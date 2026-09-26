import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { getRuntimeConfig } from '../api/config';
import { dictionaries, isLanguage, type Language, type TranslationKey } from './translations';

type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string;

interface I18nContextValue {
  language: Language;
  t: Translate;
}

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>('en');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    getRuntimeConfig()
      .then((config) => {
        if (isLanguage(config.language)) setLanguage(config.language);
      })
      .catch((err) => console.error('Failed to load runtime config:', err))
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    document.documentElement.lang = language;
  }, [language]);

  const t: Translate = (key, vars) => {
    const template = dictionaries[language][key];
    if (!vars) return template;
    return Object.entries(vars).reduce((out, [name, value]) => out.replaceAll(`{${name}}`, String(value)), template);
  };

  if (!ready) return null;

  return <I18nContext.Provider value={{ language, t }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used within I18nProvider');
  return ctx;
}
