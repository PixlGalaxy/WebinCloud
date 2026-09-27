import { readFileSync } from 'fs';
import { join } from 'path';
import { logger } from '../logger.js';

export const SUPPORTED_LANGUAGES = ['en', 'es'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

/** Keys the backend sends to clients. Locale files may hold more (the frontend's). */
const BACKEND_KEYS = [
  'auth.credentialsRequired',
  'auth.invalidCredentials',
  'auth.notAuthenticated',
  'auth.forbidden',
  'auth.passwordsRequired',
  'auth.passwordTooShort',
  'auth.currentPasswordIncorrect',
  'error.internal',
  'error.notFound',
  'files.invalidPath',
  'files.invalidName',
  'files.alreadyExists',
  'files.noFilesUploaded',
  'files.notPreviewable',
  'files.tooLargeToEdit',
  'files.invalidContent',
  'files.searchQueryRequired',
  'archives.nothingSelected',
  'archives.tooManyItems',
  'archives.notReady',
  'users.invalidEmail',
  'users.invalidUsername',
  'users.emailTaken',
  'users.usernameTaken',
  'users.cannotDeleteSelf',
  'avatars.invalidType',
  'avatars.tooLarge',
  'avatars.noFile',
  'permissions.userIdRequired',
  'permissions.rootNotAllowed',
  'permissions.folderMissing',
  'permissions.alreadyGranted',
  'pathNames.invalid',
  'pathNames.reserved',
  'pathNames.taken',
  'pathNames.inUse',
  'shares.rootNotAllowed',
  'shares.nameTaken',
  'shares.expired',
  'shares.passwordRequired',
  'shares.wrongPassword',
] as const;

export type TranslationKey = (typeof BACKEND_KEYS)[number];
export type Translate = (key: TranslationKey) => string;

export function isLanguage(value: string | undefined): value is Language {
  return SUPPORTED_LANGUAGES.includes(value as Language);
}

function loadDictionary(localesDir: string, language: Language): Record<string, string> {
  const path = join(localesDir, `${language}.json`);
  const dictionary = JSON.parse(readFileSync(path, 'utf-8')) as Record<string, string>;

  const missing = BACKEND_KEYS.filter((key) => typeof dictionary[key] !== 'string');
  if (missing.length > 0) {
    throw new Error(`Locale ${path} is missing keys: ${missing.join(', ')}`);
  }
  return dictionary;
}

export function createTranslator(localesDir: string, language: Language): Translate {
  const dictionary = loadDictionary(localesDir, language);
  logger.info(`Loaded ${language} locale from ${localesDir}`);
  return (key) => dictionary[key];
}
