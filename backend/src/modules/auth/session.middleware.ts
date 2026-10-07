import type { Request, Response, NextFunction } from 'express';
import type { Db } from '../../db/client.js';
import type { User, Session, PendingAction } from '../../types/index.js';
import type { Translate, TranslationKey } from '../../i18n/index.js';
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

/**
 * The only endpoints a restricted session may reach: enough to see who it is,
 * leave, and resolve the pending action. Everything else is refused server-side,
 * so the default credentials never grant real access — not even through a
 * direct API client that ignores the frontend's blocking modal.
 */
const ALLOWED_WHILE_PENDING: Record<PendingAction, Set<string>> = {
  setup: new Set(['/api/auth/me', '/api/auth/logout', '/api/auth/complete-setup']),
  password: new Set(['/api/auth/me', '/api/auth/logout', '/api/auth/change-password']),
};

const PENDING_ERROR: Record<PendingAction, TranslationKey> = {
  setup: 'auth.setupRequired',
  password: 'auth.passwordChangeRequired',
};

export function createAuthGuards(t: Translate) {
  function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    if (!req.user || !req.session) {
      return res.status(401).json({ error: t('auth.notAuthenticated') });
    }
    const pending = req.session.pending_action;
    if (pending && !ALLOWED_WHILE_PENDING[pending].has(req.originalUrl.split('?')[0])) {
      return res.status(403).json({ error: t(PENDING_ERROR[pending]) });
    }
    return next();
  }

  // Always mounted after requireAuth, which already applied the pending-action gate.
  function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    if (!req.user) return res.status(401).json({ error: t('auth.notAuthenticated') });
    if (req.user.role !== 'admin') return res.status(403).json({ error: t('auth.forbidden') });
    return next();
  }

  return { requireAuth, requireAdmin };
}
