import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getRuntimeConfig } from '../api/config';
import { useAuth } from './AuthContext';

const KEY = 'webincloud.autoSignOut';
const DEFAULT_MINUTES = 15;
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart'] as const;

interface Stored {
  enabled: boolean;
  minutes: number;
}

function read(): Stored {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { enabled: false, minutes: DEFAULT_MINUTES };
    const parsed = JSON.parse(raw) as Partial<Stored>;
    return {
      enabled: parsed.enabled === true,
      minutes: typeof parsed.minutes === 'number' && parsed.minutes > 0 ? parsed.minutes : DEFAULT_MINUTES,
    };
  } catch {
    return { enabled: false, minutes: DEFAULT_MINUTES };
  }
}

function write(value: Stored): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch {
    // Blocked storage: the choice just won't survive a reload.
  }
}

interface AutoSignOutContextValue {
  enabled: boolean;
  minutes: number;
  /** Longest value Settings should let the user pick, from the server's session lifetime. */
  maxMinutes: number;
  setEnabled: (value: boolean) => void;
  setMinutes: (value: number) => void;
}

const AutoSignOutContext = createContext<AutoSignOutContextValue | undefined>(undefined);

export function AutoSignOutProvider({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const [{ enabled, minutes }, setState] = useState(read);
  const [maxMinutes, setMaxMinutes] = useState(120);

  useEffect(() => {
    getRuntimeConfig()
      .then((config) => {
        if (config.maxAutoSignoutMinutes > 0) setMaxMinutes(config.maxAutoSignoutMinutes);
      })
      .catch(() => undefined);
  }, []);

  const setEnabled = (value: boolean) => setState((current) => { const next = { ...current, enabled: value }; write(next); return next; });
  const setMinutes = (value: number) => setState((current) => { const next = { ...current, minutes: value }; write(next); return next; });

  // Clamp a stale local value if the admin lowers the session lifetime later.
  useEffect(() => {
    if (minutes > maxMinutes) setMinutes(maxMinutes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxMinutes]);

  useEffect(() => {
    if (!enabled || !user) return;

    let timer: ReturnType<typeof setTimeout>;
    const reset = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void logout(), minutes * 60 * 1000);
    };

    reset();
    ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, reset, { passive: true }));
    return () => {
      clearTimeout(timer);
      ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, reset));
    };
  }, [enabled, minutes, user, logout]);

  return (
    <AutoSignOutContext.Provider value={{ enabled, minutes, maxMinutes, setEnabled, setMinutes }}>
      {children}
    </AutoSignOutContext.Provider>
  );
}

export function useAutoSignOut() {
  const ctx = useContext(AutoSignOutContext);
  if (!ctx) throw new Error('useAutoSignOut must be used within AutoSignOutProvider');
  return ctx;
}
