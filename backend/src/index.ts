import { mkdirSync } from 'fs';
import { loadEnv } from './config/env.js';
import { initializeDb } from './db/client.js';
import { runMigrations } from './db/migrate.js';
import { SettingsService } from './db/settings.js';
import { SETTINGS_KEYS } from './modules/admin/settings-keys.js';
import { bootstrapAdmin } from './modules/auth/bootstrap.js';
import { seedDevUsers } from './modules/auth/dev-seed.js';
import { PathNamesService } from './modules/path-names/path-names.service.js';
import type { User } from './types/index.js';
import { createApp } from './app.js';
import { startFrontendLogTailer } from './modules/logs/frontend-log-tailer.js';
import { logger } from './logger.js';

async function main() {
  let config = loadEnv();

  mkdirSync(config.APPDATA_ROOT, { recursive: true });
  mkdirSync(config.DATA_ROOT, { recursive: true });
  mkdirSync(config.TEMP_ROOT, { recursive: true });
  mkdirSync(config.AVATARS_DIR, { recursive: true });

  const db = initializeDb(config.DB_PATH);
  runMigrations(db);

  // Admin-panel overrides for the settings that are baked into closures at
  // startup (rate limiters, session TTL, archive cleanup, GeoIP) — anything an
  // admin has saved from Settings wins over the env default from here on,
  // until the next restart re-reads it the same way.
  const settings = new SettingsService(db);
  config = {
    ...config,
    SESSION_TTL_HOURS: settings.getNumber(SETTINGS_KEYS.sessionTtlHours, config.SESSION_TTL_HOURS),
    COOKIE_SECURE: settings.getBoolean(SETTINGS_KEYS.cookieSecure, config.COOKIE_SECURE),
    LOGIN_RATE_LIMIT_MAX: settings.getNumber(SETTINGS_KEYS.loginRateLimitMax, config.LOGIN_RATE_LIMIT_MAX),
    LOGIN_RATE_LIMIT_WINDOW_MINUTES: settings.getNumber(
      SETTINGS_KEYS.loginRateLimitWindowMinutes,
      config.LOGIN_RATE_LIMIT_WINDOW_MINUTES,
    ),
    SHARE_UNLOCK_RATE_LIMIT_MAX: settings.getNumber(SETTINGS_KEYS.shareUnlockRateLimitMax, config.SHARE_UNLOCK_RATE_LIMIT_MAX),
    SHARE_UNLOCK_RATE_LIMIT_WINDOW_MINUTES: settings.getNumber(
      SETTINGS_KEYS.shareUnlockRateLimitWindowMinutes,
      config.SHARE_UNLOCK_RATE_LIMIT_WINDOW_MINUTES,
    ),
    ARCHIVE_ABANDON_SECONDS: settings.getNumber(SETTINGS_KEYS.archiveAbandonSeconds, config.ARCHIVE_ABANDON_SECONDS),
    MAXMIND_LICENSE_KEY: settings.getOptionalString(SETTINGS_KEYS.maxmindLicenseKey) ?? config.MAXMIND_LICENSE_KEY,
  };

  await bootstrapAdmin(db);
  await seedDevUsers(db, config);

  // Covers accounts that existed before path names were introduced.
  const pathNames = new PathNamesService(db);
  for (const user of db.prepare('SELECT id, username FROM users').all() as Pick<User, 'id' | 'username'>[]) {
    pathNames.ensureDefault(user.id, user.username);
  }

  startFrontendLogTailer();

  createApp(db, config).listen(config.PORT, () => {
    logger.info(`Listening on port ${config.PORT} (${config.NODE_ENV})`);
    logger.info(`Data root: ${config.DATA_ROOT}`);
    logger.info(`App data root: ${config.APPDATA_ROOT}`);
    const outer = config.TRUST_PROXY.filter((entry) => entry !== 'loopback');
    logger.info(
      outer.length > 0
        ? `Trusted proxies: loopback, ${outer.length > 4 ? `${outer.slice(0, 4).join(', ')} (+${outer.length - 4} more)` : outer.join(', ')}`
        : 'Trusted proxies: loopback only (set TRUST_PROXY when running behind another reverse proxy)',
    );
  });
}

main().catch((err) => {
  logger.error('Fatal error during startup', err);
  process.exit(1);
});
