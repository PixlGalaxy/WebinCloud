import { randomUUID } from 'crypto';
import { createReadStream, createWriteStream, promises as fs } from 'fs';
import { basename, join, relative, sep } from 'path';
import { ZipArchive, type ProgressData } from 'archiver';
import type { Db } from '../../db/client.js';
import type { User } from '../../types/index.js';
import { AppError, badRequest, forbidden, notFound, tooManyRequests } from '../../errors.js';
import { logger } from '../../logger.js';
import { getAccess, readChecker } from '../permissions/access-check.js';
import { normalizeRelPath, resolveSafePath } from '../files/path-safety.js';

export type ArchiveStatus = 'preparing' | 'running' | 'done' | 'error';

/**
 * Who may poll and download a job. Signed-in users are identified by id;
 * public links by the share, since holding the link is the credential.
 */
export type ArchiveOwner = { kind: 'user'; id: string } | { kind: 'share'; id: string };

export function ownerKey(owner: ArchiveOwner): string {
  return `${owner.kind}:${owner.id}`;
}

export interface ArchiveSource {
  absolute: string;
  nameInZip: string;
}

export interface ArchiveJob {
  id: string;
  ownerKey: string;
  status: ArchiveStatus;
  fileName: string;
  totalBytes: number;
  processedBytes: number;
  totalEntries: number;
  processedEntries: number;
  error?: string;
  createdAt: number;
  /** Last time the client asked for progress; drives abandonment detection. */
  lastPolledAt: number;
  /** Stops the running compression and discards its partial file. */
  abort?: () => void;
}

interface PlannedEntry {
  absolute: string;
  nameInZip: string;
  size: number;
  isDirectory: boolean;
}

export interface ArchiveJobView {
  id: string;
  status: ArchiveStatus;
  fileName: string;
  totalBytes: number;
  processedBytes: number;
  totalEntries: number;
  processedEntries: number;
  /** 0..1, or null while the total is still unknown. */
  progress: number | null;
  error?: string;
}

/** Generated archives are disposable; anything older than this is swept away. */
const MAX_AGE_MS = 60 * 60 * 1000;
const MAX_SELECTION = 500;
/**
 * Running jobs one owner may hold at once. Without it, anyone with a link —
 * no account needed — could start ZIPs of a large folder in a loop and fill
 * the temp volume or pin the CPU before abandonment detection catches up.
 */
const MAX_ACTIVE_JOBS_PER_OWNER = 5;


export class ArchivesService {
  private jobs = new Map<string, ArchiveJob>();

  constructor(
    private db: Db,
    private dataRoot: string,
    private tempRoot: string,
    /**
     * A client polls twice a second. Going quiet for this long means the tab
     * closed or the connection dropped, so the work is cancelled and cleaned
     * up. Long enough to survive a page reload.
     */
    private abandonMs: number,
  ) {}

  private view(job: ArchiveJob): ArchiveJobView {
    return {
      id: job.id,
      status: job.status,
      fileName: job.fileName,
      totalBytes: job.totalBytes,
      processedBytes: job.processedBytes,
      totalEntries: job.totalEntries,
      processedEntries: job.processedEntries,
      error: job.error,
      progress: job.totalBytes > 0 ? Math.min(job.processedBytes / job.totalBytes, 1) : null,
    };
  }

  private owned(id: string, owner: ArchiveOwner): ArchiveJob {
    const job = this.jobs.get(id);
    if (!job) throw notFound();
    if (job.ownerKey !== ownerKey(owner)) throw forbidden();
    return job;
  }

  get(id: string, owner: ArchiveOwner): ArchiveJobView {
    const job = this.owned(id, owner);
    job.lastPolledAt = Date.now();
    return this.view(job);
  }

  zipPath(id: string): string {
    return join(this.tempRoot, `${id}.zip`);
  }

  /** Written to while compressing, so an incomplete file is never mistaken for a result. */
  private partPath(id: string): string {
    return join(this.tempRoot, `${id}.zip.part`);
  }

  /** Absolute path of a finished archive, for streaming it to the client. */
  ready(id: string, owner: ArchiveOwner): { absolute: string; fileName: string } {
    const job = this.owned(id, owner);
    if (job.status !== 'done') throw badRequest('archives.notReady');
    return { absolute: this.zipPath(id), fileName: job.fileName };
  }

  async remove(id: string, owner: ArchiveOwner): Promise<void> {
    if (!this.jobs.has(id)) return;
    const job = this.owned(id, owner);

    job.abort?.();
    this.jobs.delete(id);
    await this.discard(id);
  }

