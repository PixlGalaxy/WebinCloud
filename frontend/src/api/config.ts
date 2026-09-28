import { api } from './client';

export interface RuntimeConfig {
  language: string;
  theme: string;
  appName: string;
  appTitle: string;
  maxAutoSignoutMinutes: number;
}

let pending: Promise<RuntimeConfig> | null = null;

/** Server-provided defaults, fetched once and shared by every consumer. */
export function getRuntimeConfig(): Promise<RuntimeConfig> {
  pending ??= api.get<RuntimeConfig>('/config');
  return pending;
}
