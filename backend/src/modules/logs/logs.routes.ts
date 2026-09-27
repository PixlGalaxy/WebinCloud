import { Router } from 'express';
import type { Translate } from '../../i18n/index.js';
import { createAuthGuards } from '../auth/session.middleware.js';
import { logBuffer, type LogEntry } from '../../log-buffer.js';

const PAGE_SIZES = [100, 200, 1000];

/** Bursts are sent as one message, so a busy server cannot flood the browser. */
const FLUSH_MS = 250;

const positiveInt = (value: unknown, fallback: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback;
};

export function createLogsRoutes(t: Translate): Router {
  const router = Router();
  const { requireAuth, requireAdmin } = createAuthGuards(t);

  router.use(requireAuth, requireAdmin);

  router.get('/', (req, res) => {
    const requested = positiveInt(req.query.limit, PAGE_SIZES[0]);
    const limit = PAGE_SIZES.includes(requested) ? requested : PAGE_SIZES[0];
    res.json({ ...logBuffer.page(limit, positiveInt(req.query.page, 1)), limit });
  });

  /** Server-sent events: new entries as they happen, after the id the client already has. */
  router.get('/stream', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 5000\n\n');

    let pending: LogEntry[] = logBuffer.since(Number(req.query.after) || 0);
    const flush = () => {
      if (pending.length === 0) return;
      res.write(`data: ${JSON.stringify(pending)}\n\n`);
      pending = [];
    };

    const unsubscribe = logBuffer.subscribe((entry) => pending.push(entry));
    const flusher = setInterval(flush, FLUSH_MS);
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 30_000);

    req.on('close', () => {
      unsubscribe();
      clearInterval(flusher);
      clearInterval(heartbeat);
    });
  });

  return router;
}
