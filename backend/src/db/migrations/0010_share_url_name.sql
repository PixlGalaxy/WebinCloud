-- The link's path under its alias. Path-name links now publish the item's full
-- path from the data root (/public/<alias>/apps/app.exe), so two files with the
-- same name in different folders no longer clash. `name` stays the item's own
-- name; existing links keep their current URL.
ALTER TABLE shares ADD COLUMN url_name TEXT NOT NULL DEFAULT '';
UPDATE shares SET url_name = name;

DROP INDEX idx_shares_alias_name;
CREATE UNIQUE INDEX idx_shares_alias_url_name ON shares(path_name_id, url_name) WHERE path_name_id IS NOT NULL;
