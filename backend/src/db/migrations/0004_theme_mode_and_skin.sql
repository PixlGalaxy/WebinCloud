-- Splits appearance into two independent choices: `theme_mode` (light/dark/system,
-- a real light-or-dark switch) and `theme_skin` (just the accent color family, usable
-- under either mode). Replaces the single combined `theme` column from migration 0003.
-- SQLite can't drop a CHECK constraint in place, so the table is rebuilt.
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
    'ash', 'terracotta'
  )),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The old combined value packed both bits of information: 'light'/'dark' were a mode
-- with the default skin, anything else was a skin that only ever rendered in one mode.
INSERT INTO users_new (id, email, username, password_hash, display_name, avatar_path, role, is_active,
                        theme_mode, theme_skin, created_at, updated_at)
SELECT id, email, username, password_hash, display_name, avatar_path, role, is_active,
  CASE
    WHEN theme = 'light' THEN 'light'
    WHEN theme IN ('solar', 'arctic', 'mint', 'blossom') THEN 'light'
    ELSE 'dark'
  END,
  CASE WHEN theme IN ('dark', 'light') THEN 'default' ELSE theme END,
  created_at, updated_at
FROM users;

DROP TABLE users;
ALTER TABLE users_new RENAME TO users;
