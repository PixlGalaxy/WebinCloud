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

/**
 * Fixed-window request counter kept in memory, per key. Counts every request
 * regardless of outcome, so it caps guessing attempts even before a handler
 * decides success or failure. A restart clears every counter, which is fine
 * for a single-process, self-hosted server.
 */
export function createRateLimiter(options: RateLimiterOptions) {
  const hits = new Map<string, number[]>();

  setInterval(() => {
    const cutoff = Date.now() - options.windowMs;
    for (const [key, timestamps] of hits) {
      const kept = timestamps.filter((ts) => ts > cutoff);
      if (kept.length === 0) hits.delete(key);
      else hits.set(key, kept);
    }
  }, options.windowMs).unref();

  return (req: Request, _res: Response, next: NextFunction) => {
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
}
