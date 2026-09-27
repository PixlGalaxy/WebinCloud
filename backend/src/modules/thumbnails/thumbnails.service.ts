import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import type { EnvConfig } from '../../config/env.js';
import { logger } from '../../logger.js';
import { runFfmpeg } from './ffmpeg.js';
import { PROVIDERS, THUMBNAIL_SIZES, type ThumbnailProvider, type ThumbnailSize } from './providers.js';

/** Generating is CPU-heavy, so a burst of requests waits its turn instead of forking a process each. */
const MAX_PARALLEL = 2;

/** Thumbnails of files changed or deleted this long ago are removed. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export class ThumbnailService {
  private available = false;
  private active = 0;
  private waiting: (() => void)[] = [];
  private inflight = new Map<string, Promise<string>>();

  constructor(
    private cacheDir: string,
    private ffmpeg: string,
  ) {}

  static fromConfig(config: EnvConfig): ThumbnailService {
    return new ThumbnailService(config.THUMBNAILS_DIR, config.FFMPEG_PATH);
  }

  /** Checks for an ffmpeg that can write WebP; without one, thumbnails are simply not offered. */
  async detect(): Promise<void> {
    try {
      const encoders = await runFfmpeg(this.ffmpeg, ['-hide_banner', '-encoders'], 10_000);
      this.available = encoders.includes('libwebp');
      if (this.available) logger.info('Thumbnails: ffmpeg found, image and video thumbnails enabled');
      else logger.warn('Thumbnails disabled: ffmpeg has no WebP encoder (libwebp)');
    } catch {
      this.available = false;
      logger.warn(`Thumbnails disabled: "${this.ffmpeg}" not found. Install ffmpeg or set FFMPEG_PATH`);
    }
  }

  private providerFor(name: string): ThumbnailProvider | undefined {
    return PROVIDERS.find((provider) => provider.supports(name));
  }

  /** Whether a thumbnail can be made for this file name. */
  supports(name: string): boolean {
    return this.available && this.providerFor(name) !== undefined;
  }

  private keyFor(absolute: string, stats: { mtimeMs: number; size: number }, pixels: number): string {
    return createHash('sha1').update(`${absolute}|${stats.mtimeMs}|${stats.size}|${pixels}`).digest('hex');
  }

  private pathFor(key: string): string {
    return join(this.cacheDir, key.slice(0, 2), `${key}.webp`);
  }

  /** Deletes every cached size for this exact file version, so a removed or renamed file leaves nothing behind. */
  async evict(absolute: string, stats: { mtimeMs: number; size: number }): Promise<void> {
    await Promise.all(
      Object.values(THUMBNAIL_SIZES).map((pixels) =>
        fs.rm(this.pathFor(this.keyFor(absolute, stats, pixels)), { force: true }).catch(() => undefined),
      ),
    );
  }

  /**
   * Marks a cache hit as used, so the sweep counts age from the last time it was
   * actually served rather than when it was generated. Fire-and-forget: worth
   * doing, never worth making a request wait for.
   */
  private touch(path: string): void {
    const now = new Date();
    fs.utimes(path, now, now).catch(() => undefined);
  }

  private async slot<T>(work: () => Promise<T>): Promise<T> {
    if (this.active >= MAX_PARALLEL) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active++;
    try {
      return await work();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }

  /** Path of the cached thumbnail, generating it first if this version of the file has none yet. */
  async get(
    absolute: string,
    name: string,
    stats: { mtimeMs: number; size: number },
    size: ThumbnailSize,
  ): Promise<string | null> {
    const provider = this.providerFor(name);
    if (!this.available || !provider) return null;

    const pixels = THUMBNAIL_SIZES[size];
    const key = this.keyFor(absolute, stats, pixels);
    const cached = this.pathFor(key);

    if (await fs.stat(cached).catch(() => null)) {
      this.touch(cached);
      return cached;
    }

    let pending = this.inflight.get(key);
    if (!pending) {
      pending = this.slot(async () => {
        await fs.mkdir(dirname(cached), { recursive: true });
        // Written beside the final name and renamed, so a reader never sees half a file.
        const partial = `${cached}.${process.pid}.part`;
        try {
          await provider.generate({ ffmpeg: this.ffmpeg, input: absolute, output: partial, pixels });
          await fs.rename(partial, cached);
        } catch (err) {
          await fs.rm(partial, { force: true }).catch(() => undefined);
          throw err;
        }
        return cached;
      }).finally(() => this.inflight.delete(key));
      this.inflight.set(key, pending);
    }

    try {
      return await pending;
    } catch (err) {
      logger.warn(`Thumbnail failed for ${name}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  /** Removes thumbnails that have not been served (or regenerated) in a long time. */
  async sweep(): Promise<void> {
    const cutoff = Date.now() - MAX_AGE_MS;
    const shards = await fs.readdir(this.cacheDir).catch(() => [] as string[]);

    for (const shard of shards) {
      const dir = join(this.cacheDir, shard);
      for (const file of await fs.readdir(dir).catch(() => [] as string[])) {
        const path = join(dir, file);
        const stats = await fs.stat(path).catch(() => null);
        if (stats && stats.mtimeMs < cutoff) await fs.rm(path, { force: true }).catch(() => undefined);
      }
    }
  }
}
