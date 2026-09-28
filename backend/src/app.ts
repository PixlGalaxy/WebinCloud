import express from 'express';
import cookieParser from 'cookie-parser';
import type { Db } from './db/client.js';
import type { EnvConfig } from './config/env.js';
import { getOrCreateSecret } from './db/settings.js';
import { createTranslator } from './i18n/index.js';
import { requestLogger } from './middleware/request-logger.js';
import { createSessionMiddleware } from './modules/auth/session.middleware.js';
import { createAuthRoutes } from './modules/auth/auth.routes.js';
import { hashPassword, verifyPassword } from './modules/auth/password.js';
import { createUsersRoutes } from './modules/users/users.routes.js';
import { createLogsRoutes } from './modules/logs/logs.routes.js';
import { createAvatarsRoutes, ensureAvatarsDir } from './modules/avatars/avatars.routes.js';
import { createPermissionsRoutes } from './modules/permissions/permissions.routes.js';
import { createFilesRoutes } from './modules/files/files.routes.js';
import { ThumbnailService } from './modules/thumbnails/thumbnails.service.js';
import { ArchivesService } from './modules/archives/archives.service.js';
import { createArchivesRoutes } from './modules/archives/archives.routes.js';
import { TransfersService } from './modules/transfers/transfers.service.js';
import { createTransfersRoutes } from './modules/transfers/transfers.routes.js';
import { createBrandingRoutes, seedBranding } from './modules/branding/branding.routes.js';
import { SharesService } from './modules/shares/shares.service.js';
import { createSharesRoutes } from './modules/shares/shares.routes.js';
import { createPublicShareRoutes } from './modules/shares/public-shares.routes.js';
import { createErrorHandler, createNotFoundHandler } from './middleware/error-handler.js';

export function createApp(db: Db, config: EnvConfig): express.Application {
  const app = express();
  const t = createTranslator(config.LOCALES_DIR, config.LANGUAGE);
  const shares = new SharesService(
    db,
    config.DATA_ROOT,
    getOrCreateSecret(db, 'share_unlock_secret'),
    hashPassword,
    verifyPassword,
  );
  const archives = new ArchivesService(
    db,
    config.DATA_ROOT,
    config.TEMP_ROOT,
    config.ARCHIVE_ABANDON_SECONDS * 1000,
  );
  void archives.sweep();

  const thumbnails = ThumbnailService.fromConfig(config);
  void thumbnails.detect();
  void thumbnails.sweep();
  setInterval(() => void thumbnails.sweep(), 24 * 60 * 60 * 1000).unref();
  // Frees compressions whose client closed the tab or lost connection. Checked
  // several times per window, so abandonment is never missed between ticks.
  const abandonCheckMs = Math.max(1000, Math.min(10_000, (config.ARCHIVE_ABANDON_SECONDS * 1000) / 3));
  setInterval(() => void archives.dropAbandoned(), abandonCheckMs).unref();

  const transfers = new TransfersService(db, config.DATA_ROOT, config.ARCHIVE_ABANDON_SECONDS * 1000);
  setInterval(() => transfers.dropAbandoned(), abandonCheckMs).unref();
  setInterval(() => transfers.sweep(), 15 * 60 * 1000).unref();

  app.set('trust proxy', 'loopback');
  app.disable('x-powered-by');
  app.use(requestLogger);
  app.use(express.json({ limit: '10mb' }));
  app.use(cookieParser());
  app.use(createSessionMiddleware(db, config.SESSION_TTL_HOURS));

  seedBranding(config);
  app.use('/api/branding', createBrandingRoutes(config));

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  // Lets the static frontend pick up runtime settings without a rebuild.
  app.get('/api/config', (_req, res) =>
    res.json({
      language: config.LANGUAGE,
      theme: config.THEME,
      appName: config.APP_NAME,
      appTitle: config.APP_TITLE,
      // A session dies at SESSION_TTL_HOURS regardless of activity, so an
      // inactivity timeout longer than that would never actually trigger.
      maxAutoSignoutMinutes: config.SESSION_TTL_HOURS * 60,
    }),
  );

  // Anonymous: everything below is reachable with just the link.
  app.use('/api/public/:segment/:name', createPublicShareRoutes(config, shares, archives));

  app.use('/api/auth', createAuthRoutes(db, config, t));
  app.use('/api/users', createUsersRoutes(db, t));
  app.use('/api/logs', createLogsRoutes(t));
  ensureAvatarsDir(config);
  app.use('/api/avatars', createAvatarsRoutes(db, config, t));
  app.use('/api/permissions', createPermissionsRoutes(db, config, t));
  app.use('/api/files', createFilesRoutes(db, config, t, thumbnails));

  // Keeps the temp volume from growing without bound on a long-lived server.
  setInterval(() => void archives.sweep(), 15 * 60 * 1000).unref();
  app.use('/api/archives', createArchivesRoutes(t, archives));
  app.use('/api/transfers', createTransfersRoutes(t, transfers));

  app.use('/api/shares', createSharesRoutes(db, config, t, shares));

  app.use(createNotFoundHandler(t));
  app.use(createErrorHandler(t));
  return app;
}
