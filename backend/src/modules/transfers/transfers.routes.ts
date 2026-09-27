import { Router } from 'express';
import type { Translate } from '../../i18n/index.js';
import type { AuthenticatedRequest } from '../auth/session.middleware.js';
import { createAuthGuards } from '../auth/session.middleware.js';
import { badRequest } from '../../errors.js';
import { routeParam } from '../../route-params.js';
import type { ConflictMode } from '../files/files.service.js';
import type { TransfersService } from './transfers.service.js';

const CONFLICT_MODES: ConflictMode[] = ['fail', 'overwrite', 'keepBoth'];

function conflictMode(value: unknown): ConflictMode {
  return CONFLICT_MODES.includes(value as ConflictMode) ? (value as ConflictMode) : 'fail';
}

export function createTransfersRoutes(t: Translate, transfers: TransfersService): Router {
  const router = Router();
  const { requireAuth } = createAuthGuards(t);

  router.use(requireAuth);

  router.post('/', (req: AuthenticatedRequest, res) => {
    const { paths, destination, onConflict } = req.body as {
      paths?: unknown;
      destination?: string;
      onConflict?: unknown;
    };
    if (!Array.isArray(paths) || paths.some((p) => typeof p !== 'string')) {
      throw badRequest('archives.nothingSelected');
    }
    if (typeof destination !== 'string') throw badRequest('files.invalidPath');

    res.status(202).json(transfers.start(req.user!, paths as string[], destination, conflictMode(onConflict)));
  });

  router.get('/:id', (req: AuthenticatedRequest, res) => {
    res.json(transfers.get(routeParam(req.params.id), req.user!.id));
  });

  router.delete('/:id', (req: AuthenticatedRequest, res) => {
    transfers.remove(routeParam(req.params.id), req.user!.id);
    res.status(204).end();
  });

  return router;
}
