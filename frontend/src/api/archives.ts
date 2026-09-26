import { api } from './client';

export type ArchiveStatus = 'preparing' | 'running' | 'done' | 'error';

export interface ArchiveJob {
  id: string;
  status: ArchiveStatus;
  fileName: string;
  totalBytes: number;
  processedBytes: number;
  totalEntries: number;
  processedEntries: number;
  /** 0..1, or null while the total is still being measured. */
  progress: number | null;
  error?: string;
}

export const archivesApi = {
  start: (paths: string[]) => api.post<ArchiveJob>('/archives', { paths }),
  get: (id: string) => api.get<ArchiveJob>(`/archives/${id}`),
  remove: (id: string) => api.del<void>(`/archives/${id}`),
  downloadUrl: (id: string) => `/backend/api/archives/${id}/download`,
};
