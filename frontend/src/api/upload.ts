import { ApiError } from './client';
import { socketPool, socketUrl, SocketsUnavailable } from './upload-socket';

/** Where a file goes: one plain request for small files, chunked sessions for larger ones. */
export interface UploadTarget {
  postUrl: string;
  sessionsUrl: string;
  /** Upload socket for this destination, path under /backend. */
  socketPath: string;
  /** Sent when a chunked upload starts, beside the file's name and size (folder, conflict mode). */
  fields: Record<string, unknown>;
}

/**
 * Files up to this size go in one plain request: for them the round trips, not
 * the bandwidth, set the time, and one request is one round trip where a
 * chunked upload takes three. Larger files stream over upload sockets.
 */
const SOCKET_ABOVE = 1024 * 1024;
/** Over HTTP (when sockets are unavailable), files up to this size go in one request; the server's chunks are this size too. */
const CHUNKED_ABOVE = 8 * 1024 * 1024;
/** Chunks of one file in flight at once over HTTP. A browser opens at most 6 connections to a site. */
const PARALLEL_CHUNKS = 6;
/** Chunks of one file handed to the socket pool at once; the pool spreads them over its sockets. */
const QUEUED_SOCKET_CHUNKS = 64;
/** Attempts per chunk over HTTP before the file fails: a dropped connection should not cost the whole upload. */
const ATTEMPTS = 4;

interface XhrOptions {
  method: string;
  url: string;
  body: XMLHttpRequestBodyInit;
  contentType?: string;
  onProgress?: (loaded: number, total: number) => void;
  signal: AbortSignal;
}

/** XHR rather than fetch because only it reports upload progress. Resolves with the response text. */
function xhr({ method, url, body, contentType, onProgress, signal }: XhrOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new ApiError(0, 'Upload cancelled'));

    const request = new XMLHttpRequest();
    request.open(method, url);
    request.withCredentials = true;
    if (contentType) request.setRequestHeader('Content-Type', contentType);

    if (onProgress) {
      request.upload.addEventListener('progress', (event) => {
        if (event.lengthComputable) onProgress(event.loaded, event.total);
      });
    }

    const onAbort = () => request.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    const settle = () => signal.removeEventListener('abort', onAbort);

    request.addEventListener('load', () => {
      settle();
      if (request.status >= 200 && request.status < 300) return resolve(request.responseText);
      let error: string | undefined;
      try {
        error = (JSON.parse(request.responseText) as { error?: string }).error;
      } catch {
        // Fall through to the generic message.
      }
      reject(new ApiError(request.status, error ?? 'Upload failed'));
    });
    request.addEventListener('error', () => {
      settle();
      reject(new ApiError(0, 'Upload failed'));
    });
    request.addEventListener('abort', () => {
      settle();
      reject(new ApiError(0, 'Upload cancelled'));
    });

    request.send(body);
  });
}

/** One file per request. */
export async function postFile(
  url: string,
  file: File,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<void> {
  const form = new FormData();
  form.append('files', file);
  await xhr({ method: 'POST', url, body: form, signal, onProgress: (loaded, total) => onProgress(loaded / total) });
}

const wait = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => (clearTimeout(timer), resolve()), { once: true });
  });

/**
 * Lost connection, timeout, throttling or a server fault: worth sending the chunk again. Also 409,
 * which the server answers while it is still writing the copy of the chunk whose connection just dropped.
 */
const retryable = (err: unknown) =>
  err instanceof ApiError && ([0, 408, 409, 429].includes(err.status) || err.status >= 500);

interface Session {
  id: string;
  chunkSize: number;
  base: string;
}

async function openSession(target: UploadTarget, file: File, transport: 'socket' | 'http', signal: AbortSignal): Promise<Session> {
  const session = JSON.parse(
    await xhr({
      method: 'POST',
      url: target.sessionsUrl,
      body: JSON.stringify({ ...target.fields, name: file.name, size: file.size, transport }),
      contentType: 'application/json',
      signal,
    }),
  ) as { id: string; chunkSize: number };
  return { ...session, base: `${target.sessionsUrl}/${encodeURIComponent(session.id)}` };
}

/** Frees the partial file on the server now rather than when it times out. */
const dropSession = (session: Session) =>
  void fetch(session.base, { method: 'DELETE', credentials: 'include', keepalive: true }).catch(() => undefined);

/**
 * Sends `indices` of `file` with up to `parallel` in flight, through `send`.
 * Stops everything at the first chunk that fails for good, or when `signal` aborts.
 */
