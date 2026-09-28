import { readFileSync } from 'fs';
import { logger } from '../../logger.js';
import type { SettingsService } from '../../db/settings.js';

const RESTART_BUDGET_WINDOW_MS = 5 * 60 * 1000;
const RESTART_BUDGET_MAX = 3;

export interface ServiceStatus {
  running: boolean;
  uptimeSeconds: number | null;
}

const NGINX_PID_FILE = '/run/nginx.pid';
// Linux clock ticks per second, used to convert /proc/<pid>/stat's starttime field into seconds.
const CLK_TCK = 100;

function readNginxPid(): number | null {
  try {
    const pid = parseInt(readFileSync(NGINX_PID_FILE, 'utf-8').trim(), 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

/** A signal-0 probe: doesn't actually signal the process, just checks it exists and is ours to touch. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Seconds since boot that `pid` started, read the same way `network-stats.ts` reads `/proc/net/dev` — Linux only. */
function processUptimeSeconds(pid: number): number | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf-8');
    // Command name (field 2) can contain spaces/parens, so pick up parsing after its closing ')'.
    const afterComm = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
    const startTicks = Number(afterComm[19]); // field 22 overall, index 19 after the comm split
    const uptimeSeconds = Number(readFileSync('/proc/uptime', 'utf-8').split(' ')[0]);
    if (!Number.isFinite(startTicks) || !Number.isFinite(uptimeSeconds)) return null;
    return Math.max(0, Math.round(uptimeSeconds - startTicks / CLK_TCK));
  } catch {
    return null;
  }
}

/**
 * A persistent (DB-backed, not in-memory) request budget for the restart
 * endpoints. This has to survive the backend restarting itself — an in-memory
 * counter would reset on every single backend restart, making it useless for
 * exactly the case it exists to catch. `entrypoint.sh`'s own crash-loop cap
 * (8 respawns/60s) is the real backstop that keeps the container from ever
 * going down over this; this just keeps everyday use (or a scripted abuse)
 * far below that ceiling in the first place.
 */
export function tryConsumeRestartBudget(settings: SettingsService, service: 'backend' | 'frontend'): boolean {
  const key = `_restart_log_${service}`;
  const now = Date.now();
  const kept = settings
    .getString(key, '')
    .split(',')
    .filter(Boolean)
    .map(Number)
    .filter((ts) => Number.isFinite(ts) && now - ts < RESTART_BUDGET_WINDOW_MS);

  if (kept.length >= RESTART_BUDGET_MAX) return false;

  kept.push(now);
  settings.set(key, kept.join(','));
  return true;
}

export function getBackendStatus(startedAt: number): ServiceStatus {
  return { running: true, uptimeSeconds: Math.round((Date.now() - startedAt) / 1000) };
}

export function getNginxStatus(): ServiceStatus {
  const pid = readNginxPid();
  if (pid === null || !isAlive(pid)) return { running: false, uptimeSeconds: null };
  return { running: true, uptimeSeconds: processUptimeSeconds(pid) };
}

/**
 * Exits this process after replying to the request; `entrypoint.sh` runs the
 * backend in a respawn loop, so this is enough to bring it back up in ~1s.
 */
export function restartBackend(): void {
  logger.warn('Backend restart requested from the admin panel');
  setTimeout(() => process.exit(0), 300);
}

/**
 * Signals nginx's master process to stop; `entrypoint.sh`'s respawn loop
 * relaunches it the same way it would after a crash. No IPC needed — just the
 * pidfile nginx already writes (see `pid` in nginx.conf).
 */
export function restartNginx(): boolean {
  const pid = readNginxPid();
  if (pid === null) return false;
  try {
    process.kill(pid, 'SIGTERM');
    logger.warn('Frontend (nginx) restart requested from the admin panel');
    return true;
  } catch {
    return false;
  }
}
