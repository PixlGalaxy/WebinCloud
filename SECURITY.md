# Security

This document records the security status of Webin Cloud Server: how to report a
vulnerability, what was reviewed, what was fixed, and the known risks that are
still open. Keep it up to date whenever a finding is fixed or a new one is
accepted.

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's
private reporting instead: *Security → Report a vulnerability* on this
repository. Include the affected endpoint or file, steps to reproduce and the
version (image tag or commit) you tested.

Only the latest published image (`ghcr.io/pixlgalaxy/webincloud:latest`) and the
`main` branch receive security fixes.

## Current status

| | |
| --- | --- |
| Last review | 2026-10-20 |
| Scope | Backend (`backend/src`, every route, including the device API), frontend previewers, `nginx.conf`, `Dockerfile`, `entrypoint.sh`, GitHub workflows |
| Dependency audit | `npm audit --omit=dev`: 0 known vulnerabilities in backend and frontend |
| Open critical / high findings | **None** |
| Open medium findings | 4 (see [Open findings](#open-findings)) |

### Fixed in the 2026-10-19 / 2026-10-20 review

A full review in five parts (code execution, SQL, file access, authentication, client side and infrastructure), followed by a review of the new device API before it was released.

| Severity | Issue | Fix |
| --- | --- | --- |
| **High** | **Thumbnails could read other files.** ffmpeg picked its input format from the file's content, so an upload named `x.png` holding a concat list pointing at an HLS playlist made it read any video on the server, outside the user's folders, into the thumbnail. | ffmpeg may only open a fixed list of image and video demuxers (`-format_whitelist`, nested inputs included). `concat`, `hls` and `image2` are left out, and `.jpg` files are forced to the JPEG demuxer. Verified with the exploit chain against ffmpeg 8. |
| **High** | **Anyone could claim a fresh install.** `admin` / `changeme` is public, so whoever reached a new instance first could complete the setup. | The default password is accepted only from the local network, for both login and setup. Every address the request carries (the connection, `X-Forwarded-For`, `X-Real-IP`, `CF-Connecting-IP`, `Forwarded`) must be private or loopback, so this also holds behind a reverse proxy whose trust is not configured yet. |
| **High** (deployment) | **Development accounts in production.** The test accounts `admin/admin` and `user/user` were created, and existing accounts with those names reset, whenever `NODE_ENV` was not exactly `production`, for example when it was unset. | Production is the default: only `NODE_ENV=development` or `dev` turns on development mode. `npm run dev` sets it through `backend/dev.env`. |
| Medium | **Deleting a folder ignored the parent's permission.** A user with write access to a granted folder could delete the whole folder, for everyone. | Deleting needs write access to the parent too, like renaming and moving. |
| Medium | **Hidden content could be replaced or exposed.** With a non-inheriting grant, overwriting on upload, move or copy replaced items the user could not see, and moving a folder could carry hidden subfolders under a grant that exposed them. | Replacing an item needs write access to it; deleting or moving a folder needs write access to everything inside it. |
| Medium | **Links followed the path, not the item.** After a file was deleted, an unrelated upload with the same name was served by the old link. | Links follow renames and moves made in the app. A link whose item is gone stops working and is removed after 48 hours unless the item comes back (by design, so a file can be replaced by deleting and re-uploading it). |
| Medium | **ZIPs could pile up in `/temp`.** Finished archives were not counted, so a link holder could create copies of a whole folder in a loop. | At most 5 finished archives are kept per user or link; starting another drops the oldest. |
| Medium | **The container ran everything as root**, including ffmpeg on uploaded files. | The backend and ffmpeg run as `PUID:PGID` (default `99:100`); see the README. |
| Low | **Share password hashes were sent to their owner** by `GET/POST/PATCH /api/shares`. | Removed from the responses; `hasPassword` remains. |
| Low | **Successful logins counted towards the rate limit**, so signing in and out about ten times locked the account. The admin panel showed only the IP counter, so unblocking the IP did not help. | Successful logins and share unlocks give their attempt back. IP Access also lists and unblocks locked accounts. |

Upload sockets (WebSockets carrying chunk data) were reviewed before release with 33 more end-to-end checks, also run through the container's nginx: sign-in by session, device or link with its unlock cookie, the Origin check, other users' and links' sessions, chunk sizes, oversized and malformed frames, the socket caps, sockets that send only refused chunks, and signing out or turning a link off while a socket is open. Partial files left by a restart are removed at the next start.

Chunked uploads were reviewed before release, with 53 end-to-end checks against a real backend: sizes, offsets and chunk lengths, the same chunk or completion sent twice at once, path and name traversal, ownership between users and between the signed-in and link routes, cross-site requests, the session caps (per user, per link visitor and per link), and a link losing its upload permission midway.

The device API itself was reviewed before release. Three issues were fixed: the password sign-in confirmed whether an account still had the default password, `localhost` was accepted as a redirect, and pending approvals had no per-user limit.

Checked with end-to-end scripts against the Docker image, 100 checks in total:
- 49 regression checks on files, shares, permissions, rate limits and archives;
- 51 on devices: the PKCE flow, refresh rotation and reuse, revocation, permissions through a bearer token, and the admin endpoints.

### Fixed in the 2026-10-11 review

| Severity | Issue | Fix |
| --- | --- | --- |
| Low | **No maximum password length.** Login, share unlock, password change, first-run setup, user management and share passwords accepted any length, and every JSON body could be up to 10 MB, so an anonymous client could make argon2 hash a multi-megabyte "password" on each attempt. | Passwords are capped at 256 characters (`MAX_PASSWORD_LENGTH`). Login and share unlock answer a longer one like a wrong guess, without running argon2. The other endpoints return a clear 400. |
| Low | **10 MB JSON limit on every route.** Only the text editor's save needs a large body. | JSON bodies are limited to 1 MB, except `PUT /api/files/content` (10 MB, for text files up to 2 MB once JSON-escaped). |
| Low | **Malformed or oversized JSON returned 500** and logged a stack trace as an unhandled error, adding noise to the admin log viewer. | Body-parser rejections now return **400** (malformed) or **413** (too large) and log a single warning line. |

Each fix was checked by an end-to-end script against a real backend (temporary
database and data folder): 24 checks covering the cap at 256/257 characters on
every endpoint, a 900 KB password rejected in milliseconds, malformed and 2 MB
bodies, a 1.9 MB text-file save, and the normal login, user, password-change and
share flows.

### Fixed in the 2026-10-06 review

| Severity | Issue | Fix |
| --- | --- | --- |
| Medium | **First-run takeover window.** The "must complete setup" and "must change the default password" steps were enforced only by the frontend's modal: a session opened with `admin` / `changeme` (or any account whose admin set the password to `changeme`) had full API access from a direct client. | Each session now records a `pending_action` at login. Until it is cleared the server answers **403** to everything except `/auth/me`, `/auth/logout` and the one endpoint that resolves it (`/auth/complete-setup` or `/auth/change-password`). `/auth/me` reports the pending state so the prompt survives a reload. `complete-setup` also requires the current password to be the default one, so a later account merely *named* `admin` cannot use it to rename itself. |
| Medium | **Symlinks inside `/data` were followed.** A link in a bind-mounted folder pointing outside the volume let anyone with access to that folder list, preview and download the target. | `resolveSafePath` now also compares the `realpath` of the deepest existing ancestor against the `realpath` of the data root, so a path that leaves the volume through a link is refused (400). Listings and public-share listings skip such entries instead of failing. Links that stay inside the volume keep working. |
| Medium | **No upload size limit.** `client_max_body_size 0` plus no backend cap let a public upload link (anonymous) or any writer fill the data disk with one request. | New `MAX_UPLOAD_MB` (env, and Admin → Settings → *Max upload size*; `0` = no limit) applied per file in both the authenticated and the public upload routes. An oversized file is refused with **413** and its partial file removed. |
| Medium | **Unbounded ZIP / copy jobs.** Anyone holding a public link — no account needed — could start archive jobs of a large folder in a loop, filling the temp volume and pinning the CPU faster than abandonment detection could cancel them. | At most 5 running archive jobs per owner (user or share link) and 5 running copy jobs per user; further requests get **429**. |
| Low | CSRF relied on `SameSite=Lax` alone, which does not cover a sibling subdomain. | Every state-changing request whose `Sec-Fetch-Site` is `cross-site` or `same-site` is refused (403) before any route runs. The app's own pages always send `same-origin`. |
| Low | The share-unlock cookie had no server-side expiry: a stolen cookie stayed valid until the share's password changed. | The token now carries its expiry (`<expiry>.<hmac>`), signed together with the share id and password hash, and is checked server-side. |
| Low | An unparseable share `expiresAt` was stored as-is and the link never expired. | `expiresAt` must be a parseable date (400 otherwise) and is stored normalized as ISO 8601. |
| Low | `.part` / `.saving` temp names collided with real files: uploading `X` silently replaced an existing `X.part`, even through public links, which otherwise never overwrite. | Temp files now get a random suffix (`X.<hex>.part`) for uploads, public uploads, text edits and copies. |
| Low | Failed archive / copy jobs returned the raw filesystem error message to the client, including the server's absolute paths — to anonymous link holders too. | Only the app's own error keys are exposed; anything else becomes a generic failure (the detail stays in the server log). |
| Low | The backend listened on `0.0.0.0:4000`, reachable from other containers on the same Docker network without nginx's headers. | New `HOST` setting, `127.0.0.1` by default in production. |
| Low | Input robustness: non-string or missing fields in `/auth/login`, `/auth/change-password`, `/auth/complete-setup`, `POST /api/users`, `PATCH /api/users/:id`, `/api/permissions`, `/api/shares` and any `path` body field crashed the handler (500) instead of being rejected. | Type checks everywhere; a bad field is a 400. `normalizeRelPath` accepts `unknown`. |
| Low | Log injection: client-controlled strings (usernames, paths) were written to the log with control characters intact, so a crafted value could forge extra lines in the admin log viewer. | Control characters are stripped from every log message. |
| Low | Expired sessions were never deleted from the database. | Pruned at boot and hourly. |

Each fix was checked by an end-to-end script against a real backend (temporary
database and data folder, `NODE_ENV=production`): 38 checks covering the
restricted session, the symlink escape (via junctions), the upload cap, the
cross-site guard, share expiry and unlock cookies, the job cap and the input
validation all pass on the fixed code.

### Fixed in the 2026-10-02 review

| Severity | Issue | Fix |
| --- | --- | --- |
| **Critical** | `POST /api/transfers` did not normalize `destination`. A user with write access to any folder `X` could send `X/../other` — the permission check matched the `X/` prefix, then the path resolved to `other`. That let them copy files into any folder under `/data` and, with `onConflict: "overwrite"`, **delete other users' files and folders**. | The destination is now normalized (and `..` rejected) before any permission check (`transfers.service.ts`). |
| **High** | Public share links kept working after the owner lost access: revoking the folder grant or deactivating the account did not disable the owner's links. | Every public-share request now checks the owner's *current* access (`SharesService.ownerAccess`). A link never exposes more than its owner can read right now, and upload links need the owner to still have write access. |
| **High** | Recursive operations ignored grants with `inherit = false`. ZIP downloads, copies and public folder links walked into subfolders the grant does not cover. | Archives, copies and public-share listings, downloads and ZIPs check every entry against the grants (`readChecker` in `access-check.ts`). |
| Medium | Stored XSS via `.docx` preview: `docx-preview` copies hyperlink targets as-is, so a crafted document could carry a `javascript:` link that runs in the app's origin when clicked (authenticated preview and public share pages). | After rendering, links are kept only for `http:`, `https:`, `mailto:` and in-document anchors; everything else loses its `href` (`DocumentViewer.tsx`). |
| Low | Username enumeration through login timing: an unknown username answered instantly, a known one only after argon2 verification. | Unknown usernames now verify against a dummy argon2 hash, so both cases cost the same. |
| Low | No browser hardening headers. | nginx now sends `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: same-origin` and a restrictive `Permissions-Policy` on every response. |

Each fix was checked by an end-to-end script against a real backend (temporary
database and data folder). The script failed on the previous code and passes
on the fixed code.

## Security controls in place

Verified during the review:

- **Passwords**: argon2id for both account passwords and share-link passwords. Account passwords need 8 to 256 characters, and share passwords at most 256.
- **Sessions**: 256-bit random token in an `HttpOnly`, `SameSite=Lax` cookie. Only its SHA-256 hash is stored. Sessions expire server-side (`SESSION_TTL_HOURS`, expired rows pruned hourly) and are revoked on logout, password change, deactivation and role change. A session opened with default credentials is restricted server-side to the endpoint that fixes them, and the default password is accepted only from the local network.
- **Devices** (desktop apps, [docs/desktop-api.md](docs/desktop-api.md)):
  - **Tokens:** 256-bit bearer tokens, stored as SHA-256. Access tokens last 1 hour. Refresh tokens rotate on every use, and the device is signed out if a replaced one is used again.
  - **Browser sign-in:** authorization code with PKCE (S256 only). Codes are single use, last 60 seconds and are bound to a loopback redirect (`127.0.0.1` / `[::1]`).
  - **Who can enrol and disconnect:** devices cannot enrol other devices. A device has exactly its user's permissions. Devices are revoked with the user's sessions, and individually by the user or an admin (logged).
- **CSRF**: `SameSite=Lax` plus a `Sec-Fetch-Site` check that refuses state-changing requests initiated from another site or a sibling subdomain.
- **Authorization**: every `/api/*` router applies `requireAuth`, and the admin routers (`users`, `permissions`, `logs`, `admin`, `admin/ip-access`, branding writes) also apply `requireAdmin`. File access goes through `requireRead` / `requireWrite` against folder grants. Jobs (archives, transfers), shares and path names are checked for ownership.
- **Path safety**: client paths go through `normalizeRelPath`, which rejects `..` and NUL, and then `resolveSafePath`, which keeps them inside `DATA_ROOT` both lexically and after resolving symlinks (`realpath`), so a link that leaves the volume is refused. File names are validated (`assertValidName`). Search, archive and copy walks use `lstat` and skip symlinks.
- **SQL**: every query is a prepared statement with bound parameters. The single interpolated column name comes from a fixed union type.
- **Content served inline**: the MIME types allowed inline never include `text/html` or `image/svg+xml`, so text, HTML and SVG files are served as `text/plain`, always with `nosniff`. The HTML preview runs in an `<iframe sandbox="allow-scripts">` with no `allow-same-origin`, so it gets an opaque origin.
- **Uploads**: avatars accept PNG, JPEG, WebP or GIF up to 5 MB. Branding files are checked by magic bytes and limited to 5 MB. File uploads (signed-in and public) honour `MAX_UPLOAD_MB` per file. Files are written to a randomly named `.part` first and renamed when complete. Public uploads never overwrite existing files. Chunked uploads declare their size up front, checked against `MAX_UPLOAD_MB` before any byte arrives. Each chunk must be exactly its expected length and is written at a fixed offset, so nothing can be written past the declared size. Sessions have random ids and belong to the user or the link that started them (anyone else gets 404). Write access, or the link's upload permission and its owner's write access, is checked again on every chunk and on completion. At most 10 unfinished uploads are allowed per user or per link visitor, and 50 per link across all its visitors, and partial files are removed when an upload is cancelled or idle for 10 minutes. Partial files of uploads interrupted by a restart are listed in `/appdata/uploads-in-progress.json` and removed at the next start (only files inside the data root with the temp-file name pattern).
- **Upload sockets** (`/api/uploads/socket`, `/api/public/<link>/uploads/socket`): they only carry chunk data for uploads opened and completed over HTTP, with every check of those routes. The handshake is signed in like an HTTP request (session cookie or device token, or the link with its unlock cookie; banned IPs and sessions still on the default password are refused) and must come from the same host (`Origin` check). Each chunk must belong to a session of the same user or link. A socket re-checks every 5 seconds that the sign-in or link may still upload, and closes otherwise. Frames are limited to one 1 MiB chunk, compression is off, and a socket stops reading while its chunk is written, so memory stays bounded. At most 64 sockets per user or link visitor and 256 overall. `ws` is pinned to 8.22.0, which fixes GHSA-58qx-3vcg-4xpx and GHSA-96hv-2xvq-fx4p.
- **Subprocesses**: ffmpeg runs through `execFile`, with no shell, a fixed argument list, an absolute input path, a timeout and a whitelist of input formats, as an unprivileged user (`PUID`).
- **Abuse limits**: login is rate-limited per IP and per account, and share unlocking per IP and per share. Archive and copy jobs are capped at 5 running per owner. JSON bodies are limited to 1 MB (10 MB for the text editor's save). Banned IPs are rejected before any other middleware. Restarting services from the admin panel is throttled through the database. Behind another reverse proxy, **Trusted proxies** (Admin → Settings, or `TRUST_PROXY`) must list that proxy so these limits see each visitor's real IP. Only the listed proxies (plus the bundled nginx) are believed in `X-Forwarded-For`. Note that with a broad value such as `uniquelocal`, any device that can reach the container directly from a private address can claim another IP, so expose the container port only to the proxy.
- **Misc**: `x-powered-by` is disabled and `server_tokens` is off. The share-unlock cookie is an HMAC tied to the password hash and to a server-checked expiry, so changing the password or waiting 12 h invalidates it. It is compared in constant time. The backend listens on loopback only inside the container.

## Endpoint inventory

All paths are under `/backend` when going through nginx. Legend: **Public** = no
session; **Auth** = signed-in user; **Admin** = admin role; **Link** = holder of
a share link (plus password cookie if the share has one).

| Router | Endpoints | Access | Notes |
| --- | --- | --- | --- |
| `/api/health`, `/api/config` | `GET` | Public | No sensitive data |
| `/api/branding/:name` | `GET` | Public | Fixed allowlist of 3 file names |
| `/api/branding/:name` | `POST`, `DELETE` | Admin | Magic-byte check, 5 MB cap |
| `/api/auth/login` | `POST` | Public | Rate-limited per IP and per account |
| `/api/auth/logout`, `/me`, `/appearance`, `/change-password` | `POST`/`GET` | Auth | Password change revokes all sessions |
| `/api/auth/complete-setup` | `POST` | Auth (username `admin`) | Re-verifies current password; local network only |
| `/api/devices/login` | `POST` | Public | Rate-limited like `/auth/login`; refuses the default password |
| `/api/devices/token` | `POST` | Public (holder of a code + verifier, or a refresh token) | Codes single use and 60 s; refresh rotates |
| `/api/devices/authorize` | `POST` | Auth (browser session only, not a device) | Loopback redirect, S256, max 10 pending per user |
| `/api/devices`, `/api/devices/:id`, `/api/devices/current` | `GET`, `DELETE` | Auth, own devices | |
| `/api/files` (`/`, `/download`, `/raw`, `/thumbnail`, `/content`, `/search`, `/events`) | `GET` | Auth + read grant | |
| `/api/files` (`/mkdir`, `/rename`, `/move`, `/content`, `/upload`, `/upload/sessions*`, `/check-conflicts`, `DELETE /`) | write methods | Auth + write grant | Rename/move also need write access to the parent. Upload sessions belong to their user |
| `/api/archives` | `POST`, `GET /:id`, `GET /:id/download`, `DELETE /:id` | Auth, job owner | Max 500 items, per-entry read check |
| `/api/transfers` | `POST`, `GET /:id`, `DELETE /:id` | Auth, job owner | Read on sources, write on normalized destination |
| `/api/shares`, `/api/shares/path-names` | CRUD | Auth, owner | Creating an upload link needs write access |
| `/api/avatars/:userId` | `GET` | Auth | Any user can view any avatar (by design) |
| `/api/avatars/me` | `POST`, `DELETE` | Auth | |
| `/api/public/:segment/:name` | `GET /`, `POST /unlock` | Public / Link | Unlock is rate-limited |
| `/api/uploads/socket` | WebSocket | Auth (session or device), same host | Chunk data only, for the user's own upload sessions |
| `/api/public/:segment/:name/uploads/socket` | WebSocket | Link with upload allowed (plus unlock cookie), same host | Chunk data only, for that link's upload sessions |
| `/api/public/:segment/:name` | `/list`, `/download`, `/archive*`, `/upload`, `/upload/sessions*` | Link | Expiry, password, download/upload flags and the owner's current access are all checked |
| `/api/public/<alias>/<folder>/.../<name>` | same as above | Public / Link | Path-name links span several segments; a resolver rewrites them to the token form (`/api/public/<id>/<name>/...`) before the router, so the same checks apply |
| `/api/users` (including `/:id/devices`), `/api/permissions`, `/api/logs`, `/api/admin/*`, `/api/admin/ip-access/*` | all | Admin | Disconnecting a user's device is logged |

## Open findings

Known risks that are not fixed yet, in priority order. Each one either needs a
design decision or is mitigated by how the app is deployed.

### Medium

1. **No Content-Security-Policy.** The other headers are in place. A CSP (`default-src 'self'`, with exceptions for `blob:`/`data:` media and inline styles) would limit the impact of any future XSS. It needs testing against the PDF, video and office previewers before it is enabled, and the HTML preview (`<iframe srcdoc>` inherits the page's CSP) would need its own delivery path, since user HTML legitimately carries inline scripts.
2. **CSS injection from a crafted `.docx`.** `docx-preview` copies colour values from the document into a `<style>` element unchecked. A crafted file can restyle the app page around its preview (phishing, UI redress) and make the browser fetch attacker URLs. No script runs. Fix: render it in a sandboxed iframe, or strip rules outside `.docx` after rendering.
3. **Disk can still be filled through upload links.** There is no default `MAX_UPLOAD_MB`, no per-link or per-user quota, and no rate limit on public uploads.
4. **Dependabot auto-merge publishes to `:latest`.** Unless `main` requires the image build to pass, a compromised dependency release could reach users without review. Require status checks, add a Dependabot cooldown, and pin GitHub Actions and the base image by digest.

### Low / informational

- **Account lockout:** the per-account login limit (10 failures per 15 min by default) lets anyone who knows a username block that user's logins temporarily. This is an accepted trade-off against password guessing. An admin can lift it in IP Access.
- **Share unlock limit per alias spelling:** aliases are matched case-insensitively, but the per-link unlock limit counts each spelling separately, so `Alice` and `ALICE` get separate budgets. The per-IP limit still applies.
- **Guessable link URLs with path names:** each user gets a default path name equal to their username, so `/public/<username>/<file name>` can be guessed. Path-name links also show the item's folder path from the data root (`/public/<alias>/clients/acme/contract.pdf`) to anyone holding the link. Use the random-token URL, or a password, for anything sensitive.
- **Upload limit is per file, not a quota:** `MAX_UPLOAD_MB` caps each file; there is still no per-user or per-link total, nor a rate limit on public uploads. Give upload links an expiry and a password, and watch free space.
- **CSRF guard depends on `Sec-Fetch-Site`:** clients that omit the header (very old browsers, non-browser tools) fall back to `SameSite=Lax` alone, which does not cover sibling subdomains. Every current browser sends it.
- **nginx master runs as root** to bind port 80; its workers, the backend and ffmpeg do not.
- **Changes over SMB are invisible to link tracking:** a file renamed outside the app looks deleted to its links (removed after 48 hours), and anything placed at a link's path within 48 hours of a deletion is served by it.
- **`COOKIE_SECURE` defaults to `false`** and nginx sends no HSTS, because TLS is expected at an outer proxy. Production deployments must use HTTPS and set `COOKIE_SECURE=true`.
- **Logs:** failed logins log the submitted username, which may contain a password typed into the wrong field. Logs are visible only to admins.
- **Admins can demote or deactivate themselves** (only self-deletion is blocked), which can lock an instance out of its last admin. No security impact, but worth a guard.
- **`xlsx`** is installed from a `cdn.sheetjs.com` tarball, so `npm audit` and Dependabot do not track it. Check SheetJS advisories manually when upgrading.

## Deployment checklist

- [ ] Complete the first-run setup from the local network (the default password is refused from anywhere else).
- [ ] Put the container behind HTTPS and set **Cookie secure** (Admin → Settings) / `COOKIE_SECURE=true`.
- [ ] Add HSTS at the TLS-terminating proxy.
- [ ] Do not publish port `4000`; only expose port `80` of the container (the backend listens on loopback anyway unless `HOST` is changed).
- [ ] Set **Max upload size** (Admin → Settings, or `MAX_UPLOAD_MB`) if public upload links are in use.
- [ ] Behind another reverse proxy, set **Trusted proxies** in Admin → Settings (for example `uniquelocal`) so logins, rate limits and bans see real client IPs.
- [ ] Do not bind-mount directories that contain symlinks pointing outside the data folder.
- [ ] Give upload links an expiry and a password, and watch free space on `/data` (the per-file cap is not a quota).
- [ ] Back up the `/appdata` volume: it holds accounts, permissions, share links, devices and the signing secret.
- [ ] Set `PUID`/`PGID` to the owner of your files (default `99:100`, nobody:users) and make sure `/data` is writable by it.
- [ ] Do not set `NODE_ENV` to `development` or `dev` on a real instance.
