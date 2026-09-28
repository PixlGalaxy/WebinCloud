-- Adds two more skins ('olive', 'maroon') to the allowed theme_skin values.
-- SQLite can't widen a CHECK constraint in place, so the table is rebuilt again.
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
  theme_skin TEXT NOT NULL DEFAULT 'default' CHECK (theme_skin IN (
    'default', 'ocean', 'sunset', 'forest', 'grape', 'crimson', 'solar', 'arctic', 'mint', 'blossom',
    'ares', 'poseidon', 'zeus', 'jade', 'verdigris', 'nebula', 'sakura', 'slate', 'mono', 'graphite',
    'ash', 'terracotta', 'olive', 'maroon'
  )),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO users_new SELECT * FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
