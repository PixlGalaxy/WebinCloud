# Webin Cloud Server

A self-hosted web server for your files. Point it at a folder, open it in a browser, and you have a file manager with accounts, per-folder permissions, in-browser previews and public share links.

It is a good fit when you want to:

- Put a NAS or any disk on the network and browse it from a browser, with no FTP or SMB client.
- Give other people access to specific folders, each with their own account and read or write permission.
- Hand out a link to a file or a folder, with an optional password and expiry date.
- Serve files at stable, predictable URLs for your own apps to consume.

Everything runs in a single container: an nginx front end and a Node.js backend, with SQLite for accounts and permissions. There is no external database to run.

## Features

- Accounts with an administrator role; the admin creates users and grants them folders as read-only or read-write.
- File manager: upload by drag and drop with progress, download, create folders, rename, delete.
- Recursive search from any folder, showing the full path of each match.
- In-browser preview for images, PDF, video, audio and text, with syntax highlighting and an editor for text files.
- Optional thumbnails of images and videos in the file list, loaded as you scroll, with a larger preview on hover.
- Share links for a file or a folder, with optional password, optional expiry (never by default), and download and upload permissions handled separately.
- ZIP downloads: pick several items, or a whole folder, and the archive is built in the background while you keep browsing.
- English and Spanish, light and dark theme, and a replaceable logo and favicon.

## Running it

```
docker run -d \
  --name webincloud \
  -p 8080:80 \
  -v WebinCloud_Data:/data \
  -v WebinCloud_AppData:/appdata \
  -v WebinCloud_Temp:/temp \
  --restart unless-stopped \
  ghcr.io/pixlgalaxy/webincloud:latest
```

Open `http://localhost:8080` and sign in with `admin` / `changeme`. That exact pair only ever works once: on first login you're immediately asked to choose a new username, email and password, and then the app continues normally. This is the default first-run bootstrap account for a fresh install.

Note: when running the app from source during local development, the app intentionally seeds `admin` / `admin` and `user` / `user` so it is easy to test without a production setup. Those dev credentials are only for development and are reset on each boot; they are not the same as the first-run `admin` / `changeme` account used in a real deployment.

To serve an existing directory instead of a Docker volume, bind it:

```
-v /srv/files:/data
```

### With docker compose

```yaml
services:
  webincloud:
    image: ghcr.io/pixlgalaxy/webincloud:latest
    container_name: webincloud
    restart: unless-stopped
    ports:
      - "8080:80"
    environment:
      LANGUAGE: en
    volumes:
      - WebinCloud_Data:/data
      - WebinCloud_AppData:/appdata
      - WebinCloud_Temp:/temp

volumes:
  WebinCloud_Data:
  WebinCloud_AppData:
  WebinCloud_Temp:
```

## Volumes

| Mount point | Suggested volume | What it holds | Safe to delete |
| --- | --- | --- | --- |
| `/data` | `WebinCloud_Data` | The files your users see and manage. Bind an existing directory here to serve it. | No, this is your content |
| `/appdata` | `WebinCloud_AppData` | SQLite database with accounts, permissions and share links, plus the replaceable logo and icons. Users never browse this. | No, you lose accounts and links |
| `/temp` | `WebinCloud_Temp` | Generated ZIP files, cleaned up automatically. | Yes, at any time |

Inside the container:

```
/data                     files your users see
/appdata
  webincloud.sqlite       accounts, permissions, share links
  branding/               logo.png, icon.png, favicon.ico
/temp                     generated archives, disposable
```

## Configuration

Almost everything is configured from **Admin Panel → Settings** once the app is running — app title, app name, default theme, the logo/icon/favicon, session lifetime, cookie security, rate limits, and more.

`.env` is now only for the very first boot's starting values, before the panel has anything saved. See `.env.example` for the full list with defaults.

The logo and icons can still be replaced from the filesystem instead of the panel, if you prefer: they live in `/appdata/branding` (`logo.png`, `icon.png`, `favicon.ico`), and a reload picks up any change.

```
docker cp my-logo.png webincloud:/appdata/branding/logo.png
```

Translations live in `locales/*.json`. English and Spanish are written and maintained by the project's author, a native speaker of both. The rest (currently French and Dutch) were machine-translated by volunteers and may need improvement.

### The admin account

There's no `ADMIN_EMAIL`/`ADMIN_USERNAME`/`ADMIN_PASSWORD` — a real password has no business sitting in plaintext in an env var. The first boot always seeds `admin` / `changeme`, and that exact pair only ever works once. After that, you must complete the setup flow and pick a new username, email and password.

For local development, the app may also seed `admin` / `admin` and `user` / `user` intentionally so you can log in quickly in a test environment. Those are development-only credentials and do not affect production deployments.

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATA_ROOT` | `/data` | Files the users browse |
| `APPDATA_ROOT` | `/appdata` | SQLite database and app metadata |
| `TEMP_ROOT` | `/temp` | Temporary ZIP and scratch files |

## Behind a reverse proxy

The container listens on port 80 and serves the interface at `/` and its API under `/backend/`. When putting it behind another proxy, forward the whole host and keep these in mind:

- Set `COOKIE_SECURE=true` once you terminate TLS, so the session cookie is marked `Secure`.
- Disable request buffering and raise the body size limit, or large uploads will fail.
- Do not buffer responses: the file browser uses an event stream to refresh when a folder changes.
- Set `TRUST_PROXY` so the app sees each visitor's real IP instead of the proxy's (see below).

### Real client IPs

Behind another proxy, every request reaches the container from that proxy, so the admin dashboard, the login rate limit and IP bans would all see the proxy's address (for example `192.168.x.x`). `TRUST_PROXY` lists the proxies allowed to report the real client IP through the `X-Forwarded-For` header:

| Setup | Value |
| --- | --- |
| Nginx Proxy Manager, Traefik, Caddy, etc. on the same host or LAN | `TRUST_PROXY=uniquelocal` |
| The same, with the domain proxied through Cloudflare (orange cloud) | `TRUST_PROXY=uniquelocal,cloudflare` |
| A specific proxy address or range | `TRUST_PROXY=192.168.69.10` or `TRUST_PROXY=192.168.69.0/24` |

`uniquelocal` covers the private ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `fc00::/7`), which includes Docker networks. Entries are comma-separated, and the bundled nginx is always trusted. Only list proxies you control: a trusted address can claim to be any client. Restart the container after changing it; the backend logs the trusted proxies at startup.

```yaml
    environment:
      TRUST_PROXY: uniquelocal
```

## Notes

- Accounts, permissions and share links live in SQLite inside `/appdata`. Back up that volume and you have backed up the configuration.
- ZIP files are written to `/temp` and removed once they are old or once the browser that requested them goes away, so the volume does not grow on its own.
- Share links are public by design: anyone holding the link can open it, subject to the password and expiry you set.