  private async discard(id: string): Promise<void> {
    await Promise.all([
      fs.rm(this.zipPath(id), { force: true }).catch(() => undefined),
      fs.rm(this.partPath(id), { force: true }).catch(() => undefined),
    ]);
  }

  /**
   * Single walk that both sizes the job and lists what goes in, so the tree is
   * not traversed twice for large selections.
   */
  private async collect(
    absolute: string,
    nameInZip: string,
    into: PlannedEntry[],
    canRead: (relPath: string) => boolean,
  ): Promise<number> {
    if (!canRead(relative(this.dataRoot, absolute).split(sep).join('/'))) return 0;
    const stats = await fs.lstat(absolute).catch(() => null);
    if (!stats || stats.isSymbolicLink()) return 0;

    if (!stats.isDirectory()) {
      into.push({ absolute, nameInZip, size: stats.size, isDirectory: false });
      return stats.size;
    }

    into.push({ absolute, nameInZip, size: 0, isDirectory: true });
    const names = await fs.readdir(absolute).catch(() => [] as string[]);

    let bytes = 0;
    for (const name of names) {
      bytes += await this.collect(join(absolute, name), `${nameInZip}/${name}`, into, canRead);
    }
    return bytes;
  }

  /**
   * Starts building the archive and returns immediately, so the client can keep
   * browsing while it runs. Progress is polled through `get`.
   */
  /** Selection made by a signed-in user, checked against their grants. */
  start(user: User, rawPaths: string[]): ArchiveJobView {
    const paths = this.validateSelection(rawPaths);
    for (const path of paths) {
      if (!getAccess(this.db, user, path).read) throw forbidden();
    }

    return this.startJob(
      { kind: 'user', id: user.id },
      paths.map((path) => ({ absolute: resolveSafePath(this.dataRoot, path), nameInZip: basename(path) })),
      this.nameFor(paths),
      readChecker(this.db, user),
    );
  }

  /**
   * Selection made through a public link. The caller has already checked the
   * share is readable and unlocked, and resolved the paths inside its subtree.
   * `canRead` is the share owner's current access, so the link never exposes
   * more than its owner could read themselves.
   */
  startForShare(
    shareId: string,
    sources: ArchiveSource[],
    fallbackName: string,
    canRead: (relPath: string) => boolean,
  ): ArchiveJobView {
    if (sources.length === 0) throw badRequest('archives.nothingSelected');
    if (sources.length > MAX_SELECTION) throw badRequest('archives.tooManyItems');

    const fileName =
      sources.length === 1 ? `${sources[0].nameInZip}.zip` : `${fallbackName}-${sources.length}-items.zip`;

    return this.startJob({ kind: 'share', id: shareId }, sources, fileName, canRead);
  }

  private validateSelection(rawPaths: string[]): string[] {
    if (rawPaths.length === 0) throw badRequest('archives.nothingSelected');
    if (rawPaths.length > MAX_SELECTION) throw badRequest('archives.tooManyItems');

    const paths = rawPaths.map((path) => normalizeRelPath(path));
    for (const path of paths) {
      if (path === '') throw badRequest('files.invalidPath');
    }
    return paths;
  }

  private nameFor(paths: string[]): string {
    return paths.length === 1 ? `${basename(paths[0])}.zip` : `webincloud-${paths.length}-items.zip`;
  }

  private startJob(
    owner: ArchiveOwner,
    sources: ArchiveSource[],
    fileName: string,
    canRead: (relPath: string) => boolean,
  ): ArchiveJobView {
    const key = ownerKey(owner);
    let active = 0;
    for (const job of this.jobs.values()) {
      if (job.ownerKey === key && (job.status === 'preparing' || job.status === 'running')) active++;
    }
    if (active >= MAX_ACTIVE_JOBS_PER_OWNER) throw tooManyRequests(Math.ceil(this.abandonMs / 1000));

    const id = randomUUID();
    const job: ArchiveJob = {
      id,
      ownerKey: key,
      status: 'preparing',
      fileName,
      totalBytes: 0,
      processedBytes: 0,
      totalEntries: 0,
      processedEntries: 0,
      createdAt: Date.now(),
      lastPolledAt: Date.now(),
    };
    this.jobs.set(id, job);

    void this.build(job, sources, canRead);
    return this.view(job);
  }

