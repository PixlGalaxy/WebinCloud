import { randomBytes, createHmac, timingSafeEqual } from 'crypto';
import { promises as fs } from 'fs';
import { basename } from 'path';
import type { Db } from '../../db/client.js';
import type { Share, User } from '../../types/index.js';
import { badRequest, conflict, forbidden, notFound } from '../../errors.js';
import { getAccess, readChecker, type Access } from '../permissions/access-check.js';
import { normalizeRelPath, resolveSafePath } from '../files/path-safety.js';
import type { PathName } from '../path-names/path-names.service.js';
import { logFileAction, userActor } from '../../activity.js';

export interface ShareView extends Share {
  pathName: string | null;
  segment: string;
  url: string;
  hasPassword: boolean;
  expired: boolean;
}

export interface CreateShareInput {
  path: string;
  allowDownload?: boolean;
  allowUpload?: boolean;
  password?: string | null;
  expiresAt?: string | null;
  pathNameId?: string | null;
}

export interface UpdateShareInput {
  allowDownload?: boolean;
  allowUpload?: boolean;
  /** "" clears the password, undefined leaves it untouched. */
  password?: string | null;
  expiresAt?: string | null;
  pathNameId?: string | null;
}

function isExpired(share: Share): boolean {
  return share.expires_at !== null && new Date(share.expires_at).getTime() <= Date.now();
}

/** `null` clears the expiry; anything else must be a real date, or the link would never expire. */
function parseExpiry(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw badRequest('shares.invalidExpiry');
  const time = Date.parse(value);
  if (Number.isNaN(time)) throw badRequest('shares.invalidExpiry');
  return new Date(time).toISOString();
}

function optionalString(value: unknown, key: 'shares.invalidExpiry' | 'files.invalidPath'): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw badRequest(key);
  return value;
}

export class SharesService {
  constructor(
    private db: Db,
    private dataRoot: string,
    private secret: string,
    private hash: (value: string) => Promise<string>,
    private verify: (value: string, hash: string) => Promise<boolean>,
  ) {}

  private pathNameOf(share: Share): PathName | null {
    if (!share.path_name_id) return null;
    return this.db.prepare('SELECT * FROM path_names WHERE id = ?').get(share.path_name_id) as PathName | null;
  }

  toView(share: Share): ShareView {
    const pathName = this.pathNameOf(share);
    const segment = pathName?.name ?? share.id;

    return {
      ...share,
      pathName: pathName?.name ?? null,
      segment,
      url: `/public/${encodeURIComponent(segment)}/${encodeURIComponent(share.name)}`,
      hasPassword: share.password_hash !== null,
      expired: isExpired(share),
    };
  }

  listByOwner(userId: string): ShareView[] {
    const rows = this.db
      .prepare('SELECT * FROM shares WHERE owner_user_id = ? ORDER BY created_at DESC')
      .all(userId) as Share[];
    return rows.map((row) => this.toView(row));
  }

  private assertOwnedAlias(pathNameId: string, userId: string): void {
    const alias = this.db.prepare('SELECT * FROM path_names WHERE id = ?').get(pathNameId) as
      | PathName
      | undefined;
    if (!alias) throw notFound();
    if (alias.user_id !== userId) throw forbidden();
  }

  private assertAliasFree(pathNameId: string, name: string, exceptShareId?: string): void {
    const clash = this.db
      .prepare('SELECT id FROM shares WHERE path_name_id = ? AND name = ? AND id IS NOT ?')
      .get(pathNameId, name, exceptShareId ?? null);
    if (clash) throw conflict('shares.nameTaken');
  }

