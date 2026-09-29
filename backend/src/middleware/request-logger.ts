import type { Request, Response, NextFunction } from 'express';
import { logger } from '../logger.js';

// Docker's HEALTHCHECK (see the Dockerfile) calls /api/health over loopback,
// straight to the backend, bypassing nginx entirely — so it never carries a
// forwarded IP to hide behind. Anyone hitting /api/health from outside the
// container still shows up as their real IP and gets logged like anything else.
const LOCAL_IPS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  // The log viewer polls these; logging them would feed itself with its own requests.
  if (req.originalUrl.startsWith('/api/logs')) return next();

  // Pure noise every 30s forever, whether or not anyone's using the app — but
  // only when it's actually Docker's own healthcheck, not an outside caller.
  if (req.originalUrl === '/api/health' && LOCAL_IPS.has(req.ip ?? '')) return next();

  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
    // Scrolling a grid of thumbnails would otherwise bury the log in one line per image.
    if (res.statusCode < 400 && req.originalUrl.startsWith('/api/files/thumbnail')) return;

    const message = `${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(1)}ms`;
    if (res.statusCode >= 500) logger.error(message);
    else if (res.statusCode >= 400) logger.warn(message);
    else logger.info(message);
  });

  next();
}
