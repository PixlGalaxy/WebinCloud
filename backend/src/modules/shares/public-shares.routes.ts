import { Router } from 'express';
import { createWriteStream, existsSync, promises as fs, statSync } from 'fs';
import { basename, extname, join } from 'path';
import { pipeline } from 'stream/promises';
import busboy from 'busboy';
import type { EnvConfig } from '../../config/env.js';
import type { Share } from '../../types/index.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { badRequest, forbidden, notFound } from '../../errors.js';
import { logger } from '../../logger.js';
import { assertValidName, normalizeRelPath, resolveSafePath } from '../files/path-safety.js';
import { inlineMimeOf, previewKindOf } from '../files/mime.js';
import { SHARE_COOKIE_PREFIX, type SharesService } from './shares.service.js';

interface PublicRequest extends Express.Request {
  share?: Share;
}

export function createPublicShareRoutes(config: EnvConfig, shares: SharesService): Router {
  const router = Router({ mergeParams: true });

  /** Root of the shared subtree; nothing outside it is reachable. */
  const shareRoot = (share: Share) =>
    share.target_type === 'folder'
      ? resolveSafePath(config.DATA_ROOT, share.target_path)
      : resolveSafePath(config.DATA_ROOT, share.target_path.slice(0, -share.name.length) || '.');

  const load = (req: any, _res: any, next: any) => {
    const share = shares.findPublic(req.params.segment, req.params.name);
    if (!share) return next(notFound());
    try {
      shares.assertUsable(share);
    } catch (err) {
      return next(err);
    }
    (req as PublicRequest).share = share;
    next();
  };

  const requireUnlocked = (req: any, _res: any, next: any) => {
    const share = (req as PublicRequest).share!;
    if (!shares.isUnlocked(share, req.cookies?.[SHARE_COOKIE_PREFIX + share.id])) {
      return next(forbidden('shares.passwordRequired'));
    }
    next();
  };

  const requireDownload = (req: any, _res: any, next: any) => {
    if ((req as PublicRequest).share!.allow_download !== 1) return next(forbidden());
    next();
  };

  /** Path inside the share, for folder shares only. */
  const innerPath = (share: Share, raw: unknown): string => {
    if (share.target_type === 'file') return '';
    if (raw === undefined) return '';
    if (typeof raw !== 'string') throw badRequest('files.invalidPath');
    return normalizeRelPath(raw);
  };

  const absoluteInside = (share: Share, inner: string): string => {
    const root = shareRoot(share);
    return share.target_type === 'file' ? join(root, share.name) : resolveSafePath(root, inner);
  };

  router.get('/', load, (req: any, res) => {
    const share = (req as PublicRequest).share!;
    res.json({
      name: share.name,
      type: share.target_type,
      allowDownload: share.allow_download === 1,
      allowUpload: share.allow_upload === 1,
      requiresPassword: share.password_hash !== null,
      unlocked: shares.isUnlocked(share, req.cookies?.[SHARE_COOKIE_PREFIX + share.id]),
      previewKind: share.target_type === 'file' ? previewKindOf(share.name) : 'none',
    });
  });

  router.post(
    '/unlock',
    load,
    asyncHandler(async (req: any, res) => {
      const share = (req as PublicRequest).share!;
      const { password } = req.body as { password?: unknown };
      if (typeof password !== 'string') throw badRequest('shares.passwordRequired');

      if (!(await shares.checkPassword(share, password))) {
        throw forbidden('shares.wrongPassword');
      }

      res.cookie(SHARE_COOKIE_PREFIX + share.id, shares.unlockToken(share), {
        httpOnly: true,
        secure: config.COOKIE_SECURE,
        sameSite: 'lax',
        path: '/',
        maxAge: 12 * 60 * 60 * 1000,
      });
      res.json({ unlocked: true });
    }),
  );

  router.get(
    '/list',
    load,
    requireUnlocked,
    requireDownload,
    asyncHandler(async (req: any, res) => {
      const share = (req as PublicRequest).share!;
      if (share.target_type !== 'folder') throw notFound();

      const inner = innerPath(share, req.query.path);
      const absolute = resolveSafePath(shareRoot(share), inner);

      const names = await fs.readdir(absolute).catch(() => {
        throw notFound();
      });

      const entries = names.flatMap((entryName) => {
        const full = join(absolute, entryName);
        if (!existsSync(full)) return [];
        const stats = statSync(full);
        const isDir = stats.isDirectory();
        return [
          {
            name: entryName,
            path: inner ? `${inner}/${entryName}` : entryName,
            type: isDir ? 'folder' : 'file',
            size: isDir ? 0 : stats.size,
            modifiedAt: stats.mtime.toISOString(),
            previewKind: isDir ? 'none' : previewKindOf(entryName),
          },
        ];
      });

      res.json({ path: inner, entries });
    }),
  );

  router.get(
    '/download',
    load,
    requireUnlocked,
    requireDownload,
    asyncHandler(async (req: any, res) => {
      const share = (req as PublicRequest).share!;
      const absolute = absoluteInside(share, innerPath(share, req.query.path));

      const stats = await fs.stat(absolute).catch(() => {
        throw notFound();
      });
      if (stats.isDirectory()) throw notFound();

      // Behaves like opening the file in a browser: shown when it can be shown
      // safely, downloaded otherwise.
      const mime = req.query.inline === '1' ? inlineMimeOf(absolute) : null;
      if (mime) {
        res.setHeader('Content-Type', mime);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; object-src 'self'");
        return res.sendFile(absolute);
      }

      return res.download(absolute, basename(absolute));
    }),
  );

  router.post('/upload', load, requireUnlocked, (req: any, res, next) => {
    const share = (req as PublicRequest).share!;
    if (share.allow_upload !== 1 || share.target_type !== 'folder') return next(forbidden());

    let folderAbsolute: string;
    let inner: string;
    try {
      inner = innerPath(share, req.query.path);
      folderAbsolute = resolveSafePath(shareRoot(share), inner);
    } catch (err) {
      return next(err);
    }

    const parser = busboy({ headers: req.headers });
    const partials: string[] = [];
    const saved: string[] = [];
    const writes: Promise<void>[] = [];
    let failure: unknown = null;
    const fail = (err: unknown) => {
      failure ??= err;
    };

    parser.on('file', (_field, stream, info) => {
      if (failure) {
        stream.resume();
        return;
      }

      let destination: string;
      try {
        assertValidName(info.filename);
        // Public uploads never replace an existing file: a link holder must not
        // be able to destroy content, only add to it.
        destination = freeName(folderAbsolute, info.filename);
      } catch (err) {
        fail(err);
        stream.resume();
        return;
      }

      const partial = `${destination}.part`;
      partials.push(partial);
      writes.push(
        pipeline(stream, createWriteStream(partial))
          .then(() => fs.rename(partial, destination))
          .then(() => {
            saved.push(basename(destination));
          })
          .catch(fail),
      );
    });

    parser.on('error', fail);

    parser.on('close', () => {
      void (async () => {
        await Promise.all(writes);
        if (failure) {
          await Promise.all(partials.map((p) => fs.rm(p, { force: true }).catch(() => undefined)));
          return next(failure);
        }
        if (saved.length === 0) return next(badRequest('files.noFilesUploaded'));

        logger.info(`Public upload of ${saved.length} file(s) to share ${share.id}`);
        res.status(201).json({ uploaded: saved });
      })();
    });

    req.pipe(parser);
  });

  return router;
}

function freeName(folder: string, name: string): string {
  const direct = join(folder, name);
  if (!existsSync(direct)) return direct;

  const ext = extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let attempt = 1; attempt < 1000; attempt++) {
    const candidate = join(folder, `${stem} (${attempt + 1})${ext}`);
    if (!existsSync(candidate)) return candidate;
  }
  throw badRequest('files.alreadyExists');
}
