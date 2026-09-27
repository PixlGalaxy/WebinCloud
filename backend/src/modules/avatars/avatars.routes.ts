import { Router } from 'express';
import { createWriteStream, promises as fs, mkdirSync } from 'fs';
import { pipeline } from 'stream/promises';
import busboy from 'busboy';
import type { Db } from '../../db/client.js';
import type { EnvConfig } from '../../config/env.js';
import type { Translate } from '../../i18n/index.js';
import type { AuthenticatedRequest } from '../auth/session.middleware.js';
import { createAuthGuards } from '../auth/session.middleware.js';
import { toPublicUser } from '../auth/auth.service.js';
import { badRequest, notFound } from '../../errors.js';
import { routeParam } from '../../route-params.js';
import { SERVE_OPTIONS } from '../../serve-options.js';
import { AvatarsService, EXT_BY_MIME, MIME_BY_EXT } from './avatars.service.js';

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

export function ensureAvatarsDir(config: EnvConfig): void {
  mkdirSync(config.AVATARS_DIR, { recursive: true });
}

export function createAvatarsRoutes(db: Db, config: EnvConfig, t: Translate): Router {
  const router = Router();
  const avatars = new AvatarsService(db, config.AVATARS_DIR);
  const { requireAuth } = createAuthGuards(t);

  router.use(requireAuth);

  // Any signed-in user may fetch any other user's avatar (navbar, admin list, ...).
  router.get('/:userId', (req: AuthenticatedRequest, res, next) => {
    const userId = routeParam(req.params.userId);
    let filename: string | null;
    try {
      filename = avatars.filenameFor(userId);
    } catch (err) {
      return next(err);
    }
    if (!filename) return next(notFound());

    const ext = filename.split('.').pop() ?? '';
    res.setHeader('Content-Type', MIME_BY_EXT[ext] ?? 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Revalidate every time: the client cache-busts with ?v=<updated_at> instead.
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(avatars.absolutePath(filename), SERVE_OPTIONS, (err) => {
      if (err) next(notFound());
    });
  });

  router.post('/me', (req: AuthenticatedRequest, res, next) => {
    const userId = req.user!.id;
    const parser = busboy({ headers: req.headers, limits: { files: 1, fileSize: MAX_AVATAR_BYTES } });

    let sawFile = false;
    let failure: unknown = null;
    let partial = '';
    let filename = '';
    let write: Promise<void> = Promise.resolve();

    parser.on('file', (_field, stream, info) => {
      sawFile = true;

      const ext = EXT_BY_MIME[info.mimeType];
      if (!ext) {
        failure = badRequest('avatars.invalidType');
        stream.resume();
        return;
      }

      filename = `${userId}.${ext}`;
      partial = `${avatars.absolutePath(filename)}.part`;

      // busboy stops the stream once fileSize is hit but still ends it "cleanly".
      let truncated = false;
      stream.on('limit', () => {
        truncated = true;
        failure ??= badRequest('avatars.tooLarge');
      });

      write = pipeline(stream, createWriteStream(partial))
        .then(async () => {
          if (truncated) throw failure;
          await fs.rename(partial, avatars.absolutePath(filename));
        })
        .catch((err) => {
          failure ??= err;
        });
    });

    parser.on('error', (err) => {
      failure ??= err;
    });

    parser.on('close', () => {
      void (async () => {
        await write;

        if (!sawFile) return next(badRequest('avatars.noFile'));
        if (failure) {
          if (partial) await fs.rm(partial, { force: true }).catch(() => undefined);
          return next(failure);
        }

        const updated = await avatars.save(userId, filename);
        res.json(toPublicUser(updated));
      })();
    });

    req.pipe(parser);
  });

  router.delete('/me', (req: AuthenticatedRequest, res, next) => {
    void avatars
      .remove(req.user!.id)
      .then((updated) => res.json(toPublicUser(updated)))
      .catch(next);
  });

  return router;
}
