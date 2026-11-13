import type { Request, Response, NextFunction } from 'express';
import type { Translate } from '../i18n/index.js';
import { AppError } from '../errors.js';
import { logger } from '../logger.js';

const BODY_PARSER_ERRORS = new Set([
  'entity.parse.failed',
  'entity.too.large',
  'entity.verify.failed',
  'encoding.unsupported',
  'charset.unsupported',
  'request.aborted',
  'request.size.invalid',
]);

export function createErrorHandler(t: Translate) {
  return (err: Error, _req: Request, res: Response, _next: NextFunction) => {
    // A stream that already started can't switch to a JSON error: cut it, so the
    // client sees a failed transfer instead of a truncated "success".
    if (res.headersSent) {
      logger.warn(`Request failed after the response started: ${err.message}`);
      return res.destroy();
    }

    if (err instanceof AppError) {
      if (err.headers) {
        for (const [name, value] of Object.entries(err.headers)) res.setHeader(name, value);
      }
      return res.status(err.status).json({ error: t(err.key) });
    }

    // express.json() rejections (malformed or oversized body) are the client's
    // fault, not a server crash: answer 400/413 and skip the stack trace.
    const bodyError = err as Error & { type?: unknown; status?: unknown };
    if (typeof bodyError.type === 'string' && BODY_PARSER_ERRORS.has(bodyError.type)) {
      const tooLarge = bodyError.status === 413;
      logger.warn(`Rejected request body: ${bodyError.type}`);
      return res.status(tooLarge ? 413 : 400).json({ error: t(tooLarge ? 'error.payloadTooLarge' : 'error.invalidInput') });
    }

    // res.download / res.sendFile report the client's own faults this way, such as a
    // Range past the end of the file (416, its Content-Range already set).
    const sendError = err as Error & { status?: unknown; expose?: unknown };
    if (typeof sendError.status === 'number' && sendError.status >= 400 && sendError.status < 500 && sendError.expose === true) {
      return res.status(sendError.status).json({ error: t(sendError.status === 404 ? 'error.notFound' : 'error.invalidInput') });
    }

    // The host's permissions refuse the backend user (PUID) on this item, e.g. a
    // file another container wrote as root with mode 600. Not a crash: say so.
    const fsError = err as NodeJS.ErrnoException;
    if (fsError.code === 'EACCES' || fsError.code === 'EPERM') {
      logger.warn(`Permission denied: ${fsError.syscall ?? 'access'} ${fsError.path ?? ''} (check PUID/PGID and the file's owner)`);
      return res.status(403).json({ error: t('files.permissionDenied') });
    }

    logger.error('Unhandled request error', err);
    return res.status(500).json({ error: t('error.internal') });
  };
}

export function createNotFoundHandler(t: Translate) {
  return (_req: Request, res: Response) => res.status(404).json({ error: t('error.notFound') });
}
