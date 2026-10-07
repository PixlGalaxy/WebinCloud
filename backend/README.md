# Webin Cloud — Backend

The API server behind Webin Cloud: accounts and sessions, per-folder permissions, file operations, share links, ZIP archives, thumbnails and the admin panel. It is an Express 5 app written in TypeScript, with SQLite (better-sqlite3) as its only datastore.

In the Docker image it runs on port `4000` behind nginx, which exposes it under `/backend/`. For how to deploy the whole app, see the [root README](../README.md).

## Requirements

- Node.js 22 or newer (the image uses Node 26)
- A C/C++ toolchain and Python, only if `better-sqlite3` or `argon2` has no prebuilt binary for your platform
- `ffmpeg` on the `PATH` (optional), for video thumbnails

## Getting started

```bash
cd backend
npm install
npm run dev
```

`npm run dev` starts the server with `tsx` in watch mode on `http://localhost:4000`. It reads `../.env` if one exists and restarts when the source, the locales or `.env` change.

Outside production, the data folders live at the repository root (`data/`, `appdata/`, `temp/`) and two test accounts are seeded on every boot:

| Username | Password | Role |
| --- | --- | --- |
| `admin` | `admin` | admin |
| `user` | `user` | user |

These accounts never exist when `NODE_ENV=production`.

Run the frontend's dev server at the same time (see [frontend/README.md](../frontend/README.md)); it proxies `/backend` to this server.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server with auto-reload |
| `npm run build` | Compiles to `dist/` and copies the SQL migrations next to it |
| `npm start` | Runs the compiled server (`dist/index.js`) |
| `npm run migrate` | Applies pending database migrations without starting the server |

There is no test suite yet. Type-check with `npx tsc --noEmit`.

## Configuration

All settings are environment variables; `.env.example` at the repository root lists them with their defaults. The most relevant ones for development:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `4000` | Port the API listens on |
| `HOST` | *(all interfaces; `127.0.0.1` in production)* | Interface the API listens on. Loopback in the container, so only the bundled nginx reaches it |
| `NODE_ENV` | `development` | `production` uses the container paths and disables the test accounts |
| `MAX_UPLOAD_MB` | `0` (no limit) | Largest single file an upload may carry, for users and public upload links. Also editable in Admin → Settings |
| `DATA_ROOT` | `../data` (`/data` in production) | Files users browse |
| `APPDATA_ROOT` | `../appdata` (`/appdata` in production) | SQLite database, avatars, branding, GeoIP cache |
| `TEMP_ROOT` | `../temp` (`/temp` in production) | Generated ZIPs and thumbnails |
| `LANGUAGE` | `en` | Default language: `en`, `es`, `fr` or `nl` |
| `FFMPEG_PATH` | `ffmpeg` | ffmpeg executable used for thumbnails |
| `TRUST_PROXY` | *(loopback only)* | Extra proxies trusted for `X-Forwarded-For`: `uniquelocal`, `linklocal`, `cloudflare`, IPs or CIDRs, comma-separated. Also editable in Admin → Settings |

Settings such as session lifetime, cookie security and rate limits can also be changed from **Admin Panel → Settings**. Values saved there take precedence over the environment once the backend restarts.

## Project layout

```
src/
  index.ts             entry point: loads config, migrates, seeds, starts the server
  app.ts               builds the Express app and mounts every router
  config/env.ts        environment variables and their defaults
  db/                  SQLite connection, migrations (*.sql) and the settings store
  middleware/          request logging, rate limiting, IP bans, errors
  i18n/                server-side translations (strings live in ../locales)
  modules/
    auth/              login, sessions, first-run setup, password hashing
    users/             user management (admin)
    permissions/       folder grants and the access checks used everywhere
    files/             browse, upload, download, edit, move, search, path safety
    archives/          background ZIP generation
    transfers/         background copy jobs
    shares/            share links and the anonymous public-share routes
    path-names/        aliases used in public share URLs
    thumbnails/        image/video thumbnails (ffmpeg)
    avatars/ branding/ profile pictures, logo and favicon
    admin/             dashboard metrics, settings, services, IP access
    logs/              in-memory log buffer and live log stream
```

Every module follows the same pattern: a `*.routes.ts` file with the Express router and a `*.service.ts` file with the logic.

## API overview

Everything is under `/api`. Signed-in requests are authenticated with the `session` cookie set by `POST /api/auth/login`.

| Prefix | Access | Purpose |
| --- | --- | --- |
| `/api/health`, `/api/config` | public | Health check and runtime UI settings |
| `/api/auth` | public / signed in | Login, logout, current user, password change, first-run setup |
| `/api/files` | signed in + folder grant | List, upload, download, preview, edit, rename, move, delete, search, change events (SSE) |
| `/api/archives` | signed in | Start, poll and download ZIP jobs |
| `/api/transfers` | signed in | Start and poll copy jobs |
| `/api/shares` | signed in | Manage your share links and path names |
| `/api/public/:segment/:name` | anyone with the link | Public share: info, unlock, list, download, ZIP, upload |
| `/api/avatars` | signed in | Profile pictures |
| `/api/branding` | public read, admin write | Logo, icon and favicon |
| `/api/users`, `/api/permissions`, `/api/logs`, `/api/admin` | admin | User and grant management, logs, dashboard, settings |

Errors are JSON objects of the form `{ "error": "<translated message>" }`. See [SECURITY.md](../SECURITY.md) for the access rules of each endpoint.

## Database migrations

Migrations are plain SQL files in `src/db/migrations`, named `NNNN_description.sql`. On startup the server applies every file with a number higher than the one stored in `schema_version`, each in its own transaction.

To change the schema, add a new file with the next number. Never edit a migration that has already been released.
