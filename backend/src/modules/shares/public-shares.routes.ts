import { Router } from 'express';
import { createWriteStream, existsSync, promises as fs, statSync } from 'fs';
import { basename, extname, join } from 'path';
import { pipeline } from 'stream/promises';
import busboy from 'busboy';
import type { EnvConfig } from '../../config/env.js';
import type { Share } from '../../types/index.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { createRateLimiter, type RateLimiter } from '../../middleware/rate-limit.js';
import { badRequest, forbidden, notFound, payloadTooLarge } from '../../errors.js';
import { logger } from '../../logger.js';
import { logFileAction, PUBLIC_ACTOR } from '../../activity.js';
import { assertValidName, joinRelPath, normalizeRelPath, resolveSafePath } from '../files/path-safety.js';
import { inlineMimeOf, previewKindOf } from '../files/mime.js';
import { partialPath, uploadLimit } from '../files/files.routes.js';
import { SHARE_COOKIE_PREFIX, UNLOCK_TTL_MS, type SharesService } from './shares.service.js';
import type { ArchiveOwner, ArchivesService } from '../archives/archives.service.js';
import { routeParam } from '../../route-params.js';
import { SERVE_OPTIONS } from '../../serve-options.js';

interface PublicRequest extends Express.Request {
  share?: Share;
}

