import { randomUUID } from 'crypto';
import { createWriteStream, promises as fs } from 'fs';
import { resolve, sep } from 'path';
import type { FileHandle } from 'fs/promises';
import { Transform, type Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { badRequest, conflict, notFound, payloadTooLarge, tooManyRequests } from '../../errors.js';
import { logger } from '../../logger.js';

/**
 * Bytes per chunk sent over HTTP. A file this size or smaller is sent in one plain upload, so
 * only large files pay for the extra requests. Small enough that a chunk always
 * finishes well inside Node's 5-minute request timeout, even on a slow link.
 */
export const CHUNK_SIZE = 8 * 1024 * 1024;
/**
 * Bytes per chunk sent over an upload socket. Sockets stream chunks back to back
 * without a request per chunk, so small chunks cost nothing in speed and keep
 * the memory held per socket low.
 */
export const SOCKET_CHUNK_SIZE = 1024 * 1024;

/** Unfinished uploads one user, or one visitor of a link, may hold at once. */
const MAX_SESSIONS_PER_QUOTA = 10;
/** Unfinished uploads on one link across all its visitors, so changing IPs cannot open them without end. */
const MAX_SESSIONS_PER_OWNER = 50;
/** An upload with no chunk arriving or being written for this long is dropped, with its partial file. */
const IDLE_MS = 10 * 60 * 1000;
/** How often a socket upload re-checks that its writer may still write there. */
const GUARD_INTERVAL_MS = 5000;

/** Largest file taken even with no upload limit set: beyond any real file, and it keeps offsets sane. */
const MAX_FILE_BYTES = 16 * 1024 ** 4;

/** The size a client declares for a chunked upload, checked against `limit` (the admin's MAX_UPLOAD_MB) before any byte arrives. */
export function declaredSize(value: unknown, limit: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw badRequest('error.invalidInput');
  if (value > limit || value > MAX_FILE_BYTES) throw payloadTooLarge('files.tooLarge');
  return value;
}

/** Chunk size for a new session: 1 MiB when its chunks come over an upload socket, 8 MiB over HTTP. */
export function chunkSizeFor(transport: unknown): number {
  return transport === 'socket' ? SOCKET_CHUNK_SIZE : CHUNK_SIZE;
}

interface Session<T> {
  id: string;
  owner: string;
  quota: string;
  /** Hidden `.part` file the chunks are written into, beside the destination. */
  partial: string;
  size: number;
  chunkSize: number;
  chunks: number;
  received: Set<number>;
  writing: Set<number>;
  finishing: boolean;
  lastActivity: number;
  /** Throws once the writer may no longer write there (grant revoked, link turned off). */
  guard: () => void;
  lastGuard: number;
  /** Opened on the first socket chunk and shared by all of them; closed when the session ends. */
  handle: Promise<FileHandle> | null;
  /** What the route needs to place the file once complete. */
  meta: T;
}

interface CreateOptions {
  chunkSize: number;
  guard: () => void;
}

/** Every live session, whichever service owns it, so an upload socket can find the one a chunk is for. */
const live = new Map<string, UploadSessions<unknown>>();

/**
 * Partial files of the uploads in progress, kept in a file so a restart can
 * remove the ones its lost sessions left behind in users' folders.
 */
const journal = { path: '', partials: new Map<string, string>(), timer: null as NodeJS.Timeout | null };
/** The temp names partialPath() makes: "<name>.<12 hex>.part". Nothing else is ever removed. */
const PARTIAL_NAME = /\.[0-9a-f]{12}\.part$/;

function saveJournal(): void {
  if (!journal.path || journal.timer) return;
  journal.timer = setTimeout(() => {
    journal.timer = null;
    fs.writeFile(journal.path, JSON.stringify([...journal.partials.values()])).catch((err) =>
      logger.warn(`Could not save the list of uploads in progress: ${String(err)}`),
    );
  }, 1000);
}

/**
 * Removes the partial files a previous run left (its sessions died with it),
 * then keeps the list at `path` for this run. Only files inside `dataRoot`
 * with the partial-file name pattern are touched.
 */
export async function recoverUploads(path: string, dataRoot: string): Promise<void> {
  journal.path = path;
  const root = resolve(dataRoot) + sep;
  let left: unknown = [];
  try {
    left = JSON.parse(await fs.readFile(path, 'utf8'));
  } catch {
    // No list yet, or unreadable: nothing to recover.
  }
  let removed = 0;
  for (const partial of Array.isArray(left) ? left : []) {
    if (typeof partial !== 'string' || !resolve(partial).startsWith(root) || !PARTIAL_NAME.test(partial)) continue;
    await fs
      .rm(partial, { force: true })
      .then(() => removed++)
      .catch(() => undefined);
  }
  if (removed > 0) logger.info(`Removed ${removed} partial file(s) left by uploads interrupted by a restart`);
  saveJournal();
}

/** Fails the stream as soon as it carries more than `expected` bytes, and at the end if it carried fewer. */
function exactly(expected: number): Transform {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      seen += chunk.length;
      if (seen > expected) return callback(badRequest('files.uploadIncomplete'));
      callback(null, chunk);
    },
    flush(callback) {
      callback(seen === expected ? null : badRequest('files.uploadIncomplete'));
    },
  });
}

