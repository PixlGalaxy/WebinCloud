import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import { UploadCloud } from 'lucide-react';
import { filesApi, type ConflictMode, type ExistingFile } from '../api/files';
import { publicShareApi } from '../api/shares';
import { postFile } from '../api/upload';
import ConflictModal from '../pages/files/ConflictModal';
import UploadDialog from '../components/upload/UploadDialog';
import { useI18n } from '../i18n/I18nContext';
import {
  pickedFromDrop,
  pickedFromList,
  useUploadQueue,
  type Picked,
  type UploadItem,
  type UploadScope,
} from '../components/upload/useUploadQueue';

interface Target {
  scope: UploadScope;
  path: string;
}

interface UploadContextValue {
  items: UploadItem[];
  running: boolean;
  dialogOpen: boolean;
  openDialog: () => void;
  closeDialog: () => void;
  /** Opens the system dialog, then queues whatever was chosen. */
  pickFiles: (scope: UploadScope, path: string) => void;
  pickFolder: (scope: UploadScope, path: string) => void;
  addPicked: (picked: Picked[], scope: UploadScope, path: string) => void;
  /** Where files dropped anywhere on the window go; null while the page takes none. */
  setDropTarget: (target: Target | null) => void;
  /** Add more to the target used last, from inside the dialog. */
  pickMoreFiles: () => void;
  pickMoreFolder: () => void;
  start: () => void;
  cancel: () => void;
  clear: () => void;
  remove: (id: number) => void;
  /** Called after each run ends, so a listing can refresh. Returns the unsubscribe. */
  onFinished: (listener: () => void) => () => void;
}

const UploadContext = createContext<UploadContextValue | undefined>(undefined);

interface Pending {
  conflicts: ExistingFile[];
  incoming: { name: string; size: number; lastModified: number }[];
  resolve: (mode: ConflictMode | null) => void;
}

