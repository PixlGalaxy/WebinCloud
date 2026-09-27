import { randomUUID } from 'crypto';
import { createReadStream, createWriteStream, existsSync, promises as fs, statSync } from 'fs';
import { basename, dirname, extname, join } from 'path';
import type { Db } from '../../db/client.js';
import type { User } from '../../types/index.js';
import { badRequest, conflict, forbidden, notFound } from '../../errors.js';
import { getAccess, requireWrite } from '../permissions/access-check.js';
import { joinRelPath, normalizeRelPath, resolveSafePath } from '../files/path-safety.js';
import type { ConflictMode } from '../files/files.service.js';
import { logFileAction, userActor } from '../../activity.js';
import { logger } from '../../logger.js';

export type TransferStatus = 'preparing' | 'running' | 'done' | 'error';

export interface TransferJob {
  id: string;
  ownerId: string;
  status: TransferStatus;
  totalBytes: number;
  processedBytes: number;
  totalEntries: number;
  processedEntries: number;
  error?: string;
  createdAt: number;
  /** Last time the client asked for progress; drives abandonment detection. */
  lastPolledAt: number;
  /** Stops the copy loop and discards the file currently being written. */
  abort?: () => void;
}

interface PlannedEntry {
  absolute: string;
  dest: string;
  isDirectory: boolean;
}

export interface TransferJobView {
  id: string;
  status: TransferStatus;
  totalBytes: number;
  processedBytes: number;
  totalEntries: number;
  processedEntries: number;
  /** 0..1, or null while the total is still unknown. */
  progress: number | null;
  error?: string;
}

/** Stale jobs are swept even if they finished, so the map never grows without bound. */
const MAX_AGE_MS = 60 * 60 * 1000;
const MAX_SELECTION = 500;

export class TransfersService {
  private jobs = new Map<string, TransferJob>();

  constructor(
    private db: Db,
    private dataRoot: string,
    /** A client polls twice a second; going quiet this long cancels the copy. */
    private abandonMs: number,
  ) {}

  private absolute(relPath: string): string {
    return resolveSafePath(this.dataRoot, relPath);
  }

  private view(job: TransferJob): TransferJobView {
    return {
      id: job.id,
      status: job.status,
      totalBytes: job.totalBytes,
      processedBytes: job.processedBytes,
      totalEntries: job.totalEntries,
      processedEntries: job.processedEntries,
      error: job.error,
      progress: job.totalBytes > 0 ? Math.min(job.processedBytes / job.totalBytes, 1) : null,
    };
  }

  private owned(id: string, userId: string): TransferJob {
    const job = this.jobs.get(id);
    if (!job) throw notFound();
    if (job.ownerId !== userId) throw forbidden();
    return job;
  }

  get(id: string, userId: string): TransferJobView {
    const job = this.owned(id, userId);
    job.lastPolledAt = Date.now();
    return this.view(job);
  }

  remove(id: string, userId: string): void {
    if (!this.jobs.has(id)) return;
    const job = this.owned(id, userId);
    job.abort?.();
    this.jobs.delete(id);
  }

  /**
   * Starts copying and returns immediately, so the client can keep browsing
   * while it runs. Progress is polled through `get`.
   */
  start(user: User, rawPaths: string[], destinationFolder: string, onConflict: ConflictMode): TransferJobView {
    if (rawPaths.length === 0) throw badRequest('archives.nothingSelected');
    if (rawPaths.length > MAX_SELECTION) throw badRequest('archives.tooManyItems');

    const paths = rawPaths.map((p) => normalizeRelPath(p));
    for (const path of paths) {
      if (path === '') throw badRequest('files.invalidPath');
      if (!getAccess(this.db, user, path).read) throw forbidden();
      if (destinationFolder === path || destinationFolder.startsWith(`${path}/`)) {
        throw badRequest('files.cannotMoveIntoOwnSubfolder');
      }
    }
    requireWrite(this.db, user, destinationFolder);

    const destAbsolute = this.absolute(destinationFolder);
    if (!existsSync(destAbsolute) || !statSync(destAbsolute).isDirectory()) throw notFound();

    const id = randomUUID();
    const job: TransferJob = {
      id,
      ownerId: user.id,
      status: 'preparing',
      totalBytes: 0,
      processedBytes: 0,
      totalEntries: 0,
      processedEntries: 0,
      createdAt: Date.now(),
      lastPolledAt: Date.now(),
    };
    this.jobs.set(id, job);

    void this.build(job, user, paths, destinationFolder, destAbsolute, onConflict);
    return this.view(job);
  }

  /** "foto.jpg" -> "foto (copy).jpg", then "foto (copy 2).jpg", ... */
  private async freeName(destAbsolute: string, name: string): Promise<string> {
    const ext = extname(name);
    const stem = name.slice(0, name.length - ext.length);

    for (let attempt = 1; attempt < 1000; attempt++) {
      const suffix = attempt === 1 ? ' (copy)' : ` (copy ${attempt})`;
      const candidate = `${stem}${suffix}${ext}`;
      if (!existsSync(join(destAbsolute, candidate))) return candidate;
    }
    throw conflict('files.alreadyExists');
  }

