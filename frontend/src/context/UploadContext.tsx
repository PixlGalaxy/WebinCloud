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
import { filesApi, type ConflictMode, type ExistingFile } from '../api/files';
import { publicShareApi } from '../api/shares';
import { postFile } from '../api/upload';
import ConflictModal from '../pages/files/ConflictModal';
import UploadDialog from '../components/upload/UploadDialog';
import {
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
  /** For drag and drop. */
  addPicked: (picked: Picked[], scope: UploadScope, path: string) => void;
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
  const target = useRef<Target>({ scope: { kind: 'user' }, path: '' });
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
    (picked: Picked[], scope: UploadScope, path: string) => {
      target.current = { scope, path };
      if (picked.length === 0) return;
      add(picked, path, scope);
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
    input?.click();
  };

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
