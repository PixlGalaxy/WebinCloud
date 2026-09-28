-- Per-account UI language, following the same pattern as theme_mode/theme_skin.
-- No CHECK constraint (same reasoning as 0006): valid values are enforced in
-- code (isLanguage(), used by the /auth/appearance route).
ALTER TABLE users ADD COLUMN language TEXT NOT NULL DEFAULT 'en';
