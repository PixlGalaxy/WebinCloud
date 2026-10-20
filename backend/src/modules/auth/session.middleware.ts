import type { Request, Response, NextFunction } from 'express';
import type { Db } from '../../db/client.js';
import type { User, Session, PendingAction, Device } from '../../types/index.js';
import type { Translate, TranslationKey } from '../../i18n/index.js';
import { AuthService } from './auth.service.js';
import type { DevicesService } from '../devices/devices.service.js';

export interface AuthenticatedRequest extends Request {
  user?: User;
  /** Set for the web interface, signed in with a cookie. */
  session?: Session;
  /** Set for a desktop app or other client, signed in with a bearer token. */
  device?: Device;
}

export function createSessionMiddleware(db: Db, sessionTtlHours: number, devices: DevicesService) {
  const authService = new AuthService(db, sessionTtlHours);

  return (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
    // A bearer token is a deliberate choice by the client, so it wins over any cookie.
    const bearer = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') ?? '');
    if (bearer) {
      const result = devices.authenticate(bearer[1], req.ip);
      if (result) {
        req.user = result.user;
        req.device = result.device;
      }
      return next();
    }

    const token = req.cookies?.session;
    if (typeof token === 'string' && token) {
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
    if (!req.user || (!req.session && !req.device)) {
      return res.status(401).json({ error: t('auth.notAuthenticated') });
    }
    // Devices never carry a pending action: they cannot sign in with the default password.
    const pending = req.session?.pending_action;
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
