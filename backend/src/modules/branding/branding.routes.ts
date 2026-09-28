import { Router } from 'express';
import { copyFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { createWriteStream, promises as fs } from 'fs';
import { pipeline } from 'stream/promises';
import { join } from 'path';
import busboy from 'busboy';
import type { Translate } from '../../i18n/index.js';
import type { EnvConfig } from '../../config/env.js';
import { badRequest, notFound } from '../../errors.js';
import { logger } from '../../logger.js';
import { routeParam } from '../../route-params.js';
import { SERVE_OPTIONS } from '../../serve-options.js';
import { createAuthGuards } from '../auth/session.middleware.js';

/** Only these names are served, so the route cannot read arbitrary files. */
const ASSETS: Record<string, string> = {
  'logo.png': 'image/png',
  'icon.png': 'image/png',
  'favicon.ico': 'image/x-icon',
};

// Browsers are inconsistent about the Content-Type they send for a .ico file,
// so uploads are verified by magic bytes instead of trusting the header.
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const ICO_MAGIC = Buffer.from([0x00, 0x00, 0x01, 0x00]);
const MAX_BRANDING_BYTES = 5 * 1024 * 1024;

function hasValidSignature(name: string, head: Buffer): boolean {
  return name === 'favicon.ico' ? head.subarray(0, 4).equals(ICO_MAGIC) : head.subarray(0, 8).equals(PNG_MAGIC);
}

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

export function createBrandingRoutes(config: EnvConfig, t: Translate): Router {
  const router = Router();
  const { requireAuth, requireAdmin } = createAuthGuards(t);

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

  // Replaces the custom file in BRANDING_DIR only — DEFAULT_BRANDING_DIR (the
  // packaged image asset) is never touched, so a reset just means deleting
  // this override and letting the GET route's own fallback take over again.
  router.post('/:name', requireAuth, requireAdmin, (req, res, next) => {
    const name = routeParam(req.params.name);
    if (!(name in ASSETS)) throw notFound('branding.unknownAsset');

    const parser = busboy({ headers: req.headers, limits: { files: 1, fileSize: MAX_BRANDING_BYTES } });
    let sawFile = false;
    let failure: unknown = null;
    let partial = '';
    let write: Promise<void> = Promise.resolve();

    parser.on('file', (_field, stream, _info) => {
      sawFile = true;
      partial = join(config.BRANDING_DIR, `${name}.part`);

      const head: Buffer[] = [];
      let headBytes = 0;
      let truncated = false;
      stream.on('data', (chunk: Buffer) => {
        if (headBytes < 8) {
          head.push(chunk);
          headBytes += chunk.length;
        }
      });
      stream.on('limit', () => {
        truncated = true;
        failure ??= badRequest('branding.tooLarge');
      });

      write = pipeline(stream, createWriteStream(partial))
        .then(async () => {
          if (truncated) throw failure;
          if (!hasValidSignature(name, Buffer.concat(head))) throw badRequest('branding.invalidType');
          await fs.rename(partial, join(config.BRANDING_DIR, name));
        })
        .catch((err) => {
          failure ??= err;
        });
    });

    parser.on('error', (err) => {
      failure ??= err;
    });

    parser.on('close', () => {
      void (async () => {
        await write;
        if (!sawFile) return next(badRequest('branding.noFile'));
        if (failure) {
          if (partial) await fs.rm(partial, { force: true }).catch(() => undefined);
          return next(failure);
        }
        logger.info(`Branding: replaced ${name}`);
        res.json({ success: true });
      })();
    });

    req.pipe(parser);
  });

  // Deletes the custom override so the packaged default is served again.
  router.delete('/:name', requireAuth, requireAdmin, async (req, res) => {
    const name = routeParam(req.params.name);
    if (!(name in ASSETS)) throw notFound('branding.unknownAsset');

    await fs.rm(join(config.BRANDING_DIR, name), { force: true });
    logger.info(`Branding: reset ${name} to default`);
    res.json({ success: true });
  });

  return router;
}
