import { ApiError } from './client';

/** Where a file goes: one plain request for small files, chunked sessions for large ones. */
export interface UploadTarget {
  postUrl: string;
  sessionsUrl: string;
  /** Sent when a chunked upload starts, beside the file's name and size (folder, conflict mode). */
  fields: Record<string, unknown>;
}

/** Files up to this size go in one request; the server's chunks are this size too. */
const CHUNKED_ABOVE = 8 * 1024 * 1024;
/**
 * Chunks of one file in flight at once. Each request has its own flow-control
 * window, so on a high-latency link the speed grows with this until the line is full.
 */
const PARALLEL_CHUNKS = 6;
/** Attempts per chunk before the file fails: a dropped connection should not cost the whole upload. */
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

/** Sends `file`, in parallel chunks when it is large. */
export async function uploadFile(
  target: UploadTarget,
  file: File,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<void> {
  if (file.size <= CHUNKED_ABOVE) return postFile(target.postUrl, file, onProgress, signal);

  const session = JSON.parse(
    await xhr({
      method: 'POST',
      url: target.sessionsUrl,
      body: JSON.stringify({ ...target.fields, name: file.name, size: file.size }),
      contentType: 'application/json',
      signal,
    }),
  ) as { id: string; chunkSize: number };
  const base = `${target.sessionsUrl}/${encodeURIComponent(session.id)}`;

  // Stops the other chunks as soon as one fails for good, or when the user cancels.
  const stop = new AbortController();
  const onCancel = () => stop.abort();
  signal.addEventListener('abort', onCancel, { once: true });

  const count = Math.ceil(file.size / session.chunkSize);
  const loaded = new Array<number>(count).fill(0);
  const report = () => onProgress(loaded.reduce((sum, bytes) => sum + bytes, 0) / file.size);

  let next = 0;
  const worker = async () => {
    while (!stop.signal.aborted && next < count) {
      const index = next++;
      const start = index * session.chunkSize;
      const chunk = file.slice(start, Math.min(start + session.chunkSize, file.size));

      for (let attempt = 1; ; attempt++) {
        try {
          await xhr({
            method: 'PUT',
            url: `${base}/chunks/${index}`,
            body: chunk,
            contentType: 'application/octet-stream',
            signal: stop.signal,
            onProgress: (bytes) => {
              loaded[index] = bytes;
              report();
            },
          });
          loaded[index] = chunk.size;
          report();
          break;
        } catch (err) {
          loaded[index] = 0;
          report();
          if (stop.signal.aborted || attempt >= ATTEMPTS || !retryable(err)) throw err;
          await wait(1000 * 2 ** (attempt - 1), stop.signal);
        }
      }
    }
  };

  // The first chunk to fail for good; the cancellations it then causes in the other workers are not the cause.
  let failure: unknown = null;
  const run = () =>
    worker().catch((err) => {
      failure ??= err;
      stop.abort();
    });

  try {
    await Promise.all(Array.from({ length: Math.min(PARALLEL_CHUNKS, count) }, run));
    if (signal.aborted) throw new ApiError(0, 'Upload cancelled');
    if (failure) throw failure;

    await xhr({ method: 'POST', url: `${base}/complete`, body: '', signal });
  } catch (err) {
    // Frees the partial file on the server now rather than when it times out.
    void fetch(base, { method: 'DELETE', credentials: 'include', keepalive: true }).catch(() => undefined);
    throw err;
  } finally {
    signal.removeEventListener('abort', onCancel);
  }
}
