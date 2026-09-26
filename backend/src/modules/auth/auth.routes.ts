import { Router } from 'express';
import type { Db } from '../../db/client.js';
import type { EnvConfig } from '../../config/env.js';
import type { Translate } from '../../i18n/index.js';
import type { AuthenticatedRequest } from './session.middleware.js';
import { createAuthGuards } from './session.middleware.js';
import { AuthService, toPublicUser } from './auth.service.js';
import { logger } from '../../logger.js';

export function createAuthRoutes(db: Db, config: EnvConfig, t: Translate): Router {
  const router = Router();
  const authService = new AuthService(db, config.SESSION_TTL_HOURS);
  const { requireAuth } = createAuthGuards(t);

  router.post('/login', async (req: AuthenticatedRequest, res) => {
    const { usernameOrEmail, password } = req.body as { usernameOrEmail?: string; password?: string };
    if (!usernameOrEmail || !password) {
      return res.status(400).json({ error: t('auth.credentialsRequired') });
    }

    try {
      const result = await authService.login(usernameOrEmail, password, {
        userAgent: req.get('user-agent'),
        ip: req.ip,
      });
      if (!result) {
        return res.status(401).json({ error: t('auth.invalidCredentials') });
      }

      res.cookie('session', result.sessionToken, {
        httpOnly: true,
        secure: config.COOKIE_SECURE,
        sameSite: 'lax',
        path: '/',
        maxAge: config.SESSION_TTL_HOURS * 60 * 60 * 1000,
      });
      return res.json({ user: toPublicUser(result.user) });
    } catch (error) {
      logger.error('Login failed', error);
      return res.status(500).json({ error: t('error.internal') });
    }
  });

  router.post('/logout', requireAuth, (req: AuthenticatedRequest, res) => {
    authService.logout(req.session!.id);
    res.clearCookie('session', { path: '/' });
    return res.json({ success: true });
  });

  router.get('/me', requireAuth, (req: AuthenticatedRequest, res) => {
    return res.json(toPublicUser(req.user!));
  });

  router.post('/change-password', requireAuth, async (req: AuthenticatedRequest, res) => {
    const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: t('auth.passwordsRequired') });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: t('auth.passwordTooShort') });
    }

    try {
      const ok = await authService.changePassword(req.user!.id, currentPassword, newPassword);
      if (!ok) return res.status(401).json({ error: t('auth.currentPasswordIncorrect') });
      res.clearCookie('session', { path: '/' });
      return res.json({ success: true });
    } catch (error) {
      logger.error('Password change failed', error);
      return res.status(500).json({ error: t('error.internal') });
    }
  });

  return router;
}
