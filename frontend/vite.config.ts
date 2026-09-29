import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const localesDir = fileURLToPath(new URL('../locales', import.meta.url))

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@locales': localesDir },
  },
  server: {
    // Locales are shared with the backend, so they live outside the Vite root.
    fs: { allow: ['..'] },
    proxy: {
      // Mirrors nginx.conf's `location = /favicon.ico` for dev: a page with no
      // <link rel="icon"> of its own (e.g. a raw /backend/ download) makes the
      // browser auto-request this at the root, so route it to the same
      // branding endpoint the SPA's own <link> tag uses.
      '/favicon.ico': {
        target: `http://localhost:${process.env.VITE_BACKEND_PORT || 4000}`,
        changeOrigin: true,
        rewrite: () => '/api/branding/favicon.ico',
      },
      '/backend': {
        target: `http://localhost:${process.env.VITE_BACKEND_PORT || 4000}`,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/backend/, ''),
      },
    },
  },
})
