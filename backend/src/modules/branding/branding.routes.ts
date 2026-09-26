import { Router } from 'express';
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';
import type { EnvConfig } from '../../config/env.js';
import { notFound } from '../../errors.js';
import { logger } from '../../logger.js';
import { routeParam } from '../../route-params.js';
import { SERVE_OPTIONS } from '../../serve-options.js';

/** Only these names are served, so the route cannot read arbitrary files. */
const ASSETS: Record<string, string> = {
  'logo.png': 'image/png',
  'icon.png': 'image/png',
  'favicon.ico': 'image/x-icon',
};

/**
 * Copies the packaged defaults into the app data volume the first time, so the
 * files are there for an administrator to replace without rebuilding the image.
 */
export function seedBranding(config: EnvConfig): void {
  mkdirSync(config.BRANDING_DIR, { recursive: true });

  const packaged = readdirSync(config.DEFAULT_BRANDING_DIR).filter((name) => name in ASSETS);
  for (const name of packaged) {
    const target = join(config.BRANDING_DIR, name);
    if (existsSync(target)) continue;
    copyFileSync(join(config.DEFAULT_BRANDING_DIR, name), target);
    logger.info(`Branding: installed default ${name}`);
  }
}

export function createBrandingRoutes(config: EnvConfig): Router {
  const router = Router();

  // Anonymous: the logo and favicon appear on the login and public share pages.
  router.get('/:name', (req, res) => {
    const name = routeParam(req.params.name);
    const mime = ASSETS[name];
    if (!mime) throw notFound();

    const custom = join(config.BRANDING_DIR, name);
    const file = existsSync(custom) ? custom : join(config.DEFAULT_BRANDING_DIR, name);
    if (!existsSync(file)) throw notFound();

    res.setHeader('Content-Type', mime);
    // Revalidate every time, so a replaced file shows up on the next reload.
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(file, SERVE_OPTIONS);
  });

  return router;
}
