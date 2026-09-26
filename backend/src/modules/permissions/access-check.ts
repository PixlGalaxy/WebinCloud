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

/** Effective permissions for a path; the most permissive matching grant wins. */
export function getAccess(db: Db, user: User, relPath: string): Access {
  if (user.role === 'admin') return FULL;

  const grants = listGrants(db, user.id).filter((grant) => covers(grant, relPath));
  if (grants.length === 0) return NONE;

  return {
    read: grants.some((g) => g.can_read === 1),
    write: grants.some((g) => g.can_write === 1),
  };
}

export function requireRead(db: Db, user: User, relPath: string): void {
  if (!getAccess(db, user, relPath).read) throw forbidden();
}

export function requireWrite(db: Db, user: User, relPath: string): void {
  if (!getAccess(db, user, relPath).write) throw forbidden();
}
