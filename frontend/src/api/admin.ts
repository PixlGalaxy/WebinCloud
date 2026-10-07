import { api, ApiError } from './client';
import type { ThemeMode, SkinId } from '../theme/themes';

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

interface RestartTierField<T> {
  active: T;
  saved: T;
}

export interface AdminSettings {
  server: {
    sessionTtlHours: RestartTierField<number>;
    cookieSecure: RestartTierField<boolean>;
    loginRateLimitMax: RestartTierField<number>;
    loginRateLimitWindowMinutes: RestartTierField<number>;
    shareUnlockRateLimitMax: RestartTierField<number>;
    shareUnlockRateLimitWindowMinutes: RestartTierField<number>;
    archiveAbandonSeconds: RestartTierField<number>;
    /** Comma-separated, as typed — e.g. "uniquelocal, cloudflare". */
    trustProxy: RestartTierField<string>;
  };
  maxmindLicenseKeyActive: boolean;
  maxmindLicenseKeySaved: boolean;
  restartRequired: boolean;
  /** The client IP as the backend resolves it for this request. */
  yourIp: string | null;
  appTitle: string;
  appName: string;
  defaultThemeMode: string;
  defaultThemeSkin: string;
  defaultLanguage: string;
  showHiddenFiles: boolean;
}

export interface AdminSettingsPatch {
  sessionTtlHours?: number;
  cookieSecure?: boolean;
  loginRateLimitMax?: number;
  loginRateLimitWindowMinutes?: number;
  shareUnlockRateLimitMax?: number;
  shareUnlockRateLimitWindowMinutes?: number;
  archiveAbandonSeconds?: number;
  /** Empty string clears it. */
  maxmindLicenseKey?: string;
  /** Empty string means no proxy in front of the container. */
  trustProxy?: string;
  appTitle?: string;
  appName?: string;
  defaultThemeMode?: ThemeMode;
  defaultThemeSkin?: SkinId;
  defaultLanguage?: string;
  showHiddenFiles?: boolean;
}

export const settingsApi = {
  get: () => api.get<AdminSettings>('/admin/settings'),
  update: (patch: AdminSettingsPatch) => api.patch<{ success: true }>('/admin/settings', patch),
};

export interface ServiceStatus {
  running: boolean;
  uptimeSeconds: number | null;
}

export const servicesApi = {
  status: () => api.get<{ backend: ServiceStatus; frontend: ServiceStatus }>('/admin/services'),
  restart: (service: 'backend' | 'frontend') => api.post<{ success: true }>(`/admin/services/${service}/restart`),
};

export type BrandingAsset = 'logo.png' | 'icon.png' | 'favicon.ico';

export const brandingAdminApi = {
  /** Cache-busted so a freshly-uploaded (or reset) file shows up without a hard reload. */
  url: (name: BrandingAsset, version: number) => `/backend/api/branding/${name}?v=${version}`,

  upload: async (name: BrandingAsset, file: File): Promise<void> => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`/backend/api/branding/${name}`, { method: 'POST', credentials: 'include', body: form });
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }));
      throw new ApiError(res.status, body.error ?? 'Upload failed');
    }
  },

  reset: (name: BrandingAsset) => api.del<{ success: true }>(`/branding/${name}`),
};

export interface ImageInfo {
  nodeVersion: string;
  appVersion: string;
  imageRef: string;
  imageRevision?: string;
  platform: string;
  arch: string;
  osRelease: string;
  containerized: boolean;
}

export interface DiskUsage {
  label: string;
  path: string;
  totalBytes: number;
  usedBytes: number;
}

export interface UpdateStatus {
  checked: boolean;
  updateAvailable: boolean;
  latestRevision: string | null;
  checkedAt: string | null;
}

export interface SystemInfo {
  image: ImageInfo;
  /** False off Linux (no cgroups to read) — cpu/memory are meaningless as host stats, so the UI shows a notice instead. */
  resourcesAvailable: boolean;
  cpu: { cores: number; usagePercent: number | null; model: string | null };
  memory: { totalBytes: number; usedBytes: number } | null;
  disks: DiskUsage[];
  network: { upload: number; download: number; ready: boolean };
  update: UpdateStatus;
}

export const systemApi = {
  get: () => api.get<SystemInfo>('/admin/system'),
};

export type RateLimitSource = 'login' | 'shareUnlock';

export interface RateLimitedIp {
  ip: string;
  source: RateLimitSource;
  hits: number;
  retryAfterSeconds: number;
}

export interface BannedIp {
  ip: string;
  reason: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface IpAccessInfo {
  rateLimited: RateLimitedIp[];
  banned: BannedIp[];
}

export const ipAccessApi = {
  get: () => api.get<IpAccessInfo>('/admin/ip-access'),
  clearRateLimit: (source: RateLimitSource, ip: string) =>
    api.del<{ success: true }>(`/admin/ip-access/rate-limit/${source}/${encodeURIComponent(ip)}`),
  ban: (ip: string, reason?: string) => api.post<{ success: true }>('/admin/ip-access/banned', { ip, reason }),
  unban: (ip: string) => api.del<{ success: true }>(`/admin/ip-access/banned/${encodeURIComponent(ip)}`),
};