  async create(user: User, input: CreateShareInput): Promise<ShareView> {
    const targetPath = normalizeRelPath(input.path);
    if (targetPath === '') throw badRequest('shares.rootNotAllowed');

    const access = getAccess(this.db, user, targetPath);
    if (!access.read) throw forbidden();
    if (input.allowUpload && !access.write) throw forbidden();

    const stats = await fs.stat(resolveSafePath(this.dataRoot, targetPath)).catch(() => {
      throw notFound();
    });

    const name = basename(targetPath);
    const pathNameId = optionalString(input.pathNameId, 'files.invalidPath');
    const password = optionalString(input.password, 'files.invalidPath');
    const expiresAt = parseExpiry(input.expiresAt);
    if (pathNameId) {
      this.assertOwnedAlias(pathNameId, user.id);
      this.assertAliasFree(pathNameId, name);
    }

    const id = randomBytes(16).toString('hex');
    this.db
      .prepare(
        `INSERT INTO shares
           (id, owner_user_id, target_path, target_type, name, path_name_id,
            allow_download, allow_upload, password_hash, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        user.id,
        targetPath,
        stats.isDirectory() ? 'folder' : 'file',
        name,
        pathNameId,
        input.allowDownload === false ? 0 : 1,
        input.allowUpload ? 1 : 0,
        password ? await this.hash(password) : null,
        expiresAt,
      );

    logFileAction(
      userActor(user),
      'shared',
      stats.isDirectory() ? 'folder' : 'file',
      name,
      resolveSafePath(this.dataRoot, targetPath),
    );
    return this.toView(this.db.prepare('SELECT * FROM shares WHERE id = ?').get(id) as Share);
  }

  private owned(id: string, userId: string): Share {
    const share = this.db.prepare('SELECT * FROM shares WHERE id = ?').get(id) as Share | undefined;
    if (!share) throw notFound();
    if (share.owner_user_id !== userId) throw forbidden();
    return share;
  }

  async update(id: string, user: User, input: UpdateShareInput): Promise<ShareView> {
    const share = this.owned(id, user.id);

    const pathNameId = input.pathNameId === undefined ? undefined : optionalString(input.pathNameId, 'files.invalidPath');
    const password = input.password === undefined ? undefined : optionalString(input.password, 'files.invalidPath');
    const expiresAt = input.expiresAt === undefined ? share.expires_at : parseExpiry(input.expiresAt);
    if (pathNameId) {
      this.assertOwnedAlias(pathNameId, user.id);
      this.assertAliasFree(pathNameId, share.name, id);
    }
    if (input.allowUpload && !getAccess(this.db, user, share.target_path).write) throw forbidden();

    const passwordHash = password === undefined ? share.password_hash : password ? await this.hash(password) : null;

    this.db
      .prepare(
        `UPDATE shares SET
           allow_download = ?, allow_upload = ?, password_hash = ?, expires_at = ?,
           path_name_id = ?, updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(
        input.allowDownload === undefined ? share.allow_download : Number(input.allowDownload),
        input.allowUpload === undefined ? share.allow_upload : Number(input.allowUpload),
        passwordHash,
        expiresAt,
        pathNameId === undefined ? share.path_name_id : pathNameId,
        id,
      );

    return this.toView(this.db.prepare('SELECT * FROM shares WHERE id = ?').get(id) as Share);
  }

  remove(id: string, user: User): void {
    const share = this.owned(id, user.id);
    this.db.prepare('DELETE FROM shares WHERE id = ?').run(id);
    logFileAction(
      userActor(user),
      'unshared',
      share.target_type,
      share.name,
      resolveSafePath(this.dataRoot, share.target_path),
    );
  }

  /** Resolves /public/<segment>/<name>, by token first and then by alias. */
  findPublic(segment: string, name: string): Share | null {
    const byToken = this.db
      .prepare('SELECT * FROM shares WHERE id = ? AND name = ?')
      .get(segment, name) as Share | undefined;
    if (byToken) return byToken;

    const alias = this.db.prepare('SELECT * FROM path_names WHERE name = ? COLLATE NOCASE').get(segment) as
      | PathName
      | undefined;
    if (!alias) return null;

    return (
      (this.db
        .prepare('SELECT * FROM shares WHERE path_name_id = ? AND name = ?')
        .get(alias.id, name) as Share | undefined) ?? null
    );
  }

  assertUsable(share: Share): void {
    if (isExpired(share)) throw notFound('shares.expired');
  }

  // --- owner access ---------------------------------------------------------
  // A link never grants more than its owner can reach right now: revoking a
  // grant, deactivating or deleting the owner takes effect on every link at once.

  private activeOwner(share: Share): User | null {
    return (
      (this.db.prepare('SELECT * FROM users WHERE id = ? AND is_active = 1').get(share.owner_user_id) as
        | User
        | undefined) ?? null
    );
  }

  ownerAccess(share: Share, relPath: string): Access {
    const owner = this.activeOwner(share);
    if (!owner) return { read: false, write: false };
    return getAccess(this.db, owner, relPath);
  }

  /** Per-path read check against the owner's grants, for recursive walks such as archives. */
  ownerReadChecker(share: Share): (relPath: string) => boolean {
    const owner = this.activeOwner(share);
    return owner ? readChecker(this.db, owner) : () => false;
  }

  // --- unlock cookies -------------------------------------------------------

  private signUnlock(share: Share, expiresAt: number): string {
    return createHmac('sha256', this.secret)
      .update(`${share.id}:${share.password_hash ?? ''}:${expiresAt}`)
      .digest('hex');
  }

  /**
   * `<expiry>.<hmac>`. Bound to the password hash, so changing the password
   * invalidates old cookies, and to an expiry the server checks itself — the
   * cookie's maxAge is only a hint the browser may ignore.
   */
  unlockToken(share: Share): string {
    const expiresAt = Date.now() + UNLOCK_TTL_MS;
    return `${expiresAt}.${this.signUnlock(share, expiresAt)}`;
  }

  isUnlocked(share: Share, cookieValue: string | undefined): boolean {
    if (share.password_hash === null) return true;
    if (!cookieValue) return false;

    const [expiry, signature] = cookieValue.split('.');
    const expiresAt = Number(expiry);
    if (!signature || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;

    const expected = Buffer.from(this.signUnlock(share, expiresAt));
    const actual = Buffer.from(signature);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  checkPassword(share: Share, password: string): Promise<boolean> {
    if (share.password_hash === null) return Promise.resolve(true);
    return this.verify(password, share.password_hash);
  }
}

export const SHARE_COOKIE_PREFIX = 'share_';
export const UNLOCK_TTL_MS = 12 * 60 * 60 * 1000;