export function createPublicShareRoutes(
  config: EnvConfig,
  shares: SharesService,
  archives: ArchivesService,
): { router: Router; unlockIpLimiter: RateLimiter } {
  const router = Router({ mergeParams: true });

  const unlockWindowMs = config.SHARE_UNLOCK_RATE_LIMIT_WINDOW_MINUTES * 60 * 1000;
  // Both must pass: caps one IP scanning many shares, and a distributed attack
  // (many IPs) guessing a single share's password.
  const unlockIpLimiter = createRateLimiter({
    windowMs: unlockWindowMs,
    max: config.SHARE_UNLOCK_RATE_LIMIT_MAX,
    keyFn: (req) => `ip:${req.ip}`,
    describe: (req) => `share unlock attempts from ${req.ip}`,
  });
  const unlockShareLimiter = createRateLimiter({
    windowMs: unlockWindowMs,
    max: config.SHARE_UNLOCK_RATE_LIMIT_MAX,
    keyFn: (req) => `share:${req.params.segment}/${req.params.name}`,
    describe: (req) => `share unlock attempts against ${req.params.segment}/${req.params.name}`,
  });

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
    // The owner lost access (grant revoked, account deactivated): the link is dead too.
    if (!shares.ownerAccess(share, share.target_path).read) return next(notFound());
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

  /** Path relative to the data root, for checking the owner's grants. */
  const dataRelPath = (share: Share, inner: string): string =>
    share.target_type === 'file' ? share.target_path : joinRelPath(share.target_path, inner);

  const assertOwnerCanRead = (share: Share, inner: string): void => {
    if (!shares.ownerAccess(share, dataRelPath(share, inner)).read) throw notFound();
  };

  // Both branches go through resolveSafePath, so a symlink leaving the data
  // volume is refused for file shares too.
  const absoluteInside = (share: Share, inner: string): string => {
    const root = shareRoot(share);
    return share.target_type === 'file' ? resolveSafePath(root, share.name) : resolveSafePath(root, inner);
  };

  router.get(
    '/',
    load,
    asyncHandler(async (req: any, res) => {
      const share = (req as PublicRequest).share!;
      const size =
        share.target_type === 'file'
          ? await fs
              .stat(absoluteInside(share, ''))
              .then((stats) => stats.size)
              .catch(() => undefined)
          : undefined;

      res.json({
        name: share.name,
        type: share.target_type,
        allowDownload: share.allow_download === 1,
        allowUpload: share.allow_upload === 1,
        requiresPassword: share.password_hash !== null,
        unlocked: shares.isUnlocked(share, req.cookies?.[SHARE_COOKIE_PREFIX + share.id]),
        previewKind: share.target_type === 'file' ? previewKindOf(share.name) : 'none',
        size,
      });
    }),
  );

  router.post(
    '/unlock',
    unlockIpLimiter.middleware,
    unlockShareLimiter.middleware,
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
        maxAge: UNLOCK_TTL_MS,
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
      assertOwnerCanRead(share, inner);
      const absolute = resolveSafePath(shareRoot(share), inner);

      const names = await fs.readdir(absolute).catch(() => {
        throw notFound();
      });

      const canRead = shares.ownerReadChecker(share);
      const entries = names.flatMap((entryName) => {
        let full: string;
        try {
          full = resolveSafePath(absolute, entryName); // skips symlinks that leave the volume
        } catch {
          return [];
        }
        if (!existsSync(full)) return [];
        if (!canRead(dataRelPath(share, joinRelPath(inner, entryName)))) return [];
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
      const inner = innerPath(share, req.query.path);
      assertOwnerCanRead(share, inner);
      const absolute = absoluteInside(share, inner);

      const stats = await fs.stat(absolute).catch(() => {
        throw notFound();
      });
      if (stats.isDirectory()) throw notFound();

      // Behaves like opening the file in a browser: shown when it can be shown
      // safely, downloaded otherwise.
      const mime = req.query.inline === '1' ? inlineMimeOf(absolute) : null;
      if (mime) {
        // inlineMimeOf() never hands back text/html or image/svg+xml (see mime.ts), so
        // nosniff is enough to stop the browser from ever executing this as a script —
        // a sandboxed CSP isn't needed, and it breaks Chrome's own video/PDF viewer
        // when this URL is opened directly instead of embedded in the app.
        res.setHeader('Content-Type', mime);
        res.setHeader('X-Content-Type-Options', 'nosniff');
        return res.sendFile(absolute, SERVE_OPTIONS);
      }

      logFileAction(PUBLIC_ACTOR, 'downloaded', 'file', basename(absolute), absolute);
      return res.download(absolute, basename(absolute), SERVE_OPTIONS);
    }),
  );

  // --- archives -------------------------------------------------------------
  // Holding the link is the credential, so jobs are owned by the share itself.

  const archiveOwner = (share: Share): ArchiveOwner => ({ kind: 'share', id: share.id });

  router.post('/archive', load, requireUnlocked, requireDownload, (req: any, res) => {
    const share = (req as PublicRequest).share!;
    if (share.target_type !== 'folder') throw badRequest('archives.nothingSelected');

    const { paths } = req.body as { paths?: unknown };
    if (!Array.isArray(paths) || paths.some((p) => typeof p !== 'string')) {
      throw badRequest('archives.nothingSelected');
    }

    // Empty selection means the whole shared folder.
    const inner = (paths as string[]).length > 0 ? (paths as string[]) : [''];
    const sources = inner.map((raw) => {
      const relative = innerPath(share, raw);
      const absolute = resolveSafePath(shareRoot(share), relative);
      return { absolute, nameInZip: relative === '' ? share.name : basename(relative) };
    });

    res.status(202).json(archives.startForShare(share.id, sources, share.name, shares.ownerReadChecker(share)));
  });

  router.get('/archive/:id', load, requireUnlocked, (req: any, res) => {
    res.json(archives.get(routeParam(req.params.id), archiveOwner((req as PublicRequest).share!)));
  });

  router.get('/archive/:id/download', load, requireUnlocked, requireDownload, (req: any, res) => {
    const { absolute, fileName } = archives.ready(
      routeParam(req.params.id),
      archiveOwner((req as PublicRequest).share!),
    );
    res.download(absolute, fileName, SERVE_OPTIONS);
  });

  router.delete(
    '/archive/:id',
    load,
    requireUnlocked,
    asyncHandler(async (req: any, res) => {
      await archives.remove(routeParam(req.params.id), archiveOwner((req as PublicRequest).share!));
      res.status(204).end();
    }),
  );

  router.post('/upload', load, requireUnlocked, (req: any, res, next) => {
    const share = (req as PublicRequest).share!;
    if (share.allow_upload !== 1 || share.target_type !== 'folder') return next(forbidden());

    let folderAbsolute: string;
    let inner: string;
    try {
      inner = innerPath(share, req.query.path);
      if (!shares.ownerAccess(share, dataRelPath(share, inner)).write) return next(forbidden());
      folderAbsolute = resolveSafePath(shareRoot(share), inner);
    } catch (err) {
      return next(err);
    }

    // Uploaded folders keep their structure, so the destination may not exist yet.
    ensureFolder()
      .then(receive)
      .catch(next);

    async function ensureFolder(): Promise<void> {
      for (const segment of inner.split('/')) if (segment) assertValidName(segment);
      const created = await fs.mkdir(folderAbsolute, { recursive: true });
      if (created) logFileAction(PUBLIC_ACTOR, 'created', 'folder', basename(folderAbsolute), folderAbsolute);
    }

    function receive(): void {
      const parser = busboy({ headers: req.headers, limits: { fileSize: uploadLimit(config) } });
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

        const partial = partialPath(destination);
        partials.push(partial);

        let truncated = false;
        stream.on('limit', () => {
          truncated = true;
          fail(payloadTooLarge('files.tooLarge'));
        });

        writes.push(
          pipeline(stream, createWriteStream(partial))
            .then(() => {
              if (truncated) throw failure;
              return fs.rename(partial, destination);
            })
            .then(() => {
              saved.push(basename(destination));
              logFileAction(PUBLIC_ACTOR, 'uploaded', 'file', basename(destination), destination);
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
    }
  });

  return { router, unlockIpLimiter };
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
