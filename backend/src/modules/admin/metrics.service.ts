import type { GeoipService, GeoCountry } from './geoip.service.js';
import { readInterfaceCounters } from './network-stats.js';

export type Activity = 'browsing' | 'downloading' | 'uploading' | 'modifying' | 'idle';

interface ConnectionEntry {
  ip: string;
  country: GeoCountry | null;
  kind: 'user' | 'public';
  /** Username for a logged-in connection; undefined for an anonymous share visitor. */
  username?: string;
  activity: Activity;
  firstSeenAt: number;
  lastActiveAt: number;
}

export interface ConnectionSnapshot {
  ip: string;
  country: string | null;
  countryName: string | null;
  kind: 'user' | 'public';
  username?: string;
  activity: Activity;
  since: string;
}

export interface MetricsSnapshot {
  totals: { connections: number; uploads: number; downloads: number };
  current: ConnectionSnapshot[];
  countries: { code: string; name: string; count: number }[];
  geoReady: boolean;
  networkStatsReady: boolean;
  bandwidth: { intervalSeconds: number; upload: number[]; download: number[] };
}

/** No activity for this long: still listed, but shown as idle instead of its last real activity. */
const IDLE_MS = 15_000;
/** No activity for this long: dropped from "current" entirely — the visitor is gone. */
const DROP_MS = 5 * 60_000;
/** 1s samples, 60 of them: a scrolling last-minute window, same idea as Unraid's "1m" graph. */
const TICK_MS = 1_000;
const MAX_BUCKETS = 60;
/**
 * Hard ceiling on tracked connections. An anonymous visitor gets one entry per
 * distinct share path they hit, and the tracker runs before the share is
 * validated — so without a cap, unauthenticated traffic to made-up share URLs
 * could grow this map for as long as the retention window lasts. Far more than
 * any real deployment shows at once, and nothing but the dashboard is affected.
 */
const MAX_CONNECTIONS = 5_000;

/**
 * Tracks who's currently doing what, and the last minute of upload/download
 * throughput read straight from the container's network interface — all in
 * memory, reset on restart. `recordActivity`/`recordOperation` are fed by the
 * `connection-tracker` middleware; nothing here talks to Express directly.
 * `subscribe` powers the dashboard's live SSE stream, one push per tick.
 */
export class MetricsService {
  private current = new Map<string, ConnectionEntry>();
  private totals = { connections: 0, uploads: 0, downloads: 0 };
  private uploadBuckets: number[] = [];
  private downloadBuckets: number[] = [];
  private lastCounters: { rx: number; tx: number } | null = null;
  private networkStatsReady = false;
  private listeners = new Set<(snapshot: MetricsSnapshot) => void>();

  constructor(private geoip: GeoipService) {
    setInterval(() => this.tick(), TICK_MS).unref();
  }

  subscribe(listener: (snapshot: MetricsSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  recordActivity(
    id: string,
    info: { ip: string; activity: Activity } & ({ kind: 'user'; username: string } | { kind: 'public' }),
  ): void {
    const now = Date.now();
    const existing = this.current.get(id);
    if (existing) {
      existing.activity = info.activity;
      existing.lastActiveAt = now;
      return;
    }

    this.totals.connections++;
    if (this.current.size >= MAX_CONNECTIONS) this.dropOldest();
    this.current.set(id, {
      ip: info.ip,
      country: this.geoip.lookup(info.ip),
      kind: info.kind,
      username: info.kind === 'user' ? info.username : undefined,
      activity: info.activity,
      firstSeenAt: now,
      lastActiveAt: now,
    });
  }

  /** Evicts the least recently active entry to make room, so the cap never blocks a real visitor from being tracked. */
  private dropOldest(): void {
    let oldestId: string | null = null;
    let oldestAt = Infinity;
    for (const [id, entry] of this.current) {
      if (entry.lastActiveAt < oldestAt) {
        oldestAt = entry.lastActiveAt;
        oldestId = id;
      }
    }
    if (oldestId) this.current.delete(oldestId);
  }

  /** Drops every current connection for this username immediately — logout, password change, deactivation, deletion — instead of waiting out the idle timeout. */
  forgetUser(username: string): void {
    for (const [id, entry] of this.current) {
      if (entry.kind === 'user' && entry.username === username) this.current.delete(id);
    }
  }

  recordOperation(kind: 'upload' | 'download'): void {
    if (kind === 'upload') this.totals.uploads++;
    else this.totals.downloads++;
  }

  /** One tick: sample the NIC, prune stale connections, and push the fresh snapshot to any listener. */
  private tick(): void {
    const now = Date.now();
    for (const [id, entry] of this.current) {
      if (now - entry.lastActiveAt > DROP_MS) this.current.delete(id);
    }

    const counters = readInterfaceCounters();
    let uploadRate = 0;
    let downloadRate = 0;
    if (counters && this.lastCounters) {
      // Inbound (rx) is data reaching the server — uploads; outbound (tx) is downloads.
      uploadRate = Math.max(0, counters.rx - this.lastCounters.rx);
      downloadRate = Math.max(0, counters.tx - this.lastCounters.tx);
    }
    this.networkStatsReady = counters !== null;
    this.lastCounters = counters;

    this.uploadBuckets.push(uploadRate);
    this.downloadBuckets.push(downloadRate);
    if (this.uploadBuckets.length > MAX_BUCKETS) this.uploadBuckets.shift();
    if (this.downloadBuckets.length > MAX_BUCKETS) this.downloadBuckets.shift();

    // Only worth building when a dashboard is actually open.
    if (this.listeners.size === 0) return;
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  snapshot(): MetricsSnapshot {
    const now = Date.now();
    const current: ConnectionSnapshot[] = [...this.current.values()].map((e) => ({
      ip: e.ip,
      country: e.country?.code ?? null,
      countryName: e.country?.name ?? null,
      kind: e.kind,
      username: e.username,
      activity: now - e.lastActiveAt > IDLE_MS ? 'idle' : e.activity,
      since: new Date(e.firstSeenAt).toISOString(),
    }));

    const countryCounts = new Map<string, { name: string; count: number }>();
    for (const c of current) {
      if (!c.country) continue;
      const entry = countryCounts.get(c.country);
      if (entry) entry.count++;
      else countryCounts.set(c.country, { name: c.countryName ?? c.country, count: 1 });
    }

    return {
      totals: { ...this.totals },
      current,
      countries: [...countryCounts.entries()].map(([code, { name, count }]) => ({ code, name, count })),
      geoReady: this.geoip.isReady(),
      networkStatsReady: this.networkStatsReady,
      bandwidth: {
        intervalSeconds: TICK_MS / 1000,
        upload: this.uploadBuckets,
        download: this.downloadBuckets,
      },
    };
  }
}
