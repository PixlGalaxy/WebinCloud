import { EventEmitter } from 'events';
import { dirname, relative, sep } from 'path';

/** Changes inside one folder this close together reach the apps as one notice. */
const SETTLE_MS = 250;

/**
 * Tells connected desktop apps which folder changed, so they can refresh it:
 * an edited file becomes a fresh cloud placeholder, new entries appear and
 * deleted ones go. Fed by every file action the app performs (web interface,
 * desktop apps, public upload links); changes made outside the app, over SMB,
 * are not seen yet.
 */
class ChangeBus extends EventEmitter {
  private dataRoot = '';
  private pending = new Map<string, NodeJS.Timeout>();

  init(dataRoot: string): void {
    this.dataRoot = dataRoot;
    // One listener per connected app.
    this.setMaxListeners(0);
  }

  /** `absolute` was created, changed or removed: its folder changed. */
  touched(absolute: string): void {
    this.folderChanged(dirname(absolute));
  }

  folderChanged(absoluteFolder: string): void {
    if (!this.dataRoot) return;
    const rel = relative(this.dataRoot, absoluteFolder);
    if (rel.startsWith('..')) return;
    const folder = rel.split(sep).join('/');

    clearTimeout(this.pending.get(folder));
    this.pending.set(
      folder,
      setTimeout(() => {
        this.pending.delete(folder);
        this.emit('changed', folder);
      }, SETTLE_MS),
    );
  }
}

export const changes = new ChangeBus();