  private async build(
    job: ArchiveJob,
    sources: ArchiveSource[],
    canRead: (relPath: string) => boolean,
  ): Promise<void> {
    try {
      await fs.mkdir(this.tempRoot, { recursive: true });

      const planned: PlannedEntry[] = [];
      for (const source of sources) {
        job.totalBytes += await this.collect(source.absolute, source.nameInZip, planned, canRead);
      }
      job.totalEntries = planned.length;

      job.status = 'running';

      const output = createWriteStream(this.partPath(job.id));
      // Level 1: most of what people archive here (images, video, office docs)
      // is already compressed, so the higher levels cost a lot of time for
      // almost no size gain. This keeps multi-gigabyte selections usable.
      const archive = new ZipArchive({ zlib: { level: 1 } });

      let aborted = false;
      job.abort = () => {
        if (aborted) return;
        aborted = true;
        archive.abort();
        output.destroy();
      };

      const finished = new Promise<void>((resolve, reject) => {
        output.on('close', () => (aborted ? reject(new Error('aborted')) : resolve()));
        output.on('error', reject);
        archive.on('error', reject);
      });

      archive.on('progress', (data: ProgressData) => {
        job.processedEntries = data.entries.processed;
      });

      archive.pipe(output);

      // Entries are fed one at a time and counted as their bytes are read, so
      // the bar moves smoothly through a single huge file instead of jumping
      // only when that file finishes. It also keeps one file handle open.
      let index = 0;
      const pumpNext = () => {
        if (aborted) return;

        if (index >= planned.length) {
          void archive.finalize();
          return;
        }

        const next = planned[index++];
        if (next.isDirectory) {
          archive.append(Buffer.alloc(0), { name: `${next.nameInZip}/` });
          return;
        }

        const source = createReadStream(next.absolute);
        source.on('data', (chunk: Buffer | string) => {
          job.processedBytes += chunk.length;
        });
        source.on('error', () => undefined); // a vanished file must not kill the archive
        archive.append(source, { name: next.nameInZip });
      };

      archive.on('entry', pumpNext);
      pumpNext();

      await finished;

      // Only now does it become a real .zip.
      await fs.rename(this.partPath(job.id), this.zipPath(job.id));
      job.abort = undefined;
      job.processedBytes = job.totalBytes;
      job.status = 'done';
      logger.info(`Archive ${job.id} ready (${job.totalEntries} entries)`);
    } catch (err) {
      const cancelled = !this.jobs.has(job.id);
      job.status = 'error';
      // Only our own error keys reach the client: a raw fs message would carry
      // the server's absolute paths, and the holder of a public link is a stranger.
      job.error = err instanceof AppError ? err.key : undefined;
      job.abort = undefined;

      if (cancelled) logger.info(`Archive ${job.id} cancelled, partial file removed`);
      else logger.error(`Archive ${job.id} failed`, err);

      await this.discard(job.id);
    }
  }

  /**
   * Cancels archives whose client stopped polling, freeing both the CPU work
   * and the partial file on disk.
   */
  async dropAbandoned(): Promise<void> {
    const cutoff = Date.now() - this.abandonMs;

    for (const [id, job] of this.jobs) {
      const active = job.status === 'preparing' || job.status === 'running';
      if (!active || job.lastPolledAt >= cutoff) continue;

      logger.info(`Archive ${id} abandoned by its client, cancelling`);
      this.jobs.delete(id);
      job.abort?.();
      await this.discard(id);
    }
  }

  /** Drops stale jobs and their files; called on boot and periodically. */
  async sweep(): Promise<void> {
    const cutoff = Date.now() - MAX_AGE_MS;

    for (const [id, job] of this.jobs) {
      if (job.createdAt < cutoff) {
        this.jobs.delete(id);
        await fs.rm(this.zipPath(id), { force: true }).catch(() => undefined);
      }
    }

    // Also covers files left behind by a previous run of the process, including
    // .part files whose compression died with it.
    const names = await fs.readdir(this.tempRoot).catch(() => [] as string[]);
    for (const name of names) {
      if (!name.endsWith('.zip') && !name.endsWith('.zip.part')) continue;

      const full = join(this.tempRoot, name);
      const id = name.replace(/\.zip(\.part)?$/, '');
      // A .part with no live job can only be a leftover.
      const orphaned = name.endsWith('.part') && !this.jobs.has(id);

      const stats = await fs.stat(full).catch(() => null);
      if (stats && (orphaned || stats.mtimeMs < cutoff)) {
        await fs.rm(full, { force: true }).catch(() => undefined);
      }
    }
  }
}
