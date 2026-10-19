import { promises as fs } from 'fs';
import type { Db } from '../../db/client.js';
import type { User } from '../../types/index.js';
import { forbidden } from '../../errors.js';
import { joinRelPath, resolveSafePath } from '../files/path-safety.js';
import { accessFrom, listGrants } from './access-check.js';

/**
 * Throws unless the user may write everything under `relPath`, not just the
 * folder itself: deleting, moving or replacing a folder acts on all of it. A
 * non-inheriting grant covers only its own folder, so a subfolder below it can
 * be out of the user's reach even though the parent is writable.
 */
export async function requireTreeWrite(db: Db, user: User, dataRoot: string, relPath: string): Promise<void> {
  if (user.role === 'admin') return;
  const grants = listGrants(db, user.id);

  // The common case, answered without walking: an inheriting write grant on
  // the folder or above it reaches every descendant.
  const inherited = grants.some(
    (grant) =>
      !!grant.inherit &&
      grant.can_write === 1 &&
      (grant.folder_path === relPath || relPath.startsWith(`${grant.folder_path}/`)),
  );
  if (inherited) return;

  const queue = [relPath];
  while (queue.length > 0) {
    const dir = queue.shift()!;
    if (!accessFrom(grants, user, dir).write) throw forbidden();

    const names = await fs.readdir(resolveSafePath(dataRoot, dir)).catch(() => [] as string[]);
    for (const name of names) {
      const child = joinRelPath(dir, name);
      if (!accessFrom(grants, user, child).write) throw forbidden();
      // lstat: a symlink is removed as itself, never followed.
      const stats = await fs.lstat(resolveSafePath(dataRoot, child)).catch(() => null);
      if (stats?.isDirectory()) queue.push(child);
    }
  }
}
