# Webin Cloud Server

A self-hosted web server for your files. Point it at a folder, open it in a browser, and you have a file manager with accounts, per-folder permissions, in-browser previews and public share links.

It is a good fit when you want to:

- Put a NAS or any disk on the network and browse it from a browser, with no FTP or SMB client.
- Give other people access to specific folders, each with their own account and read or write permission.
- Hand out a link to a file or folder, with an optional password and expiry date.
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
  -e ADMIN_EMAIL=admin@example.com \
  -e ADMIN_USERNAME=admin \
  -e ADMIN_PASSWORD=change-me \
  --restart unless-stopped \
  ghcr.io/pixlgalaxy/webincloud:latest
```

Open `http://localhost:8080` and sign in with the administrator account above. That account is created only on the first run, while the user table is still empty; changing the variables later has no effect, so set a real password from the start.

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
      ADMIN_EMAIL: admin@example.com
      ADMIN_USERNAME: admin
      ADMIN_PASSWORD: change-me
      LANGUAGE: en
      THEME: dark
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

Everything below is optional except the administrator account.

### Customization

| Variable | Default | Description |
| --- | --- | --- |
| `LANGUAGE` | `en` | Interface and API message language: `en` or `es` |
| `THEME` | `dark` | Default appearance: `dark` or `light`. A visitor's own toggle is remembered in a cookie and wins |
| `APP_TITLE` | `Webin Cloud Server` | Browser tab title |
| `APP_NAME` | `Webin Cloud` | Product name used in the interface |

The logo and icons are files rather than settings. Replace them in `/appdata/branding` (`logo.png`, `icon.png`, `favicon.ico`); the defaults are copied there on first boot and a reload picks up any change:

```
docker cp my-logo.png webincloud:/appdata/branding/logo.png
```

### Accounts and sessions

| Variable | Default | Description |
| --- | --- | --- |
| `ADMIN_EMAIL` | — | Administrator created on first run only |
| `ADMIN_USERNAME` | — | Administrator created on first run only |
| `ADMIN_PASSWORD` | — | Administrator created on first run only |
| `SESSION_TTL_HOURS` | `24` | Session lifetime |
| `COOKIE_SECURE` | `false` | Set to `true` only when serving over HTTPS, otherwise the session cookie is never returned |
| `LOGIN_RATE_LIMIT_MAX` | `10` | Max login attempts per IP and per account within the window below, before a 429 |
| `LOGIN_RATE_LIMIT_WINDOW_MINUTES` | `15` | Window for the login rate limit |
| `SHARE_UNLOCK_RATE_LIMIT_MAX` | `10` | Max password attempts per IP and per share link within the window below, before a 429 |
| `SHARE_UNLOCK_RATE_LIMIT_WINDOW_MINUTES` | `15` | Window for the share-unlock rate limit |

### Storage

| Variable | Default | Description |
| --- | --- | --- |
| `ARCHIVE_ABANDON_SECONDS` | `30` | Seconds without a progress poll before a running ZIP is cancelled and its partial file removed |
| `DATA_ROOT` | `/data` | Override only for a custom layout |
| `APPDATA_ROOT` | `/appdata` | Override only for a custom layout |
| `TEMP_ROOT` | `/temp` | Override only for a custom layout |

## Behind a reverse proxy

The container listens on port 80 and serves the interface at `/` and its API under `/backend/`. When putting it behind another proxy, forward the whole host and keep these in mind:

- Set `COOKIE_SECURE=true` once you terminate TLS, so the session cookie is marked `Secure`.
- Disable request buffering and raise the body size limit, or large uploads will fail.
- Do not buffer responses: the file browser uses an event stream to refresh when a folder changes.

## Notes

- Accounts, permissions and share links live in SQLite inside `/appdata`. Back up that volume and you have backed up the configuration.
- ZIP files are written to `/temp` and removed once they are old or once the browser that requested them goes away, so the volume does not grow on its own.
- Share links are public by design: anyone holding the link can open it, subject to the password and expiry you set.

## Source

https://github.com/PixlGalaxy/WebinCloud