  /**
   * Single walk that both sizes the job and lists what goes in, so the tree is
   * not traversed twice for large selections.
   */
  private async collect(absolute: string, dest: string, into: PlannedEntry[]): Promise<number> {
    const stats = await fs.lstat(absolute).catch(() => null);
    if (!stats || stats.isSymbolicLink()) return 0;

    if (!stats.isDirectory()) {
      into.push({ absolute, dest, isDirectory: false });
      return stats.size;
    }

    into.push({ absolute, dest, isDirectory: true });
    const names = await fs.readdir(absolute).catch(() => [] as string[]);

    let bytes = 0;
    for (const name of names) {
      bytes += await this.collect(join(absolute, name), join(dest, name), into);
    }
    return bytes;
  }

  private async build(
    job: TransferJob,
    user: User,
    paths: string[],
    destinationFolder: string,
    destAbsolute: string,
    onConflict: ConflictMode,
  ): Promise<void> {
    try {
      // Resolve each top-level destination name up front, so a conflict is
      // reported before any bytes are copied rather than partway through.
      const roots: { absolute: string; dest: string; relTarget: string }[] = [];
      for (const relPath of paths) {
        const name = basename(relPath);
        let finalName = name;
        let dest = join(destAbsolute, finalName);

        if (existsSync(dest)) {
          if (onConflict === 'fail') throw conflict('files.alreadyExists');
          if (onConflict === 'keepBoth') {
            finalName = await this.freeName(destAbsolute, finalName);
            dest = join(destAbsolute, finalName);
          } else {
            // 'overwrite' replaces the destination outright; no folder-merge semantics.
            await fs.rm(dest, { recursive: true, force: true });
          }
        }

        roots.push({ absolute: this.absolute(relPath), dest, relTarget: joinRelPath(destinationFolder, finalName) });
      }

      const planned: PlannedEntry[] = [];
      for (const root of roots) {
        job.totalBytes += await this.collect(root.absolute, root.dest, planned);
      }
      job.totalEntries = planned.length;
      job.status = 'running';

      let aborted = false;
      let currentPart: string | null = null;
      job.abort = () => {
        aborted = true;
        if (currentPart) void fs.rm(currentPart, { force: true }).catch(() => undefined);
      };

      for (const entry of planned) {
        if (aborted) break;

        if (entry.isDirectory) {
          await fs.mkdir(entry.dest, { recursive: true });
          job.processedEntries++;
          continue;
        }

        await fs.mkdir(dirname(entry.dest), { recursive: true });
        const part = `${entry.dest}.part`;
        currentPart = part;

        await new Promise<void>((resolve, reject) => {
          const source = createReadStream(entry.absolute);
          const sink = createWriteStream(part);
          source.on('data', (chunk: Buffer | string) => {
            job.processedBytes += chunk.length;
          });
          source.on('error', reject);
          sink.on('error', reject);
          sink.on('close', resolve);
          source.pipe(sink);
        });

        currentPart = null;
        if (aborted) break;
        await fs.rename(part, entry.dest);
        job.processedEntries++;
      }

      if (aborted) throw new Error('aborted');

      job.abort = undefined;
      job.status = 'done';
      logger.info(`Transfer ${job.id} done (${job.totalEntries} entries)`);
      for (const root of roots) {
        const stats = await fs.stat(root.dest).catch(() => null);
        logFileAction(
          userActor(user),
          'copied',
          stats?.isDirectory() ? 'folder' : 'file',
          `${basename(root.absolute)} to ${root.relTarget}`,
          root.dest,
        );
      }
    } catch (err) {
      const cancelled = !this.jobs.has(job.id);
      job.status = 'error';
      job.error = err instanceof Error ? err.message : String(err);
      job.abort = undefined;

      if (cancelled) logger.info(`Transfer ${job.id} cancelled`);
      else logger.error(`Transfer ${job.id} failed`, err);
    }
  }

  /**
   * Cancels copies whose client stopped polling, freeing the CPU/disk work.
   */
  dropAbandoned(): void {
    const cutoff = Date.now() - this.abandonMs;

    for (const [id, job] of this.jobs) {
      const active = job.status === 'preparing' || job.status === 'running';
      if (!active || job.lastPolledAt >= cutoff) continue;

      logger.info(`Transfer ${id} abandoned by its client, cancelling`);
      this.jobs.delete(id);
      job.abort?.();
    }
  }

  /** Drops stale jobs regardless of status, so the map never grows without bound. */
  sweep(): void {
    const cutoff = Date.now() - MAX_AGE_MS;
    for (const [id, job] of this.jobs) {
      if (job.createdAt < cutoff) this.jobs.delete(id);
    }
  }
}
