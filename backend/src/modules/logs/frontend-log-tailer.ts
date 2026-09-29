import { existsSync, statSync, openSync, readSync, closeSync } from 'fs';
import { logBuffer } from '../../log-buffer.js';

// Mirrors nginx.conf's `webincloud` log_format:
// $time_iso8601 $status $request_method $request_uri ${body_bytes_sent}b ${request_time}s "..."
const LOG_PATH = '/tmp/nginx-access.log';
const POLL_MS = 1000;
const LINE_RE = /^(\S+) (\d{3}) (\S+) (\S+) \d+b ([\d.]+)s/;

let offset: number | null = null;

function poll(): void {
  if (!existsSync(LOG_PATH)) return;

  let size: number;
  try {
    size = statSync(LOG_PATH).size;
  } catch {
    return;
  }

  // First sight of the file: skip whatever's already in it (e.g. from before
  // a backend-only restart — nginx itself, and this file, are untouched by
  // that) and only tail what's written from here on, like `tail -f`.
  if (offset === null) {
    offset = size;
    return;
  }
  if (size < offset) offset = 0; // the file was replaced/truncated — start over
  if (size <= offset) return;

  const fd = openSync(LOG_PATH, 'r');
  try {
    const length = size - offset;
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, offset);
    offset = size;

    for (const line of buffer.toString('utf-8').split('\n')) {
      if (!line) continue;
      const match = LINE_RE.exec(line);
      if (!match) continue;
      const [, time, status, method, uri, requestTime] = match;
      const code = Number(status);
      const ms = (Number(requestTime) * 1000).toFixed(1);
      logBuffer.push({
        time,
        channel: 'FRONTEND',
        level: code >= 500 ? 'ERROR' : code >= 400 ? 'WARN' : 'INFO',
        message: `${method} ${uri} ${status} ${ms}ms`,
      });
    }
  } finally {
    closeSync(fd);
  }
}

/**
 * Tails nginx's own access log (a second `access_log` target added in
 * nginx.conf, alongside its existing stdout one) so static-asset and page
 * requests show up in the same Logs page as BACKEND/AUTH/SYSTEM, as a
 * FRONTEND channel. Proxied `/backend/*` requests are deliberately not
 * duplicated here — the backend's own request logger already covers those in
 * more detail. Off Windows dev, where nginx never runs, the file just never
 * appears and this stays silent.
 */
export function startFrontendLogTailer(): void {
  setInterval(poll, POLL_MS).unref();
}
