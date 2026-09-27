import { ApiError } from './client';

/** One file per request, over XHR because only it reports upload progress. */
export function postFile(
  url: string,
  file: File,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new ApiError(0, 'Upload cancelled'));

    const form = new FormData();
    form.append('files', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.withCredentials = true;

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    });

    xhr.addEventListener('load', () => {
      let body: { error?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // Fall through to the status-based error below.
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new ApiError(xhr.status, body.error ?? 'Upload failed'));
    });

    xhr.addEventListener('error', () => reject(new ApiError(0, 'Upload failed')));
    xhr.addEventListener('abort', () => reject(new ApiError(0, 'Upload cancelled')));
    signal.addEventListener('abort', () => xhr.abort(), { once: true });

    xhr.send(form);
  });
}
