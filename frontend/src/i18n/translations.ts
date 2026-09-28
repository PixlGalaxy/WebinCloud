import en from '@locales/en.json';
import es from '@locales/es.json';
import fr from '@locales/fr.json';
import nl from '@locales/nl.json';

// To add a language: drop its locales/<code>.json (matching en.json's keys —
// a mismatch fails the build), then add the code here, its import above, its
// entry in `dictionaries`, and its native name in `LANGUAGE_NAMES` below.
// TypeScript enforces the last one for you: `LANGUAGE_NAMES` won't compile
// until every code in `SUPPORTED_LANGUAGES` has a name. The language picker
// in Settings reads this list, so a new language appears there automatically.
export const SUPPORTED_LANGUAGES = ['en', 'es', 'fr', 'nl'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export type TranslationKey = keyof typeof en;

// Every other locale is checked against en.json's shape, so a missing key fails the build.
export const dictionaries: Record<Language, Record<TranslationKey, string>> = { en, es, fr, nl };

/** Each language's own name for itself, e.g. "Español" — shown regardless of the current UI language. */
export const LANGUAGE_NAMES: Record<Language, string> = {
  en: 'English',
  es: 'Español',
  fr: 'Français',
  nl: 'Nederlands',
};

export function isLanguage(value: unknown): value is Language {
  return SUPPORTED_LANGUAGES.includes(value as Language);
}
