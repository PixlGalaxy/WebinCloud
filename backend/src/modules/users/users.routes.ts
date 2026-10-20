import { Router } from 'express';
import type { Db } from '../../db/client.js';
import type { Translate } from '../../i18n/index.js';
import type { AuthenticatedRequest } from '../auth/session.middleware.js';
import { createAuthGuards } from '../auth/session.middleware.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { routeParam } from '../../route-params.js';
import { UsersService, type CreateUserInput, type UpdateUserInput } from './users.service.js';
import type { MetricsService } from '../admin/metrics.service.js';
import type { DevicesService } from '../devices/devices.service.js';
import { logger } from '../../logger.js';

export function createUsersRoutes(db: Db, t: Translate, metrics: MetricsService, devices: DevicesService): Router {
  const router = Router();
  const users = new UsersService(db, metrics);
  const { requireAuth, requireAdmin } = createAuthGuards(t);

  router.use(requireAuth, requireAdmin);

  router.get('/', (_req, res) => res.json(users.list()));

  router.post(
    '/',
    asyncHandler(async (req, res) => {
      const created = await users.create(req.body as CreateUserInput);
      res.status(201).json(created);
    }),
  );

  router.patch(
    '/:id',
    asyncHandler(async (req, res) => {
      res.json(await users.update(routeParam(req.params.id), req.body as UpdateUserInput));
    }),
  );

  // A user's connected desktop apps, so an admin can cut off one (a lost
  // laptop, say) without resetting the password and signing out all the rest.
  // Seeing and disconnecting only: an admin never signs a device in for someone.
  router.get('/:id/devices', (req, res) => {
    const user = users.get(routeParam(req.params.id));
    res.json(devices.list(user.id));
  });

  router.delete('/:id/devices/:deviceId', (req: AuthenticatedRequest, res) => {
    const user = users.get(routeParam(req.params.id));
    devices.revoke(user.id, routeParam(req.params.deviceId));
    logger.auth.info(`"${req.user!.username}" disconnected a device of "${user.username}" from ${req.ip}`);
    res.status(204).end();
  });

  router.delete('/:id', (req: AuthenticatedRequest, res) => {
    users.remove(routeParam(req.params.id), req.user!.id);
    res.status(204).end();
  });

  return router;
}
