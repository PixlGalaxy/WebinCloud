import { randomUUID } from 'crypto';
import { createWriteStream, promises as fs } from 'fs';
import { Transform, type Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { badRequest, conflict, notFound, payloadTooLarge, tooManyRequests } from '../../errors.js';
import { logger } from '../../logger.js';

/**
 * Bytes per chunk. A file this size or smaller is sent in one plain upload, so
 * only large files pay for the extra requests. Small enough that a chunk always
 * finishes well inside Node's 5-minute request timeout, even on a slow link.
 */
export const CHUNK_SIZE = 8 * 1024 * 1024;

/** Unfinished uploads one user, or one visitor of a link, may hold at once. */
const MAX_SESSIONS_PER_QUOTA = 10;
/** Unfinished uploads on one link across all its visitors, so changing IPs cannot open them without end. */
const MAX_SESSIONS_PER_OWNER = 50;
/** An upload with no chunk arriving or being written for this long is dropped, with its partial file. */
const IDLE_MS = 10 * 60 * 1000;

/** Largest file taken even with no upload limit set: beyond any real file, and it keeps offsets sane. */
const MAX_FILE_BYTES = 16 * 1024 ** 4;

/** The size a client declares for a chunked upload, checked against `limit` (the admin's MAX_UPLOAD_MB) before any byte arrives. */
export function declaredSize(value: unknown, limit: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw badRequest('error.invalidInput');
  if (value > limit || value > MAX_FILE_BYTES) throw payloadTooLarge('files.tooLarge');
  return value;
}

interface Session<T> {
  id: string;
  owner: string;
  quota: string;
  /** Hidden `.part` file the chunks are written into, beside the destination. */
  partial: string;
  size: number;
  chunks: number;
  received: Set<number>;
  writing: Set<number>;
  finishing: boolean;
  lastActivity: number;
  /** What the route needs to place the file once complete. */
  meta: T;
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
      chunks: Math.ceil(size / CHUNK_SIZE),
      received: new Set(),
      writing: new Set(),
      finishing: false,
      lastActivity: Date.now(),
      meta,
    });
    return { id, chunkSize: CHUNK_SIZE };
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

  /** Writes chunk `index` from `body`, which must carry exactly that chunk's bytes. Sending a chunk again replaces it. */
  async writeChunk(id: string, owner: string, rawIndex: string, body: Readable): Promise<void> {
    const session = this.owned(id, owner);
    if (!/^\d{1,9}$/.test(rawIndex)) throw badRequest('error.invalidInput');
    const index = Number(rawIndex);
    if (index >= session.chunks) throw badRequest('error.invalidInput');
    if (session.finishing || session.writing.has(index)) throw conflict('files.uploadIncomplete');

    const start = index * CHUNK_SIZE;
    const expected = Math.min(CHUNK_SIZE, session.size - start);

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
      return await place(session.partial, session.meta);
    } finally {
      this.sessions.delete(id);
      await fs.rm(session.partial, { force: true }).catch(() => undefined);
    }
  }

  async cancel(id: string, owner: string): Promise<void> {
    const session = this.sessions.get(id);
    if (!session || session.owner !== owner || session.finishing) return;
    this.sessions.delete(id);
    await fs.rm(session.partial, { force: true }).catch(() => undefined);
  }

  private async dropIdle(): Promise<void> {
    const cutoff = Date.now() - IDLE_MS;
    for (const [id, session] of this.sessions) {
      if (session.finishing || session.writing.size > 0 || session.lastActivity >= cutoff) continue;
      this.sessions.delete(id);
      logger.info(`${this.label} upload ${id} abandoned by its client, removing its partial file`);
      await fs.rm(session.partial, { force: true }).catch(() => undefined);
    }
  }
}