export function UploadProvider({ children }: { children: ReactNode }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [dragging, setDragging] = useState(false);
  const target = useRef<Target>({ scope: { kind: 'user' }, path: '' });
  // The open page's folder, if it accepts uploads; otherwise drops go to the last target, while the dialog is up.
  const dropTarget = useRef<Target | null>(null);
  const picked = useRef(false);
  const dialogShown = useRef(false);

  useEffect(() => {
    dialogShown.current = dialogOpen;
  }, [dialogOpen]);
  const finishedListeners = useRef(new Set<() => void>());
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

  /** Asks what to do about files that would replace existing ones, once for the whole queue. */
  const confirm = async (todo: UploadItem[]): Promise<ConflictMode | null> => {
    // Public uploads never replace anything, so only the signed-in ones can clash.
    const own = todo.filter((item) => item.scope.kind === 'user');
    const dirs = [...new Set(own.map((item) => item.dir))];
    const conflicts: ExistingFile[] = [];
    const incoming: Pending['incoming'] = [];

    try {
      for (const dir of dirs) {
        const inDir = own.filter((item) => item.dir === dir);
        const found = await filesApi.checkConflicts(
          dir,
          inDir.map((item) => item.name),
        );
        for (const existing of found.conflicts) {
          const label = dir ? `${dir}/${existing.name}` : existing.name;
          const match = inDir.find((item) => item.name === existing.name)!;
          conflicts.push({ ...existing, name: label });
          incoming.push({ name: label, size: match.file.size, lastModified: match.file.lastModified });
        }
      }
    } catch {
      // A check that fails (say, an invalid name) shows up as that file's own error once it is sent.
      return 'fail';
    }

    if (conflicts.length === 0) return 'fail';
    return new Promise((resolve) => setPending({ conflicts, incoming, resolve }));
  };

  const queue = useUploadQueue({
    send: (item, mode, onProgress, signal) =>
      postFile(
        item.scope.kind === 'user'
          ? filesApi.uploadUrl(item.dir, mode)
          : publicShareApi.uploadUrl(item.scope.segment, item.scope.name, item.dir),
        item.file,
        onProgress,
        signal,
      ),
    confirm,
    onFinished: () => finishedListeners.current.forEach((listener) => listener()),
  });

  const { add } = queue;

  const addPicked = useCallback(
    (list: Picked[], scope: UploadScope, path: string) => {
      target.current = { scope, path };
      picked.current = true;
      if (list.length === 0) return;
      add(list, path, scope);
      setDialogOpen(true);
    },
    [add],
  );

  const choose = (e: ChangeEvent<HTMLInputElement>) => {
    addPicked(pickedFromList(e.target.files ?? []), target.current.scope, target.current.path);
    e.target.value = '';
  };

  const pick = (input: HTMLInputElement | null, scope: UploadScope, path: string) => {
    target.current = { scope, path };
    picked.current = true;
    input?.click();
  };

  // Files dragged in from the desktop can be dropped anywhere on the window, the dialog included.
  useEffect(() => {
    const withFiles = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files');
    const destination = () => dropTarget.current ?? (dialogShown.current && picked.current ? target.current : null);
    // dragenter/dragleave fire for every element crossed, so count them to know when the window is left.
    let depth = 0;

    const onEnter = (e: DragEvent) => {
      if (!withFiles(e)) return;
      depth += 1;
      setDragging(!!destination());
    };
    const onOver = (e: DragEvent) => {
      if (!withFiles(e)) return;
      // Without this the browser would open the file instead of handing it over.
      e.preventDefault();
      e.dataTransfer!.dropEffect = destination() ? 'copy' : 'none';
    };
    const onLeave = (e: DragEvent) => {
      if (!withFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!withFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      const to = destination();
      if (to) void pickedFromDrop(e.dataTransfer!).then((list) => addPicked(list, to.scope, to.path));
    };

    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [addPicked]);

  const setDropTarget = useCallback((next: Target | null) => {
    dropTarget.current = next;
  }, []);

  const onFinished = useCallback((listener: () => void) => {
    finishedListeners.current.add(listener);
    return () => {
      finishedListeners.current.delete(listener);
    };
  }, []);

  const value: UploadContextValue = {
    items: queue.items,
    running: queue.running,
    dialogOpen,
    openDialog: () => setDialogOpen(true),
    closeDialog: () => setDialogOpen(false),
    pickFiles: (scope, path) => pick(fileInput.current, scope, path),
    pickFolder: (scope, path) => pick(folderInput.current, scope, path),
    addPicked,
    setDropTarget,
    pickMoreFiles: () => fileInput.current?.click(),
    pickMoreFolder: () => folderInput.current?.click(),
    start: () => void queue.start(() => setDialogOpen(false)),
    cancel: queue.cancel,
    clear: queue.clear,
    remove: queue.remove,
    onFinished,
  };

  return (
    <UploadContext.Provider value={value}>
      {children}

      <input ref={fileInput} type="file" multiple hidden onChange={choose} />
      <input ref={folderInput} type="file" multiple hidden onChange={choose} {...({ webkitdirectory: '' } as object)} />

      {dialogOpen && <UploadDialog />}

      {dragging && <DropOverlay />}

      {pending && (
        <ConflictModal
          conflicts={pending.conflicts}
          incoming={pending.incoming}
          onCancel={() => {
            pending.resolve(null);
            setPending(null);
          }}
          onResolve={(mode) => {
            pending.resolve(mode);
            setPending(null);
          }}
        />
      )}
    </UploadContext.Provider>
  );
}

/** Shown while files are dragged over the window, above everything so the dialog takes drops too. */
function DropOverlay() {
  const { t } = useI18n();

  return (
    <div className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4">
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 rounded-2xl border-4 border-dashed border-[var(--accent-500)] bg-white/70 text-center dark:bg-slate-900/70">
        <UploadCloud size={48} className="text-[var(--accent-500)]" />
        <p className="text-lg font-semibold text-slate-900 dark:text-slate-100">{t('upload.dropHere')}</p>
      </div>
    </div>
  );
}

export function useUploads() {
  const ctx = useContext(UploadContext);
  if (!ctx) throw new Error('useUploads must be used within UploadProvider');
  return ctx;
}

/** Runs `listener` whenever an upload run ends, for as long as the caller is mounted. */
export function useUploadsFinished(listener: () => void) {
  const { onFinished } = useUploads();
  const latest = useRef(listener);

  useEffect(() => {
    latest.current = listener;
  });

  useEffect(() => onFinished(() => latest.current()), [onFinished]);
}

/** Lets files dropped anywhere on the window land in `path`, while `enabled` and the caller is mounted. */
export function useUploadDropTarget(scope: UploadScope, path: string, enabled: boolean) {
  const { setDropTarget } = useUploads();
  const scopeKey = JSON.stringify(scope);

  useEffect(() => {
    if (!enabled) return;
    setDropTarget({ scope: JSON.parse(scopeKey) as UploadScope, path });
    return () => setDropTarget(null);
  }, [setDropTarget, scopeKey, path, enabled]);
}
