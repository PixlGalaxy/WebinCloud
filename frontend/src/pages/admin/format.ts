/** Shared byte-formatting helpers for the admin panel (bandwidth chart, System page). */

export function formatBytesPerSec(bytesPerSec: number): string {
  if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B`;
  if (bytesPerSec < 1024 ** 2) return `${(bytesPerSec / 1024).toFixed(2)} KB`;
  if (bytesPerSec < 1024 ** 3) return `${(bytesPerSec / 1024 ** 2).toFixed(2)} MB`;
  return `${(bytesPerSec / 1024 ** 3).toFixed(2)} GB`;
}

/** Same ladder, no "/s" — for a plain quantity like memory or disk usage. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes.toFixed(0)} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
}
