-- A session opened with credentials that must be replaced before anything else
-- is allowed: 'setup' for the seeded admin/changeme account, 'password' for any
-- account still using the default password. Until the account is fixed the
-- session only reaches /auth/me, /auth/logout and the endpoint that fixes it —
-- previously this was enforced by the frontend alone, so a direct API client
-- holding the default password had full admin access.
ALTER TABLE sessions ADD COLUMN pending_action TEXT;
