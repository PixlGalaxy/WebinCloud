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
| Last review | 2026-10-02 |
| Scope | Backend (`backend/src`, every route), frontend previewers, `nginx.conf`, `Dockerfile`, `entrypoint.sh` |
| Dependency audit | `npm audit --omit=dev`: 0 known vulnerabilities in backend and frontend |
| Open critical / high findings | **None** |
| Open medium findings | 4 (see [Open findings](#open-findings)) |

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
- **Sessions**: 256-bit random token in an `HttpOnly`, `SameSite=Lax` cookie. Only its SHA-256 hash is stored. Sessions expire server-side (`SESSION_TTL_HOURS`) and are revoked on logout, password change, deactivation and role change.
- **Authorization**: every `/api/*` router applies `requireAuth`, and the admin routers (`users`, `permissions`, `logs`, `admin`, `admin/ip-access`, branding writes) also apply `requireAdmin`. File access goes through `requireRead` / `requireWrite` against folder grants. Jobs (archives, transfers), shares and path names are checked for ownership.
- **Path safety**: client paths go through `normalizeRelPath`, which rejects `..` and NUL, and then `resolveSafePath`, which keeps them inside `DATA_ROOT`. File names are validated (`assertValidName`). Search, archive and copy walks use `lstat` and skip symlinks.
- **SQL**: every query is a prepared statement with bound parameters. The single interpolated column name comes from a fixed union type.
- **Content served inline**: the MIME types allowed inline never include `text/html` or `image/svg+xml`, so text, HTML and SVG files are served as `text/plain`, always with `nosniff`. The HTML preview runs in an `<iframe sandbox="allow-scripts">` with no `allow-same-origin`, so it gets an opaque origin.
- **Uploads**: avatars accept PNG, JPEG, WebP or GIF up to 5 MB. Branding files are checked by magic bytes and limited to 5 MB. Files are written to `.part` first and renamed when complete. Public uploads never overwrite existing files.
- **Subprocesses**: ffmpeg runs through `execFile`, with no shell, a fixed argument list, an absolute input path and a timeout.
- **Abuse limits**: login is rate-limited per IP and per account, and share unlocking per IP and per share. Banned IPs are rejected before any other middleware. Restarting services from the admin panel is throttled through the database. Behind another reverse proxy, `TRUST_PROXY` must list that proxy so these limits see each visitor's real IP; only the listed proxies (plus the bundled nginx) are believed in `X-Forwarded-For`, so a client cannot forge its address.
- **Misc**: `x-powered-by` is disabled and `server_tokens` is off. The share-unlock cookie is an HMAC tied to the password hash, so changing the password invalidates it. It is compared in constant time.

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

1. **First-run takeover window.** A fresh install accepts `admin` / `changeme` until someone completes setup. The "must complete setup" step is enforced only by the frontend: a session opened with the default password has full admin API access. *Mitigation:* never expose a fresh instance to an untrusted network before signing in once. *Fix idea:* store a `must_complete_setup` flag on the session and reject every other endpoint server-side until it is cleared.
2. **No size or quota limit on uploads.** nginx sets `client_max_body_size 0` and the backend has no limit, so public upload links (anonymous) and users with write access can fill the `/data` disk. *Fix idea:* a configurable maximum size per upload and a rate limit on public uploads.
3. **Symlinks inside `/data` are followed** by listing, download, raw preview and public-share listing (only search, ZIP and copy skip them). The app itself cannot create symlinks, but if the host bind-mounts a directory that contains a symlink pointing outside it, users with access to that folder can read the target. *Fix idea:* compare `realpath` against `DATA_ROOT` in `resolveSafePath`, or reject symlinks.
4. **No Content-Security-Policy.** The other headers are in place. A CSP (`default-src 'self'`, with exceptions for `blob:`/`data:` media and inline styles) would limit the impact of any future XSS. It needs testing against the PDF, video and office previewers before it is enabled.

### Low / informational

- **Account lockout:** the per-account login limit (10 per 15 min by default) lets anyone who knows a username block that user's logins temporarily. This is an accepted trade-off against password guessing.
- **Guessable link URLs with path names:** each user gets a default path name equal to their username, so `/public/<username>/<file name>` can be guessed. Use the random-token URL, or a password, for anything sensitive.
- **Share expiry is not validated:** an unparseable `expiresAt` is stored as-is and the link never expires. The UI sends valid ISO dates, so this only affects direct API calls.
- **The share-unlock cookie has no server-side expiry:** the 12 h `maxAge` is enforced only by the browser. The token stays valid until the share's password changes.
- **CSRF** relies on `SameSite=Lax` plus JSON bodies; there is no CSRF token. Multipart uploads from a *same-site* origin (a sibling subdomain) would carry the cookie. Avoid hosting untrusted apps on sibling subdomains.
- **`.part` collisions:** uploading `X` overwrites an existing file literally named `X.part`, even through public links, which otherwise never overwrite.
- **Backend binds `0.0.0.0:4000`** inside the container. The port is not published, but other containers on the same Docker network can reach the API without going through nginx and its headers. Binding to `127.0.0.1` in production would close this.
- **Container runs as root** (the Node process and the nginx master). Running Node as an unprivileged user would reduce the impact of a compromise.
- **`COOKIE_SECURE` defaults to `false`** and nginx sends no HSTS, because TLS is expected at an outer proxy. Production deployments must use HTTPS and set `COOKIE_SECURE=true`.
- **Input robustness:** `POST /api/users` with missing fields returns 500 instead of 400 (admin-only, no security impact).
- **Logs:** failed logins log the submitted username, which may contain a password typed into the wrong field. Logs are visible only to admins.
- **`xlsx`** is installed from a `cdn.sheetjs.com` tarball, so `npm audit` and Dependabot do not track it. Check SheetJS advisories manually when upgrading.

## Deployment checklist

- [ ] Sign in and complete the first-run setup **before** exposing the instance.
- [ ] Put the container behind HTTPS and set **Cookie secure** (Admin → Settings) / `COOKIE_SECURE=true`.
- [ ] Add HSTS at the TLS-terminating proxy.
- [ ] Do not publish port `4000`; only expose port `80` of the container.
- [ ] Behind another reverse proxy, set `TRUST_PROXY` (for example `uniquelocal`) so logins, rate limits and bans see real client IPs.
- [ ] Do not bind-mount directories that contain symlinks pointing outside the data folder.
- [ ] Give upload links an expiry and a password, and watch free space on `/data`.
- [ ] Back up the `/appdata` volume: it holds accounts, permissions, share links and the signing secret.
