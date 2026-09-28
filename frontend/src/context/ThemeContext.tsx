import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getRuntimeConfig } from '../api/config';
import { api } from '../api/client';
import type { User } from '../api/types';
import { useAuth } from './AuthContext';
import { isSkinId, isThemeMode, type SkinId, type ThemeMode } from '../theme/themes';

export type { ThemeMode, SkinId } from '../theme/themes';

interface ThemeContextValue {
  /** The visitor's raw choice — may be 'system'. */
  themeMode: ThemeMode;
  skin: SkinId;
  /** What 'system' actually resolves to right now; always 'dark' or 'light'. */
  mode: 'dark' | 'light';
  setAppearance: (appearance: { mode?: ThemeMode; skin?: SkinId }) => Promise<void>;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

function useSystemPrefersDark(): boolean {
  const [prefersDark, setPrefersDark] = useState(
    () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches,
  );

  useEffect(() => {
    const query = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setPrefersDark(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return prefersDark;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { user, updateUser } = useAuth();
  // Signed-out screens (login, public shares) ignore any account preference
  // and always show the admin-configured default instead (Admin Panel ->
  // Settings -> Appearance), applies with no restart needed.
  const [defaultMode, setDefaultMode] = useState<ThemeMode>('dark');
  const [defaultSkin, setDefaultSkin] = useState<SkinId>('default');
  const systemPrefersDark = useSystemPrefersDark();

  useEffect(() => {
    getRuntimeConfig()
      .then((config) => {
        if (isThemeMode(config.defaultThemeMode)) setDefaultMode(config.defaultThemeMode);
        if (isSkinId(config.defaultThemeSkin)) setDefaultSkin(config.defaultThemeSkin);
      })
      .catch(() => undefined);
  }, []);

  const themeMode: ThemeMode = user ? (isThemeMode(user.theme_mode) ? user.theme_mode : 'dark') : defaultMode;
  const skin: SkinId = user ? (isSkinId(user.theme_skin) ? user.theme_skin : 'default') : defaultSkin;
  const mode: 'dark' | 'light' = themeMode === 'system' ? (systemPrefersDark ? 'dark' : 'light') : themeMode;

  useEffect(() => {
    document.documentElement.classList.toggle('dark', mode === 'dark');
    document.documentElement.dataset.skin = skin;
  }, [mode, skin]);

  const setAppearance = async (appearance: { mode?: ThemeMode; skin?: SkinId }) => {
    const updated = await api.post<User>('/auth/appearance', appearance);
    updateUser(updated);
  };

  return <ThemeContext.Provider value={{ themeMode, skin, mode, setAppearance }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
