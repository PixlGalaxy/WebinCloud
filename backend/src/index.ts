import { mkdirSync } from 'fs';
import { loadEnv } from './config/env.js';
import { initializeDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { bootstrapAdmin } from './modules/auth/bootstrap.js';
import { seedDevUsers } from './modules/auth/dev-seed.js';
import { PathNamesService } from './modules/path-names/path-names.service.js';
import type { User } from './types/index.js';
import { createApp } from './app.js';
import { logger } from './logger.js';

async function main() {
  const config = loadEnv();

  mkdirSync(config.APPDATA_ROOT, { recursive: true });
  mkdirSync(config.DATA_ROOT, { recursive: true });
  mkdirSync(config.AVATARS_DIR, { recursive: true });

  const db = initializeDb(config.DB_PATH);
  runMigrations(db);
  await bootstrapAdmin(db, config);
  await seedDevUsers(db, config);

  // Covers accounts that existed before path names were introduced.
  const pathNames = new PathNamesService(db);
  for (const user of db.prepare('SELECT id, username FROM users').all() as Pick<User, 'id' | 'username'>[]) {
    pathNames.ensureDefault(user.id, user.username);
  }

  createApp(db, config).listen(config.PORT, () => {
    logger.info(`Listening on port ${config.PORT} (${config.NODE_ENV})`);
    logger.info(`Data root: ${config.DATA_ROOT}`);
    logger.info(`App data root: ${config.APPDATA_ROOT}`);
  });
}

main().catch((err) => {
  logger.error('Fatal error during startup', err);
  process.exit(1);
});
