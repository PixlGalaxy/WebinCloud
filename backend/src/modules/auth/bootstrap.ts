import { randomUUID } from 'crypto';
import type { Db } from '../../db/client.js';
import type { EnvConfig } from '../../config/env.js';
import { hashPassword } from './password.js';
import { logger } from '../../logger.js';

export async function bootstrapAdmin(db: Db, config: EnvConfig): Promise<void> {
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
  if (count > 0) return;

  if (!config.ADMIN_EMAIL || !config.ADMIN_USERNAME || !config.ADMIN_PASSWORD) {
    logger.warn('Admin bootstrap skipped: set ADMIN_EMAIL, ADMIN_USERNAME and ADMIN_PASSWORD');
    return;
  }

  db.prepare(
    `INSERT INTO users (id, email, username, password_hash, role, is_active)
     VALUES (?, ?, ?, ?, 'admin', 1)`,
  ).run(randomUUID(), config.ADMIN_EMAIL, config.ADMIN_USERNAME, await hashPassword(config.ADMIN_PASSWORD));

  logger.info(`Admin user created: ${config.ADMIN_USERNAME} (${config.ADMIN_EMAIL})`);
}
