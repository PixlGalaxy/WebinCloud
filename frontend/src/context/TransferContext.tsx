import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { transfersApi, type TransferJob } from '../api/transfers';
import type { ConflictMode } from '../api/files';
import { ApiError } from '../api/client';

export interface TrackedTransfer extends TransferJob {
  /** Computed client-side when the copy starts, so the panel has something to show. */
  label: string;
}

interface TransferContextValue {
  jobs: TrackedTransfer[];
  startCopy: (paths: string[], destination: string, onConflict: ConflictMode, label: string) => Promise<void>;
  dismiss: (id: string) => void;
}

const TransferContext = createContext<TransferContextValue | undefined>(undefined);

const STORAGE_KEY = 'webincloud.transfers';

interface StoredJob {
  id: string;
  label: string;
}

/** Job ids (and their label) survive a reload here; the work itself lives on the server. */
function readStored(): StoredJob[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is StoredJob =>
        typeof item === 'object' &&
        item !== null &&
        typeof (item as StoredJob).id === 'string' &&
        typeof (item as StoredJob).label === 'string',
    );
  } catch {
    return [];
  }
}

function store(items: StoredJob[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Private mode or blocked storage: the tray just won't survive a reload.
  }
}

/**
 * Lives above the router so copies keep running — and stay visible — while
 * the user navigates elsewhere.
 */
export function TransferProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<TrackedTransfer[]>([]);
  const timers = useRef(new Map<string, number>());

  const stopPolling = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      clearInterval(timer);
      timers.current.delete(id);
    }
  }, []);

  const poll = useCallback(
    (id: string, label: string) => {
      const timer = window.setInterval(async () => {
        try {
          const fresh = await transfersApi.get(id);
          setJobs((current) => current.map((item) => (item.id === id ? { ...fresh, label } : item)));

          if (fresh.status === 'done' || fresh.status === 'error') {
            stopPolling(id);
            store(readStored().filter((item) => item.id !== id));
          }
        } catch (err) {
          stopPolling(id);
          setJobs((current) =>
            current.map((item) =>
              item.id === id
                ? { ...item, status: 'error', error: err instanceof ApiError ? err.message : undefined }
                : item,
            ),
          );
        }
      }, 500);
      timers.current.set(id, timer);
    },
    [stopPolling],
  );

  const track = useCallback(
    (job: TransferJob, label: string) => {
      setJobs((current) => [...current, { ...job, label }]);
      store([...readStored(), { id: job.id, label }]);
      poll(job.id, label);
    },
    [poll],
  );

  const startCopy = useCallback(
    async (paths: string[], destination: string, onConflict: ConflictMode, label: string) => {
      track(await transfersApi.start(paths, destination, onConflict), label);
    },
    [track],
  );

  // Reattaches to jobs still running on the server after a reload.
  useEffect(() => {
    const stored = readStored();
    if (stored.length === 0) return;

    void Promise.all(
      stored.map((item) =>
        transfersApi
          .get(item.id)
          .then((job): TrackedTransfer => ({ ...job, label: item.label }))
          .catch(() => null),
      ),
    ).then((recovered) => {
      const alive = recovered.filter((job): job is TrackedTransfer => job !== null);
      setJobs(alive);
      store(alive.map((job) => ({ id: job.id, label: job.label })));

      for (const job of alive) {
        if (job.status === 'preparing' || job.status === 'running') poll(job.id, job.label);
      }
    });
  }, [poll]);

  const dismiss = useCallback(
    (id: string) => {
      stopPolling(id);
      store(readStored().filter((item) => item.id !== id));

      setJobs((current) => {
        const job = current.find((item) => item.id === id);
        if (job && job.status !== 'done') void transfersApi.remove(id).catch(() => undefined);
        return current.filter((item) => item.id !== id);
      });
    },
    [stopPolling],
  );

  // Closing the tab kills the connection but not the server-side job; warn
  // anyway, since the user would lose track of the copy.
  useEffect(() => {
    const running = jobs.some((job) => job.status === 'preparing' || job.status === 'running');
    if (!running) return;

    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [jobs]);

  useEffect(() => {
    const active = timers.current;
    return () => {
      for (const timer of active.values()) clearInterval(timer);
      active.clear();
    };
  }, []);

  return (
    <TransferContext.Provider value={{ jobs, startCopy, dismiss }}>{children}</TransferContext.Provider>
  );
}

export function useTransfers() {
  const ctx = useContext(TransferContext);
  if (!ctx) throw new Error('useTransfers must be used within TransferProvider');
  return ctx;
}
