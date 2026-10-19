import type { Db } from '../../db/client.js';

/** `target_path` is `path` itself or something inside it. */
const UNDER = `(target_path = ? OR substr(target_path, 1, length(?) + 1) = ? || '/')`;

/**
 * Flags the links to a deleted item at once, so their owner sees the warning
 * without waiting for the next check. They stay for MISSING_GRACE_MS: an item
 * uploaded again under the same name in that time is served by the old link.
 */
export function markSharesMissing(db: Db, path: string): void {
  db.prepare(`UPDATE shares SET missing_since = ? WHERE missing_since IS NULL AND ${UNDER}`).run(
    new Date().toISOString(),
    path,
    path,
    path,
  );
}

/**
 * A renamed or moved item keeps its links. Only the target changes: the URL
 * stays the one already handed out, so nobody's link breaks.
 */
export function moveSharesUnder(db: Db, from: string, to: string): void {
  db.prepare(
    `UPDATE shares SET target_path = ? || substr(target_path, length(?) + 1), updated_at = datetime('now')
     WHERE ${UNDER}`,
  ).run(to, from, from, from, from);
}
