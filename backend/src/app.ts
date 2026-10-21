import express from 'express';
import type { IncomingMessage, Server } from 'http';
import cookieParser from 'cookie-parser';
import type { Db } from './db/client.js';
import type { EnvConfig } from './config/env.js';
import { getOrCreateSecret, SettingsService } from './db/settings.js';
import { SETTINGS_KEYS } from './modules/admin/settings-keys.js';
import { createTranslator } from './i18n/index.js';
import { requestLogger } from './middleware/request-logger.js';
import { createSessionMiddleware } from './modules/auth/session.middleware.js';
import { createAuthRoutes } from './modules/auth/auth.routes.js';
import { AuthService } from './modules/auth/auth.service.js';
import { DevicesService } from './modules/devices/devices.service.js';
import { createDevicesRoutes } from './modules/devices/devices.routes.js';
import { changes } from './modules/devices/change-bus.js';
import { hashPassword, verifyPassword } from './modules/auth/password.js';
import { createUsersRoutes } from './modules/users/users.routes.js';
import { createLogsRoutes } from './modules/logs/logs.routes.js';
import { createAvatarsRoutes, ensureAvatarsDir } from './modules/avatars/avatars.routes.js';
import { createPermissionsRoutes } from './modules/permissions/permissions.routes.js';
import { createFilesRoutes } from './modules/files/files.routes.js';
import { ThumbnailService } from './modules/thumbnails/thumbnails.service.js';
import { ArchivesService } from './modules/archives/archives.service.js';
import { createArchivesRoutes } from './modules/archives/archives.routes.js';
import { TransfersService } from './modules/transfers/transfers.service.js';
import { createTransfersRoutes } from './modules/transfers/transfers.routes.js';
import { createBrandingRoutes, prepareBranding } from './modules/branding/branding.routes.js';
import { SharesService } from './modules/shares/shares.service.js';
import { createSharesRoutes } from './modules/shares/shares.routes.js';
import { createPublicPathResolver, createPublicShareRoutes } from './modules/shares/public-shares.routes.js';
import { createErrorHandler, createNotFoundHandler } from './middleware/error-handler.js';
import { GeoipService } from './modules/admin/geoip.service.js';
import { MetricsService } from './modules/admin/metrics.service.js';
import { createConnectionTracker } from './middleware/connection-tracker.js';
import { createAdminRoutes } from './modules/admin/admin.routes.js';
import { UpdateCheckService } from './modules/admin/update-check.service.js';
import { IpBansService } from './modules/admin/ip-bans.service.js';
import { createIpBanMiddleware } from './middleware/ip-ban.js';
import { rejectCrossSiteWrites } from './middleware/csrf.js';
import { createIpAccessRoutes } from './modules/admin/ip-access.routes.js';
import { attachUploadSocket, type SocketIdentity } from './modules/files/upload-socket.js';
import { recoverUploads } from './modules/files/upload-sessions.js';
import { join } from 'path';
import { SHARE_COOKIE_PREFIX } from './modules/shares/shares.service.js';
import { forbidden, notFound, unauthorized } from './errors.js';
import type { Share } from './types/index.js';

export interface App {
  app: express.Application;
  /** Takes over WebSocket upgrades on the listening server, for chunked uploads. */
  attachSockets(server: Server): void;
}

