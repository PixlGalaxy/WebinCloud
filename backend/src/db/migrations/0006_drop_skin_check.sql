-- Drops the CHECK constraint on theme_skin instead of widening it every time a
-- skin is added: the list is expected to keep growing, and SQLite can't alter a
-- CHECK constraint in place, so 0005 (and 0004 before it) each had to rebuild
-- the whole table just to add entries. Valid values are still enforced in code
-- (isThemeSkin(), used by the /auth/appearance route) before anything is
-- written — the DB just stores whatever it's given, so new skins from here on
-- only need code changes, never another migration.
-- theme_mode stays constrained: it's a fixed 3-value enum, not meant to grow.
CREATE TABLE users_new (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT,
  avatar_path TEXT,
  role TEXT NOT NULL CHECK (role IN ('admin','user')) DEFAULT 'user',
  is_active INTEGER NOT NULL DEFAULT 1,
  theme_mode TEXT NOT NULL DEFAULT 'dark' CHECK (theme_mode IN ('light', 'dark', 'system')),
  theme_skin TEXT NOT NULL DEFAULT 'default',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO users_new SELECT * FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
