import type { TranslationKey } from './i18n/index.js';

/** Carries the HTTP status plus the locale key used to render the message. */
export class AppError extends Error {
  status: number;
  key: TranslationKey;
  headers?: Record<string, string>;

  constructor(status: number, key: TranslationKey, headers?: Record<string, string>) {
    super(key);
    this.status = status;
    this.key = key;
    this.headers = headers;
  }
}

export const badRequest = (key: TranslationKey) => new AppError(400, key);
export const forbidden = (key: TranslationKey = 'auth.forbidden') => new AppError(403, key);
export const notFound = (key: TranslationKey = 'error.notFound') => new AppError(404, key);
export const conflict = (key: TranslationKey) => new AppError(409, key);
export const payloadTooLarge = (key: TranslationKey) => new AppError(413, key);
export const tooManyRequests = (retryAfterSeconds: number) =>
  new AppError(429, 'error.tooManyRequests', { 'Retry-After': String(retryAfterSeconds) });
