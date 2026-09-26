import type { TranslationKey } from './i18n/index.js';

/** Carries the HTTP status plus the locale key used to render the message. */
export class AppError extends Error {
  status: number;
  key: TranslationKey;

  constructor(status: number, key: TranslationKey) {
    super(key);
    this.status = status;
    this.key = key;
  }
}

export const badRequest = (key: TranslationKey) => new AppError(400, key);
export const forbidden = (key: TranslationKey = 'auth.forbidden') => new AppError(403, key);
export const notFound = (key: TranslationKey = 'error.notFound') => new AppError(404, key);
export const conflict = (key: TranslationKey) => new AppError(409, key);
