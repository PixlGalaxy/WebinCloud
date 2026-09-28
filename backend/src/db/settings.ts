import { randomBytes } from 'crypto';
import type { Db } from './client.js';

/**
 * Returns a persistent random secret, creating it on first use. Living in the
 * database means it survives restarts without an extra config file.
 */
export function getOrCreateSecret(db: Db, key: string): string {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  if (row) return row.value;

  const value = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)').run(key, value);
  return value;
}

/**
 * Admin-editable server configuration, layered over the `.env` defaults in
 * `EnvConfig`. Backed by the same `app_settings` key-value table used for
 * secrets — a missing key just means "use the env/hardcoded default", so
 * deployments that never touch the admin panel behave exactly as before.
 */
export class SettingsService {
  constructor(private db: Db) {}

  private row(key: string): string | undefined {
    return (this.db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined)
      ?.value;
  }

  getString(key: string, fallback: string): string {
    return this.row(key) ?? fallback;
  }

  /** `undefined` fallback if unset, distinct from "set to empty string" — used for optional secrets like the MaxMind key. */
  getOptionalString(key: string): string | undefined {
    const value = this.row(key);
    return value === undefined || value === '' ? undefined : value;
  }

  getNumber(key: string, fallback: number): number {
    const raw = this.row(key);
    if (raw === undefined) return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  getBoolean(key: string, fallback: boolean): boolean {
    const raw = this.row(key);
    return raw === undefined ? fallback : raw === 'true';
  }

  set(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value);
  }

  /** Reverts a key to its env/hardcoded default by simply forgetting the override. */
  delete(key: string): void {
    this.db.prepare('DELETE FROM app_settings WHERE key = ?').run(key);
  }

  has(key: string): boolean {
    return this.row(key) !== undefined;
  }
}
