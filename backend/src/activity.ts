import { logger } from './logger.js';
import { changes } from './modules/devices/change-bus.js';

/** Actions that only read; everything else changed the folder the item is in. */
const READ_ONLY = new Set(['downloaded', 'shared', 'unshared']);

/** Who did it, as it reads in the [SYSTEM] log. */
export type Actor = string;

/** Anyone holding a public link: there is no account to name. */
export const PUBLIC_ACTOR: Actor = 'PublicShareFolderClient';

export const userActor = (user: { username: string }): Actor => `User: ${user.username}`;

export function logFileAction(
  actor: Actor,
  action: string,
  kind: 'file' | 'folder',
  name: string,
  absolute: string,
): void {
  logger.system.info(`${actor} ${action} ${kind}: ${name} on ${absolute}`);
  if (!READ_ONLY.has(action)) changes.touched(absolute);
}
