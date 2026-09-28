import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { isLanguage, type Language } from '../i18n/index.js';
import { logger } from '../logger.js';

// src/config/env.ts (or dist/config/env.js) -> repo root
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export interface EnvConfig {
  NODE_ENV: 'development' | 'production';
  PORT: number;
  DATA_ROOT: string;
  APPDATA_ROOT: string;
  TEMP_ROOT: string;
  DB_PATH: string;
  AVATARS_DIR: string;
  /** Cached thumbnails: disposable, they are regenerated on demand. */
  THUMBNAILS_DIR: string;
  /** ffmpeg executable used to make thumbnails. */
  FFMPEG_PATH: string;
  LOCALES_DIR: string;
  /** Administrator-replaceable logo and icons, inside the app data volume. */
  BRANDING_DIR: string;
  /** Packaged fallbacks shipped with the image. */
  DEFAULT_BRANDING_DIR: string;
  SESSION_TTL_HOURS: number;
  COOKIE_SECURE: boolean;
  /** Seconds without a progress poll before a running archive is cancelled. */
  ARCHIVE_ABANDON_SECONDS: number;
  /** Max login attempts allowed per IP and per account within the window below. */
  LOGIN_RATE_LIMIT_MAX: number;
  LOGIN_RATE_LIMIT_WINDOW_MINUTES: number;
  /** Max share-unlock (password) attempts allowed per IP and per share within the window below. */
  SHARE_UNLOCK_RATE_LIMIT_MAX: number;
  SHARE_UNLOCK_RATE_LIMIT_WINDOW_MINUTES: number;
  LANGUAGE: Language;
  /** Shown in the browser tab.
   */
  APP_TITLE: string;
  /** Product name used in UI copy and image alt text. */
  APP_NAME: string;
  /** Optional: enables the admin dashboard's world map. Without it, the map just has no dots. */
  MAXMIND_LICENSE_KEY?: string;
  /** Where the downloaded GeoLite2-Country.mmdb is cached across restarts. */
  GEOIP_DIR: string;
}

export function loadEnv(): EnvConfig {
  const env = process.env;
  const isProd = env.NODE_ENV === 'production';

  // Mounted volumes in production; folders at the repo root in development.
  const DATA_ROOT = resolve(env.DATA_ROOT || (isProd ? '/data' : join(repoRoot, 'data')));
  const APPDATA_ROOT = resolve(env.APPDATA_ROOT || (isProd ? '/appdata' : join(repoRoot, 'appdata')));
  // Scratch space for generated archives; safe to wipe at any time.
  const TEMP_ROOT = resolve(env.TEMP_ROOT || (isProd ? '/temp' : join(repoRoot, 'temp')));

  if (env.LANGUAGE && !isLanguage(env.LANGUAGE)) {
    logger.warn(`Unsupported LANGUAGE "${env.LANGUAGE}", falling back to "en"`);
  }

  return {
    NODE_ENV: isProd ? 'production' : 'development',
    PORT: parseInt(env.PORT || '4000', 10),
    DATA_ROOT,
    APPDATA_ROOT,
    TEMP_ROOT,
    DB_PATH: env.DB_PATH || join(APPDATA_ROOT, 'webincloud.sqlite'),
    AVATARS_DIR: env.AVATARS_DIR || join(APPDATA_ROOT, 'avatars'),
    THUMBNAILS_DIR: env.THUMBNAILS_DIR || join(TEMP_ROOT, 'thumbnails'),
    FFMPEG_PATH: env.FFMPEG_PATH || 'ffmpeg',
    BRANDING_DIR: env.BRANDING_DIR || join(APPDATA_ROOT, 'branding'),
    DEFAULT_BRANDING_DIR: env.DEFAULT_BRANDING_DIR || join(repoRoot, 'branding'),
    // Shared with the frontend so both render the same strings.
    LOCALES_DIR: resolve(env.LOCALES_DIR || join(repoRoot, 'locales')),
    SESSION_TTL_HOURS: parseInt(env.SESSION_TTL_HOURS || '24', 10),
    ARCHIVE_ABANDON_SECONDS: parseInt(env.ARCHIVE_ABANDON_SECONDS || '30', 10),
    LOGIN_RATE_LIMIT_MAX: parseInt(env.LOGIN_RATE_LIMIT_MAX || '10', 10),
    LOGIN_RATE_LIMIT_WINDOW_MINUTES: parseInt(env.LOGIN_RATE_LIMIT_WINDOW_MINUTES || '15', 10),
    SHARE_UNLOCK_RATE_LIMIT_MAX: parseInt(env.SHARE_UNLOCK_RATE_LIMIT_MAX || '10', 10),
    SHARE_UNLOCK_RATE_LIMIT_WINDOW_MINUTES: parseInt(env.SHARE_UNLOCK_RATE_LIMIT_WINDOW_MINUTES || '15', 10),
    // Off by default: behind plain-HTTP nginx a Secure cookie would never be sent back.
    COOKIE_SECURE: env.COOKIE_SECURE === 'true',
    LANGUAGE: isLanguage(env.LANGUAGE) ? env.LANGUAGE : 'en',
    APP_TITLE: env.APP_TITLE || 'Webin Cloud Server',
    APP_NAME: env.APP_NAME || 'Webin Cloud',
    MAXMIND_LICENSE_KEY: env.MAXMIND_LICENSE_KEY || undefined,
    GEOIP_DIR: env.GEOIP_DIR || join(APPDATA_ROOT, 'geoip'),
  };
}
