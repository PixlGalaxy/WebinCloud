-- Public URL aliases a user can pick instead of the random share token.
CREATE TABLE path_names (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL COLLATE NOCASE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Globally unique: the name is what appears in /public/<name>/...
CREATE UNIQUE INDEX idx_path_names_name ON path_names(name COLLATE NOCASE);
CREATE INDEX idx_path_names_user ON path_names(user_id);

-- The link's last URL segment, and the alias it is published under (NULL = use the token).
ALTER TABLE shares ADD COLUMN name TEXT NOT NULL DEFAULT '';
ALTER TABLE shares ADD COLUMN path_name_id TEXT REFERENCES path_names(id) ON DELETE SET NULL;

-- Within one alias the file name identifies the link; token-based shares are
-- exempt because SQLite treats each NULL as distinct.
CREATE UNIQUE INDEX idx_shares_alias_name ON shares(path_name_id, name) WHERE path_name_id IS NOT NULL;

-- Small key/value store; holds the HMAC secret that signs share unlock cookies.
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
