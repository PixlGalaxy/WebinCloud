import { api, ApiError } from './client';

export type PreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'none';

export interface DirEntry {
  name: string;
  path: string;
  type: 'file' | 'folder';
  size: number;
  modifiedAt: string;
  previewKind: PreviewKind;
}

export interface TextContent {
  content: string;
  kind: PreviewKind;
  canWrite: boolean;
}

export type ConflictMode = 'fail' | 'overwrite' | 'keepBoth';

export interface ExistingFile {
  name: string;
  size: number;
  modifiedAt: string;
}

export interface Listing {
  path: string;
  canWrite: boolean;
  entries: DirEntry[];
}

const encode = (path: string) => encodeURIComponent(path);

export const filesApi = {
  list: (path: string) => api.get<Listing>(`/files?path=${encode(path)}`),

  createFolder: (path: string, name: string) => api.post<DirEntry>('/files/mkdir', { path, name }),

  rename: (path: string, newName: string) => api.patch<DirEntry>('/files/rename', { path, newName }),

  remove: (path: string) => api.del<void>(`/files?path=${encode(path)}`),

  downloadUrl: (path: string) => `/backend/api/files/download?path=${encode(path)}`,

  /** Same-origin URL that renders inline (images, video, audio, PDF). */
  rawUrl: (path: string) => `/backend/api/files/raw?path=${encode(path)}`,

  readText: (path: string) => api.get<TextContent>(`/files/content?path=${encode(path)}`),

  writeText: (path: string, content: string) =>
    api.put<void>(`/files/content?path=${encode(path)}`, { content }),

  checkConflicts: (path: string, names: string[]) =>
    api.post<{ conflicts: ExistingFile[] }>('/files/check-conflicts', { path, names }),

  eventsUrl: (path: string) => `/backend/api/files/events?path=${encode(path)}`,
};

/** Uploads via XHR because only it reports progress events. */
export function uploadFiles(
  path: string,
  files: File[],
  onProgress: (fraction: number) => void,
  onConflict: ConflictMode = 'fail',
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    for (const file of files) form.append('files', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/backend/api/files/upload?path=${encode(path)}&onConflict=${onConflict}`);
    xhr.withCredentials = true;

    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    });

    xhr.addEventListener('load', () => {
      let body: { uploaded?: string[]; error?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // Fall through to the status-based error below.
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body.uploaded ?? []);
      else reject(new ApiError(xhr.status, body.error ?? 'Upload failed'));
    });

    xhr.addEventListener('error', () => reject(new ApiError(0, 'Upload failed')));
    xhr.send(form);
  });
}
