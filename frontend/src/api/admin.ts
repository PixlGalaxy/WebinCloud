import { api } from './client';

export type ConnectionActivity = 'browsing' | 'downloading' | 'uploading' | 'modifying' | 'idle';

export interface ConnectionSnapshot {
  ip: string;
  country: string | null;
  countryName: string | null;
  kind: 'user' | 'public';
  username?: string;
  activity: ConnectionActivity;
  since: string;
}

export interface MetricsSnapshot {
  totals: { connections: number; uploads: number; downloads: number };
  current: ConnectionSnapshot[];
  countries: { code: string; name: string; count: number }[];
  geoReady: boolean;
  networkStatsReady: boolean;
  bandwidth: { intervalSeconds: number; upload: number[]; download: number[] };
}

export const adminApi = {
  metrics: () => api.get<MetricsSnapshot>('/admin/metrics'),
  metricsStreamUrl: () => '/backend/api/admin/metrics/stream',
};
