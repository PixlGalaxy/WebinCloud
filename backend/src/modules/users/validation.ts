import type { Db } from '../../db/client.js';
import { conflict } from '../../errors.js';

// Intentionally permissive: self-hosted installs use intranet addresses such as
// "admin@localhost", which a TLD-requiring pattern would reject.
export const EMAIL = /^[^\s@]+@[^\s@]+$/;
export const USERNAME = /^[a-zA-Z0-9._-]{3,32}$/;
// argon2 accepts any length, so cap it: a multi-megabyte "password" would
// otherwise be hashed in full on every login or unlock attempt.
export const MAX_PASSWORD_LENGTH = 256;

/** Shared by admin user management and the first-run "complete setup" flow. */
export function assertUniqueUser(db: Db, field: 'email' | 'username', value: string, exceptId?: string): void {
  const row = db.prepare(`SELECT id FROM users WHERE ${field} = ? AND id IS NOT ?`).get(value, exceptId ?? null) as
    | { id: string }
    | undefined;
  if (row) throw conflict(field === 'email' ? 'users.emailTaken' : 'users.usernameTaken');
}
