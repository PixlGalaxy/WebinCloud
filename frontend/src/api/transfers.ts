import { api } from './client';
import type { ConflictMode } from './files';

export type TransferStatus = 'preparing' | 'running' | 'done' | 'error';

export interface TransferJob {
  id: string;
  status: TransferStatus;
  totalBytes: number;
  processedBytes: number;
  totalEntries: number;
  processedEntries: number;
  /** 0..1, or null while the total is still being measured. */
  progress: number | null;
  error?: string;
}

export const transfersApi = {
  start: (paths: string[], destination: string, onConflict: ConflictMode) =>
    api.post<TransferJob>('/transfers', { paths, destination, onConflict }),
  get: (id: string) => api.get<TransferJob>(`/transfers/${id}`),
  remove: (id: string) => api.del<void>(`/transfers/${id}`),
};
