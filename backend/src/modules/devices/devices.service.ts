import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import type { Db } from '../../db/client.js';
import type { Device, User } from '../../types/index.js';
import { badRequest, notFound, tooManyRequests, unauthorized } from '../../errors.js';

/** Sent on every request, so kept short: a leaked one stops working within the hour. */
export const ACCESS_TTL_SECONDS = 60 * 60;
/** Renewed on each use, so a device in regular use never has to sign in again. */
const REFRESH_TTL_DAYS = 90;
/** Authorization codes only bridge the browser and the app, a few seconds apart. */
const CODE_TTL_MS = 60 * 1000;
/**
 * A refresh token presented again this soon after it was replaced is taken as
 * the app retrying (two refreshes racing), not as a stolen copy: refused, but
 * the device stays signed in.
 */
const RETRY_GRACE_MS = 30 * 1000;
/** last_seen_at is written at most this often per device. */
const SEEN_INTERVAL_MS = 60 * 1000;
/** Approvals one user may have waiting at once; each lives a minute at most. */
const MAX_PENDING_CODES_PER_USER = 10;

export const PLATFORMS = ['windows', 'macos', 'linux', 'other'] as const;
export type Platform = (typeof PLATFORMS)[number];

export interface DeviceView {
  id: string;
  name: string;
  platform: string;
  createdAt: string;
  lastSeenAt: string | null;
  lastIp: string | null;
}

export interface IssuedTokens {
  tokenType: 'Bearer';
  accessToken: string;
  refreshToken: string;
  /** Seconds the access token is valid for. */
  expiresIn: number;
  device: DeviceView;
}

interface PendingCode {
  userId: string;
  challenge: string;
  redirectUri: string;
  name: string;
  platform: Platform;
  expiresAt: number;
}

const hash = (token: string) => createHash('sha256').update(token).digest('hex');
const newToken = () => randomBytes(32).toString('base64url');

/** The display name a client asked for, or a generic one; never control characters. */
export function deviceName(value: unknown): string {
  if (typeof value !== 'string') throw badRequest('devices.invalidRequest');
  // eslint-disable-next-line no-control-regex
  const name = value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 64);
  if (!name) throw badRequest('devices.invalidRequest');
  return name;
}

export function platform(value: unknown): Platform {
  return PLATFORMS.includes(value as Platform) ? (value as Platform) : 'other';
}

/**
 * Where the browser hands the code back: only a port on this machine's
 * loopback, as RFC 8252 prescribes for native apps, so a link crafted by
 * someone else can never send an approval to their server.
 */
export function loopbackRedirect(value: unknown): string {
  if (typeof value !== 'string') throw badRequest('devices.invalidRequest');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw badRequest('devices.invalidRequest');
  }
  // Literal addresses only: "localhost" can resolve elsewhere (RFC 8252, 8.3).
  const loopback = ['127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'http:' || !loopback || !url.port || url.username || url.password || url.hash) {
    throw badRequest('devices.invalidRequest');
  }
  return url.toString();
}

function toView(device: Device): DeviceView {
  return {
    id: device.id,
    name: device.name,
    platform: device.platform,
    createdAt: device.created_at,
    lastSeenAt: device.last_seen_at,
    lastIp: device.last_ip,
  };
}

export class DevicesService {
  private codes = new Map<string, PendingCode>();
  private lastSeen = new Map<string, number>();

  constructor(private db: Db) {}

  /** A new device for `user`, with its first pair of tokens. */
  issue(user: User, name: string, devicePlatform: Platform, ip: string | undefined): IssuedTokens {
    const id = randomUUID();
    const accessToken = newToken();
    const refreshToken = newToken();
    this.db
      .prepare(
        `INSERT INTO devices (id, user_id, name, platform, access_hash, access_expires_at, refresh_hash,
                              refresh_expires_at, last_seen_at, last_ip)
         VALUES (?, ?, ?, ?, ?, datetime('now', ?), ?, datetime('now', ?), datetime('now'), ?)`,
      )
      .run(
        id,
        user.id,
        name,
        devicePlatform,
        hash(accessToken),
        `+${ACCESS_TTL_SECONDS} seconds`,
        hash(refreshToken),
        `+${REFRESH_TTL_DAYS} days`,
        ip ?? null,
      );
    return this.tokens(id, accessToken, refreshToken);
  }

  private tokens(id: string, accessToken: string, refreshToken: string): IssuedTokens {
    const device = this.db.prepare('SELECT * FROM devices WHERE id = ?').get(id) as Device;
    return { tokenType: 'Bearer', accessToken, refreshToken, expiresIn: ACCESS_TTL_SECONDS, device: toView(device) };
  }

  // --- browser approval (authorization code + PKCE) -------------------------

  /** Called from the signed-in browser once the user approves the device. */
  createCode(user: User, request: { challenge: string; redirectUri: string; name: string; platform: Platform }): string {
    const now = Date.now();
    let mine = 0;
    for (const [key, pending] of this.codes) {
      if (pending.expiresAt <= now) this.codes.delete(key);
      else if (pending.userId === user.id) mine++;
    }
    if (mine >= MAX_PENDING_CODES_PER_USER) throw tooManyRequests(Math.ceil(CODE_TTL_MS / 1000));

    const code = newToken();
    this.codes.set(hash(code), { userId: user.id, ...request, expiresAt: now + CODE_TTL_MS });
    return code;
  }

