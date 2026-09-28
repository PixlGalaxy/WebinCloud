import { Router } from 'express';
import type { Db } from '../../db/client.js';
import type { EnvConfig } from '../../config/env.js';
import type { Translate } from '../../i18n/index.js';
import type { AuthenticatedRequest } from './session.middleware.js';
import { createAuthGuards } from './session.middleware.js';
import { AuthService, isThemeMode, isThemeSkin, toPublicUser } from './auth.service.js';
import { logger } from '../../logger.js';
import { badRequest } from '../../errors.js';
import { createRateLimiter } from '../../middleware/rate-limit.js';

export function createAuthRoutes(db: Db, config: EnvConfig, t: Translate): Router {
  const router = Router();
  const authService = new AuthService(db, config.SESSION_TTL_HOURS);
  const { requireAuth } = createAuthGuards(t);

  const loginWindowMs = config.LOGIN_RATE_LIMIT_WINDOW_MINUTES * 60 * 1000;
  // Both must pass: caps one IP hammering many accounts, and a distributed
  // attack (many IPs) hammering a single account.
  const loginIpLimiter = createRateLimiter({
    windowMs: loginWindowMs,
    max: config.LOGIN_RATE_LIMIT_MAX,
    keyFn: (req) => `ip:${req.ip}`,
    describe: (req) => `login attempts from ${req.ip}`,
  });
  const loginAccountLimiter = createRateLimiter({
    windowMs: loginWindowMs,
    max: config.LOGIN_RATE_LIMIT_MAX,
    keyFn: (req) => {
      const value = (req.body as { usernameOrEmail?: unknown })?.usernameOrEmail;
      return typeof value === 'string' && value.trim() ? `account:${value.trim().toLowerCase()}` : null;
    },
    describe: (req) => `login attempts against "${(req.body as { usernameOrEmail?: string }).usernameOrEmail}"`,
  });

  router.post('/login', loginIpLimiter, loginAccountLimiter, async (req: AuthenticatedRequest, res) => {
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
        logger.auth.warn(`Login as "${usernameOrEmail}" from ${req.ip} failed: invalid credentials`);
        return res.status(401).json({ error: t('auth.invalidCredentials') });
      }

      logger.auth.info(`Login as "${result.user.username}" from ${req.ip} succeeded`);
      if (result.mustChangePassword) {
        logger.auth.warn(`"${result.user.username}" is still using the default password and must change it`);
      }

      res.cookie('session', result.sessionToken, {
        httpOnly: true,
        secure: config.COOKIE_SECURE,
        sameSite: 'lax',
        path: '/',
        maxAge: config.SESSION_TTL_HOURS * 60 * 60 * 1000,
      });
      return res.json({ user: toPublicUser(result.user), mustChangePassword: result.mustChangePassword });
    } catch (error) {
      logger.error('Login failed', error);
      return res.status(500).json({ error: t('error.internal') });
    }
  });

  router.post('/logout', requireAuth, (req: AuthenticatedRequest, res) => {
    authService.logout(req.session!.id);
    logger.auth.info(`Logout as "${req.user!.username}" from ${req.ip}`);
    res.clearCookie('session', { path: '/' });
    return res.json({ success: true });
  });

  router.get('/me', requireAuth, (req: AuthenticatedRequest, res) => {
    return res.json(toPublicUser(req.user!));
  });

  router.post('/appearance', requireAuth, (req: AuthenticatedRequest, res) => {
    const { mode, skin } = req.body as { mode?: unknown; skin?: unknown };
    if (mode === undefined && skin === undefined) throw badRequest('auth.invalidTheme');
    if (mode !== undefined && !isThemeMode(mode)) throw badRequest('auth.invalidTheme');
    if (skin !== undefined && !isThemeSkin(skin)) throw badRequest('auth.invalidTheme');

    const updated = authService.setAppearance(req.user!.id, { mode, skin });
    return res.json(toPublicUser(updated));
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
      if (!ok) {
        logger.auth.warn(`Password change for "${req.user!.username}" from ${req.ip} failed: wrong current password`);
        return res.status(401).json({ error: t('auth.currentPasswordIncorrect') });
      }
      logger.auth.info(`Password changed for "${req.user!.username}" from ${req.ip}`);
      res.clearCookie('session', { path: '/' });
      return res.json({ success: true });
    } catch (error) {
      logger.error('Password change failed', error);
      return res.status(500).json({ error: t('error.internal') });
    }
  });

  return router;
}
