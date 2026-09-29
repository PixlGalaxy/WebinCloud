import type { NextFunction, Request, Response } from 'express';
import { tooManyRequests } from '../errors.js';
import { logger } from '../logger.js';

interface RateLimiterOptions {
  windowMs: number;
  max: number;
  /** Bucket key for this request; returning null skips limiting it (e.g. body field missing). */
  keyFn: (req: Request) => string | null;
  /** Logged when a key gets blocked. */
  describe: (req: Request) => string;
}

export interface RateLimiter {
  middleware: (req: Request, res: Response, next: NextFunction) => void;
  /** Keys currently at/over max within the window — i.e. actively blocking new requests right now. Powers the admin panel's IP Access page. */
  listBlocked(): { key: string; hits: number; retryAfterSeconds: number }[];
  /** Clears a key's counter early — the admin panel's "unblock" action. Returns false if it wasn't tracked. */
  clear(key: string): boolean;
}

/**
 * Fixed-window request counter kept in memory, per key. Counts every request
 * regardless of outcome, so it caps guessing attempts even before a handler
 * decides success or failure. A restart clears every counter, which is fine
 * for a single-process, self-hosted server.
 */
export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const hits = new Map<string, number[]>();

  setInterval(() => {
    const cutoff = Date.now() - options.windowMs;
    for (const [key, timestamps] of hits) {
      const kept = timestamps.filter((ts) => ts > cutoff);
      if (kept.length === 0) hits.delete(key);
      else hits.set(key, kept);
    }
  }, options.windowMs).unref();

  const middleware = (req: Request, _res: Response, next: NextFunction) => {
    const key = options.keyFn(req);
    if (key === null) return next();

    const now = Date.now();
    const cutoff = now - options.windowMs;
    const timestamps = (hits.get(key) ?? []).filter((ts) => ts > cutoff);

    if (timestamps.length >= options.max) {
      const retryAfterSeconds = Math.ceil((timestamps[0]! + options.windowMs - now) / 1000);
      logger.auth.warn(`Rate limit exceeded: ${options.describe(req)}`);
      return next(tooManyRequests(retryAfterSeconds));
    }

    timestamps.push(now);
    hits.set(key, timestamps);
    next();
  };

  const listBlocked: RateLimiter['listBlocked'] = () => {
    const now = Date.now();
    const cutoff = now - options.windowMs;
    const blocked: { key: string; hits: number; retryAfterSeconds: number }[] = [];
    for (const [key, timestamps] of hits) {
      const kept = timestamps.filter((ts) => ts > cutoff);
      if (kept.length >= options.max) {
        blocked.push({ key, hits: kept.length, retryAfterSeconds: Math.ceil((kept[0]! + options.windowMs - now) / 1000) });
      }
    }
    return blocked;
  };

  return { middleware, listBlocked, clear: (key) => hits.delete(key) };
}
