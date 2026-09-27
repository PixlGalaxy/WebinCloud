import { promises as fs } from 'fs';
import { join } from 'path';
import type { Db } from '../../db/client.js';
import type { User } from '../../types/index.js';
import { notFound } from '../../errors.js';

export const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

export class AvatarsService {
  constructor(private db: Db, private avatarsDir: string) {}

  absolutePath(filename: string): string {
    return join(this.avatarsDir, filename);
  }

  filenameFor(userId: string): string | null {
    const row = this.db.prepare('SELECT avatar_path FROM users WHERE id = ?').get(userId) as
      | { avatar_path: string | null }
      | undefined;
    if (!row) throw notFound();
    return row.avatar_path;
  }

  private getUser(userId: string): User {
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as User;
  }

  /** Points avatar_path at the new file, removing the old one if its extension changed. */
  async save(userId: string, filename: string): Promise<User> {
    const previous = this.filenameFor(userId);
    if (previous && previous !== filename) {
      await fs.rm(this.absolutePath(previous), { force: true }).catch(() => undefined);
    }

    this.db
      .prepare("UPDATE users SET avatar_path = ?, updated_at = datetime('now') WHERE id = ?")
      .run(filename, userId);
    return this.getUser(userId);
  }

  async remove(userId: string): Promise<User> {
    const previous = this.filenameFor(userId);
    if (previous) {
      await fs.rm(this.absolutePath(previous), { force: true }).catch(() => undefined);
    }

    this.db.prepare("UPDATE users SET avatar_path = NULL, updated_at = datetime('now') WHERE id = ?").run(userId);
    return this.getUser(userId);
  }
}
