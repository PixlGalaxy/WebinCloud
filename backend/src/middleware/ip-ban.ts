import type { NextFunction, Request, Response } from 'express';
import { forbidden } from '../errors.js';
import type { IpBansService } from '../modules/admin/ip-bans.service.js';

/**
 * A banned IP gets nothing from this server — mounted as early as possible
 * (right after `trust proxy` is set, before session/cookie parsing or any
 * route), not scoped to just login/share-unlock.
 */
export function createIpBanMiddleware(ipBans: IpBansService) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (ipBans.isBanned(req.ip)) return next(forbidden('error.ipBanned'));
    next();
  };
}
