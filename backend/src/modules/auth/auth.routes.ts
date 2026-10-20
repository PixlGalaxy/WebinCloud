import { Router } from 'express';
import type { Db } from '../../db/client.js';
import type { EnvConfig } from '../../config/env.js';
import type { Translate } from '../../i18n/index.js';
import { isLanguage } from '../../i18n/index.js';
import type { AuthenticatedRequest } from './session.middleware.js';
import { createAuthGuards } from './session.middleware.js';
import { isFromLocalNetwork } from './local-network.js';
import { AuthService, DEFAULT_PASSWORD, isThemeMode, isThemeSkin, toPublicUser } from './auth.service.js';
import { logger } from '../../logger.js';
import { AppError, badRequest } from '../../errors.js';
import { createRateLimiter, type RateLimiter } from '../../middleware/rate-limit.js';
import { getOrCreateSecret } from '../../db/settings.js';
import { KnownBrowsers } from './known-browsers.js';
import type { MetricsService } from '../admin/metrics.service.js';
import { EMAIL, MAX_PASSWORD_LENGTH, USERNAME, assertUniqueUser } from '../users/validation.js';

export function createAuthRoutes(
  db: Db,
  config: EnvConfig,
  t: Translate,
  metrics: MetricsService,
): { router: Router; loginIpLimiter: RateLimiter; loginAccountLimiter: RateLimiter } {
  const router = Router();
  const authService = new AuthService(db, config.SESSION_TTL_HOURS);
  const { requireAuth } = createAuthGuards(t);

  authService.pruneExpired();
  setInterval(() => authService.pruneExpired(), 60 * 60 * 1000).unref();

  const loginWindowMs = config.LOGIN_RATE_LIMIT_WINDOW_MINUTES * 60 * 1000;
  // Both must pass: caps one IP hammering many accounts, and a distributed
  // attack (many IPs) hammering a single account.
  const loginIpLimiter = createRateLimiter({
    windowMs: loginWindowMs,
    max: config.LOGIN_RATE_LIMIT_MAX,
    keyFn: (req) => `ip:${req.ip}`,
    describe: (req) => `login attempts from ${req.ip}`,
  });
  // Browsers that signed in to the account before are exempt, so wrong guesses
  // from elsewhere cannot lock its owner out (see KnownBrowsers).
  const knownBrowsers = new KnownBrowsers(db, getOrCreateSecret(db, 'known_browser_secret'), config.COOKIE_SECURE);
  const loginAccountLimiter = knownBrowsers.exempt(
    createRateLimiter({
      windowMs: loginWindowMs,
      max: config.LOGIN_RATE_LIMIT_MAX,
      keyFn: (req) => {
        const value = (req.body as { usernameOrEmail?: unknown })?.usernameOrEmail;
        return typeof value === 'string' && value.trim() ? `account:${value.trim().toLowerCase()}` : null;
      },
      describe: (req) => `login attempts against "${(req.body as { usernameOrEmail?: string }).usernameOrEmail}"`,
    }),
  );

  router.post('/login', loginIpLimiter.middleware, loginAccountLimiter.middleware, async (req: AuthenticatedRequest, res) => {
    const { usernameOrEmail, password } = req.body as { usernameOrEmail?: unknown; password?: unknown };
    if (typeof usernameOrEmail !== 'string' || typeof password !== 'string' || !usernameOrEmail || !password) {
      return res.status(400).json({ error: t('auth.credentialsRequired') });
    }
    // The default password is public, so whoever reaches a fresh install from
    // the internet first could claim it: it only works from the local network.
    if (password === DEFAULT_PASSWORD && !isFromLocalNetwork(req)) {
      logger.auth.warn(`Login as "${usernameOrEmail}" from ${req.ip} refused: the default password only works from the local network`);
      return res.status(403).json({ error: t('auth.defaultPasswordLocalOnly') });
    }
    // No account can have a longer password, so skip argon2 and answer like any wrong guess.
    if (password.length > MAX_PASSWORD_LENGTH) {
      logger.auth.warn(`Login as "${usernameOrEmail}" from ${req.ip} failed: invalid credentials`);
      return res.status(401).json({ error: t('auth.invalidCredentials') });
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

      loginIpLimiter.refund(req);
      loginAccountLimiter.refund(req);
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
      knownBrowsers.remember(res, result.user.id);
      return res.json({
        user: toPublicUser(result.user),
        mustChangePassword: result.mustChangePassword,
        mustCompleteSetup: result.mustCompleteSetup,
      });
    } catch (error) {
      logger.error('Login failed', error);
      return res.status(500).json({ error: t('error.internal') });
    }
  });

  router.post('/logout', requireAuth, (req: AuthenticatedRequest, res) => {
    // A device signing out goes through DELETE /api/devices/current instead.
    if (req.session) authService.logout(req.session.id);
    metrics.forgetUser(req.user!.username);
    logger.auth.info(`Logout as "${req.user!.username}" from ${req.ip}`);
    res.clearCookie('session', { path: '/' });
    return res.json({ success: true });
  });

  // Same shape as /login, so a page reload restores the forced setup/password
  // prompt instead of leaving the user in front of an API that refuses them.
  router.get('/me', requireAuth, (req: AuthenticatedRequest, res) => {
    const pending = req.session?.pending_action;
    return res.json({
      user: toPublicUser(req.user!),
      mustChangePassword: pending === 'password',
      mustCompleteSetup: pending === 'setup',
    });
  });

  router.post('/appearance', requireAuth, (req: AuthenticatedRequest, res) => {
    const { mode, skin, language } = req.body as { mode?: unknown; skin?: unknown; language?: unknown };
    if (mode === undefined && skin === undefined && language === undefined) throw badRequest('auth.invalidTheme');
    if (mode !== undefined && !isThemeMode(mode)) throw badRequest('auth.invalidTheme');
    if (skin !== undefined && !isThemeSkin(skin)) throw badRequest('auth.invalidTheme');
    if (language !== undefined && (typeof language !== 'string' || !isLanguage(language))) {
      throw badRequest('auth.invalidLanguage');
    }

    const updated = authService.setAppearance(req.user!.id, { mode, skin, language });
    return res.json(toPublicUser(updated));
  });

  router.post('/change-password', requireAuth, async (req: AuthenticatedRequest, res) => {
    const { currentPassword, newPassword } = req.body as { currentPassword?: unknown; newPassword?: unknown };
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || !currentPassword || !newPassword) {
      return res.status(400).json({ error: t('auth.passwordsRequired') });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: t('auth.passwordTooShort') });
    }
    if (newPassword.length > MAX_PASSWORD_LENGTH || currentPassword.length > MAX_PASSWORD_LENGTH) {
      return res.status(400).json({ error: t('auth.passwordTooLong') });
    }

    try {
      const ok = await authService.changePassword(req.user!.id, currentPassword, newPassword);
      if (!ok) {
        logger.auth.warn(`Password change for "${req.user!.username}" from ${req.ip} failed: wrong current password`);
        return res.status(401).json({ error: t('auth.currentPasswordIncorrect') });
      }
      logger.auth.info(`Password changed for "${req.user!.username}" from ${req.ip}`);
      metrics.forgetUser(req.user!.username);
      res.clearCookie('session', { path: '/' });
      return res.json({ success: true });
    } catch (error) {
      logger.error('Password change failed', error);
      return res.status(500).json({ error: t('error.internal') });
    }
  });

  // The seeded first-run admin (username "admin", password "changeme") must
  // replace all three before doing anything else — see AuthService.login's
  // mustCompleteSetup and bootstrap.ts.
  router.post('/complete-setup', requireAuth, async (req: AuthenticatedRequest, res) => {
    const { currentPassword, newUsername, newEmail, newPassword } = req.body as {
      currentPassword?: unknown;
      newUsername?: unknown;
      newEmail?: unknown;
      newPassword?: unknown;
    };
    if (
      typeof currentPassword !== 'string' ||
      typeof newUsername !== 'string' ||
      typeof newEmail !== 'string' ||
      typeof newPassword !== 'string' ||
      !currentPassword ||
      !newUsername ||
      !newEmail ||
      !newPassword
    ) {
      return res.status(400).json({ error: t('auth.setupFieldsRequired') });
    }
    // Usernames are otherwise immutable after creation (UsersService.update has
    // no username field at all) — this endpoint is a deliberate, narrow
    // exception for exactly the seeded first-run account, not a general
    // "rename yourself" tool for every user. Both halves of its identity are
    // required: the name alone would let any later account called "admin"
    // rename itself; the password is verified against the hash further down.
    if (req.user!.username !== 'admin' || currentPassword !== DEFAULT_PASSWORD) {
      return res.status(403).json({ error: t('auth.forbidden') });
    }
    if (!isFromLocalNetwork(req)) {
      logger.auth.warn(`Setup completion for "${req.user!.username}" from ${req.ip} refused: not from the local network`);
      return res.status(403).json({ error: t('auth.defaultPasswordLocalOnly') });
    }
    if (!USERNAME.test(newUsername)) return res.status(400).json({ error: t('users.invalidUsername') });
    if (!EMAIL.test(newEmail)) return res.status(400).json({ error: t('users.invalidEmail') });
    if (newPassword.length < 8) return res.status(400).json({ error: t('auth.passwordTooShort') });
    if (newPassword.length > MAX_PASSWORD_LENGTH) return res.status(400).json({ error: t('auth.passwordTooLong') });

    try {
      assertUniqueUser(db, 'username', newUsername, req.user!.id);
      assertUniqueUser(db, 'email', newEmail, req.user!.id);

      const ok = await authService.completeSetup(req.user!.id, currentPassword, {
        username: newUsername,
        email: newEmail,
        password: newPassword,
      });
      if (!ok) {
        logger.auth.warn(`Setup completion for "${req.user!.username}" from ${req.ip} failed: wrong current password`);
        return res.status(401).json({ error: t('auth.currentPasswordIncorrect') });
      }
      logger.auth.info(`"${req.user!.username}" completed first-run setup as "${newUsername}" from ${req.ip}`);
      metrics.forgetUser(req.user!.username);
      res.clearCookie('session', { path: '/' });
      return res.json({ success: true });
    } catch (error) {
      if (error instanceof AppError) throw error; // conflict() from assertUniqueUser — Express 5 forwards it to the error handler.
      logger.error('Setup completion failed', error);
      return res.status(500).json({ error: t('error.internal') });
    }
  });

  return { router, loginIpLimiter, loginAccountLimiter };
}
