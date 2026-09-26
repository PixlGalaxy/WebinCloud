import type { Request, Response, NextFunction } from 'express';
import type { Translate } from '../i18n/index.js';
import { AppError } from '../errors.js';
import { logger } from '../logger.js';

export function createErrorHandler(t: Translate) {
  return (err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      return res.status(err.status).json({ error: t(err.key) });
    }

    logger.error('Unhandled request error', err);
    return res.status(500).json({ error: t('error.internal') });
  };
}

export function createNotFoundHandler(t: Translate) {
  return (_req: Request, res: Response) => res.status(404).json({ error: t('error.notFound') });
}
