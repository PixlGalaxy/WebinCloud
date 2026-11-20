import { logger } from '../../logger.js';
import type { RateLimiter } from '../../middleware/rate-limit.js';
import { isLoopbackOrPrivate } from './ip-bans.service.js';

/** Requests for missing paths one IP may make within WINDOW_MS before it is blocked. */
const MAX_MISSES = 40;
const WINDOW_MS = 60 * 1000;
/** How long a blocked IP gets nothing at all from the server. */
const BLOCK_MS = 15 * 60 * 1000;
/** Addresses tracked at once; past this the oldest are forgotten, so rotating addresses cannot grow memory without end. */
const MAX_TRACKED = 50_000;

/**
 * Blocks addresses that probe the server. Scanners and crawlers ask for paths
 * that do not exist by the dozen: backups (/site.zip), admin pages of other
 * software (/wp-login.php), every string in the frontend's JavaScript as if it
 * were a file. An address that makes MAX_MISSES such requests within WINDOW_MS
 * gets nothing at all for BLOCK_MS: pages, assets, API and upload sockets.
 *
 * Only misses no page of the app ever makes count: routes that do not exist,
 * missing static files, odd paths at the root and unknown share links. A file,
 * thumbnail or folder a page asks for and does not find never counts.
 *
 * Private and loopback addresses are never blocked: behind a reverse proxy
 * whose trust is not set, every request seems to come from the proxy's private
 * address, and blocking it would lock everyone out.
 */
export class ScannerGuard {
  private misses = new Map<string, number[]>();
  private blocked = new Map<string, { until: number; hits: number }>();

  constructor() {
    setInterval(() => this.prune(), WINDOW_MS).unref();
  }

  /** Counts one request for a missing path against `ip`, blocking it once it passes the limit. */
  miss(ip: string | undefined): void {
    if (!ip || isLoopbackOrPrivate(ip) || this.isBlocked(ip)) return;

    const now = Date.now();
    const recent = (this.misses.get(ip) ?? []).filter((at) => at > now - WINDOW_MS);
    recent.push(now);
    this.misses.delete(ip);

    if (recent.length >= MAX_MISSES) {
      this.blocked.set(ip, { until: now + BLOCK_MS, hits: recent.length });
      logger.warn(`Blocked ${ip} for ${BLOCK_MS / 60000} minutes: ${recent.length} requests for missing paths within a minute`);
      return;
    }

    // Re-inserted last, so the map's first keys are the ones idle longest.
    this.misses.set(ip, recent);
    if (this.misses.size > MAX_TRACKED) this.misses.delete(this.misses.keys().next().value!);
  }

  isBlocked(ip: string | undefined): boolean {
    if (!ip) return false;
    const entry = this.blocked.get(ip);
    if (!entry) return false;
    if (entry.until > Date.now()) return true;
    this.blocked.delete(ip);
    return false;
  }

  /** The blocked addresses, keyed "ip:<address>" like the login and share-unlock limits that IP Access lists them beside. */
  listBlocked(): ReturnType<RateLimiter['listBlocked']> {
    const now = Date.now();
    const list: ReturnType<RateLimiter['listBlocked']> = [];
    for (const [ip, entry] of this.blocked) {
      if (entry.until <= now) continue;
      list.push({ key: `ip:${ip}`, hits: entry.hits, retryAfterSeconds: Math.ceil((entry.until - now) / 1000) });
    }
    return list;
  }

  /** IP Access's "unblock". */
  clear(key: string): boolean {
    const ip = key.startsWith('ip:') ? key.slice(3) : key;
    this.misses.delete(ip);
    return this.blocked.delete(ip);
  }

  private prune(): void {
    const now = Date.now();
    for (const [ip, entry] of this.blocked) if (entry.until <= now) this.blocked.delete(ip);
    for (const [ip, times] of this.misses) if (!times.some((at) => at > now - WINDOW_MS)) this.misses.delete(ip);
  }
}
