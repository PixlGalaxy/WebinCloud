import type { Request, Response, NextFunction } from 'express';
import type { Db } from '../../db/client.js';
import type { User, Session } from '../../types/index.js';
import type { Translate } from '../../i18n/index.js';
import { AuthService } from './auth.service.js';

export interface AuthenticatedRequest extends Request {
  user?: User;
  session?: Session;
}

export function createSessionMiddleware(db: Db, sessionTtlHours: number) {
  const authService = new AuthService(db, sessionTtlHours);

  return (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
    const token = req.cookies?.session as string | undefined;
    if (token) {
      const result = authService.getSessionByToken(token);
      if (result) {
        req.user = result.user;
        req.session = result.session;
      }
    }
    next();
  };
}

export function createAuthGuards(t: Translate) {
  function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    if (!req.user || !req.session) {
      return res.status(401).json({ error: t('auth.notAuthenticated') });
    }
    return next();
  }

  function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    if (!req.user) return res.status(401).json({ error: t('auth.notAuthenticated') });
    if (req.user.role !== 'admin') return res.status(403).json({ error: t('auth.forbidden') });
    return next();
  }

  return { requireAuth, requireAdmin };
}
