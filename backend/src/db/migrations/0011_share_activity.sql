-- When a link was last used, shown to its owner, and since when its file or
-- folder has been gone. A link whose item stays gone for 48 hours is removed;
-- one that comes back before then (deleted and uploaded again) keeps working.
ALTER TABLE shares ADD COLUMN last_accessed_at TEXT;
ALTER TABLE shares ADD COLUMN missing_since TEXT;
