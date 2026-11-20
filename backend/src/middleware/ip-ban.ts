import type { NextFunction, Request, Response } from 'express';
import type { IpBansService } from '../modules/admin/ip-bans.service.js';
import type { ScannerGuard } from '../modules/admin/scanner-guard.js';

/**
 * Status the bundled nginx turns into a closed connection (its own 444), so a
 * banned or blocked address gets no answer at all, not even an error page.
 */
export const CLOSE_CONNECTION = 444;

/**
 * A banned IP (by an admin) or a blocked one (probing for missing paths, see
 * ScannerGuard) gets nothing from this server — mounted as early as possible
 * (right after `trust proxy` is set, before session/cookie parsing or any
 * route), not scoped to just login/share-unlock. nginx asks the same question
 * through /api/internal/gate before serving pages and assets.
 */
export function createIpBanMiddleware(ipBans: IpBansService, scanner: ScannerGuard) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (ipBans.isBanned(req.ip) || scanner.isBlocked(req.ip)) {
      res.status(CLOSE_CONNECTION).end();
      return;
    }
    next();
  };
}