async function sendChunks(
  indices: number[],
  parallel: number,
  send: (index: number, stop: AbortSignal) => Promise<void>,
  signal: AbortSignal,
): Promise<void> {
  const stop = new AbortController();
  const onCancel = () => stop.abort();
  signal.addEventListener('abort', onCancel, { once: true });

  // The first chunk to fail for good; the cancellations it then causes in the other workers are not the cause.
  let failure: unknown = null;
  let next = 0;
  const worker = async () => {
    while (!stop.signal.aborted && next < indices.length) await send(indices[next++], stop.signal);
  };
  const run = () =>
    worker().catch((err) => {
      failure ??= err;
      stop.abort();
    });

  try {
    await Promise.all(Array.from({ length: Math.min(parallel, indices.length) }, run));
  } finally {
    signal.removeEventListener('abort', onCancel);
  }
  if (signal.aborted) throw new ApiError(0, 'Upload cancelled');
  if (failure) throw failure;
}

/** Tracks bytes confirmed per chunk, plus the bytes of chunks still on their way, for the progress bar. */
function progressOf(file: File, onProgress: (fraction: number) => void) {
  const loaded = new Map<number, number>();
  let done = 0;
  const report = () => {
    let partial = 0;
    for (const bytes of loaded.values()) partial += bytes;
    onProgress(Math.min(1, (done + partial) / file.size));
  };
  return {
    partial(index: number, bytes: number) {
      loaded.set(index, bytes);
      report();
    },
    finished(index: number, bytes: number) {
      loaded.delete(index);
      done += bytes;
      report();
    },
    reset(index: number) {
      loaded.delete(index);
      report();
    },
  };
}

/** One chunk as an HTTP PUT, sent again after a dropped connection or a server fault. */
async function putChunk(session: Session, file: File, index: number, stop: AbortSignal, progress: ReturnType<typeof progressOf>) {
  const start = index * session.chunkSize;
  const chunk = file.slice(start, Math.min(start + session.chunkSize, file.size));

  for (let attempt = 1; ; attempt++) {
    try {
      await xhr({
        method: 'PUT',
        url: `${session.base}/chunks/${index}`,
        body: chunk,
        contentType: 'application/octet-stream',
        signal: stop,
        onProgress: (bytes) => progress.partial(index, bytes),
      });
      progress.finished(index, chunk.size);
      return;
    } catch (err) {
      progress.reset(index);
      if (stop.aborted || attempt >= ATTEMPTS || !retryable(err)) throw err;
      await wait(1000 * 2 ** (attempt - 1), stop);
    }
  }
}

/** Sends `file`: over upload sockets when it is large enough and sockets work here, otherwise over HTTP. */
export async function uploadFile(
  target: UploadTarget,
  file: File,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<void> {
  const pool = socketPool(socketUrl(`/backend${target.socketPath}`));
  if (file.size > SOCKET_ABOVE && !pool.broken) return uploadOverSockets(target, pool, file, onProgress, signal);
  if (file.size <= CHUNKED_ABOVE) return postFile(target.postUrl, file, onProgress, signal);
  return uploadOverHttp(target, file, onProgress, signal);
}

async function uploadOverHttp(target: UploadTarget, file: File, onProgress: (fraction: number) => void, signal: AbortSignal) {
  const session = await openSession(target, file, 'http', signal);
  const progress = progressOf(file, onProgress);
  const indices = Array.from({ length: Math.ceil(file.size / session.chunkSize) }, (_, i) => i);
  try {
    await sendChunks(indices, PARALLEL_CHUNKS, (index, stop) => putChunk(session, file, index, stop, progress), signal);
    await xhr({ method: 'POST', url: `${session.base}/complete`, body: '', signal });
  } catch (err) {
    dropSession(session);
    throw err;
  }
}

async function uploadOverSockets(
  target: UploadTarget,
  pool: ReturnType<typeof socketPool>,
  file: File,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
) {
  const session = await openSession(target, file, 'socket', signal);
  const progress = progressOf(file, onProgress);
  const count = Math.ceil(file.size / session.chunkSize);
  const pending = new Set(Array.from({ length: count }, (_, i) => i));

  const viaSocket = async (index: number) => {
    const start = index * session.chunkSize;
    const chunk = file.slice(start, Math.min(start + session.chunkSize, file.size));
    await pool.send(session.id, index, chunk);
    pending.delete(index);
    progress.finished(index, chunk.size);
  };

  try {
    try {
      await sendChunks([...pending], QUEUED_SOCKET_CHUNKS, (index) => viaSocket(index), signal);
    } catch (err) {
      if (!(err instanceof SocketsUnavailable)) throw err;
      // Sockets are blocked here: the same session takes the rest of its chunks over HTTP.
      await sendChunks([...pending], PARALLEL_CHUNKS, (index, stop) => putChunk(session, file, index, stop, progress), signal);
    }
    await xhr({ method: 'POST', url: `${session.base}/complete`, body: '', signal });
  } catch (err) {
    pool.forget(session.id);
    dropSession(session);
    throw err;
  }
}
