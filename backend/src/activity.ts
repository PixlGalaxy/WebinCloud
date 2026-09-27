import { logger } from './logger.js';

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
}
