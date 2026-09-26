import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getRuntimeConfig } from '../api/config';

const THEMES = ['dark', 'light'] as const;
export type Theme = (typeof THEMES)[number];

const COOKIE = 'theme';
const ONE_YEAR = 60 * 60 * 24 * 365;

function isTheme(value: unknown): value is Theme {
  return THEMES.includes(value as Theme);
}

function readCookie(): Theme | null {
  const match = document.cookie.match(/(?:^|;\s*)theme=(dark|light)/);
  return match ? (match[1] as Theme) : null;
}

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  // The inline script in index.html already applied this same value.
  const [theme, setTheme] = useState<Theme>(() => readCookie() ?? 'dark');
  const [chosenByUser] = useState(() => readCookie() !== null);

  useEffect(() => {
    if (chosenByUser) return;
    getRuntimeConfig()
      .then((config) => {
        if (isTheme(config.theme)) setTheme(config.theme);
      })
      .catch(() => undefined);
  }, [chosenByUser]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const toggleTheme = () => {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    document.cookie = `${COOKIE}=${next}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
    setTheme(next);
  };

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
