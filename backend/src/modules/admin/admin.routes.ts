import { Router } from 'express';
import type { Translate } from '../../i18n/index.js';
import type { EnvConfig } from '../../config/env.js';
import { badRequest, notFound, tooManyRequests } from '../../errors.js';
import { createAuthGuards } from '../auth/session.middleware.js';
import { isThemeMode, isThemeSkin } from '../auth/auth.service.js';
import { isLanguage } from '../../i18n/index.js';
import type { SettingsService } from '../../db/settings.js';
import { SETTINGS_KEYS } from './settings-keys.js';
import type { MetricsService } from './metrics.service.js';
import { getBackendStatus, getNginxStatus, restartBackend, restartNginx, tryConsumeRestartBudget } from './process-control.js';

function numberField(body: Record<string, unknown>, key: string, min: number, max: number): number | undefined {
  if (body[key] === undefined) return undefined;
  const value = Number(body[key]);
  if (!Number.isFinite(value) || value < min || value > max) throw badRequest('adminSettings.invalidValue');
  return Math.round(value);
}

export function createAdminRoutes(
  t: Translate,
  metrics: MetricsService,
  settings: SettingsService,
  config: EnvConfig,
  backendStartedAt: number,
): Router {
  const router = Router();
  const { requireAuth, requireAdmin } = createAuthGuards(t);

  router.use(requireAuth, requireAdmin);

  router.get('/metrics', (_req, res) => res.json(metrics.snapshot()));

  /** Server-sent events: a fresh snapshot every tick, so the dashboard never needs to poll or be refreshed by hand. */
  router.get('/metrics/stream', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 5000\n\n');
    res.write(`data: ${JSON.stringify(metrics.snapshot())}\n\n`);

    const unsubscribe = metrics.subscribe((snapshot) => res.write(`data: ${JSON.stringify(snapshot)}\n\n`));
    const heartbeat = setInterval(() => res.write(': ping\n\n'), 30_000);

    req.on('close', () => {
      unsubscribe();
      clearInterval(heartbeat);
    });
  });

  // Restart-tier fields: "active" is what the running process actually uses
  // right now (baked in at boot), "saved" is what's in the database. They only
  // differ right after an admin edits one, until the backend is restarted.
  router.get('/settings', (_req, res) => {
    const savedMaxmindKey = settings.getOptionalString(SETTINGS_KEYS.maxmindLicenseKey);
    const server = {
      sessionTtlHours: { active: config.SESSION_TTL_HOURS, saved: settings.getNumber(SETTINGS_KEYS.sessionTtlHours, config.SESSION_TTL_HOURS) },
      cookieSecure: { active: config.COOKIE_SECURE, saved: settings.getBoolean(SETTINGS_KEYS.cookieSecure, config.COOKIE_SECURE) },
      loginRateLimitMax: {
        active: config.LOGIN_RATE_LIMIT_MAX,
        saved: settings.getNumber(SETTINGS_KEYS.loginRateLimitMax, config.LOGIN_RATE_LIMIT_MAX),
      },
      loginRateLimitWindowMinutes: {
        active: config.LOGIN_RATE_LIMIT_WINDOW_MINUTES,
        saved: settings.getNumber(SETTINGS_KEYS.loginRateLimitWindowMinutes, config.LOGIN_RATE_LIMIT_WINDOW_MINUTES),
      },
      shareUnlockRateLimitMax: {
        active: config.SHARE_UNLOCK_RATE_LIMIT_MAX,
        saved: settings.getNumber(SETTINGS_KEYS.shareUnlockRateLimitMax, config.SHARE_UNLOCK_RATE_LIMIT_MAX),
      },
      shareUnlockRateLimitWindowMinutes: {
        active: config.SHARE_UNLOCK_RATE_LIMIT_WINDOW_MINUTES,
        saved: settings.getNumber(
          SETTINGS_KEYS.shareUnlockRateLimitWindowMinutes,
          config.SHARE_UNLOCK_RATE_LIMIT_WINDOW_MINUTES,
        ),
      },
      archiveAbandonSeconds: {
        active: config.ARCHIVE_ABANDON_SECONDS,
        saved: settings.getNumber(SETTINGS_KEYS.archiveAbandonSeconds, config.ARCHIVE_ABANDON_SECONDS),
      },
    };
    const restartRequired =
      Object.values(server).some((field) => field.active !== field.saved) ||
      (savedMaxmindKey ?? '') !== (config.MAXMIND_LICENSE_KEY ?? '');

    res.json({
      server,
      maxmindLicenseKeyActive: Boolean(config.MAXMIND_LICENSE_KEY),
      maxmindLicenseKeySaved: Boolean(savedMaxmindKey),
      restartRequired,
      appTitle: settings.getString(SETTINGS_KEYS.appTitle, config.APP_TITLE),
      appName: settings.getString(SETTINGS_KEYS.appName, config.APP_NAME),
      defaultThemeMode: settings.getString(SETTINGS_KEYS.defaultThemeMode, 'dark'),
      defaultThemeSkin: settings.getString(SETTINGS_KEYS.defaultThemeSkin, 'default'),
      defaultLanguage: settings.getString(SETTINGS_KEYS.defaultLanguage, config.LANGUAGE),
    });
  });

  router.patch('/settings', (req, res) => {
    const body = req.body as Record<string, unknown>;

    const sessionTtlHours = numberField(body, 'sessionTtlHours', 1, 720);
    if (sessionTtlHours !== undefined) settings.set(SETTINGS_KEYS.sessionTtlHours, String(sessionTtlHours));

    if (body.cookieSecure !== undefined) {
      if (typeof body.cookieSecure !== 'boolean') throw badRequest('adminSettings.invalidValue');
      settings.set(SETTINGS_KEYS.cookieSecure, String(body.cookieSecure));
    }

    const loginRateLimitMax = numberField(body, 'loginRateLimitMax', 1, 1000);
    if (loginRateLimitMax !== undefined) settings.set(SETTINGS_KEYS.loginRateLimitMax, String(loginRateLimitMax));

    const loginRateLimitWindowMinutes = numberField(body, 'loginRateLimitWindowMinutes', 1, 1440);
    if (loginRateLimitWindowMinutes !== undefined) {
      settings.set(SETTINGS_KEYS.loginRateLimitWindowMinutes, String(loginRateLimitWindowMinutes));
    }

    const shareUnlockRateLimitMax = numberField(body, 'shareUnlockRateLimitMax', 1, 1000);
    if (shareUnlockRateLimitMax !== undefined) {
      settings.set(SETTINGS_KEYS.shareUnlockRateLimitMax, String(shareUnlockRateLimitMax));
    }

    const shareUnlockRateLimitWindowMinutes = numberField(body, 'shareUnlockRateLimitWindowMinutes', 1, 1440);
    if (shareUnlockRateLimitWindowMinutes !== undefined) {
      settings.set(SETTINGS_KEYS.shareUnlockRateLimitWindowMinutes, String(shareUnlockRateLimitWindowMinutes));
    }

    const archiveAbandonSeconds = numberField(body, 'archiveAbandonSeconds', 5, 3600);
    if (archiveAbandonSeconds !== undefined) settings.set(SETTINGS_KEYS.archiveAbandonSeconds, String(archiveAbandonSeconds));

    if (body.maxmindLicenseKey !== undefined) {
      if (typeof body.maxmindLicenseKey !== 'string') throw badRequest('adminSettings.invalidValue');
      if (body.maxmindLicenseKey === '') settings.delete(SETTINGS_KEYS.maxmindLicenseKey);
      else settings.set(SETTINGS_KEYS.maxmindLicenseKey, body.maxmindLicenseKey);
    }

    if (body.appTitle !== undefined) {
      if (typeof body.appTitle !== 'string' || !body.appTitle.trim() || body.appTitle.length > 100) {
        throw badRequest('adminSettings.invalidValue');
      }
      settings.set(SETTINGS_KEYS.appTitle, body.appTitle.trim());
    }

    if (body.appName !== undefined) {
      if (typeof body.appName !== 'string' || !body.appName.trim() || body.appName.length > 100) {
        throw badRequest('adminSettings.invalidValue');
      }
      settings.set(SETTINGS_KEYS.appName, body.appName.trim());
    }

    if (body.defaultThemeMode !== undefined) {
      if (!isThemeMode(body.defaultThemeMode)) throw badRequest('adminSettings.invalidValue');
      settings.set(SETTINGS_KEYS.defaultThemeMode, body.defaultThemeMode);
    }

    if (body.defaultThemeSkin !== undefined) {
      if (!isThemeSkin(body.defaultThemeSkin)) throw badRequest('adminSettings.invalidValue');
      settings.set(SETTINGS_KEYS.defaultThemeSkin, body.defaultThemeSkin);
    }

    if (body.defaultLanguage !== undefined) {
      if (typeof body.defaultLanguage !== 'string' || !isLanguage(body.defaultLanguage)) {
        throw badRequest('adminSettings.invalidValue');
      }
      settings.set(SETTINGS_KEYS.defaultLanguage, body.defaultLanguage);
    }

    res.json({ success: true });
  });

  router.get('/services', (_req, res) => {
    res.json({
      backend: getBackendStatus(backendStartedAt),
      frontend: getNginxStatus(),
    });
  });

  router.post('/services/:service/restart', (req, res) => {
    const service = req.params.service;
    if (service !== 'backend' && service !== 'frontend') throw notFound('adminSettings.unknownService');

    // DB-backed, not in-memory — see tryConsumeRestartBudget for why a backend
    // restart can't be allowed to wipe its own throttle.
    if (!tryConsumeRestartBudget(settings, service)) throw tooManyRequests(5 * 60);

    if (service === 'backend') {
      res.json({ success: true });
      restartBackend();
      return;
    }
    if (!restartNginx()) throw badRequest('adminSettings.serviceRestartFailed');
    return res.json({ success: true });
  });

  return router;
}
