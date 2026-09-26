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
