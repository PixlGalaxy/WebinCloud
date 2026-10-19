import { Router } from 'express';
import type { Translate } from '../../i18n/index.js';
import { badRequest, notFound } from '../../errors.js';
import { createAuthGuards } from '../auth/session.middleware.js';
import type { AuthenticatedRequest } from '../auth/session.middleware.js';
import type { RateLimiter } from '../../middleware/rate-limit.js';
import type { IpBansService } from './ip-bans.service.js';

type RateLimitSource = 'login' | 'loginAccount' | 'shareUnlock';

/**
 * How each limiter keys its buckets. `loginAccount` counts attempts against
 * one account from anywhere, so it can lock an account while its owner's IP
 * is clear; listing it here lets the admin see and lift that too.
 */
const KEY_PREFIX: Record<RateLimitSource, string> = { login: 'ip:', loginAccount: 'account:', shareUnlock: 'ip:' };

function isSource(value: string): value is RateLimitSource {
  return value in KEY_PREFIX;
}

export function createIpAccessRoutes(
  t: Translate,
  loginIpLimiter: RateLimiter,
  loginAccountLimiter: RateLimiter,
  unlockIpLimiter: RateLimiter,
  ipBans: IpBansService,
): Router {
  const router = Router();
  const { requireAuth, requireAdmin } = createAuthGuards(t);
  const limiters: Record<RateLimitSource, RateLimiter> = {
    login: loginIpLimiter,
    loginAccount: loginAccountLimiter,
    shareUnlock: unlockIpLimiter,
  };

  router.use(requireAuth, requireAdmin);

  router.get('/', (_req, res) => {
    const rateLimited = (Object.keys(limiters) as RateLimitSource[]).flatMap((source) =>
      limiters[source].listBlocked().map((entry) => ({
        // An IP, or the account name for loginAccount.
        ip: entry.key.slice(KEY_PREFIX[source].length),
        source,
        hits: entry.hits,
        retryAfterSeconds: entry.retryAfterSeconds,
      })),
    );
    res.json({ rateLimited, banned: ipBans.list() });
  });

  router.delete('/rate-limit/:source/:ip', (req, res) => {
    const { source, ip } = req.params;
    if (!isSource(source)) throw notFound('ipAccess.unknownSource');
    limiters[source].clear(`${KEY_PREFIX[source]}${ip}`);
    res.json({ success: true });
  });

  router.post('/banned', (req: AuthenticatedRequest, res) => {
    const { ip, reason } = req.body as { ip?: unknown; reason?: unknown };
    if (typeof ip !== 'string' || !ip.trim()) throw badRequest('ipAccess.invalidIp');
    if (reason !== undefined && typeof reason !== 'string') throw badRequest('ipAccess.invalidIp');
    // A self-inflicted lockout would need shell access to the container to undo.
    if (ip.trim() === req.ip) throw badRequest('ipAccess.cannotBanSelf');

    ipBans.add(ip.trim(), reason, req.user!.username);
    res.status(201).json({ success: true });
  });

  router.delete('/banned/:ip', (req, res) => {
    ipBans.remove(req.params.ip);
    res.json({ success: true });
  });

  return router;
}