/**
 * Writes one chunk that arrived over an upload socket. `owner` is who the socket
 * signed in as; a session belonging to anyone else is reported as missing.
 */
export function writeSocketChunk(id: string, owner: string, index: number, data: Buffer): Promise<void> {
  const sessions = live.get(id);
  if (!sessions) return Promise.reject(notFound());
  return sessions.writeBuffer(id, owner, index, data);
}

/**
 * Large files arrive as numbered chunks sent in parallel, so a high-latency
 * link is not held to what a single connection can carry. Each chunk is
 * written at its own offset in the partial file, and the file is only moved
 * into place once every chunk is in. Sessions live in memory: a restart loses
 * them and the client has to send the file again.
 */
export class UploadSessions<T> {
  private sessions = new Map<string, Session<T>>();

  constructor(private label: string) {
    setInterval(() => void this.dropIdle(), 60 * 1000).unref();
  }

  /**
   * `owner` is who may send the chunks; `quota` who the unfinished uploads are
   * counted against (the same, except on a link shared by many visitors).
   * `partial` must not exist yet; it is created empty here.
   */
  async create(
    owner: string,
    quota: string,
    partial: string,
    size: number,
    meta: T,
    options: CreateOptions,
  ): Promise<{ id: string; chunkSize: number }> {
    let byQuota = 0;
    let byOwner = 0;
    for (const session of this.sessions.values()) {
      if (session.quota === quota) byQuota++;
      if (session.owner === owner) byOwner++;
    }
    if (byQuota >= MAX_SESSIONS_PER_QUOTA || byOwner >= MAX_SESSIONS_PER_OWNER) throw tooManyRequests(60);

    // 'wx' refuses to reuse anything already at that path.
    await fs.writeFile(partial, '', { flag: 'wx' });

    const id = randomUUID();
    this.sessions.set(id, {
      id,
      owner,
      quota,
      partial,
      size,
      chunkSize: options.chunkSize,
      chunks: Math.ceil(size / options.chunkSize),
      received: new Set(),
      writing: new Set(),
      finishing: false,
      lastActivity: Date.now(),
      guard: options.guard,
      lastGuard: Date.now(),
      handle: null,
      meta,
    });
    live.set(id, this as UploadSessions<unknown>);
    journal.partials.set(id, partial);
    saveJournal();
    return { id, chunkSize: options.chunkSize };
  }

  /** Unknown and foreign sessions look the same, so ids cannot be probed. */
  private owned(id: string, owner: string): Session<T> {
    const session = this.sessions.get(id);
    if (!session || session.owner !== owner) throw notFound();
    return session;
  }

  meta(id: string, owner: string): T {
    return this.owned(id, owner).meta;
  }

  /** Bytes chunk `rawIndex` must carry, after checking it may be written now. */
  private claim(session: Session<T>, rawIndex: string | number): { index: number; start: number; expected: number } {
    const index = typeof rawIndex === 'number' ? rawIndex : /^\d{1,9}$/.test(rawIndex) ? Number(rawIndex) : NaN;
    if (!Number.isInteger(index) || index < 0 || index >= session.chunks) throw badRequest('error.invalidInput');
    if (session.finishing || session.writing.has(index)) throw conflict('files.uploadIncomplete');

    const start = index * session.chunkSize;
    return { index, start, expected: Math.min(session.chunkSize, session.size - start) };
  }

