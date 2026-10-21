import { ApiError } from './client';

/**
 * Sockets per destination. A browser opens at most 6 HTTP connections to a site,
 * but sockets are not counted against that. Across a long distance each one
 * carries some tens of Mb/s; measured from the United States to Peru, the total
 * stops growing much past this many.
 */
const SOCKETS = 32;
/**
 * Bytes sent and not yet acknowledged per socket. Besides keeping a long-distance
 * connection busy, it rides out the pauses of a second or two some servers' disks
 * make while committing, during which the server keeps reading but cannot acknowledge.
 */
const WINDOW_BYTES = 8 * 1024 * 1024;
/** Times a chunk is sent before its file fails. */
const ATTEMPTS = 5;
/** Sockets in a row that failed to open, with none open, before giving up. */
const FAILED_OPENS = 3;
/** A pool with nothing to send closes its sockets after this long. */
const IDLE_MS = 30_000;

/** Sockets cannot be used here (blocked by a proxy, or not enabled on the server): send over HTTP instead. */
export class SocketsUnavailable extends Error {
  constructor() {
    super('Upload sockets unavailable');
  }
}

interface Job {
  id: string;
  index: number;
  data: Blob;
  attempts: number;
  resolve: () => void;
  reject: (err: unknown) => void;
}

interface Lane {
  ws: WebSocket;
  open: boolean;
  bytes: number;
  jobs: Map<string, Job>;
}

const keyOf = (id: string, index: number) => `${id}:${index}`;

/** A server answer worth sending the chunk again for: still writing an earlier copy, throttled, or a server fault. */
const retryable = (status: number) => status === 409 || status === 429 || status >= 500;

/** Session id as 16 bytes, then the chunk index as 4 big-endian bytes: what the server reads ahead of the data. */
function header(id: string, index: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(new ArrayBuffer(20));
  const hex = id.replace(/-/g, '');
  for (let i = 0; i < 16; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  new DataView(bytes.buffer).setUint32(16, index);
  return bytes;
}

/**
 * Upload sockets to one destination (the signed-in API, or one share link).
 * Chunks are spread over the sockets with a window of bytes in flight on each,
 * so many connections stream at once; a chunk on a socket that drops is sent
 * again on another.
 */
export class UploadSocketPool {
  private lanes = new Set<Lane>();
  private queue: Job[] = [];
  private everOpened = false;
  private failedOpens = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  broken = false;
  private url: string;

  constructor(url: string) {
    this.url = url;
  }

  /** Sends chunk `index` of upload `id`; resolves once the server has it on disk. */
  send(id: string, index: number, data: Blob): Promise<void> {
    if (this.broken) return Promise.reject(new SocketsUnavailable());
    return new Promise((resolve, reject) => {
      this.queue.push({ id, index, data, attempts: 0, resolve, reject });
      this.wake();
    });
  }

  /** Drops the chunks of `id` still waiting; those already sent finish on their own. */
  forget(id: string): void {
    const kept: Job[] = [];
    for (const job of this.queue) {
      if (job.id === id) job.reject(new ApiError(0, 'Upload cancelled'));
      else kept.push(job);
    }
    this.queue = kept;
  }

  private wake(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    while (this.lanes.size < SOCKETS && this.queue.length > 0 && !this.broken) this.openLane();
    this.pump();
  }

  private openLane(): void {
    const lane: Lane = { ws: new WebSocket(this.url), open: false, bytes: 0, jobs: new Map() };
    this.lanes.add(lane);

    lane.ws.onopen = () => {
      lane.open = true;
      this.everOpened = true;
      this.failedOpens = 0;
      this.pump();
    };
    lane.ws.onmessage = (event) => {
      let reply: { id?: string; index?: number; ok?: boolean; status?: number; error?: string };
      try {
        reply = JSON.parse(String(event.data));
      } catch {
        return;
      }
      const job = lane.jobs.get(keyOf(String(reply.id), Number(reply.index)));
      if (!job) return;
      lane.jobs.delete(keyOf(job.id, job.index));
      lane.bytes -= job.data.size;

      if (reply.ok) job.resolve();
      else this.retry(job, new ApiError(reply.status ?? 0, reply.error ?? 'Upload failed'), retryable(reply.status ?? 0));
      this.pump();
    };
    lane.ws.onclose = (event) => {
      this.lanes.delete(lane);
      const noneOpen = ![...this.lanes].some((other) => other.open);
      if (!lane.open && ++this.failedOpens >= FAILED_OPENS && noneOpen) {
        // Never worked here: fall back to HTTP. Worked before (signed out, server gone): fail what is waiting.
        if (!this.everOpened) this.giveUp();
        else this.failAll(new ApiError(0, 'Upload failed'));
        return;
      }
      // 4403: the sign-in or link no longer allows uploading; nothing will get through.
      const denied = event.code === 4403;
      for (const job of lane.jobs.values()) this.retry(job, new ApiError(denied ? 403 : 0, 'Upload failed'), !denied);
      if (denied) {
        for (const job of this.queue.splice(0)) job.reject(new ApiError(403, 'Upload failed'));
        return;
      }
      // Reopen after a moment if there is still work, rather than hammering a server that just dropped us.
      setTimeout(() => this.wake(), 1000);
    };
  }

  private retry(job: Job, err: ApiError, worthIt: boolean): void {
    job.attempts++;
    if (worthIt && job.attempts < ATTEMPTS) this.queue.unshift(job);
    else job.reject(err);
  }

  /** Sockets never opened: everything waiting goes back to the caller, which sends it over HTTP. */
  private giveUp(): void {
    this.broken = true;
    this.failAll(new SocketsUnavailable());
  }

  private failAll(err: unknown): void {
    this.failedOpens = 0;
    for (const lane of this.lanes) {
      for (const job of lane.jobs.values()) job.reject(err);
      lane.jobs.clear();
      lane.ws.close();
    }
    this.lanes.clear();
    for (const job of this.queue.splice(0)) job.reject(err);
  }

  private pump(): void {
    for (const lane of this.lanes) {
      while (lane.open && lane.bytes < WINDOW_BYTES && this.queue.length > 0) {
        const job = this.queue.shift()!;
        lane.jobs.set(keyOf(job.id, job.index), job);
        lane.bytes += job.data.size;
        lane.ws.send(new Blob([header(job.id, job.index), job.data]));
      }
    }

    const busy = this.queue.length > 0 || [...this.lanes].some((lane) => lane.jobs.size > 0);
    if (!busy && !this.idleTimer) {
      this.idleTimer = setTimeout(() => {
        for (const lane of this.lanes) lane.ws.close(1000);
        this.lanes.clear();
      }, IDLE_MS);
    }
  }
}

const pools = new Map<string, UploadSocketPool>();

/** The pool for `url`, shared by every upload to that destination. */
export function socketPool(url: string): UploadSocketPool {
  let pool = pools.get(url);
  if (!pool) {
    pool = new UploadSocketPool(url);
    pools.set(url, pool);
  }
  return pool;
}

/** `/backend/api/...` as a ws:// or wss:// address on this site. */
export function socketUrl(path: string): string {
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}${path}`;
}
