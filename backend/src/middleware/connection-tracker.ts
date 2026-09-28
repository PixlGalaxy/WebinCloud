import type { NextFunction, Request, Response } from 'express';
import type { AuthenticatedRequest } from '../modules/auth/session.middleware.js';
import type { Activity } from '../modules/admin/metrics.service.js';
import type { MetricsService } from '../modules/admin/metrics.service.js';

const PUBLIC_SHARE_RE = /^\/api\/public\/([^/]+)\/([^/]+)/;

function classify(method: string, path: string): Activity {
  if (method === 'GET' && /\/download(\/|$)/.test(path)) return 'downloading';
  if (method === 'POST' && /\/upload(\/|$)/.test(path)) return 'uploading';
  if (method === 'DELETE' || method === 'PATCH' || method === 'PUT') return 'modifying';
  if (method === 'POST' && /\/mkdir$/.test(path)) return 'modifying';
  return 'browsing';
}

/** Who's making this request — a logged-in session, or a public-share visitor identified by IP + share. */
function identify(req: AuthenticatedRequest): { id: string; kind: 'user' | 'public'; username?: string } | null {
  if (req.user && req.session) {
    return { id: `session:${req.session.id}`, kind: 'user', username: req.user.username };
  }
  const match = PUBLIC_SHARE_RE.exec(req.path);
  if (match) {
    return { id: `anon:${req.ip}:${match[1]}/${match[2]}`, kind: 'public' };
  }
  return null;
}

/**
 * Feeds the admin dashboard: who's connected and what they're doing. No
 * existing route needs to change — this reads `req.user`/`req.session`
 * (already resolved by session middleware, which must run before this) and
 * classifies the request from its method and path alone. Bandwidth itself
 * comes from the container's network interface (see `network-stats.ts`), not
 * from here.
 */
// Watching your own dashboard shouldn't overwrite your own "downloading"/"uploading"
// row with "browsing" every tick — it's not activity worth showing.
const UNTRACKED = /^\/api\/admin\/metrics(\/stream)?$/;

export function createConnectionTracker(metrics: MetricsService) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (UNTRACKED.test(req.path)) return next();

    const identity = identify(req as AuthenticatedRequest);
    const activity = classify(req.method, req.path);

    if (identity) {
      metrics.recordActivity(identity.id, {
        ip: req.ip ?? 'unknown',
        activity,
        ...(identity.kind === 'user' ? { kind: 'user', username: identity.username! } : { kind: 'public' }),
      });
    }

    res.on('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        if (activity === 'uploading') metrics.recordOperation('upload');
        if (activity === 'downloading') metrics.recordOperation('download');
      }
    });

    next();
  };
}
