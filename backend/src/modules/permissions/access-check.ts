import type { Db } from '../../db/client.js';
import type { User, FolderGrant } from '../../types/index.js';
import { forbidden } from '../../errors.js';

export interface Access {
  read: boolean;
  write: boolean;
}

const FULL: Access = { read: true, write: true };
const NONE: Access = { read: false, write: false };

function covers(grant: FolderGrant, relPath: string): boolean {
  if (grant.folder_path === relPath) return true;
  if (grant.inherit && relPath.startsWith(`${grant.folder_path}/`)) return true;
  return false;
}

export function listGrants(db: Db, userId: string): FolderGrant[] {
  return db
    .prepare('SELECT * FROM folder_grants WHERE user_id = ? ORDER BY folder_path')
    .all(userId) as FolderGrant[];
}

/**
 * Effective permissions from an already-loaded grant list, so a recursive walk
 * can check every directory without hitting the database each time.
 */
export function accessFrom(grants: FolderGrant[], user: User, relPath: string): Access {
  if (user.role === 'admin') return FULL;

  const matching = grants.filter((grant) => covers(grant, relPath));
  if (matching.length === 0) return NONE;

  return {
    read: matching.some((g) => g.can_read === 1),
    write: matching.some((g) => g.can_write === 1),
  };
}

/** Effective permissions for a path; the most permissive matching grant wins. */
export function getAccess(db: Db, user: User, relPath: string): Access {
  if (user.role === 'admin') return FULL;
  return accessFrom(listGrants(db, user.id), user, relPath);
}

/**
 * Read check for recursive walks (archives, copies): loads the grants once and
 * answers per path, so a subfolder a non-inheriting grant does not cover is
 * skipped instead of being swept in along with its parent.
 */
export function readChecker(db: Db, user: User): (relPath: string) => boolean {
  if (user.role === 'admin') return () => true;
  const grants = listGrants(db, user.id);
  return (relPath) => accessFrom(grants, user, relPath).read;
}

export function requireRead(db: Db, user: User, relPath: string): void {
  if (!getAccess(db, user, relPath).read) throw forbidden();
}

export function requireWrite(db: Db, user: User, relPath: string): void {
  if (!getAccess(db, user, relPath).write) throw forbidden();
}
