-- Permanently blocked IPs, managed from the Admin Panel's IP Access page.
-- Separate from the in-memory rate limiter (fixed-window, self-expiring,
-- reset on restart) — this is a deliberate, persistent admin action.
CREATE TABLE ip_bans (
  id TEXT PRIMARY KEY,
  ip TEXT NOT NULL UNIQUE,
  reason TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
