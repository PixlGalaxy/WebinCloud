import { randomUUID } from 'crypto';
import type { Db } from '../../db/client.js';
import { hashPassword } from './password.js';
import { DEFAULT_PASSWORD } from './auth.service.js';
import { logger } from '../../logger.js';

/** The seeded first-run account. Deliberately fixed, not env-configurable — see complete-setup below. */
const DEFAULT_ADMIN = { username: 'admin', email: 'admin@example.com' };

/**
 * Always seeds a known admin/changeme account when no users exist yet, so the
 * app never becomes unusable for lack of an env var. The real credentials are
 * never meant to be used past first login: `AuthService.login` flags this
 * exact username+password combination as `mustCompleteSetup`, and the
 * frontend forces a new username, email and password before anything else is
 * reachable (see `POST /api/auth/complete-setup`).
 */
export async function bootstrapAdmin(db: Db): Promise<void> {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
  if (count > 0) return;

  db.prepare(
    `INSERT INTO users (id, email, username, password_hash, role, is_active)
     VALUES (?, ?, ?, ?, 'admin', 1)`,
  ).run(randomUUID(), DEFAULT_ADMIN.email, DEFAULT_ADMIN.username, await hashPassword(DEFAULT_PASSWORD));

  logger.warn(
    `Admin account created: sign in as "${DEFAULT_ADMIN.username}" with password "${DEFAULT_PASSWORD}" — ` +
      'you will be asked to set a new username, email and password immediately.',
  );
}
