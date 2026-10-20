import { Router } from 'express';
import type { Translate } from '../../i18n/index.js';
import type { RateLimiter } from '../../middleware/rate-limit.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { badRequest, forbidden } from '../../errors.js';
import { logger } from '../../logger.js';
import { createAuthGuards, type AuthenticatedRequest } from '../auth/session.middleware.js';
import { AuthService, DEFAULT_PASSWORD, toPublicUser } from '../auth/auth.service.js';
import { MAX_PASSWORD_LENGTH } from '../users/validation.js';
import { routeParam } from '../../route-params.js';
import { DevicesService, deviceName, loopbackRedirect, platform } from './devices.service.js';
import { changes } from './change-bus.js';
import type { Db } from '../../db/client.js';
import { getAccess } from '../permissions/access-check.js';

/**
 * Sign-in for desktop apps and other clients that are not the web interface.
 *
 * Browser approval (preferred): the app opens /connect in the browser with a
 * PKCE challenge and a loopback redirect; the signed-in user approves, the
 * page calls POST /authorize and hands the code to the app, which trades it
 * at POST /token. The password never passes through the app.
 *
 * Password (fallback, e.g. scripts): POST /login, under the same rules and
 * rate limits as the web login.
 *
 * Either way the app then sends `Authorization: Bearer <accessToken>` and
 * renews it at POST /token with its refresh token.
 */
/** How quickly an open app learns it was disconnected. */
const SIGNED_IN_CHECK_MS = 3000;
/** Open event streams one device may hold; a new one beyond this closes the oldest. */
const MAX_STREAMS_PER_DEVICE = 3;

export function createDevicesRoutes(
  db: Db,
  devices: DevicesService,
  authService: AuthService,
  t: Translate,
  loginIpLimiter: RateLimiter,
  loginAccountLimiter: RateLimiter,
): Router {
  const router = Router();
  const { requireAuth } = createAuthGuards(t);
  // Each stream costs timers and a lookup every few seconds, so one device
  // (or a stolen token) cannot open them without limit.
  const streams = new Map<string, Set<{ end: () => void }>>();

  router.post(
    '/login',
    loginIpLimiter.middleware,
    loginAccountLimiter.middleware,
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const { usernameOrEmail, password } = req.body as { usernameOrEmail?: unknown; password?: unknown };
      if (typeof usernameOrEmail !== 'string' || typeof password !== 'string' || !usernameOrEmail || !password) {
        throw badRequest('auth.credentialsRequired');
      }
      const name = deviceName(req.body.deviceName);
      // Refused before checking it, so the answer never confirms that an account
      // still has the public default password. It is replaced in the web interface.
      if (password === DEFAULT_PASSWORD) throw forbidden('devices.finishSetupInBrowser');

      const user = password.length > MAX_PASSWORD_LENGTH ? null : await authService.verifyCredentials(usernameOrEmail, password);
      if (!user) {
        logger.auth.warn(`Device sign-in as "${usernameOrEmail}" from ${req.ip} failed: invalid credentials`);
        return res.status(401).json({ error: t('auth.invalidCredentials') });
      }
      loginIpLimiter.refund(req);
      loginAccountLimiter.refund(req);
      const tokens = devices.issue(user, name, platform(req.body.platform), req.ip);
      logger.auth.info(`"${user.username}" signed in device "${name}" from ${req.ip}`);
      return res.status(201).json({ ...tokens, user: toPublicUser(user) });
    }),
  );

  // From the signed-in browser only: a device must not be able to enrol others.
  router.post('/authorize', requireAuth, (req: AuthenticatedRequest, res) => {
    if (req.device) throw forbidden();
    const { codeChallenge, codeChallengeMethod } = req.body as { codeChallenge?: unknown; codeChallengeMethod?: unknown };
    if (codeChallengeMethod !== 'S256' || typeof codeChallenge !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) {
      throw badRequest('devices.invalidRequest');
    }
    const name = deviceName(req.body.deviceName);
    const code = devices.createCode(req.user!, {
      challenge: codeChallenge,
      redirectUri: loopbackRedirect(req.body.redirectUri),
      name,
      platform: platform(req.body.platform),
    });
    logger.auth.info(`"${req.user!.username}" approved device "${name}" from ${req.ip}`);
    res.json({ code });
  });

  router.post('/token', (req: AuthenticatedRequest, res) => {
    const body = req.body as { grantType?: unknown; code?: unknown; codeVerifier?: unknown; redirectUri?: unknown; refreshToken?: unknown };

    if (body.grantType === 'authorization_code') {
      const tokens = devices.redeemCode(body.code, body.codeVerifier, body.redirectUri, req.ip);
      return res.status(201).json(tokens);
    }
    if (body.grantType === 'refresh_token') {
      return res.json(devices.refresh(body.refreshToken, req.ip));
    }
    throw badRequest('devices.invalidRequest');
  });

  /**
   * Held open by the app. Carries:
   * - `changed` with `{ "path": "<folder>" }` when something in a folder the
   *   user can read was created, edited, renamed, moved or deleted, so the app
   *   refreshes that folder;
   * - `signed-out` as soon as the device is disconnected by any means (the
   *   user, an admin, a password change, a deactivated account), after which
   *   the stream ends.
   */
  router.get('/events', requireAuth, (req: AuthenticatedRequest, res) => {
    if (!req.device) throw badRequest('devices.invalidRequest');
    const deviceId = req.device.id;

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 5000\n\n');

    const open = streams.get(deviceId) ?? new Set<{ end: () => void }>();
    streams.set(deviceId, open);
    if (open.size >= MAX_STREAMS_PER_DEVICE) open.values().next().value?.end();
    const handle = { end: () => res.end() };
    open.add(handle);

    // One indexed lookup every few seconds per connected device.
    const check = setInterval(() => {
      if (devices.isSignedIn(deviceId)) return;
      clearInterval(check);
      res.write('event: signed-out\ndata: {}\n\n');
      res.end();
    }, SIGNED_IN_CHECK_MS);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 30_000);

    const user = req.user!;
    const onChange = (folder: string) => {
      // Only folders this user can see; a non-admin's root is their granted folders, not the volume.
      if (folder === '' && user.role !== 'admin') return;
      if (!getAccess(db, user, folder).read) return;
      res.write(`event: changed\ndata: ${JSON.stringify({ path: folder })}\n\n`);
    };
    changes.on('changed', onChange);

    req.on('close', () => {
      clearInterval(check);
      clearInterval(heartbeat);
      changes.off('changed', onChange);
      open.delete(handle);
      if (open.size === 0) streams.delete(deviceId);
    });
  });

  router.get('/', requireAuth, (req: AuthenticatedRequest, res) => {
    res.json(devices.list(req.user!.id).map((device) => ({ ...device, current: device.id === req.device?.id })));
  });

  // The app signing itself out.
  router.delete('/current', requireAuth, (req: AuthenticatedRequest, res) => {
    if (!req.device) throw badRequest('devices.invalidRequest');
    devices.revoke(req.user!.id, req.device.id);
    res.status(204).end();
  });

  router.delete('/:id', requireAuth, (req: AuthenticatedRequest, res) => {
    devices.revoke(req.user!.id, routeParam(req.params.id));
    logger.auth.info(`"${req.user!.username}" disconnected a device from ${req.ip}`);
    res.status(204).end();
  });

  return router;
}
