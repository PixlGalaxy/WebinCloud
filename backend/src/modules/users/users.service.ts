import { randomUUID } from 'crypto';
import type { Db } from '../../db/client.js';
import type { User, PublicUser } from '../../types/index.js';
import { badRequest, conflict, notFound } from '../../errors.js';
import { hashPassword } from '../auth/password.js';
import { toPublicUser } from '../auth/auth.service.js';
import { PathNamesService } from '../path-names/path-names.service.js';

export interface CreateUserInput {
  email: string;
  username: string;
  password: string;
  displayName?: string | null;
  role?: 'admin' | 'user';
}

export interface UpdateUserInput {
  email?: string;
  displayName?: string | null;
  role?: 'admin' | 'user';
  isActive?: boolean;
  password?: string;
}

// Intentionally permissive: self-hosted installs use intranet addresses such as
// "admin@localhost", which a TLD-requiring pattern would reject.
const EMAIL = /^[^\s@]+@[^\s@]+$/;
const USERNAME = /^[a-zA-Z0-9._-]{3,32}$/;

export class UsersService {
  constructor(private db: Db) {}

  list(): PublicUser[] {
    const rows = this.db.prepare('SELECT * FROM users ORDER BY username').all() as User[];
    return rows.map(toPublicUser);
  }

  get(id: string): PublicUser {
    const row = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined;
    if (!row) throw notFound();
    return toPublicUser(row);
  }

  private assertUnique(field: 'email' | 'username', value: string, exceptId?: string): void {
    const row = this.db
      .prepare(`SELECT id FROM users WHERE ${field} = ? AND id IS NOT ?`)
      .get(value, exceptId ?? null) as { id: string } | undefined;
    if (row) throw conflict(field === 'email' ? 'users.emailTaken' : 'users.usernameTaken');
  }

  async create(input: CreateUserInput): Promise<PublicUser> {
    if (!EMAIL.test(input.email)) throw badRequest('users.invalidEmail');
    if (!USERNAME.test(input.username)) throw badRequest('users.invalidUsername');
    if (input.password.length < 8) throw badRequest('auth.passwordTooShort');

    this.assertUnique('email', input.email);
    this.assertUnique('username', input.username);

    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO users (id, email, username, password_hash, display_name, role, is_active)
         VALUES (?, ?, ?, ?, ?, ?, 1)`,
      )
      .run(
        id,
        input.email,
        input.username,
        await hashPassword(input.password),
        input.displayName ?? null,
        input.role ?? 'user',
      );

    new PathNamesService(this.db).ensureDefault(id, input.username);
    return this.get(id);
  }

  async update(id: string, input: UpdateUserInput): Promise<PublicUser> {
    const existing = this.db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined;
    if (!existing) throw notFound();

    if (input.email !== undefined) {
      if (!EMAIL.test(input.email)) throw badRequest('users.invalidEmail');
      this.assertUnique('email', input.email, id);
    }
    if (input.password !== undefined && input.password.length < 8) throw badRequest('auth.passwordTooShort');

    this.db
      .prepare(
        `UPDATE users SET
           email = COALESCE(?, email),
           display_name = CASE WHEN ? THEN ? ELSE display_name END,
           role = COALESCE(?, role),
           is_active = COALESCE(?, is_active),
           password_hash = COALESCE(?, password_hash),
           updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(
        input.email ?? null,
        input.displayName !== undefined ? 1 : 0,
        input.displayName ?? null,
        input.role ?? null,
        input.isActive === undefined ? null : input.isActive ? 1 : 0,
        input.password ? await hashPassword(input.password) : null,
        id,
      );

    // A deactivated user, a demoted admin or a new password must stop old sessions.
    if (input.isActive === false || input.role !== undefined || input.password) {
      this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);
    }

    return this.get(id);
  }

  remove(id: string, actingUserId: string): void {
    if (id === actingUserId) throw badRequest('users.cannotDeleteSelf');
    const result = this.db.prepare('DELETE FROM users WHERE id = ?').run(id);
    if (result.changes === 0) throw notFound();
  }
}
