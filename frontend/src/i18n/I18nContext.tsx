import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getRuntimeConfig } from '../api/config';
import { api } from '../api/client';
import type { User } from '../api/types';
import { useAuth } from '../context/AuthContext';
import { dictionaries, isLanguage, type Language, type TranslationKey } from './translations';

type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string;

interface I18nContextValue {
  language: Language;
  t: Translate;
  /** No-op while signed out — the language only persists to an account. */
  setLanguage: (language: Language) => Promise<void>;
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

export function I18nProvider({ children }: { children: ReactNode }) {
  const { user, updateUser } = useAuth();
  // Signed-out screens (login, public shares) ignore any account language and
  // always show the server's configured default instead.
  const [envLanguage, setEnvLanguage] = useState<Language>('en');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    getRuntimeConfig()
      .then((config) => {
        if (isLanguage(config.language)) setEnvLanguage(config.language);
      })
      .catch((err) => console.error('Failed to load runtime config:', err))
      .finally(() => setReady(true));
  }, []);

  const language: Language = user ? (isLanguage(user.language) ? user.language : 'en') : envLanguage;

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const t: Translate = (key, vars) => {
    const template = dictionaries[language][key];
    if (!vars) return template;
    return Object.entries(vars).reduce((out, [name, value]) => out.replaceAll(`{${name}}`, String(value)), template);
  };

  const setLanguage = async (next: Language) => {
    const updated = await api.post<User>('/auth/appearance', { language: next });
    updateUser(updated);
  };

  if (!ready) return null;

  return <I18nContext.Provider value={{ language, t, setLanguage }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
