import { randomUUID } from 'crypto';
import type { Db } from '../../db/client.js';
import type { EnvConfig } from '../../config/env.js';
import type { User } from '../../types/index.js';
import { hashPassword } from './password.js';
import { logger } from '../../logger.js';

const DEV_USERS = [
  { username: 'admin', password: 'admin', email: 'admin@localhost', role: 'admin' },
  { username: 'user', password: 'user', email: 'user@localhost', role: 'user' },
] as const;

/**
 * Test accounts for local development only. Their passwords are reset on every
 * boot so the credentials always work; never runs in production.
 */
export async function seedDevUsers(db: Db, config: EnvConfig): Promise<void> {
  if (config.NODE_ENV === 'production') return;

  for (const { username, password, email, role } of DEV_USERS) {
    const hash = await hashPassword(password);
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username) as
      | Pick<User, 'id'>
      | undefined;

    if (existing) {
      db.prepare("UPDATE users SET password_hash = ?, role = ?, is_active = 1, updated_at = datetime('now') WHERE id = ?").run(
        hash,
        role,
        existing.id,
      );
    } else {
      db.prepare(
        'INSERT INTO users (id, email, username, password_hash, role, is_active) VALUES (?, ?, ?, ?, ?, 1)',
      ).run(randomUUID(), email, username, hash, role);
    }
  }

  logger.warn(`Development seed: ${DEV_USERS.map((u) => `${u.username}/${u.password}`).join(', ')}`);
}
