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
      PUID: 99
      PGID: 100
      UMASK: "002"
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

## File ownership

The backend runs as an unprivileged user, never as root, so everything it creates in `/data` belongs to a user your host knows. That matters when the same folders are also reached another way, such as an SMB share on a NAS.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PUID` | `99` | User id that owns the files the app creates |
| `PGID` | `100` | Group id that owns them |
| `UMASK` | `002` | Permissions for new files: `002` gives `rw` to the owner and the group (folders `775`, files `664`) |

The defaults are `nobody:users`, what Unraid uses for its shares, so on Unraid nothing needs changing: every Unraid user is in the `users` group and can edit what the app writes over SMB. Elsewhere, set them to your own user, which `id` prints (often `1000`). Set `UMASK` to `000` if users outside the group must write too, and `PUID=0` to go back to running as root.

`/appdata` and `/temp` are handed to that user on every start. `/data` is your content and is never changed, except an empty folder, which is simply taken over. If it is not writable, the container log says so at startup.

**Upgrading from a version that ran as root:** files the app already created belong to root, and it can no longer modify them. Give them to `PUID:PGID` once on the host: on Unraid, **Tools → Docker Safe New Permissions** on the share; elsewhere, `chown -R 99:100 /path/to/files && chmod -R u+rwX,g+rwX /path/to/files`.

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

Because that password is public, it is only accepted from the server's local network (private and loopback addresses), so nobody on the internet can claim a fresh install before you do. Behind a reverse proxy this holds even before the trusted proxies are set: every address the request carries must be local. Do the first sign-in from a device on the same network.

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
- Live views (the dashboard, logs and folder refreshes) use event streams. The container marks them with `X-Accel-Buffering: no`, so nginx-based proxies such as Nginx Proxy Manager stream them without extra configuration. For other proxies, turn off response buffering for `/backend/`; if a proxy still holds the stream back, the dashboard falls back to refreshing once a second.
- Set the trusted proxies so the app sees each visitor's real IP instead of the proxy's (see below).

### Real client IPs

Behind another proxy, every request reaches the container from that proxy, so the admin dashboard, the login rate limit and IP bans would all see the proxy's address (for example `192.168.x.x`). Fix it in **Admin Panel → Settings → Trusted proxies**, listing the proxies allowed to report the real client IP through the `X-Forwarded-For` header, then restart the backend from **Services**. The field also shows the IP the server currently sees for you, so you can check the result.

| Setup | Value |
| --- | --- |
| Nginx Proxy Manager, Traefik, Caddy, etc. on the same host or LAN | `uniquelocal` |
| The same, with the domain proxied through Cloudflare (orange cloud) | `uniquelocal, cloudflare` |
| A specific proxy address or range | `192.168.69.10` or `192.168.69.0/24` |

`uniquelocal` covers the private ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `fc00::/7`), which includes Docker networks. Entries are comma-separated, and the bundled nginx is always trusted. Only list proxies you control: a trusted address can claim to be any client. The backend logs the trusted proxies at startup.

For a first boot, the same value can be given as the `TRUST_PROXY` environment variable (`TRUST_PROXY: uniquelocal`). Once it is saved in the panel, the panel's value wins.

## Notes

- Accounts, permissions and share links live in SQLite inside `/appdata`. Back up that volume and you have backed up the configuration.
- ZIP files are written to `/temp` and removed once they are old or once the browser that requested them goes away, so the volume does not grow on its own.
- Share links are public by design: anyone holding the link can open it, subject to the password and expiry you set.
