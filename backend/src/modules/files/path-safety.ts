import { resolve, sep, normalize } from 'path';
import { badRequest } from '../../errors.js';

const INVALID_NAME = /[\\/:*?"<>|\u0000]/;

/**
 * Turns a client-supplied relative path into a normalized one ("" for the root),
 * rejecting anything that tries to climb out of the tree.
 */
export function normalizeRelPath(input: string | undefined): string {
  const raw = (input ?? '').replace(/\\/g, '/');
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
 * Resolves a relative path inside `root` and verifies it stayed there, so a
 * crafted path can never reach the rest of the filesystem.
 */
export function resolveSafePath(root: string, relPath: string): string {
  const normalizedRoot = resolve(root);
  const target = resolve(normalizedRoot, normalize(relPath));

  if (target !== normalizedRoot && !target.startsWith(normalizedRoot + sep)) {
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
