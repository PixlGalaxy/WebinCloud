import { Router } from 'express';
import type { Db } from '../../db/client.js';
import type { EnvConfig } from '../../config/env.js';
import type { Translate } from '../../i18n/index.js';
import type { AuthenticatedRequest } from '../auth/session.middleware.js';
import { createAuthGuards } from '../auth/session.middleware.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { badRequest } from '../../errors.js';
import { PermissionsService, type CreateGrantInput, type UpdateGrantInput } from './permissions.service.js';

export function createPermissionsRoutes(db: Db, config: EnvConfig, t: Translate): Router {
  const router = Router();
  const permissions = new PermissionsService(db, config.DATA_ROOT);
  const { requireAuth, requireAdmin } = createAuthGuards(t);

  router.use(requireAuth, requireAdmin);

  router.get('/', (req, res) => {
    const userId = req.query.userId;
    if (typeof userId !== 'string') throw badRequest('permissions.userIdRequired');
    res.json(permissions.listByUser(userId));
  });

  router.post(
    '/',
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      const created = await permissions.create(req.body as CreateGrantInput, req.user!.id);
      res.status(201).json(created);
    }),
  );

  router.patch('/:id', (req, res) => {
    res.json(permissions.update(req.params.id, req.body as UpdateGrantInput));
  });

  router.delete('/:id', (req, res) => {
    permissions.remove(req.params.id);
    res.status(204).end();
  });

  return router;
}
