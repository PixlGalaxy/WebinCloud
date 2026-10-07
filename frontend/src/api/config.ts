import { api } from './client';

export interface RuntimeConfig {
  language: string;
  appName: string;
  appTitle: string;
  /** Admin-set system-wide default appearance for signed-out screens — see ThemeContext. */
  defaultThemeMode: string;
  defaultThemeSkin: string;
  maxAutoSignoutMinutes: number;
  /** Admin-set default for showing dotfiles in file lists; each browser can override it. */
  showHiddenFiles: boolean;
}

let pending: Promise<RuntimeConfig> | null = null;

/** Server-provided defaults, fetched once and shared by every consumer. */
export function getRuntimeConfig(): Promise<RuntimeConfig> {
  pending ??= api.get<RuntimeConfig>('/config');
  return pending;
}
