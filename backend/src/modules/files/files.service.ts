import { promises as fs, existsSync, statSync } from 'fs';
import { basename, extname } from 'path';
import type { Db } from '../../db/client.js';
import type { User } from '../../types/index.js';
import { badRequest, conflict, notFound } from '../../errors.js';
import { accessFrom, getAccess, listGrants, requireRead, requireWrite } from '../permissions/access-check.js';
import { assertValidName, joinRelPath, parentOf, resolveSafePath } from './path-safety.js';
import { inlineMimeOf, isTextFile, previewKindOf, type PreviewKind } from './mime.js';
import { logFileAction, userActor } from '../../activity.js';

/** Editing is meant for source and config files, not multi-megabyte logs. */
const MAX_TEXT_BYTES = 2 * 1024 * 1024;

/** Bounds on the recursive search, so one request cannot walk forever. */
const MAX_SEARCH_RESULTS = 200;
const MAX_SEARCH_DIRS = 5000;

export interface DirEntry {
  name: string;
  path: string;
  type: 'file' | 'folder';
  size: number;
  modifiedAt: string;
  previewKind: PreviewKind;
}

export interface Listing {
  path: string;
  canWrite: boolean;
  entries: DirEntry[];
}

export interface SearchResult {
  /** Folder the match lives in, relative to the data root ("" = root). */
  parentPath: string;
  entry: DirEntry;
}

export interface SearchResponse {
  query: string;
  path: string;
  results: SearchResult[];
  /** True when a limit stopped the walk, so the list may be incomplete. */
  truncated: boolean;
}

export type ConflictMode = 'fail' | 'overwrite' | 'keepBoth';

export interface ExistingFile {
  name: string;
  size: number;
  modifiedAt: string;
}

async function statEntry(absolute: string, name: string, relPath: string): Promise<DirEntry | null> {
  try {
    const stats = await fs.stat(absolute);
    const isDirectory = stats.isDirectory();
    return {
      name,
      path: relPath,
      type: isDirectory ? 'folder' : 'file',
      size: isDirectory ? 0 : stats.size,
      modifiedAt: stats.mtime.toISOString(),
      previewKind: isDirectory ? 'none' : previewKindOf(name),
    };
  } catch {
    // Vanished between readdir and stat, or a broken link: leave it out.
    return null;
  }
}

