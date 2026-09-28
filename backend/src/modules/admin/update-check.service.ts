import { logger } from '../../logger.js';

const REPO = 'PixlGalaxy/WebinCloud';
// One request an hour is nowhere near GitHub's 60-req/hour unauthenticated
// rate limit, and catches a new push to main within the hour.
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

export interface UpdateStatus {
  /** False until the first check completes (or forever, if disabled/offline) — distinct from "checked, no update". */
  checked: boolean;
  updateAvailable: boolean;
  /** Short SHA of main's current HEAD, once known. */
  latestRevision: string | null;
  checkedAt: string | null;
}

/**
 * A small background "daemon": periodically asks GitHub's REST API whether
 * `main` has moved past the commit this image was built from
 * (`APP_IMAGE_REVISION`, baked in by the publish workflow — see the
 * Dockerfile). This is the only reliable way to answer "is a newer `:latest`
 * out there" — a runtime tag string like "latest" never changes once baked
 * into a running container, even after the registry's `latest` pointer moves.
 *
 * Best-effort and silent on failure: air-gapped or offline installs, or ones
 * built without the publish workflow (APP_IMAGE_REVISION unset), simply never
 * see an update notice. Nothing else depends on this succeeding.
 */
export class UpdateCheckService {
  private latestRevision: string | null = null;
  private checkedAt: number | null = null;

  constructor(private currentRevision: string | undefined, private enabled: boolean) {
    if (!this.enabled || !this.currentRevision) return;
    void this.check();
    setInterval(() => void this.check(), CHECK_INTERVAL_MS).unref();
  }

  private async check(): Promise<void> {
    try {
      const res = await fetch(`https://api.github.com/repos/${REPO}/commits/main`, {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (!res.ok) throw new Error(`GitHub API returned ${res.status}`);
      const body = (await res.json()) as { sha?: string };
      if (body.sha) {
        this.latestRevision = body.sha.slice(0, 7);
        this.checkedAt = Date.now();
      }
    } catch (err) {
      // Expected and harmless for any install without outbound internet access.
      logger.warn('Update check against GitHub failed (harmless if this server has no internet access)', err);
    }
  }

  getStatus(): UpdateStatus {
    const current = this.currentRevision?.slice(0, 7);
    const updateAvailable = Boolean(
      this.enabled && current && this.latestRevision && this.latestRevision !== current,
    );
    return {
      checked: this.checkedAt !== null,
      updateAvailable,
      latestRevision: this.latestRevision,
      checkedAt: this.checkedAt ? new Date(this.checkedAt).toISOString() : null,
    };
  }
}
