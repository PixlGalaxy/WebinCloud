-- Desktop apps and other clients signed in to an account. Each holds a
-- short-lived access token and a refresh token that changes on every use;
-- only their SHA-256 hashes are stored, as with sessions.
CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  platform TEXT NOT NULL,
  access_hash TEXT UNIQUE,
  access_expires_at TEXT,
  refresh_hash TEXT NOT NULL UNIQUE,
  -- The refresh token this one replaced: presented again, it means a copy was
  -- stolen, and the device is signed out.
  previous_refresh_hash TEXT,
  rotated_at TEXT,
  refresh_expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT,
  last_ip TEXT
);

CREATE INDEX idx_devices_user ON devices(user_id);
