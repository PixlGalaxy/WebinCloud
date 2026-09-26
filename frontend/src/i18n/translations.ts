import en from '@locales/en.json';
import es from '@locales/es.json';

export const SUPPORTED_LANGUAGES = ['en', 'es'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export type TranslationKey = keyof typeof en;

// es.json is checked against en.json's shape, so a missing key fails the build.
export const dictionaries: Record<Language, Record<TranslationKey, string>> = { en, es };

export function isLanguage(value: unknown): value is Language {
  return SUPPORTED_LANGUAGES.includes(value as Language);
}
