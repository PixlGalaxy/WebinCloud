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
| Last review | 2026-10-06 |
| Scope | Backend (`backend/src`, every route), frontend previewers, `nginx.conf`, `Dockerfile`, `entrypoint.sh` |
| Dependency audit | `npm audit --omit=dev`: 0 known vulnerabilities in backend and frontend |
| Open critical / high findings | **None** |
| Open medium findings | 1 (see [Open findings](#open-findings)) |

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

- **Passwords**: argon2id for both account passwords and share-link passwords. Minimum length 8.
- **Sessions**: 256-bit random token in an `HttpOnly`, `SameSite=Lax` cookie. Only its SHA-256 hash is stored. Sessions expire server-side (`SESSION_TTL_HOURS`, expired rows pruned hourly) and are revoked on logout, password change, deactivation and role change. A session opened with default credentials is restricted server-side to the endpoint that fixes them.
- **CSRF**: `SameSite=Lax` plus a `Sec-Fetch-Site` check that refuses state-changing requests initiated from another site or a sibling subdomain.
- **Authorization**: every `/api/*` router applies `requireAuth`, and the admin routers (`users`, `permissions`, `logs`, `admin`, `admin/ip-access`, branding writes) also apply `requireAdmin`. File access goes through `requireRead` / `requireWrite` against folder grants. Jobs (archives, transfers), shares and path names are checked for ownership.
- **Path safety**: client paths go through `normalizeRelPath`, which rejects `..` and NUL, and then `resolveSafePath`, which keeps them inside `DATA_ROOT` both lexically and after resolving symlinks (`realpath`), so a link that leaves the volume is refused. File names are validated (`assertValidName`). Search, archive and copy walks use `lstat` and skip symlinks.
- **SQL**: every query is a prepared statement with bound parameters. The single interpolated column name comes from a fixed union type.
- **Content served inline**: the MIME types allowed inline never include `text/html` or `image/svg+xml`, so text, HTML and SVG files are served as `text/plain`, always with `nosniff`. The HTML preview runs in an `<iframe sandbox="allow-scripts">` with no `allow-same-origin`, so it gets an opaque origin.
- **Uploads**: avatars accept PNG, JPEG, WebP or GIF up to 5 MB. Branding files are checked by magic bytes and limited to 5 MB. File uploads (signed-in and public) honour `MAX_UPLOAD_MB` per file. Files are written to a randomly named `.part` first and renamed when complete. Public uploads never overwrite existing files.
- **Subprocesses**: ffmpeg runs through `execFile`, with no shell, a fixed argument list, an absolute input path and a timeout.
- **Abuse limits**: login is rate-limited per IP and per account, and share unlocking per IP and per share. Archive and copy jobs are capped at 5 running per owner. Banned IPs are rejected before any other middleware. Restarting services from the admin panel is throttled through the database. Behind another reverse proxy, **Trusted proxies** (Admin → Settings, or `TRUST_PROXY`) must list that proxy so these limits see each visitor's real IP; only the listed proxies (plus the bundled nginx) are believed in `X-Forwarded-For`, so a client cannot forge its address.
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
| `/api/auth/complete-setup` | `POST` | Auth (username `admin`) | Re-verifies current password |
| `/api/files` (`/`, `/download`, `/raw`, `/thumbnail`, `/content`, `/search`, `/events`) | `GET` | Auth + read grant | |
| `/api/files` (`/mkdir`, `/rename`, `/move`, `/content`, `/upload`, `/check-conflicts`, `DELETE /`) | write methods | Auth + write grant | Rename/move also need write access to the parent |
| `/api/archives` | `POST`, `GET /:id`, `GET /:id/download`, `DELETE /:id` | Auth, job owner | Max 500 items, per-entry read check |
| `/api/transfers` | `POST`, `GET /:id`, `DELETE /:id` | Auth, job owner | Read on sources, write on normalized destination |
| `/api/shares`, `/api/shares/path-names` | CRUD | Auth, owner | Creating an upload link needs write access |
| `/api/avatars/:userId` | `GET` | Auth | Any user can view any avatar (by design) |
| `/api/avatars/me` | `POST`, `DELETE` | Auth | |
| `/api/public/:segment/:name` | `GET /`, `POST /unlock` | Public / Link | Unlock is rate-limited |
| `/api/public/:segment/:name` | `/list`, `/download`, `/archive*`, `/upload` | Link | Expiry, password, download/upload flags and the owner's current access are all checked |
| `/api/users`, `/api/permissions`, `/api/logs`, `/api/admin/*`, `/api/admin/ip-access/*` | all | Admin | |

## Open findings

Known risks that are not fixed yet, in priority order. Each one either needs a
design decision or is mitigated by how the app is deployed.

### Medium

1. **No Content-Security-Policy.** The other headers are in place. A CSP (`default-src 'self'`, with exceptions for `blob:`/`data:` media and inline styles) would limit the impact of any future XSS. It needs testing against the PDF, video and office previewers before it is enabled, and the HTML preview (`<iframe srcdoc>` inherits the page's CSP) would need its own delivery path, since user HTML legitimately carries inline scripts.

### Low / informational

- **Account lockout:** the per-account login limit (10 per 15 min by default) lets anyone who knows a username block that user's logins temporarily. This is an accepted trade-off against password guessing.
- **Guessable link URLs with path names:** each user gets a default path name equal to their username, so `/public/<username>/<file name>` can be guessed. Use the random-token URL, or a password, for anything sensitive.
- **Upload limit is per file, not a quota:** `MAX_UPLOAD_MB` caps each file; there is still no per-user or per-link total, nor a rate limit on public uploads. Give upload links an expiry and a password, and watch free space.
- **CSRF guard depends on `Sec-Fetch-Site`:** clients that omit the header (very old browsers, non-browser tools) fall back to `SameSite=Lax` alone, which does not cover sibling subdomains. Every current browser sends it.
- **Container runs as root** (the Node process and the nginx master). Running Node as an unprivileged user would reduce the impact of a compromise, but bind-mounted volumes owned by the host user make this a breaking change for existing installs.
- **`COOKIE_SECURE` defaults to `false`** and nginx sends no HSTS, because TLS is expected at an outer proxy. Production deployments must use HTTPS and set `COOKIE_SECURE=true`.
- **Logs:** failed logins log the submitted username, which may contain a password typed into the wrong field. Logs are visible only to admins.
- **Admins can demote or deactivate themselves** (only self-deletion is blocked), which can lock an instance out of its last admin. No security impact, but worth a guard.
- **`xlsx`** is installed from a `cdn.sheetjs.com` tarball, so `npm audit` and Dependabot do not track it. Check SheetJS advisories manually when upgrading.

## Deployment checklist

- [ ] Sign in and complete the first-run setup **before** exposing the instance.
- [ ] Put the container behind HTTPS and set **Cookie secure** (Admin → Settings) / `COOKIE_SECURE=true`.
- [ ] Add HSTS at the TLS-terminating proxy.
- [ ] Do not publish port `4000`; only expose port `80` of the container (the backend listens on loopback anyway unless `HOST` is changed).
- [ ] Set **Max upload size** (Admin → Settings, or `MAX_UPLOAD_MB`) if public upload links are in use.
- [ ] Behind another reverse proxy, set **Trusted proxies** in Admin → Settings (for example `uniquelocal`) so logins, rate limits and bans see real client IPs.
- [ ] Do not bind-mount directories that contain symlinks pointing outside the data folder.
- [ ] Give upload links an expiry and a password, and watch free space on `/data` (the per-file cap is not a quota).
- [ ] Back up the `/appdata` volume: it holds accounts, permissions, share links and the signing secret.
