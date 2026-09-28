/**
 * `app_settings` row keys for admin-editable configuration. Centralized here so
 * `index.ts` (the startup overlay), `admin.routes.ts` (the settings API) and
 * `app.ts` (the live-tier reads in `/api/config`) all agree on the same names.
 */
export const SETTINGS_KEYS = {
  // Restart-tier: baked into closures/constructors at boot, so an admin edit
  // only takes effect after `POST /api/admin/services/backend/restart`.
  sessionTtlHours: 'session_ttl_hours',
  cookieSecure: 'cookie_secure',
  loginRateLimitMax: 'login_rate_limit_max',
  loginRateLimitWindowMinutes: 'login_rate_limit_window_minutes',
  shareUnlockRateLimitMax: 'share_unlock_rate_limit_max',
  shareUnlockRateLimitWindowMinutes: 'share_unlock_rate_limit_window_minutes',
  archiveAbandonSeconds: 'archive_abandon_seconds',
  maxmindLicenseKey: 'maxmind_license_key',

  // Live-tier: read fresh on every `/api/config` request, no restart needed.
  appTitle: 'app_title',
  appName: 'app_name',
  defaultThemeMode: 'default_theme_mode',
  defaultThemeSkin: 'default_theme_skin',
  /** Language shown on signed-out screens (login, public share links) and new accounts' initial language. */
  defaultLanguage: 'default_language',
} as const;

export const RESTART_TIER_KEYS = [
  SETTINGS_KEYS.sessionTtlHours,
  SETTINGS_KEYS.cookieSecure,
  SETTINGS_KEYS.loginRateLimitMax,
  SETTINGS_KEYS.loginRateLimitWindowMinutes,
  SETTINGS_KEYS.shareUnlockRateLimitMax,
  SETTINGS_KEYS.shareUnlockRateLimitWindowMinutes,
  SETTINGS_KEYS.archiveAbandonSeconds,
  SETTINGS_KEYS.maxmindLicenseKey,
] as const;
