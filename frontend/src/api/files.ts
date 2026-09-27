import { api } from './client';

export type PreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'text' | 'none';

export interface DirEntry {
  name: string;
  path: string;
  type: 'file' | 'folder';
  size: number;
  modifiedAt: string;
  previewKind: PreviewKind;
  /** The server can make a small preview image of it, whatever its format. */
  thumbnail: boolean;
}

export interface TextContent {
  content: string;
  kind: PreviewKind;
  canWrite: boolean;
}

export interface SearchResult {
  parentPath: string;
  entry: DirEntry;
}

export interface SearchResponse {
  query: string;
  path: string;
  results: SearchResult[];
  truncated: boolean;
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

  /** The modified time is part of the URL, so a cached thumbnail is never stale. */
  thumbnailUrl: (path: string, modifiedAt: string, size: 'sm' | 'lg') =>
    `/backend/api/files/thumbnail?path=${encode(path)}&size=${size}&v=${encodeURIComponent(modifiedAt)}`,

  /** Same-origin URL that renders inline (images, video, audio, PDF). */
  rawUrl: (path: string) => `/backend/api/files/raw?path=${encode(path)}`,

  readText: (path: string) => api.get<TextContent>(`/files/content?path=${encode(path)}`),

  writeText: (path: string, content: string) =>
    api.put<void>(`/files/content?path=${encode(path)}`, { content }),

  search: (path: string, query: string) =>
    api.get<SearchResponse>(`/files/search?path=${encode(path)}&q=${encode(query)}`),

  checkConflicts: (path: string, names: string[]) =>
    api.post<{ conflicts: ExistingFile[] }>('/files/check-conflicts', { path, names }),

  uploadUrl: (path: string, onConflict: ConflictMode) =>
    `/backend/api/files/upload?path=${encode(path)}&onConflict=${onConflict}`,

  eventsUrl: (path: string) => `/backend/api/files/events?path=${encode(path)}`,
};
