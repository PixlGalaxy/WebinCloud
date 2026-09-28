import { randomBytes, createHash } from 'crypto';
import type { Db } from '../../db/client.js';
import type { User, Session, PublicUser, ThemeMode, ThemeSkin } from '../../types/index.js';
import { THEME_MODES, THEME_SKINS } from '../../types/index.js';
import { hashPassword, verifyPassword } from './password.js';

export function isThemeMode(value: unknown): value is ThemeMode {
  return THEME_MODES.includes(value as ThemeMode);
}

export function isThemeSkin(value: unknown): value is ThemeSkin {
  return THEME_SKINS.includes(value as ThemeSkin);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export const DEFAULT_PASSWORD = 'changeme';

export function toPublicUser(user: User): PublicUser {
  const { password_hash: _omit, ...rest } = user;
  return rest;
}

export class AuthService {
  constructor(private db: Db, private sessionTtlHours: number) {}

  async login(
    usernameOrEmail: string,
    password: string,
    meta: { userAgent?: string; ip?: string },
  ): Promise<{ user: User; sessionToken: string; mustChangePassword: boolean } | null> {
    const user = this.db
      .prepare('SELECT * FROM users WHERE (email = ? OR username = ?) AND is_active = 1')
      .get(usernameOrEmail, usernameOrEmail) as User | undefined;

    if (!user) return null;
    if (!(await verifyPassword(password, user.password_hash))) return null;

    const sessionToken = randomBytes(32).toString('hex');
    this.db
      .prepare(
        `INSERT INTO sessions (id, user_id, user_agent, ip_address, expires_at)
         VALUES (?, ?, ?, ?, datetime('now', ?))`,
      )
      .run(hashToken(sessionToken), user.id, meta.userAgent ?? null, meta.ip ?? null, `+${this.sessionTtlHours} hours`);

    return { user, sessionToken, mustChangePassword: password === DEFAULT_PASSWORD };
  }

  getSessionByToken(token: string): { user: User; session: Session } | null {
    const session = this.db
      .prepare("SELECT * FROM sessions WHERE id = ? AND expires_at > datetime('now')")
      .get(hashToken(token)) as Session | undefined;
    if (!session) return null;

    const user = this.db
      .prepare('SELECT * FROM users WHERE id = ? AND is_active = 1')
      .get(session.user_id) as User | undefined;
    if (!user) return null;

    this.db.prepare("UPDATE sessions SET last_seen_at = datetime('now') WHERE id = ?").run(session.id);
    return { user, session };
  }

  logout(sessionId: string): void {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<boolean> {
    const user = this.db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as
      | Pick<User, 'password_hash'>
      | undefined;
    if (!user || !(await verifyPassword(currentPassword, user.password_hash))) return false;

    const newHash = await hashPassword(newPassword);
    this.db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?").run(newHash, userId);
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    return true;
  }

  setAppearance(userId: string, appearance: { mode?: ThemeMode; skin?: ThemeSkin }): User {
    if (appearance.mode !== undefined) {
      this.db.prepare("UPDATE users SET theme_mode = ?, updated_at = datetime('now') WHERE id = ?").run(appearance.mode, userId);
    }
    if (appearance.skin !== undefined) {
      this.db.prepare("UPDATE users SET theme_skin = ?, updated_at = datetime('now') WHERE id = ?").run(appearance.skin, userId);
    }
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as User;
  }
}
