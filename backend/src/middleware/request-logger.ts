import type { Request, Response, NextFunction } from 'express';
import { logger } from '../logger.js';

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  // The log viewer polls these; logging them would feed itself with its own requests.
  if (req.originalUrl.startsWith('/api/logs')) return next();

  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const message = `${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(1)}ms`;
    if (res.statusCode >= 500) logger.error(message);
    else if (res.statusCode >= 400) logger.warn(message);
    else logger.info(message);
  });

  next();
}
