import type { Request, Response, NextFunction } from 'express';
import { logger } from '../logger.js';

const CHUNK_RE = /\/upload\/sessions\/[^/?]+\/chunks\//;

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  // The log viewer polls these; logging them would feed itself with its own requests.
  if (req.originalUrl.startsWith('/api/logs')) return next();

  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
    // Docker's HEALTHCHECK, uptime monitors and proxies poll this around the clock;
    // a healthy answer is pure noise. A failing one is still logged.
    if (res.statusCode < 400 && req.originalUrl.split('?')[0] === '/api/health') return;
    // Scrolling a grid of thumbnails would otherwise bury the log in one line per image.
    if (res.statusCode < 400 && req.originalUrl.startsWith('/api/files/thumbnail')) return;
    // Same for the chunks of a large upload: one line per 8 MB. Its start and completion are still logged.
    if (res.statusCode < 400 && CHUNK_RE.test(req.originalUrl)) return;

    const message = `${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(1)}ms`;
    if (res.statusCode >= 500) logger.error(message);
    else if (res.statusCode >= 400) logger.warn(message);
    else logger.info(message);
  });

  next();
}