export function createApp(db: Db, config: EnvConfig): App {
  const app = express();
  const t = createTranslator(config.LOCALES_DIR, config.LANGUAGE);
  const shares = new SharesService(
    db,
    config.DATA_ROOT,
    getOrCreateSecret(db, 'share_unlock_secret'),
    hashPassword,
    verifyPassword,
  );
  const archives = new ArchivesService(
    db,
    config.DATA_ROOT,
    config.TEMP_ROOT,
    config.ARCHIVE_ABANDON_SECONDS * 1000,
  );
  void archives.sweep();

  const thumbnails = ThumbnailService.fromConfig(config);
  void thumbnails.detect();
  void thumbnails.sweep();
  setInterval(() => void thumbnails.sweep(), 24 * 60 * 60 * 1000).unref();
  // Frees compressions whose client closed the tab or lost connection. Checked
  // several times per window, so abandonment is never missed between ticks.
  const abandonCheckMs = Math.max(1000, Math.min(10_000, (config.ARCHIVE_ABANDON_SECONDS * 1000) / 3));
  setInterval(() => void archives.dropAbandoned(), abandonCheckMs).unref();

  // Uploads cut short by the last restart left their partial files in users' folders.
  void recoverUploads(join(config.APPDATA_ROOT, 'uploads-in-progress.json'), config.DATA_ROOT);

  const transfers = new TransfersService(db, config.DATA_ROOT, config.ARCHIVE_ABANDON_SECONDS * 1000);
  setInterval(() => transfers.dropAbandoned(), abandonCheckMs).unref();
  setInterval(() => transfers.sweep(), 15 * 60 * 1000).unref();

  const geoip = new GeoipService(config);
  void geoip.init();
  const metrics = new MetricsService(geoip);
  const settings = new SettingsService(db);
  const backendStartedAt = Date.now();
  const updateCheck = new UpdateCheckService(config.IMAGE_REVISION, config.UPDATE_CHECK_ENABLED);
  const ipBans = new IpBansService(db);

  // The bundled nginx (loopback) plus any outer proxies from TRUST_PROXY, so
  // req.ip is the visitor's address rather than the proxy's.
  app.set('trust proxy', config.TRUST_PROXY);
  app.disable('x-powered-by');
  // Before anything else — a banned IP shouldn't get session/cookie handling, let alone a route.
  app.use(createIpBanMiddleware(ipBans));
  app.use(rejectCrossSiteWrites);
  app.use(requestLogger);
  // Only the text editor's save needs a big body (files up to 2 MB, more once
  // JSON-escaped); everything else, including anonymous login and unlock, gets 1 MB.
  const largeJson = express.json({ limit: '10mb' });
  const smallJson = express.json({ limit: '1mb' });
  app.use((req, res, next) => (req.path === '/api/files/content' ? largeJson : smallJson)(req, res, next));
  app.use(cookieParser());
  const devices = new DevicesService(db);
  changes.init(config.DATA_ROOT);
  devices.pruneExpired();
  app.use(createSessionMiddleware(db, config.SESSION_TTL_HOURS, devices));
  // After the session middleware so req.user/req.session are already resolved.
  app.use(createConnectionTracker(metrics));

  prepareBranding(config);
  app.use('/api/branding', createBrandingRoutes(config, t));

  app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
  // Lets the static frontend pick up runtime settings without a rebuild. Title,
  // app name and default appearance are read fresh here (not baked into
  // `config`), so an admin panel edit takes effect on the very next request.
  app.get('/api/config', (_req, res) =>
    res.json({
      language: settings.getString(SETTINGS_KEYS.defaultLanguage, config.LANGUAGE),
      appName: settings.getString(SETTINGS_KEYS.appName, config.APP_NAME),
      appTitle: settings.getString(SETTINGS_KEYS.appTitle, config.APP_TITLE),
      // The product, set only by BRANDING: unlike the names above, the admin panel cannot change it.
      brand: config.BRAND.title,
      defaultThemeMode: settings.getString(SETTINGS_KEYS.defaultThemeMode, 'dark'),
      defaultThemeSkin: settings.getString(SETTINGS_KEYS.defaultThemeSkin, 'default'),
      // Only a display default: hidden entries are still listed by the API and
      // reachable by anyone with access; each user can override it in Settings.
      showHiddenFiles: settings.getBoolean(SETTINGS_KEYS.showHiddenFiles, false),
      // A session dies at SESSION_TTL_HOURS regardless of activity, so an
      // inactivity timeout longer than that would never actually trigger.
      maxAutoSignoutMinutes: config.SESSION_TTL_HOURS * 60,
    }),
  );

  // Anonymous: everything below is reachable with just the link.
  const { router: publicShareRoutes, unlockIpLimiter } = createPublicShareRoutes(config, shares, archives);
  app.use(createPublicPathResolver(shares));
  app.use('/api/public/:segment/:name', publicShareRoutes);

  const { router: authRoutes, loginIpLimiter, loginAccountLimiter } = createAuthRoutes(db, config, t, metrics);
  app.use('/api/auth', authRoutes);
  app.use(
    '/api/devices',
    createDevicesRoutes(db, devices, new AuthService(db, config.SESSION_TTL_HOURS), t, loginIpLimiter, loginAccountLimiter),
  );
  app.use('/api/users', createUsersRoutes(db, t, metrics, devices));
  app.use('/api/logs', createLogsRoutes(t));
  ensureAvatarsDir(config);
  app.use('/api/avatars', createAvatarsRoutes(db, config, t));
  app.use('/api/permissions', createPermissionsRoutes(db, config, t));
  app.use('/api/files', createFilesRoutes(db, config, t, thumbnails));

  // Keeps the temp volume from growing without bound on a long-lived server.
  setInterval(() => void archives.sweep(), 15 * 60 * 1000).unref();
  // Links whose file or folder is gone: flagged, then removed after 48 hours.
  shares.sweepMissing();
  setInterval(() => shares.sweepMissing(), 15 * 60 * 1000).unref();
  app.use('/api/archives', createArchivesRoutes(t, archives));
  app.use('/api/transfers', createTransfersRoutes(t, transfers));

  app.use('/api/shares', createSharesRoutes(db, config, t, shares));

  app.use('/api/admin', createAdminRoutes(t, metrics, settings, config, backendStartedAt, updateCheck));
  app.use('/api/admin/ip-access', createIpAccessRoutes(t, loginIpLimiter, loginAccountLimiter, unlockIpLimiter, ipBans));

  app.use(createNotFoundHandler(t));
  app.use(createErrorHandler(t));

  // Upload sockets never pass through Express, so they get the same checks by hand:
  // banned IPs, the session or device (or the link and its unlock cookie), and whether
  // that sign-in may still upload, re-checked while the socket stays open.
  const sessionAuth = new AuthService(db, config.SESSION_TTL_HOURS);
  const parseCookies = cookieParser();

  const authenticateSocket = (raw: IncomingMessage, link: string[] | null): SocketIdentity => {
    // Express's own request object, so req.ip honours the trusted proxies exactly as for HTTP.
    Object.setPrototypeOf(raw, app.request);
    const req = raw as express.Request;
    parseCookies(req, {} as express.Response, () => undefined);
    const ip = req.ip ?? 'unknown';
    if (ipBans.isBanned(ip)) throw forbidden('error.ipBanned');

    const track = (id: string, info: { kind: 'user'; username: string } | { kind: 'public' }) => {
      metrics.recordActivity(id, { ip, activity: 'uploading', ...info });
      return true;
    };

    if (!link) {
      const bearer = /^Bearer\s+(\S+)$/i.exec(req.get('authorization') ?? '');
      if (bearer) {
        const result = devices.authenticate(bearer[1], ip);
        if (!result) throw unauthorized();
        const { user, device } = result;
        track(`device:${device.id}`, { kind: 'user', username: user.username });
        return {
          owner: `user:${user.id}`,
          key: `user:${user.id}`,
          stillAllowed: () =>
            !ipBans.isBanned(ip) &&
            devices.isSignedIn(device.id) &&
            track(`device:${device.id}`, { kind: 'user', username: user.username }),
        };
      }

      const token: unknown = req.cookies?.session;
      const signedIn = typeof token === 'string' && token ? sessionAuth.getSessionByToken(token) : null;
      if (!signedIn) throw unauthorized();
      // A session still on the default password may do nothing but fix it.
      if (signedIn.session.pending_action) throw forbidden();
      const { user, session } = signedIn;
      track(`session:${session.id}`, { kind: 'user', username: user.username });
      return {
        owner: `user:${user.id}`,
        key: `user:${user.id}`,
        stillAllowed: () => {
          const current = sessionAuth.getSessionByToken(token as string);
          return (
            !!current &&
            !current.session.pending_action &&
            !ipBans.isBanned(ip) &&
            track(`session:${session.id}`, { kind: 'user', username: user.username })
          );
        },
      };
    }

    // A token link (<id>/<name>) or a path-name link (<alias>/<folders...>), as the HTTP routes resolve them.
    let share = link.length === 2 ? shares.findPublic(link[0], link[1]) : null;
    if (!share && link.length >= 2) {
      const match = shares.findPublicByPath(link[0], link.slice(1));
      if (match && 1 + match.consumed === link.length) share = match.share;
    }
    if (!share) throw notFound();

    const unlock: unknown = req.cookies?.[SHARE_COOKIE_PREFIX + share.id];
    const canUpload = (current: Share) => {
      try {
        shares.assertUsable(current);
      } catch {
        return false;
      }
      return (
        current.allow_upload === 1 &&
        current.target_type === 'folder' &&
        shares.ownerAccess(current, current.target_path).write &&
        shares.isUnlocked(current, typeof unlock === 'string' ? unlock : undefined)
      );
    };
    if (!canUpload(share)) throw forbidden();

    const shareId = share.id;
    const visitor = `anon:${ip}:${link[0]}/${link[1]}`;
    track(visitor, { kind: 'public' });
    return {
      owner: `share:${shareId}`,
      key: `share:${shareId}:${ip}`,
      stillAllowed: () => {
        const current = shares.findById(shareId);
        return !!current && canUpload(current) && !ipBans.isBanned(ip) && track(visitor, { kind: 'public' });
      },
    };
  };

  return {
    app,
    attachSockets: (server) => attachUploadSocket(server, { t, authenticate: authenticateSocket }),
  };
}
