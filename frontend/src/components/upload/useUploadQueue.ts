import { useCallback, useRef, useState } from 'react';
import type { ConflictMode } from '../../api/files';

/** Where a file goes: the signed-in API, or a public share link. */
export type UploadScope = { kind: 'user' } | { kind: 'share'; segment: string; name: string };

export type UploadStatus = 'queued' | 'uploading' | 'done' | 'error' | 'cancelled';

export interface UploadItem {
  id: number;
  scope: UploadScope;
  file: File;
  /** Folder it lands in, relative to the data root (or to the share). */
  dir: string;
  name: string;
  status: UploadStatus;
  progress: number;
  error?: string;
}

/** A chosen file plus the folders it sat in inside a chosen folder ("" for a plain file). */
export interface Picked {
  file: File;
  relDir: string;
}

/** Parallel requests: enough to keep the link busy, few enough not to swamp the server. */
const CONCURRENCY = 3;

const join = (parent: string, child: string) => (parent && child ? `${parent}/${child}` : parent || child);

interface Options {
  send: (
    item: UploadItem,
    mode: ConflictMode,
    onProgress: (fraction: number) => void,
    signal: AbortSignal,
  ) => Promise<void>;
  /** Asked once before starting; returning null abandons the start. */
  confirm?: (items: UploadItem[]) => Promise<ConflictMode | null>;
  onFinished?: () => void;
}

export function useUploadQueue({ send, confirm, onFinished }: Options) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [running, setRunning] = useState(false);
  const nextId = useRef(1);
  const controller = useRef<AbortController | null>(null);

  const patch = useCallback((id: number, changes: Partial<UploadItem>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...changes } : item)));
  }, []);

  /** `targetPath` is where picked files land: the open folder, or the inner path of a share. */
  const add = (picked: Picked[], targetPath: string, scope: UploadScope) => {
    setItems((current) => {
      const key = (item: { scope: UploadScope; dir: string; name: string; file: File }) =>
        `${JSON.stringify(item.scope)}|${item.dir}/${item.name}|${item.file.size}|${item.file.lastModified}`;
      const waiting = new Set(current.filter((item) => item.status !== 'done').map(key));

      const fresh: UploadItem[] = [];
      for (const { file, relDir } of picked) {
        const candidate = { scope, dir: join(targetPath, relDir), name: file.name, file };
        const k = key(candidate);
        if (waiting.has(k)) continue;
        waiting.add(k);
        fresh.push({ id: nextId.current++, ...candidate, status: 'queued', progress: 0 });
      }
      return [...current, ...fresh];
    });
  };

  /** `onBegin` runs once the upload is really going, after any question was answered. */
  const start = async (onBegin?: () => void) => {
    if (running) return;
    const todo = items.filter((item) => item.status !== 'done' && item.status !== 'uploading');
    if (todo.length === 0) return;

    let mode: ConflictMode = 'fail';
    if (confirm) {
      const chosen = await confirm(todo);
      if (chosen === null) return;
      mode = chosen;
    }

    const abort = new AbortController();
    controller.current = abort;
    setRunning(true);
    onBegin?.();

    const ids = new Set(todo.map((item) => item.id));
    setItems((current) =>
      current.map((item) => (ids.has(item.id) ? { ...item, status: 'queued', progress: 0, error: undefined } : item)),
    );

    let cursor = 0;
    const worker = async () => {
      while (!abort.signal.aborted && cursor < todo.length) {
        const item = todo[cursor++];
        patch(item.id, { status: 'uploading', progress: 0 });

        let shown = 0;
        try {
          await send(
            item,
            mode,
            (fraction) => {
              // Whole percents only: hundreds of events per second would re-render the list for nothing.
              const percent = Math.floor(fraction * 100);
              if (percent === shown) return;
              shown = percent;
              patch(item.id, { progress: fraction });
            },
            abort.signal,
          );
          patch(item.id, { status: 'done', progress: 1 });
        } catch (err) {
          if (abort.signal.aborted) patch(item.id, { status: 'cancelled', progress: 0 });
          else patch(item.id, { status: 'error', error: err instanceof Error ? err.message : String(err) });
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));

    controller.current = null;
    setRunning(false);
    onFinished?.();
  };

  const cancel = () => controller.current?.abort();

  const remove = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id || item.status === 'uploading'));
  }, []);

  const clear = useCallback(() => {
    if (!running) setItems([]);
  }, [running]);

  return { items, running, add, start, cancel, remove, clear };
}

export function pickedFromList(list: FileList | File[]): Picked[] {
  return Array.from(list).map((file) => {
    const path = file.webkitRelativePath;
    const slash = path.lastIndexOf('/');
    return { file, relDir: slash === -1 ? '' : path.slice(0, slash) };
  });
}

const fileOf = (entry: FileSystemFileEntry) => new Promise<File>((resolve, reject) => entry.file(resolve, reject));

const childrenOf = async (entry: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> => {
  const reader = entry.createReader();
  const all: FileSystemEntry[] = [];
  // readEntries hands back a limited batch per call, until it returns an empty one.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (batch.length === 0) return all;
    all.push(...batch);
  }
};

async function walk(entry: FileSystemEntry, relDir: string, out: Picked[]): Promise<void> {
  if (entry.isFile) {
    out.push({ file: await fileOf(entry as FileSystemFileEntry), relDir });
  } else if (entry.isDirectory) {
    const here = join(relDir, entry.name);
    for (const child of await childrenOf(entry as FileSystemDirectoryEntry)) await walk(child, here, out);
  }
}

/** Files and whole folders dropped from the desktop. */
export async function pickedFromDrop(data: DataTransfer): Promise<Picked[]> {
  // The item list is only valid during the event, so take the entries before awaiting anything.
  const entries = Array.from(data.items ?? [])
    .map((item) => item.webkitGetAsEntry?.())
    .filter((entry): entry is FileSystemEntry => !!entry);

  if (entries.length === 0) return pickedFromList(data.files);

  const out: Picked[] = [];
  for (const entry of entries) await walk(entry, '', out);
  return out;
}
