# Webin Cloud — Frontend

The web interface of Webin Cloud: file explorer, previews and editor, share links, public share pages, user settings and the admin panel. It is a single-page app built with React 19, TypeScript, Vite and Tailwind CSS.

In the Docker image, nginx serves the built files at `/` and forwards `/backend/` to the API. For how to deploy the whole app, see the [root README](../README.md).

## Requirements

- Node.js 22 or newer
- The backend running locally (see [backend/README.md](../backend/README.md))

## Getting started

```bash
# terminal 1
cd backend && npm install && npm run dev

# terminal 2
cd frontend
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`) and sign in with one of the development accounts: `admin` / `admin` or `user` / `user`.

The dev server proxies `/backend/*` to the backend on port `4000`, the same way nginx does in production. If the backend runs on another port, set `VITE_BACKEND_PORT`:

```bash
VITE_BACKEND_PORT=4100 npm run dev
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server with hot reload |
| `npm run build` | Type-checks and builds the production bundle into `dist/` |
| `npm run preview` | Serves the built `dist/` locally |
| `npm run lint` | Runs ESLint |

## Project layout

```
src/
  main.tsx, App.tsx    entry point and routes
  api/                 typed wrappers around the backend API (one file per area)
  context/             app-wide state: auth, theme, config, uploads, archives, clipboard
  pages/
    files/             file explorer, previews, code editor, office viewers
    share/             share link manager
    public/            public share page (no sign-in required)
    settings/          user settings
    admin/             admin panel: dashboard, users, logs, IP access, settings, system
    LoginPage.tsx
  components/          shared UI: navbar, modals, upload tray, folder tree, ...
  hooks/               small reusable hooks
  i18n/                translation context; strings come from ../locales
  theme/               theme skins and light/dark mode
```

## Routes

| Path | Page | Access |
| --- | --- | --- |
| `/login` | Sign in | public |
| `/public/:segment/:name` | Public share link | public |
| `/files/*` | File explorer | signed in |
| `/share` | Share link manager | signed in |
| `/settings` | User settings | signed in |
| `/admin` | Admin panel | admin |

## Talking to the API

Every request goes through `src/api/client.ts`, which prefixes `/backend/api`, sends the session cookie (`credentials: 'include'`) and turns error responses into an `ApiError` with the status code and the server's translated message. Add new endpoints to the matching file in `src/api/` rather than calling `fetch` from components.

## Translations

UI strings live in `../locales/*.json`, shared with the backend and imported through the `@locales` alias. To add a string, add the key to `en.json` and every other locale file, then use it with `useI18n().t('your.key')`.

## Previews

- Images, video, audio and PDF use the browser's own viewers.
- Text and code open in a CodeMirror editor.
- HTML runs in a sandboxed `iframe` without `allow-same-origin`, so it cannot reach the app.
- `.docx` files render with `docx-preview`. Links other than `http`, `https`, `mailto` and in-page anchors are removed after rendering.
- Spreadsheets render with SheetJS (`xlsx`). It is installed from the `cdn.sheetjs.com` tarball, so `npm install` needs access to that host.
