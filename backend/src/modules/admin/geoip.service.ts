import { createWriteStream } from 'fs';
import { mkdir, stat, rm, readdir, copyFile } from 'fs/promises';
import { join } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import maxmind, { type CountryResponse, type Reader } from 'maxmind';
import type { EnvConfig } from '../../config/env.js';
import { logger } from '../../logger.js';

const execFileAsync = promisify(execFile);

const DOWNLOAD_URL = (key: string) =>
  `https://download.maxmind.com/app/geoip_download?edition_id=GeoLite2-Country&license_key=${key}&suffix=tar.gz`;

// MaxMind expects a refreshed database periodically; this is comfortably inside that window.
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const RECHECK_MS = 24 * 60 * 60 * 1000;

export interface GeoCountry {
  code: string;
  name: string;
}

/**
 * Resolves an IP to its country using a locally cached MaxMind GeoLite2-Country
 * database — no per-lookup call to a third party. Entirely optional: without
 * MAXMIND_LICENSE_KEY, lookup() always returns null and nothing is downloaded.
 */
export class GeoipService {
  private reader: Reader<CountryResponse> | null = null;
  private readonly dbPath: string;

  constructor(private config: EnvConfig) {
    this.dbPath = join(config.GEOIP_DIR, 'GeoLite2-Country.mmdb');
  }

  async init(): Promise<void> {
    if (!this.config.MAXMIND_LICENSE_KEY) return;

    const refresh = () => this.ensureFresh().catch((err) => logger.warn('GeoIP refresh failed', err));
    await refresh();
    setInterval(refresh, RECHECK_MS).unref();
  }

  /** Whether the map can actually resolve countries right now — false with no key, or while the first download is still pending. */
  isReady(): boolean {
    return this.reader !== null;
  }

  lookup(ip: string): GeoCountry | null {
    if (!this.reader) return null;
    try {
      const result = this.reader.get(ip);
      const code = result?.country?.iso_code;
      if (!code) return null;
      return { code, name: result?.country?.names?.en ?? code };
    } catch {
      // Malformed or non-public IP (e.g. ::1 in dev) — not an error worth logging per request.
      return null;
    }
  }

  private async ensureFresh(): Promise<void> {
    const needsDownload = await stat(this.dbPath)
      .then((s) => Date.now() - s.mtimeMs > MAX_AGE_MS)
      .catch(() => true);

    if (needsDownload) await this.download();
    if (!this.reader) {
      this.reader = await maxmind.open<CountryResponse>(this.dbPath);
      logger.info('GeoIP database loaded');
    }
  }

  private async download(): Promise<void> {
    await mkdir(this.config.GEOIP_DIR, { recursive: true });
    const archivePath = join(this.config.GEOIP_DIR, 'GeoLite2-Country.tar.gz');
    const extractDir = join(this.config.GEOIP_DIR, 'extract');

    logger.info('Downloading GeoIP database…');
    const res = await fetch(DOWNLOAD_URL(this.config.MAXMIND_LICENSE_KEY!));
    if (!res.ok || !res.body) throw new Error(`GeoIP download failed: HTTP ${res.status}`);
    await pipeline(Readable.fromWeb(res.body as import('stream/web').ReadableStream), createWriteStream(archivePath));

    await rm(extractDir, { recursive: true, force: true });
    await mkdir(extractDir, { recursive: true });
    await execFileAsync('tar', ['xzf', archivePath, '-C', extractDir]);

    // MaxMind ships it inside a version-stamped folder, e.g. GeoLite2-Country_20240101/.
    const entries = await readdir(extractDir);
    const folder = entries.find((e) => e.startsWith('GeoLite2-Country'));
    if (!folder) throw new Error('GeoIP archive did not contain the expected folder');

    await copyFile(join(extractDir, folder, 'GeoLite2-Country.mmdb'), this.dbPath);
    await rm(archivePath, { force: true });
    await rm(extractDir, { recursive: true, force: true });

    this.reader = null; // Force a reload from the freshly written file.
    logger.info('GeoIP database updated');
  }
}
