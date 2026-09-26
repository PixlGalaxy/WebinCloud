import { Router } from 'express';
import { createWriteStream, promises as fs, watch } from 'fs';
import { pipeline } from 'stream/promises';
import busboy from 'busboy';
import type { Db } from '../../db/client.js';
import type { EnvConfig } from '../../config/env.js';
import type { Translate } from '../../i18n/index.js';
import type { AuthenticatedRequest } from '../auth/session.middleware.js';
import { createAuthGuards } from '../auth/session.middleware.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { badRequest, notFound } from '../../errors.js';
import { logger } from '../../logger.js';
import { FilesService, type ConflictMode } from './files.service.js';
import { normalizeRelPath } from './path-safety.js';
import { SERVE_OPTIONS } from '../../serve-options.js';

const CONFLICT_MODES: ConflictMode[] = ['fail', 'overwrite', 'keepBoth'];

function conflictMode(value: unknown): ConflictMode {
  return CONFLICT_MODES.includes(value as ConflictMode) ? (value as ConflictMode) : 'fail';
}

function queryPath(value: unknown): string {
  if (value === undefined) return '';
  if (typeof value !== 'string') throw badRequest('files.invalidPath');
  return normalizeRelPath(value);
}

export function createFilesRoutes(db: Db, config: EnvConfig, t: Translate): Router {
  const router = Router();
  const files = new FilesService(db, config.DATA_ROOT);
  const { requireAuth } = createAuthGuards(t);

  router.use(requireAuth);

  router.get(
    '/',
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      res.json(await files.list(req.user!, queryPath(req.query.path)));
    }),
  );

  router.post(
    '/mkdir',
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const { path, name } = req.body as { path?: string; name?: string };
      if (typeof name !== 'string') throw badRequest('files.invalidName');
      res.status(201).json(await files.createFolder(req.user!, normalizeRelPath(path), name));
    }),
  );

  router.patch(
    '/rename',
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const { path, newName } = req.body as { path?: string; newName?: string };
      if (typeof newName !== 'string') throw badRequest('files.invalidName');
      res.json(await files.rename(req.user!, normalizeRelPath(path), newName));
    }),
  );

  router.delete(
    '/',
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      await files.remove(req.user!, queryPath(req.query.path));
      res.status(204).end();
    }),
  );

  router.get(
    '/download',
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const { absolute, name } = await files.resolveFile(req.user!, queryPath(req.query.path));
      // res.download streams and honours Range requests.
      res.download(absolute, name, SERVE_OPTIONS);
    }),
  );

  router.get(
    '/raw',
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const { absolute, mime } = await files.resolveInlineFile(req.user!, queryPath(req.query.path));
      // Never let the browser re-interpret the bytes as something scriptable.
      res.setHeader('Content-Type', mime);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; object-src 'self'");
      res.sendFile(absolute, SERVE_OPTIONS);
    }),
  );

  router.get(
    '/content',
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      res.json(await files.readText(req.user!, queryPath(req.query.path)));
    }),
  );

  router.put(
    '/content',
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const { content } = req.body as { content?: unknown };
      if (typeof content !== 'string') throw badRequest('files.invalidContent');
      await files.writeText(req.user!, queryPath(req.query.path), content);
      res.status(204).end();
    }),
  );

  router.get(
    '/search',
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const { q } = req.query;
      if (typeof q !== 'string') throw badRequest('files.searchQueryRequired');
      res.json(await files.search(req.user!, queryPath(req.query.path), q));
    }),
  );

  router.post(
    '/check-conflicts',
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const { path, names } = req.body as { path?: string; names?: unknown };
      if (!Array.isArray(names) || names.some((n) => typeof n !== 'string')) {
        throw badRequest('files.invalidName');
      }
      res.json({ conflicts: files.checkConflicts(req.user!, normalizeRelPath(path), names as string[]) });
    }),
  );

  /** Server-sent events: one message whenever the watched folder changes. */
  router.get('/events', (req: AuthenticatedRequest, res, next) => {
    let absolute: string;
    try {
      absolute = files.watchTarget(req.user!, queryPath(req.query.path));
    } catch (err) {
      return next(err);
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 5000\n\n');

    let timer: NodeJS.Timeout | null = null;
    const notify = () => {
      // Editors touch a file several times; collapse the burst into one message.
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => res.write(`data: changed\n\n`), 150);
    };

    let watcher: ReturnType<typeof watch> | null = null;
    try {
      watcher = watch(absolute, notify);
      watcher.on('error', () => res.end());
    } catch {
      return next(notFound());
    }

    const heartbeat = setInterval(() => res.write(': ping\n\n'), 30_000);

    req.on('close', () => {
      clearInterval(heartbeat);
      if (timer) clearTimeout(timer);
      watcher?.close();
    });
  });

  router.post('/upload', (req: AuthenticatedRequest, res, next) => {
    let folderPath: string;
    let onConflict: ConflictMode;
    try {
      folderPath = queryPath(req.query.path);
      onConflict = conflictMode(req.query.onConflict);
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

      let target: { absolute: string; relPath: string };
      try {
        target = files.uploadTarget(req.user!, folderPath, info.filename, onConflict);
      } catch (err) {
        fail(err);
        stream.resume();
        return;
      }

      // Write to a .part file so readers never see a half-uploaded file.
      const partial = `${target.absolute}.part`;
      partials.push(partial);

      writes.push(
        pipeline(stream, createWriteStream(partial))
          .then(() => fs.rename(partial, target.absolute))
          .then(() => {
            saved.push(target.relPath);
          })
          .catch(fail),
      );
    });

    parser.on('error', fail);

    parser.on('close', () => {
      void (async () => {
        await Promise.all(writes);

        if (failure) {
          await Promise.all(
            partials.map((partial) => fs.rm(partial, { force: true }).catch(() => undefined)),
          );
          return next(failure);
        }

        if (saved.length === 0) return next(badRequest('files.noFilesUploaded'));

        logger.info(`Uploaded ${saved.length} file(s) to "${folderPath || '/'}"`);
        res.status(201).json({ uploaded: saved });
      })();
    });

    req.pipe(parser);
  });

  return router;
}