function sortEntries(entries: DirEntry[]): DirEntry[] {
  return entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

export class FilesService {
  constructor(
    private db: Db,
    private dataRoot: string,
  ) {}

  private absolute(relPath: string): string {
    return resolveSafePath(this.dataRoot, relPath);
  }

  /** At the root a non-admin sees their granted folders rather than the real directory. */
  private async listGrantedRoot(user: User): Promise<DirEntry[]> {
    const entries = await Promise.all(
      listGrants(this.db, user.id)
        .filter((grant) => grant.can_read === 1)
        .map((grant) =>
          statEntry(this.absolute(grant.folder_path), basename(grant.folder_path), grant.folder_path),
        ),
    );
    return sortEntries(entries.filter((entry): entry is DirEntry => entry !== null));
  }

  async list(user: User, relPath: string): Promise<Listing> {
    if (relPath === '' && user.role !== 'admin') {
      return { path: '', canWrite: false, entries: await this.listGrantedRoot(user) };
    }

    requireRead(this.db, user, relPath);
    const absolute = this.absolute(relPath);

    let names: string[];
    try {
      names = await fs.readdir(absolute);
    } catch {
      throw notFound();
    }

    const entries = await Promise.all(
      names.map((name) => statEntry(resolveSafePath(absolute, name), name, joinRelPath(relPath, name))),
    );

    return {
      path: relPath,
      canWrite: getAccess(this.db, user, relPath).write,
      entries: sortEntries(entries.filter((entry): entry is DirEntry => entry !== null)),
    };
  }

  /**
   * Walks the tree under `relPath` looking for names containing `query`.
   * Breadth-first and bounded, so a huge tree cannot stall the server, and
   * every directory is permission-checked before being opened.
   */
  async search(user: User, relPath: string, query: string): Promise<SearchResponse> {
    const needle = query.trim().toLowerCase();
    if (needle === '') return { query, path: relPath, results: [], truncated: false };

    const grants = user.role === 'admin' ? [] : listGrants(this.db, user.id);
    const canRead = (dir: string) => accessFrom(grants, user, dir).read;

    // A non-admin searching the root starts from each granted folder instead.
    const queue: string[] =
      relPath === '' && user.role !== 'admin'
        ? grants.filter((g) => g.can_read === 1).map((g) => g.folder_path)
        : [relPath];

    if (relPath !== '' || user.role === 'admin') requireRead(this.db, user, relPath);

    const results: SearchResult[] = [];
    let visited = 0;
    let truncated = false;

    while (queue.length > 0) {
      if (results.length >= MAX_SEARCH_RESULTS || visited >= MAX_SEARCH_DIRS) {
        truncated = true;
        break;
      }

      const dir = queue.shift()!;
      if (!canRead(dir)) continue;
      visited++;

      let names: string[];
      try {
        names = await fs.readdir(this.absolute(dir));
      } catch {
        continue; // removed or unreadable while walking
      }

      for (const name of names) {
        const childPath = joinRelPath(dir, name);
        let stats;
        try {
          // lstat, not stat: a symlink must never be followed out of the tree.
          stats = await fs.lstat(this.absolute(childPath));
        } catch {
          continue;
        }
        if (stats.isSymbolicLink()) continue;

        const isDirectory = stats.isDirectory();
        if (isDirectory) queue.push(childPath);

        if (name.toLowerCase().includes(needle) && results.length < MAX_SEARCH_RESULTS) {
          results.push({
            parentPath: dir,
            entry: {
              name,
              path: childPath,
              type: isDirectory ? 'folder' : 'file',
              size: isDirectory ? 0 : stats.size,
              modifiedAt: stats.mtime.toISOString(),
              previewKind: isDirectory ? 'none' : previewKindOf(name),
            },
          });
        }
      }
    }

    results.sort((a, b) => {
      if (a.entry.type !== b.entry.type) return a.entry.type === 'folder' ? -1 : 1;
      return a.entry.path.localeCompare(b.entry.path);
    });

    return { query, path: relPath, results, truncated };
  }

  async createFolder(user: User, parentPath: string, name: string): Promise<DirEntry> {
    assertValidName(name);
    requireWrite(this.db, user, parentPath);

    const relPath = joinRelPath(parentPath, name);
    const absolute = this.absolute(relPath);

    try {
      await fs.mkdir(absolute);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'EEXIST') throw conflict('files.alreadyExists');
      throw err;
    }

    logFileAction(userActor(user), 'created', 'folder', name, absolute);
    return (await statEntry(absolute, name, relPath))!;
  }

  async rename(user: User, relPath: string, newName: string): Promise<DirEntry> {
    assertValidName(newName);
    if (relPath === '') throw notFound();

    const parent = parentOf(relPath);
    requireWrite(this.db, user, relPath);
    requireWrite(this.db, user, parent);

    const target = joinRelPath(parent, newName);
    const from = this.absolute(relPath);
    const to = this.absolute(target);

    try {
      await fs.access(to);
      throw conflict('files.alreadyExists');
    } catch (err) {
      if (err instanceof Error && 'status' in err) throw err;
    }

    await fs.rename(from, to);
    const renamed = (await statEntry(to, newName, target))!;
    logFileAction(userActor(user), 'renamed', renamed.type, `${basename(relPath)} to ${newName}`, to);
    return renamed;
  }

  async remove(user: User, relPath: string): Promise<void> {
    if (relPath === '') throw notFound();
    requireWrite(this.db, user, relPath);

    const absolute = this.absolute(relPath);
    const kind = (await fs.stat(absolute).catch(() => null))?.isDirectory() ? 'folder' : 'file';
    try {
      await fs.rm(absolute, { recursive: true, force: false });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw notFound();
      throw err;
    }
    logFileAction(userActor(user), 'deleted', kind, basename(relPath), absolute);
  }

  /** Absolute path of a readable file, for streaming downloads. */
  async resolveFile(user: User, relPath: string): Promise<{ absolute: string; name: string; size: number }> {
    if (relPath === '') throw notFound();
    requireRead(this.db, user, relPath);

    const absolute = this.absolute(relPath);
    const stats = await fs.stat(absolute).catch(() => {
      throw notFound();
    });
    if (stats.isDirectory()) throw notFound();

    return { absolute, name: basename(relPath), size: stats.size };
  }

  /** Absolute path of a file that is safe to serve inline for preview. */
  async resolveInlineFile(
    user: User,
    relPath: string,
  ): Promise<{ absolute: string; name: string; mime: string }> {
    const { absolute, name } = await this.resolveFile(user, relPath);
    const mime = inlineMimeOf(name);
    if (!mime) throw badRequest('files.notPreviewable');
    return { absolute, name, mime };
  }

  async readText(user: User, relPath: string): Promise<{ content: string; kind: PreviewKind; canWrite: boolean }> {
    const { absolute, name, size } = await this.resolveFile(user, relPath);
    if (!isTextFile(name)) throw badRequest('files.notPreviewable');
    if (size > MAX_TEXT_BYTES) throw badRequest('files.tooLargeToEdit');

    return {
      content: await fs.readFile(absolute, 'utf-8'),
      kind: previewKindOf(name),
      canWrite: getAccess(this.db, user, relPath).write,
    };
  }

  async writeText(user: User, relPath: string, content: string): Promise<void> {
    if (relPath === '') throw notFound();
    requireWrite(this.db, user, relPath);

    const absolute = this.absolute(relPath);
    const stats = await fs.stat(absolute).catch(() => {
      throw notFound();
    });
    if (stats.isDirectory()) throw notFound();
    if (!isTextFile(basename(relPath))) throw badRequest('files.notPreviewable');
    if (Buffer.byteLength(content, 'utf8') > MAX_TEXT_BYTES) throw badRequest('files.tooLargeToEdit');

    // Write beside the original and swap, so a failed write never truncates it.
    const partial = `${absolute}.saving`;
    await fs.writeFile(partial, content, 'utf-8');
    await fs.rename(partial, absolute);
    logFileAction(userActor(user), 'edited', 'file', basename(relPath), absolute);
  }

  /** Existing files among `names`, so the client can ask before replacing them. */
  checkConflicts(user: User, folderPath: string, names: string[]): ExistingFile[] {
    requireWrite(this.db, user, folderPath);

    const conflicts: ExistingFile[] = [];
    for (const name of names) {
      assertValidName(name);
      const absolute = this.absolute(joinRelPath(folderPath, name));
      if (!existsSync(absolute)) continue;

      const stats = statSync(absolute);
      conflicts.push({ name, size: stats.size, modifiedAt: stats.mtime.toISOString() });
    }
    return conflicts;
  }

  /** Creates the folder an upload lands in, so a dropped folder keeps its structure. */
  async prepareUploadFolder(user: User, folderPath: string): Promise<void> {
    requireWrite(this.db, user, folderPath);
    for (const segment of folderPath.split('/')) if (segment) assertValidName(segment);

    const absolute = this.absolute(folderPath);
    const created = await fs.mkdir(absolute, { recursive: true });
    // Only the caller that really created it logs it, even when uploads race.
    if (created) logFileAction(userActor(user), 'created', 'folder', basename(absolute), absolute);
  }

  /**
   * Destination for an upload. Kept synchronous so the incoming stream is never
   * left unattended while we decide where it goes.
   */
  uploadTarget(
    user: User,
    folderPath: string,
    name: string,
    onConflict: ConflictMode,
  ): { absolute: string; relPath: string } {
    assertValidName(name);
    requireWrite(this.db, user, folderPath);

    let finalName = name;
    const taken = (candidate: string) => existsSync(this.absolute(joinRelPath(folderPath, candidate)));

    if (taken(name)) {
      if (onConflict === 'fail') throw conflict('files.alreadyExists');
      if (onConflict === 'keepBoth') finalName = this.freeName(folderPath, name);
      // 'overwrite' keeps the name: the .part rename replaces the old file only
      // once the new one is fully written.
    }

    const relPath = joinRelPath(folderPath, finalName);
    return { absolute: this.absolute(relPath), relPath };
  }

  /** "agua.txt" -> "agua (new).txt", then "agua (new 2).txt", ... */
  private freeName(folderPath: string, name: string): string {
    const ext = extname(name);
    const stem = name.slice(0, name.length - ext.length);

    for (let attempt = 1; attempt < 1000; attempt++) {
      const suffix = attempt === 1 ? ' (new)' : ` (new ${attempt})`;
      const candidate = `${stem}${suffix}${ext}`;
      if (!existsSync(this.absolute(joinRelPath(folderPath, candidate)))) return candidate;
    }
    throw conflict('files.alreadyExists');
  }

  /** Absolute path of a readable folder, for watching it. */
  watchTarget(user: User, relPath: string): string {
    requireRead(this.db, user, relPath);
    return this.absolute(relPath);
  }
}
