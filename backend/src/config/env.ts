import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { readFileSync } from 'fs';
import { isLanguage, type Language } from '../i18n/index.js';
import { logger } from '../logger.js';
import { parseTrustProxy } from './trust-proxy.js';

// src/config/env.ts (or dist/config/env.js) -> repo root
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export interface EnvConfig {
  NODE_ENV: 'development' | 'production';
  PORT: number;
  /** Interface to listen on. Loopback in production: only the bundled nginx should reach the API directly. */
  HOST: string | undefined;
  /** Largest single file an upload (signed-in or public link) may carry; 0 means no limit. */
  MAX_UPLOAD_MB: number;
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
  /** Which product this server presents as, from BRANDING (WC or RC). */
  BRAND: Brand;
  /** Folder holding one sub-folder of default logos per brand (branding/WebinCloud, branding/RyzhellCloud). */
  BRANDING_PACKS_DIR: string;
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
  /** Read from backend/package.json at boot — shown on the admin panel's System page. */
  BACKEND_VERSION: string;
  /** The published tag (e.g. "latest", "1.2.3") baked in by the publish workflow — "dev" for a plain local `docker build`. */
  IMAGE_REF: string;
  /** Git commit the running image was built from, if the publish workflow set it. */
  IMAGE_REVISION?: string;
  /** Periodically asks GitHub if `main` has moved past IMAGE_REVISION — set DISABLE_UPDATE_CHECK=true to turn off. */
  UPDATE_CHECK_ENABLED: boolean;
  /** Proxies allowed to report the client IP in X-Forwarded-For (always includes loopback). See trust-proxy.ts. */
  TRUST_PROXY: string[];
  /** The same, as typed by the admin (e.g. "uniquelocal, cloudflare") — shown in the admin panel. */
  TRUST_PROXY_SETTING: string;
}

export interface Brand {
  id: 'WebinCloud' | 'RyzhellCloud';
  /** Short name, the default app name. */
  name: string;
  /** Full name, the default page title. */
  title: string;
}

/**
 * The products this server can present as. They differ only in name, logo,
 * icon and favicon; BRANDING picks one (WC by default).
 */
export const BRANDS: Record<string, Brand> = {
  WC: { id: 'WebinCloud', name: 'Webin Cloud', title: 'Webin Cloud Server' },
  RC: { id: 'RyzhellCloud', name: 'Ryzhell Cloud', title: 'Ryzhell Cloud Server' },
};

function brandFrom(value: string | undefined): Brand {
  if (!value) return BRANDS.WC;
  const key = value.trim().toUpperCase();
  const brand = BRANDS[key] ?? Object.values(BRANDS).find((b) => b.id.toUpperCase() === key);
  if (!brand) logger.warn(`Unknown BRANDING "${value}", using WC (Webin Cloud). Valid values: ${Object.keys(BRANDS).join(', ')}`);
  return brand ?? BRANDS.WC;
}

export function loadEnv(): EnvConfig {
  const env = process.env;
  // Production unless asked otherwise: a missing or mistyped NODE_ENV must
  // never turn on the development seed or listen on every interface.
  const isProd = env.NODE_ENV !== 'development' && env.NODE_ENV !== 'dev';

  // Mounted volumes in production; folders at the repo root in development.
  const DATA_ROOT = resolve(env.DATA_ROOT || (isProd ? '/data' : join(repoRoot, 'data')));
  const APPDATA_ROOT = resolve(env.APPDATA_ROOT || (isProd ? '/appdata' : join(repoRoot, 'appdata')));
  // Scratch space for generated archives; safe to wipe at any time.
  const TEMP_ROOT = resolve(env.TEMP_ROOT || (isProd ? '/temp' : join(repoRoot, 'temp')));

  const brand = brandFrom(env.BRANDING);
  const brandingPacks = resolve(env.BRANDING_PACKS_DIR || join(repoRoot, 'branding'));

  if (env.LANGUAGE && !isLanguage(env.LANGUAGE)) {
    logger.warn(`Unsupported LANGUAGE "${env.LANGUAGE}", falling back to "en"`);
  }

  const trustProxy = parseTrustProxy(env.TRUST_PROXY);
  if (trustProxy.invalid.length > 0) {
    logger.warn(`Ignoring unrecognized TRUST_PROXY entries: ${trustProxy.invalid.join(', ')}`);
  }

  let backendVersion = '0.0.0';
  try {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'backend', 'package.json'), 'utf-8')) as { version?: string };
    if (pkg.version) backendVersion = pkg.version;
  } catch {
    // Best-effort — shown on the System page, never load-bearing.
  }

  return {
    NODE_ENV: isProd ? 'production' : 'development',
    PORT: parseInt(env.PORT || '4000', 10),
    // Unset in development so the Vite proxy reaches it whichever of
    // 127.0.0.1 / ::1 "localhost" resolves to on the machine.
    HOST: env.HOST || (isProd ? '127.0.0.1' : undefined),
    MAX_UPLOAD_MB: Math.max(0, parseInt(env.MAX_UPLOAD_MB || '0', 10) || 0),
    DATA_ROOT,
    APPDATA_ROOT,
    TEMP_ROOT,
    DB_PATH: env.DB_PATH || join(APPDATA_ROOT, 'webincloud.sqlite'),
    AVATARS_DIR: env.AVATARS_DIR || join(APPDATA_ROOT, 'avatars'),
    THUMBNAILS_DIR: env.THUMBNAILS_DIR || join(TEMP_ROOT, 'thumbnails'),
    FFMPEG_PATH: env.FFMPEG_PATH || 'ffmpeg',
    BRANDING_DIR: env.BRANDING_DIR || join(APPDATA_ROOT, 'branding'),
    BRAND: brand,
    BRANDING_PACKS_DIR: brandingPacks,
    // The brand's own logos, unless a folder is forced.
    DEFAULT_BRANDING_DIR: env.DEFAULT_BRANDING_DIR || join(brandingPacks, brand.id),
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
    APP_TITLE: env.APP_TITLE || brand.title,
    APP_NAME: env.APP_NAME || brand.name,
    MAXMIND_LICENSE_KEY: env.MAXMIND_LICENSE_KEY || undefined,
    GEOIP_DIR: env.GEOIP_DIR || join(APPDATA_ROOT, 'geoip'),
    BACKEND_VERSION: backendVersion,
    IMAGE_REF: env.APP_IMAGE_REF || 'dev',
    IMAGE_REVISION: env.APP_IMAGE_REVISION || undefined,
    UPDATE_CHECK_ENABLED: env.DISABLE_UPDATE_CHECK !== 'true',
    TRUST_PROXY: trustProxy.trusted,
    TRUST_PROXY_SETTING: trustProxy.setting,
  };
}
