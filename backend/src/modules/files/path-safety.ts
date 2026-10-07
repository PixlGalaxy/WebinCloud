import { realpathSync } from 'fs';
import { basename, dirname, join, resolve, sep, normalize } from 'path';
import { badRequest, notFound } from '../../errors.js';

const INVALID_NAME = /[\\/:*?"<>|\u0000]/;

/**
 * Turns a client-supplied relative path into a normalized one ("" for the root),
 * rejecting anything that tries to climb out of the tree. Accepts `unknown` so
 * a non-string body field is a 400 rather than a crash.
 */
export function normalizeRelPath(input: unknown): string {
  if (input !== undefined && input !== null && typeof input !== 'string') throw badRequest('files.invalidPath');
  const raw = ((input as string | undefined | null) ?? '').replace(/\\/g, '/');
  if (raw.includes('\u0000')) throw badRequest('files.invalidPath');

  const parts: string[] = [];
  for (const segment of raw.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') throw badRequest('files.invalidPath');
    parts.push(segment);
  }
  return parts.join('/');
}

/**
 * `target` with every symlink resolved. The path may not exist yet (an upload,
 * a new folder), so the deepest existing ancestor is resolved and the missing
 * tail appended to it.
 */
function realpathOfExisting(target: string): string {
  let probe = target;
  let missing = '';
  for (;;) {
    try {
      const real = realpathSync.native(probe);
      return missing ? join(real, missing) : real;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw badRequest('files.invalidPath');
      const parent = dirname(probe);
      if (parent === probe) throw badRequest('files.invalidPath');
      missing = missing ? join(basename(probe), missing) : basename(probe);
      probe = parent;
    }
  }
}

/**
 * Resolves a relative path inside `root` and verifies it stayed there, so a
 * crafted path can never reach the rest of the filesystem. Checked twice:
 * lexically, and again after resolving symlinks, so a link inside the data
 * volume that points outside it (e.g. in a bind-mounted host folder) is
 * refused instead of followed.
 */
export function resolveSafePath(root: string, relPath: string): string {
  const normalizedRoot = resolve(root);
  const target = resolve(normalizedRoot, normalize(relPath));

  if (target !== normalizedRoot && !target.startsWith(normalizedRoot + sep)) {
    throw badRequest('files.invalidPath');
  }

  let realRoot: string;
  try {
    realRoot = realpathSync.native(normalizedRoot);
  } catch {
    throw notFound();
  }
  const realTarget = realpathOfExisting(target);
  if (realTarget !== realRoot && !realTarget.startsWith(realRoot + sep)) {
    throw badRequest('files.invalidPath');
  }
  return target;
}

/** Validates a single file or folder name typed by a user. */
export function assertValidName(name: string): void {
  if (!name || name === '.' || name === '..' || INVALID_NAME.test(name)) {
    throw badRequest('files.invalidName');
  }
}

export function joinRelPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

export function parentOf(relPath: string): string {
  const index = relPath.lastIndexOf('/');
  return index === -1 ? '' : relPath.slice(0, index);
}
