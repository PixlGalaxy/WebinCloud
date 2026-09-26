import { readFileSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import type { Db } from './client.js';
import { logger } from '../logger.js';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

export function runMigrations(db: Db): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)');
  const row = db.prepare('SELECT MAX(version) AS version FROM schema_version').get() as { version: number | null };
  const current = row.version ?? 0;

  const files = readdirSync(migrationsDir)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort();

  for (const file of files) {
    const version = parseInt(file.slice(0, 4), 10);
    if (version <= current) continue;
    const sql = readFileSync(join(migrationsDir, file), 'utf-8');
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_version (version) VALUES (?)').run(version);
    })();
    logger.info(`Applied migration: ${file}`);
  }
}