  /**
   * Trades a code for tokens. Single use, short-lived, bound to the redirect
   * it was issued for, and only to whoever holds the verifier whose SHA-256 is
   * the challenge: a code caught on its way to the app is worthless alone.
   */
  redeemCode(code: unknown, verifier: unknown, redirectUri: unknown, ip: string | undefined): IssuedTokens {
    if (typeof code !== 'string' || typeof verifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) {
      throw badRequest('devices.invalidCode');
    }
    const key = hash(code);
    const pending = this.codes.get(key);
    this.codes.delete(key);
    if (!pending || pending.expiresAt <= Date.now()) throw badRequest('devices.invalidCode');

    let redirect: string;
    try {
      redirect = loopbackRedirect(redirectUri);
    } catch {
      throw badRequest('devices.invalidCode');
    }
    const expected = Buffer.from(pending.challenge);
    const actual = Buffer.from(createHash('sha256').update(verifier).digest('base64url'));
    if (redirect !== pending.redirectUri || expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw badRequest('devices.invalidCode');
    }

    const user = this.activeUser(pending.userId);
    if (!user) throw badRequest('devices.invalidCode');
    return this.issue(user, pending.name, pending.platform, ip);
  }

  // --- tokens ---------------------------------------------------------------

  /** New access and refresh tokens for a refresh token; the old one stops working. */
  refresh(refreshToken: unknown, ip: string | undefined): IssuedTokens {
    if (typeof refreshToken !== 'string' || !refreshToken) throw unauthorized('devices.invalidRefreshToken');
    const presented = hash(refreshToken);

    const device = this.db
      .prepare("SELECT * FROM devices WHERE refresh_hash = ? AND refresh_expires_at > datetime('now')")
      .get(presented) as Device | undefined;

    if (!device) {
      const replaced = this.db.prepare('SELECT * FROM devices WHERE previous_refresh_hash = ?').get(presented) as
        | Device
        | undefined;
      const retrying = replaced?.rotated_at && Date.now() - Date.parse(`${replaced.rotated_at.replace(' ', 'T')}Z`) < RETRY_GRACE_MS;
      // An old token used again outside the retry window: someone else has a copy.
      if (replaced && !retrying) this.db.prepare('DELETE FROM devices WHERE id = ?').run(replaced.id);
      throw unauthorized('devices.invalidRefreshToken');
    }
    if (!this.activeUser(device.user_id)) throw unauthorized('devices.invalidRefreshToken');

    const accessToken = newToken();
    const nextRefresh = newToken();
    this.db
      .prepare(
        `UPDATE devices SET access_hash = ?, access_expires_at = datetime('now', ?), refresh_hash = ?,
           previous_refresh_hash = ?, rotated_at = datetime('now'), refresh_expires_at = datetime('now', ?),
           last_seen_at = datetime('now'), last_ip = ?
         WHERE id = ?`,
      )
      .run(
        hash(accessToken),
        `+${ACCESS_TTL_SECONDS} seconds`,
        hash(nextRefresh),
        presented,
        `+${REFRESH_TTL_DAYS} days`,
        ip ?? null,
        device.id,
      );
    return this.tokens(device.id, accessToken, nextRefresh);
  }

  /** The device and its user for an access token, or null if it is unknown, expired or the user is gone. */
  authenticate(accessToken: string, ip: string | undefined): { user: User; device: Device } | null {
    const device = this.db
      .prepare("SELECT * FROM devices WHERE access_hash = ? AND access_expires_at > datetime('now')")
      .get(hash(accessToken)) as Device | undefined;
    if (!device) return null;
    const user = this.activeUser(device.user_id);
    if (!user) return null;

    const now = Date.now();
    if (now - (this.lastSeen.get(device.id) ?? 0) >= SEEN_INTERVAL_MS) {
      this.lastSeen.set(device.id, now);
      this.db.prepare("UPDATE devices SET last_seen_at = datetime('now'), last_ip = ? WHERE id = ?").run(ip ?? null, device.id);
    }
    return { user, device };
  }

  private activeUser(userId: string): User | null {
    return (this.db.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1').get(userId) as User | undefined) ?? null;
  }

  // --- management -----------------------------------------------------------

  list(userId: string): DeviceView[] {
    const rows = this.db
      .prepare('SELECT * FROM devices WHERE user_id = ? ORDER BY COALESCE(last_seen_at, created_at) DESC')
      .all(userId) as Device[];
    return rows.map(toView);
  }

  revoke(userId: string, deviceId: string): void {
    const result = this.db.prepare('DELETE FROM devices WHERE id = ? AND user_id = ?').run(deviceId, userId);
    if (result.changes === 0) throw notFound();
    this.lastSeen.delete(deviceId);
  }

  /** Devices nobody has used within the refresh lifetime can never sign in again. */
  pruneExpired(): void {
    this.db.prepare("DELETE FROM devices WHERE refresh_expires_at <= datetime('now')").run();
  }
}
