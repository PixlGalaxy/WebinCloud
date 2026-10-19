import type { Db } from '../../db/client.js';

/** `target_path` is `path` itself or something inside it. */
const UNDER = `(target_path = ? OR substr(target_path, 1, length(?) + 1) = ? || '/')`;

/**
 * Links point at a path, so they are kept in step with what the app does to
 * it: a deleted item takes its links with it, instead of a later upload with
 * the same name being served under the old link.
 */
export function forgetSharesUnder(db: Db, path: string): void {
  db.prepare(`DELETE FROM shares WHERE ${UNDER}`).run(path, path, path);
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
