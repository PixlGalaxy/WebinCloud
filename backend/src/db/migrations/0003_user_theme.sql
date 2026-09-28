-- Appearance is now tied to the account, not the browser: it follows the user
-- across devices, and the unauthenticated login screen falls back to the
-- server's configured default instead.
ALTER TABLE users ADD COLUMN theme TEXT NOT NULL DEFAULT 'dark'
  CHECK (theme IN ('dark', 'light', 'ocean', 'sunset', 'forest', 'grape', 'crimson', 'solar', 'arctic', 'mint', 'blossom'));
