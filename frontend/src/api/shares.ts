import { api } from './client';
import type { PreviewKind } from './files';

export interface PathName {
  id: string;
  user_id: string;
  name: string;
  created_at: string;
}

export interface Share {
  id: string;
  target_path: string;
  target_type: 'file' | 'folder';
  name: string;
  path_name_id: string | null;
  pathName: string | null;
  segment: string;
  url: string;
  allow_download: number;
  allow_upload: number;
  hasPassword: boolean;
  expires_at: string | null;
  expired: boolean;
  created_at: string;
}

export interface CreateShareInput {
  path: string;
  allowDownload: boolean;
  allowUpload: boolean;
  password?: string | null;
  expiresAt?: string | null;
  pathNameId?: string | null;
}

export interface UpdateShareInput {
  allowDownload?: boolean;
  allowUpload?: boolean;
  password?: string | null;
  expiresAt?: string | null;
  pathNameId?: string | null;
}

export const sharesApi = {
  list: () => api.get<Share[]>('/shares'),
  create: (input: CreateShareInput) => api.post<Share>('/shares', input),
  update: (id: string, input: UpdateShareInput) => api.patch<Share>(`/shares/${id}`, input),
  remove: (id: string) => api.del<void>(`/shares/${id}`),

  listPathNames: () => api.get<PathName[]>('/shares/path-names'),
  createPathName: (name: string) => api.post<PathName>('/shares/path-names', { name }),
  renamePathName: (id: string, name: string) => api.patch<PathName>(`/shares/path-names/${id}`, { name }),
  removePathName: (id: string) => api.del<void>(`/shares/path-names/${id}`),
};

// --- public side (no session) ------------------------------------------------

export interface PublicShareInfo {
  name: string;
  type: 'file' | 'folder';
  allowDownload: boolean;
  allowUpload: boolean;
  requiresPassword: boolean;
  unlocked: boolean;
  previewKind: PreviewKind;
}

export interface PublicEntry {
  name: string;
  path: string;
  type: 'file' | 'folder';
  size: number;
  modifiedAt: string;
  previewKind: PreviewKind;
}

const publicBase = (segment: string, name: string) =>
  `/public/${encodeURIComponent(segment)}/${encodeURIComponent(name)}`;

export const publicShareApi = {
  info: (segment: string, name: string) => api.get<PublicShareInfo>(publicBase(segment, name)),

  unlock: (segment: string, name: string, password: string) =>
    api.post<{ unlocked: boolean }>(`${publicBase(segment, name)}/unlock`, { password }),

  list: (segment: string, name: string, path: string) =>
    api.get<{ path: string; entries: PublicEntry[] }>(
      `${publicBase(segment, name)}/list?path=${encodeURIComponent(path)}`,
    ),

  downloadUrl: (segment: string, name: string, path = '') =>
    `/backend/api${publicBase(segment, name)}/download?path=${encodeURIComponent(path)}`,

  rawUrl: (segment: string, name: string, path = '') =>
    `/backend/api${publicBase(segment, name)}/download?inline=1&path=${encodeURIComponent(path)}`,

  uploadUrl: (segment: string, name: string, path = '') =>
    `/backend/api${publicBase(segment, name)}/upload?path=${encodeURIComponent(path)}`,
};

/** Public uploads report progress, so they go through XHR like the private ones. */
export function uploadToShare(
  url: string,
  files: File[],
  onProgress: (fraction: number) => void,
): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    for (const file of files) form.append('files', file);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.withCredentials = true;
    xhr.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    });
    xhr.addEventListener('load', () => {
      let body: { uploaded?: string[]; error?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // handled by the status check below
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body.uploaded ?? []);
      else reject(new Error(body.error ?? 'Upload failed'));
    });
    xhr.addEventListener('error', () => reject(new Error('Upload failed')));
    xhr.send(form);
  });
}
