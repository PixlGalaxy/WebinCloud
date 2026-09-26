import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import type { Db } from '../../db/client.js';
import type { FolderGrant } from '../../types/index.js';
import { badRequest, conflict, notFound } from '../../errors.js';
import { normalizeRelPath, resolveSafePath } from '../files/path-safety.js';

export interface CreateGrantInput {
  userId: string;
  folderPath: string;
  canRead?: boolean;
  canWrite?: boolean;
  inherit?: boolean;
  /** Creates the folder instead of failing when it does not exist yet. */
  createFolder?: boolean;
}

export interface UpdateGrantInput {
  canRead?: boolean;
  canWrite?: boolean;
  inherit?: boolean;
}

export class PermissionsService {
  constructor(
    private db: Db,
    private dataRoot: string,
  ) {}

  listByUser(userId: string): FolderGrant[] {
    return this.db
      .prepare('SELECT * FROM folder_grants WHERE user_id = ? ORDER BY folder_path')
      .all(userId) as FolderGrant[];
  }

  get(id: string): FolderGrant {
    const row = this.db.prepare('SELECT * FROM folder_grants WHERE id = ?').get(id) as FolderGrant | undefined;
    if (!row) throw notFound();
    return row;
  }

  async create(input: CreateGrantInput, createdBy: string): Promise<FolderGrant> {
    const folderPath = normalizeRelPath(input.folderPath);
    if (folderPath === '') throw badRequest('permissions.rootNotAllowed');

    const userExists = this.db.prepare('SELECT 1 FROM users WHERE id = ?').get(input.userId);
    if (!userExists) throw notFound();

    const absolute = resolveSafePath(this.dataRoot, folderPath);
    const stats = await fs.stat(absolute).catch(() => null);

    if (!stats) {
      if (!input.createFolder) throw badRequest('permissions.folderMissing');
      await fs.mkdir(absolute, { recursive: true });
    } else if (!stats.isDirectory()) {
      throw badRequest('permissions.folderMissing');
    }

    const duplicate = this.db
      .prepare('SELECT 1 FROM folder_grants WHERE user_id = ? AND folder_path = ?')
      .get(input.userId, folderPath);
    if (duplicate) throw conflict('permissions.alreadyGranted');

    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO folder_grants (id, user_id, folder_path, can_read, can_write, inherit, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.userId,
        folderPath,
        input.canRead === false ? 0 : 1,
        input.canWrite ? 1 : 0,
        input.inherit === false ? 0 : 1,
        createdBy,
      );

    return this.get(id);
  }

  update(id: string, input: UpdateGrantInput): FolderGrant {
    const grant = this.get(id);

    this.db
      .prepare('UPDATE folder_grants SET can_read = ?, can_write = ?, inherit = ? WHERE id = ?')
      .run(
        input.canRead === undefined ? grant.can_read : Number(input.canRead),
        input.canWrite === undefined ? grant.can_write : Number(input.canWrite),
        input.inherit === undefined ? grant.inherit : Number(input.inherit),
        id,
      );

    return this.get(id);
  }

  remove(id: string): void {
    const result = this.db.prepare('DELETE FROM folder_grants WHERE id = ?').run(id);
    if (result.changes === 0) throw notFound();
  }
}
