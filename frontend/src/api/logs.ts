import { api } from './client';

export interface LogEntry {
  id: number;
  time: string;
  channel: 'BACKEND' | 'FRONTEND' | 'AUTH' | 'SYSTEM';
  level: 'INFO' | 'WARN' | 'ERROR';
  message: string;
}

export interface LogPage {
  entries: LogEntry[];
  total: number;
  pages: number;
  limit: number;
  /** Most entries the server keeps, so the client can bound its own count. */
  capacity: number;
}

export const PAGE_SIZES = [100, 200, 1000] as const;

export const logsApi = {
  list: (limit: number, page: number) => api.get<LogPage>(`/logs?limit=${limit}&page=${page}`),

  /** Entries newer than `after`, so a page load and the stream leave no gap. */
  streamUrl: (after: number) => `/backend/api/logs/stream?after=${after}`,
};
