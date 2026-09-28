import { Router } from 'express';
import type { Translate } from '../../i18n/index.js';
import { createAuthGuards } from '../auth/session.middleware.js';
import type { MetricsService } from './metrics.service.js';

export function createAdminRoutes(t: Translate, metrics: MetricsService): Router {
  const router = Router();
  const { requireAuth, requireAdmin } = createAuthGuards(t);

  router.use(requireAuth, requireAdmin);

  router.get('/metrics', (_req, res) => res.json(metrics.snapshot()));

  /** Server-sent events: a fresh snapshot every tick, so the dashboard never needs to poll or be refreshed by hand. */
  router.get('/metrics/stream', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 5000\n\n');
    res.write(`data: ${JSON.stringify(metrics.snapshot())}\n\n`);

    const unsubscribe = metrics.subscribe((snapshot) => res.write(`data: ${JSON.stringify(snapshot)}\n\n`));
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 30_000);

    req.on('close', () => {
      unsubscribe();
      clearInterval(heartbeat);
    });
  });

  return router;
}
