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
import { createPermissionsRoutes } from './modules/permissions/permissions.routes.js';
import { createFilesRoutes } from './modules/files/files.routes.js';
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

  app.set('trust proxy', 'loopback');
  app.disable('x-powered-by');
  app.use(requestLogger);
  app.use(express.json({ limit: '10mb' }));
  app.use(cookieParser());
  app.use(createSessionMiddleware(db, config.SESSION_TTL_HOURS));

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  // Lets the static frontend pick up runtime settings without a rebuild.
  app.get('/api/config', (_req, res) => res.json({ language: config.LANGUAGE, theme: config.THEME }));

  // Anonymous: everything below is reachable with just the link.
  app.use('/api/public/:segment/:name', createPublicShareRoutes(config, shares));

  app.use('/api/auth', createAuthRoutes(db, config, t));
  app.use('/api/users', createUsersRoutes(db, t));
  app.use('/api/permissions', createPermissionsRoutes(db, config, t));
  app.use('/api/files', createFilesRoutes(db, config, t));
  app.use('/api/shares', createSharesRoutes(db, config, t, shares));

  app.use(createNotFoundHandler(t));
  app.use(createErrorHandler(t));
  return app;
}
