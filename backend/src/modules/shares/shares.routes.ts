import { Router } from 'express';
import type { Db } from '../../db/client.js';
import type { EnvConfig } from '../../config/env.js';
import type { Translate } from '../../i18n/index.js';
import type { AuthenticatedRequest } from '../auth/session.middleware.js';
import { createAuthGuards } from '../auth/session.middleware.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { badRequest } from '../../errors.js';
import { routeParam } from '../../route-params.js';
import { PathNamesService } from '../path-names/path-names.service.js';
import { SharesService, type CreateShareInput, type UpdateShareInput } from './shares.service.js';

export function createSharesRoutes(
  db: Db,
  _config: EnvConfig,
  t: Translate,
  shares: SharesService,
): Router {
  const router = Router();
  const pathNames = new PathNamesService(db);
  const { requireAuth } = createAuthGuards(t);

  router.use(requireAuth);

  // --- path names -----------------------------------------------------------

  router.get('/path-names', (req: AuthenticatedRequest, res) => {
    res.json(pathNames.listByUser(req.user!.id));
  });

  router.post('/path-names', (req: AuthenticatedRequest, res) => {
    const { name } = req.body as { name?: unknown };
    if (typeof name !== 'string') throw badRequest('pathNames.invalid');
    res.status(201).json(pathNames.create(req.user!.id, name));
  });

  router.patch('/path-names/:id', (req: AuthenticatedRequest, res) => {
    const { name } = req.body as { name?: unknown };
    if (typeof name !== 'string') throw badRequest('pathNames.invalid');
    res.json(pathNames.rename(routeParam(req.params.id), req.user!.id, name));
  });

  router.delete('/path-names/:id', (req: AuthenticatedRequest, res) => {
    pathNames.remove(routeParam(req.params.id), req.user!.id);
    res.status(204).end();
  });

  // --- shares ---------------------------------------------------------------

  router.get('/', (req: AuthenticatedRequest, res) => {
    res.json(shares.listByOwner(req.user!.id));
  });

  router.post(
    '/',
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      res.status(201).json(await shares.create(req.user!, req.body as CreateShareInput));
    }),
  );

  router.patch(
    '/:id',
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      res.json(await shares.update(routeParam(req.params.id), req.user!, req.body as UpdateShareInput));
    }),
  );

  router.delete('/:id', (req: AuthenticatedRequest, res) => {
    shares.remove(routeParam(req.params.id), req.user!.id);
    res.status(204).end();
  });

  return router;
}
