# Desktop and device API

How a desktop app (or any client that is not the web interface) signs in to a Webin Cloud server and stays signed in. The Windows app in [WebinCloudClient](https://github.com/PixlGalaxy/WebinCloudClient) uses exactly this.

All paths below are relative to the server root, for example `https://cloud.example.com`. The API is under `/backend/api`.

## Overview

A signed-in client is a **device**. Each device has:

- an **access token**, sent on every request as `Authorization: Bearer <token>`, valid for **1 hour**;
- a **refresh token**, used only to get a new pair, valid for **90 days** and extended each time it is used.

Both are 256-bit random strings; the server stores only their SHA-256. A device has exactly the permissions of its user, and every existing endpoint (`/files`, `/shares`, `/auth/me`, …) accepts the bearer token in place of the web session cookie.

The user sees and disconnects their devices in **Settings → Devices**. An admin sees and disconnects any user's devices in **Admin → Users → Edit**.

A device is signed out when:

- it signs itself out (`DELETE /devices/current`);
- the user or an admin disconnects it;
- the user's password changes (by the user or an admin), or the account is deactivated or its role changes: **all** of that user's devices are signed out;
- an old refresh token is used again (see [Refresh](#refresh)).

## Signing in

There are two ways. Prefer the browser: the password never passes through the app, and it keeps working if the server adds other sign-in steps later.

### A. Browser approval (OAuth 2.0 authorization code + PKCE)

This follows RFC 7636 (PKCE) and RFC 8252 (OAuth for native apps).

1. Generate a **verifier**: 32 random bytes, base64url without padding (43 characters). Compute `challenge = base64url(SHA-256(verifier))`. Generate a random **state**.
2. Listen on `http://127.0.0.1:<any free port>/` (or `http://[::1]:<port>/`). `localhost` is **not** accepted.
3. Open the system browser on:

   ```
   <server>/connect?code_challenge=<challenge>
                   &code_challenge_method=S256
                   &redirect_uri=http://127.0.0.1:<port>/callback
                   &state=<state>
                   &device_name=<name shown to the user, max 64 chars>
                   &platform=windows|macos|linux|other
   ```

   If the user is not signed in, the page sends them through the normal login (rate limits, LAN-only default password and so on) and comes back.
4. The user clicks **Connect** (or **Cancel**). The browser is sent to your `redirect_uri` with:
   - `?code=<one-time code>&state=<state>` on approval;
   - `?error=access_denied&state=<state>` on cancel.

   Check that `state` matches. Answer the browser with a page saying it can be closed.
5. Redeem the code within **60 seconds**:

   ```http
   POST /backend/api/devices/token
   Content-Type: application/json

   {
     "grantType": "authorization_code",
     "code": "<code>",
     "codeVerifier": "<verifier>",
     "redirectUri": "<the same redirect_uri>"
   }
   ```

   The code is single use: a failed attempt (wrong verifier, other `redirectUri`) also burns it. Answer: **201** with [tokens](#token-response).

A user can have at most 10 approvals waiting at once (429 beyond that).

### B. Username and password

```http
POST /backend/api/devices/login
Content-Type: application/json

{
  "usernameOrEmail": "fabricio",
  "password": "…",
  "deviceName": "PC-Fabricio",
  "platform": "windows"
}
```

- **201**: [tokens](#token-response), plus `user`.
- **401**: wrong credentials.
- **403**: the password is the public default (`changeme`). It must be replaced in the web interface first. This answer comes before the password is checked, so it never confirms whether an account still has it.
- **429**: rate limited, with the same per-IP and per-account limits as the web login. Successful sign-ins do not count towards them.

### Token response

```json
{
  "tokenType": "Bearer",
  "accessToken": "…",
  "refreshToken": "…",
  "expiresIn": 3600,
  "device": {
    "id": "…",
    "name": "PC-Fabricio",
    "platform": "windows",
    "createdAt": "2026-10-20 06:00:33",
    "lastSeenAt": "2026-10-20 06:00:33",
    "lastIp": "203.0.113.7"
  }
}
```

Dates are UTC in SQLite's `YYYY-MM-DD HH:MM:SS` form.

## Refresh

Renew shortly before `expiresIn` runs out, or when a request gets **401**:

```http
POST /backend/api/devices/token
Content-Type: application/json

{ "grantType": "refresh_token", "refreshToken": "<refresh token>" }
```

- **200** returns a new token response. **Both** tokens change. Store the new refresh token immediately; the old one stops working.
- **401** means the device was signed out. Delete the stored tokens and ask the user to sign in again.

**Reuse detection.** If a refresh token that was already replaced is presented again, the server assumes a copy was stolen and signs the device out. Exception: the same old token presented within 30 seconds of being replaced is just refused (401) and the device stays signed in, so two refreshes racing in the app do not sign it out. Serialise refreshes anyway.

## Managing devices

| Request | Who | Result |
| --- | --- | --- |
| `GET /backend/api/devices` | the user (cookie or bearer) | Their devices; `current: true` marks the one making the request |
| `DELETE /backend/api/devices/current` | a device | Signs itself out (204) |
| `DELETE /backend/api/devices/:id` | the user | Disconnects one of their devices (204, 404 if not theirs) |
| `GET /backend/api/users/:userId/devices` | admin | That user's devices |
| `DELETE /backend/api/users/:userId/devices/:id` | admin | Disconnects it (204); logged with the admin's name |

A device cannot approve other devices (`POST /devices/authorize` refuses bearer tokens). There is no way for an admin to sign a device in on someone else's behalf.

## Client requirements

- **Store tokens in the OS secret store** (Windows Credential Manager, macOS Keychain), never in plain settings files or logs.
- **Use HTTPS.** Plain `http` is only acceptable on the local network; the Windows app refuses it for any other address.
- **Do not follow redirects** on requests that carry the bearer token.
- **Listen on `127.0.0.1` only,** answer only the callback path, and bound how much you read from each connection.
- **Never send the password anywhere else,** and don't keep it after sign-in.

## Errors

Errors are JSON, `{ "error": "<message in the server's language>" }`, safe to show to the user.
