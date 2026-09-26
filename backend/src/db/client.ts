import Database from 'better-sqlite3';

export type Db = Database.Database;

export function initializeDb(dbPath: string): Db {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}
