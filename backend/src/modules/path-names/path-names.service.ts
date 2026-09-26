import { randomUUID } from 'crypto';
import type { Db } from '../../db/client.js';
import { badRequest, conflict, forbidden, notFound } from '../../errors.js';

export interface PathName {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
}

/** Lowercase slug: it has to survive being pasted into a URL. */
const VALID = /^[a-z0-9][a-z0-9._-]{1,62}$/;

/**
 * Only segments that could clash with how the app is served. Aliases live under
 * /public/, so frontend routes like /admin or /files are not a concern.
 */
const RESERVED = new Set(['api', 'backend', 'public', 'assets', 'static']);

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
}

export class PathNamesService {
  constructor(private db: Db) {}

  listByUser(userId: string): PathName[] {
    return this.db
      .prepare('SELECT * FROM path_names WHERE user_id = ? ORDER BY created_at')
      .all(userId) as PathName[];
  }

  private isTaken(name: string): boolean {
    return this.db.prepare('SELECT 1 FROM path_names WHERE name = ? COLLATE NOCASE').get(name) !== undefined;
  }

  create(userId: string, rawName: string): PathName {
    const name = rawName.trim().toLowerCase();
    if (!VALID.test(name)) throw badRequest('pathNames.invalid');
    if (RESERVED.has(name)) throw conflict('pathNames.reserved');
    if (this.isTaken(name)) throw conflict('pathNames.taken');

    const id = randomUUID();
    this.db.prepare('INSERT INTO path_names (id, user_id, name) VALUES (?, ?, ?)').run(id, userId, name);
    return this.db.prepare('SELECT * FROM path_names WHERE id = ?').get(id) as PathName;
  }

  /** Renaming keeps every existing link working, since shares store the id. */
  rename(id: string, userId: string, rawName: string): PathName {
    const existing = this.db.prepare('SELECT * FROM path_names WHERE id = ?').get(id) as PathName | undefined;
    if (!existing) throw notFound();
    if (existing.user_id !== userId) throw forbidden();

    const name = rawName.trim().toLowerCase();
    if (!VALID.test(name)) throw badRequest('pathNames.invalid');
    if (RESERVED.has(name)) throw conflict('pathNames.reserved');
    if (name !== existing.name.toLowerCase() && this.isTaken(name)) throw conflict('pathNames.taken');

    this.db.prepare('UPDATE path_names SET name = ? WHERE id = ?').run(name, id);
    return this.db.prepare('SELECT * FROM path_names WHERE id = ?').get(id) as PathName;
  }

  remove(id: string, userId: string): void {
    const existing = this.db.prepare('SELECT * FROM path_names WHERE id = ?').get(id) as PathName | undefined;
    if (!existing) throw notFound();
    if (existing.user_id !== userId) throw forbidden();

    const inUse = this.db.prepare('SELECT COUNT(*) AS count FROM shares WHERE path_name_id = ?').get(id) as {
      count: number;
    };
    if (inUse.count > 0) throw conflict('pathNames.inUse');

    this.db.prepare('DELETE FROM path_names WHERE id = ?').run(id);
  }

  /** Gives a new account a usable alias derived from its username. */
  ensureDefault(userId: string, username: string): void {
    if (this.listByUser(userId).length > 0) return;

    const base = slugify(username) || 'user';
    for (let attempt = 0; attempt < 100; attempt++) {
      const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
      if (RESERVED.has(candidate) || this.isTaken(candidate)) continue;

      this.db
        .prepare('INSERT INTO path_names (id, user_id, name) VALUES (?, ?, ?)')
        .run(randomUUID(), userId, candidate);
      return;
    }
  }
}
