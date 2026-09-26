import { Router } from 'express';
import type { Translate } from '../../i18n/index.js';
import type { AuthenticatedRequest } from '../auth/session.middleware.js';
import { createAuthGuards } from '../auth/session.middleware.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import { badRequest } from '../../errors.js';
import { routeParam } from '../../route-params.js';
import type { ArchiveOwner, ArchivesService } from './archives.service.js';

export function createArchivesRoutes(t: Translate, archives: ArchivesService): Router {
  const router = Router();
  const { requireAuth } = createAuthGuards(t);
  const owner = (req: AuthenticatedRequest): ArchiveOwner => ({ kind: 'user', id: req.user!.id });

  router.use(requireAuth);

  router.post('/', (req: AuthenticatedRequest, res) => {
    const { paths } = req.body as { paths?: unknown };
    if (!Array.isArray(paths) || paths.some((p) => typeof p !== 'string')) {
      throw badRequest('archives.nothingSelected');
    }
    res.status(202).json(archives.start(req.user!, paths as string[]));
  });

  router.get('/:id', (req: AuthenticatedRequest, res) => {
    res.json(archives.get(routeParam(req.params.id), owner(req)));
  });

  router.get('/:id/download', (req: AuthenticatedRequest, res) => {
    const { absolute, fileName } = archives.ready(routeParam(req.params.id), owner(req));
    res.download(absolute, fileName);
  });

  router.delete(
    '/:id',
    asyncHandler(async (req: AuthenticatedRequest, res) => {
      await archives.remove(routeParam(req.params.id), owner(req));
      res.status(204).end();
    }),
  );

  return router;
}
