import { Router } from 'express';
import type { Db } from '../../db/client.js';
import type { Translate } from '../../i18n/index.js';
import type { AuthenticatedRequest } from '../auth/session.middleware.js';
import { createAuthGuards } from '../auth/session.middleware.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { routeParam } from '../../route-params.js';
import { UsersService, type CreateUserInput, type UpdateUserInput } from './users.service.js';
import type { MetricsService } from '../admin/metrics.service.js';

export function createUsersRoutes(db: Db, t: Translate, metrics: MetricsService): Router {
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

  router.delete('/:id', (req: AuthenticatedRequest, res) => {
    users.remove(routeParam(req.params.id), req.user!.id);
    res.status(204).end();
  });

  return router;
}
