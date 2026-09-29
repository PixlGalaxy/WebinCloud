import { randomUUID } from 'crypto';
import type { Db } from '../../db/client.js';
import { badRequest, conflict } from '../../errors.js';

export interface IpBan {
  ip: string;
  reason: string | null;
  createdBy: string | null;
  createdAt: string;
}

interface IpBanRow {
  id: string;
  ip: string;
  reason: string | null;
  created_by: string | null;
  created_at: string;
}

// Deliberately permissive — this only gates whether an admin-supplied string
// is shaped like an IP at all, not full RFC validation.
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV6 = /^[0-9a-fA-F:]+$/;

export function isValidIp(value: string): boolean {
  const ipv4Match = IPV4.exec(value);
  if (ipv4Match) return ipv4Match.slice(1).every((octet) => Number(octet) <= 255);
  return value.includes(':') && IPV6.test(value);
}

/** Pulls the IPv4 out of a plain address or an IPv4-mapped IPv6 one (`::ffff:a.b.c.d`), or null for a "real" IPv6 address. */
function asIpv4(ip: string): [number, number, number, number] | null {
  const mapped = /^::ffff:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/i.exec(ip);
  const plain = mapped ? null : IPV4.exec(ip);
  const parts = mapped ?? plain;
  return parts ? (parts.slice(1).map(Number) as [number, number, number, number]) : null;
}

/**
 * Loopback, private (RFC 1918 / ULA) and link-local addresses — banning one of
 * these is almost always a mistake with an outsized blast radius: it can take
 * down the container's own Docker healthcheck (which hits `127.0.0.1`
 * directly), or lock every device on the admin's own LAN out at once, not
 * just the person who typed it in.
 */
export function isLoopbackOrPrivate(ip: string): boolean {
  const v4 = asIpv4(ip);
  if (v4) {
    const [a, b] = v4;
    return (
      a === 127 || // 127.0.0.0/8 — loopback
      a === 10 || // 10.0.0.0/8
      (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12
      (a === 192 && b === 168) || // 192.168.0.0/16
      (a === 169 && b === 254) // 169.254.0.0/16 — link-local
    );
  }
  const lower = ip.toLowerCase();
  return lower === '::1' || /^fe[89ab][0-9a-f]:/.test(lower) || /^f[cd][0-9a-f]{2}:/.test(lower);
}

/**
 * A persistent, admin-curated block list — distinct from the rate limiter's
 * in-memory, self-expiring lockouts. Checked on every single request (see
 * `middleware/ip-ban.ts`), so bans live in a `Set` for O(1) lookups; the table
 * is only the source of truth across restarts.
 */
export class IpBansService {
  private banned: Set<string>;

  constructor(private db: Db) {
    const rows = this.db.prepare('SELECT ip FROM ip_bans').all() as { ip: string }[];
    this.banned = new Set(rows.map((r) => r.ip));
  }

  isBanned(ip: string | undefined): boolean {
    return ip !== undefined && this.banned.has(ip);
  }

  list(): IpBan[] {
    const rows = this.db.prepare('SELECT * FROM ip_bans ORDER BY created_at DESC').all() as IpBanRow[];
    return rows.map((r) => ({ ip: r.ip, reason: r.reason, createdBy: r.created_by, createdAt: r.created_at }));
  }

  add(ip: string, reason: string | undefined, createdBy: string): void {
    if (!isValidIp(ip)) throw badRequest('ipAccess.invalidIp');
    if (isLoopbackOrPrivate(ip)) throw badRequest('ipAccess.cannotBanPrivate');
    if (this.banned.has(ip)) throw conflict('ipAccess.alreadyBanned');

    this.db
      .prepare('INSERT INTO ip_bans (id, ip, reason, created_by) VALUES (?, ?, ?, ?)')
      .run(randomUUID(), ip, reason?.trim() || null, createdBy);
    this.banned.add(ip);
  }

  remove(ip: string): boolean {
    const result = this.db.prepare('DELETE FROM ip_bans WHERE ip = ?').run(ip);
    this.banned.delete(ip);
    return result.changes > 0;
  }
}
