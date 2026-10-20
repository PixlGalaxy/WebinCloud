import { createHmac, timingSafeEqual } from 'crypto';
import type { Request, Response } from 'express';
import type { Db } from '../../db/client.js';
import type { RateLimiter } from '../../middleware/rate-limit.js';

const COOKIE_PREFIX = 'known_';
const TTL_MS = 180 * 24 * 60 * 60 * 1000;

/**
 * Remembers browsers that have signed in to an account before, so the
 * per-account login limit cannot be used to lock the owner out: anyone can
 * spend an account's attempts with wrong passwords, but only from browsers
 * that never signed in to it. A remembered browser still needs the password
 * and stays under the per-IP limit. One signed cookie per account,
 * `<expiry>.<hmac>`, checked against an expiry the server reads itself.
 */
export class KnownBrowsers {
  constructor(
    private db: Db,
    private secret: string,
    private secure: boolean,
  ) {}

  private sign(userId: string, expiresAt: number): string {
    return createHmac('sha256', this.secret).update(`${userId}:${expiresAt}`).digest('hex');
  }

  remember(res: Response, userId: string): void {
    const expiresAt = Date.now() + TTL_MS;
    res.cookie(COOKIE_PREFIX + userId, `${expiresAt}.${this.sign(userId, expiresAt)}`, {
      httpOnly: true,
      secure: this.secure,
      sameSite: 'lax',
      path: '/',
      maxAge: TTL_MS,
    });
  }

  /** Whether this browser signed in before to the active account `usernameOrEmail` names. */
  isKnown(req: Request, usernameOrEmail: string): boolean {
    const user = this.db
      .prepare('SELECT id FROM users WHERE (email = ? OR username = ?) AND is_active = 1')
      .get(usernameOrEmail, usernameOrEmail) as { id: string } | undefined;
    const value: unknown = user ? req.cookies?.[COOKIE_PREFIX + user.id] : undefined;
    if (!user || typeof value !== 'string') return false;

    const [expiry, signature] = value.split('.');
    const expiresAt = Number(expiry);
    if (!signature || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;

    const expected = Buffer.from(this.sign(user.id, expiresAt));
    const actual = Buffer.from(signature);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  /**
   * `limiter` applied only to browsers this account does not know. Its refund
   * gives back only attempts it actually counted, so a remembered browser's
   * success never erases a failure someone else spent.
   */
  exempt(limiter: RateLimiter): RateLimiter {
    const counted = new WeakSet<Request>();
    return {
      ...limiter,
      middleware: (req, res, next) => {
        const value = (req.body as { usernameOrEmail?: unknown })?.usernameOrEmail;
        if (typeof value === 'string' && value && this.isKnown(req, value)) return next();
        counted.add(req);
        limiter.middleware(req, res, next);
      },
      refund: (req) => {
        if (counted.has(req)) limiter.refund(req);
      },
    };
  }
}