  /** Writes chunk `index` from `body`, which must carry exactly that chunk's bytes. Sending a chunk again replaces it. */
  async writeChunk(id: string, owner: string, rawIndex: string, body: Readable): Promise<void> {
    const session = this.owned(id, owner);
    const { index, start, expected } = this.claim(session, rawIndex);

    session.writing.add(index);
    session.received.delete(index);
    session.lastActivity = Date.now();
    try {
      // r+ writes in place without truncating what other chunks already wrote.
      await pipeline(body, exactly(expected), createWriteStream(session.partial, { flags: 'r+', start }));
      session.received.add(index);
    } catch (err) {
      // Cancelled or dropped meanwhile: its partial file is gone, which is not a server fault.
      if (!this.sessions.has(id)) throw notFound();
      throw err;
    } finally {
      session.writing.delete(index);
      session.lastActivity = Date.now();
    }
  }

  /** The same for a chunk that arrived whole over an upload socket. */
  async writeBuffer(id: string, owner: string, index: number, data: Buffer): Promise<void> {
    const session = this.owned(id, owner);
    const claim = this.claim(session, index);
    if (data.length !== claim.expected) throw badRequest('files.uploadIncomplete');

    // Sockets have no request per chunk to re-check permissions on, so do it here, every few seconds.
    if (Date.now() - session.lastGuard >= GUARD_INTERVAL_MS) {
      session.guard();
      session.lastGuard = Date.now();
    }

    session.writing.add(claim.index);
    session.received.delete(claim.index);
    session.lastActivity = Date.now();
    try {
      session.handle ??= fs.open(session.partial, 'r+');
      const handle = await session.handle;
      let written = 0;
      while (written < data.length) {
        const { bytesWritten } = await handle.write(data, written, data.length - written, claim.start + written);
        written += bytesWritten;
      }
      session.received.add(claim.index);
    } catch (err) {
      if (!this.sessions.has(id)) throw notFound();
      throw err;
    } finally {
      session.writing.delete(claim.index);
      session.lastActivity = Date.now();
    }
  }

  /**
   * Once every chunk is in, hands the partial file to `place`, which moves it
   * into its final location. Whatever happens, the session ends here, and the
   * partial file is removed if `place` did not take it.
   */
  async complete<R>(id: string, owner: string, place: (partial: string, meta: T) => Promise<R>): Promise<R> {
    const session = this.owned(id, owner);
    if (session.finishing || session.writing.size > 0) throw conflict('files.uploadIncomplete');
    if (session.received.size !== session.chunks) throw badRequest('files.uploadIncomplete');

    session.finishing = true;
    try {
      await this.release(session);
      return await place(session.partial, session.meta);
    } finally {
      this.forget(id);
      await fs.rm(session.partial, { force: true }).catch(() => undefined);
    }
  }

  async cancel(id: string, owner: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session || session.owner !== owner || session.finishing) return;
    this.forget(id);
    await this.release(session);
    await fs.rm(session.partial, { force: true }).catch(() => undefined);
  }

  private forget(id: string): void {
    this.sessions.delete(id);
    live.delete(id);
    journal.partials.delete(id);
    saveJournal();
  }

  /** Closes the file a socket upload kept open, so it can be moved or removed. */
  private async release(session: Session<T>): Promise<void> {
    if (!session.handle) return;
    const handle = session.handle;
    session.handle = null;
    await handle.then((h) => h.close()).catch(() => undefined);
  }

  private async dropIdle(): Promise<void> {
    const cutoff = Date.now() - IDLE_MS;
    for (const [id, session] of this.sessions) {
      if (session.finishing || session.writing.size > 0 || session.lastActivity >= cutoff) continue;
      this.forget(id);
      logger.info(`${this.label} upload ${id} abandoned by its client, removing its partial file`);
      await this.release(session);
      await fs.rm(session.partial, { force: true }).catch(() => undefined);
    }
  }
}
