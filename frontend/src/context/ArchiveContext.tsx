import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { archivesApi, type ArchiveJob } from '../api/archives';
import { publicShareApi } from '../api/shares';
import { ApiError } from '../api/client';

/** Where a job lives: the signed-in API, or a public share link. */
export type ArchiveScope = { kind: 'user' } | { kind: 'share'; segment: string; name: string };

export interface TrackedJob extends ArchiveJob {
  scope: ArchiveScope;
}

interface ArchiveContextValue {
  jobs: TrackedJob[];
  createArchive: (paths: string[]) => Promise<void>;
  createShareArchive: (segment: string, name: string, paths: string[]) => Promise<void>;
  dismiss: (id: string) => void;
}

const ArchiveContext = createContext<ArchiveContextValue | undefined>(undefined);

const STORAGE_KEY = 'webincloud.archives';

interface StoredJob {
  id: string;
  scope: ArchiveScope;
}

/** Job ids survive a reload here; the work itself lives on the server. */
function readStored(): StoredJob[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is StoredJob =>
        typeof item === 'object' && item !== null && typeof (item as StoredJob).id === 'string',
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

function fetchJob(id: string, scope: ArchiveScope): Promise<ArchiveJob> {
  return scope.kind === 'user'
    ? archivesApi.get(id)
    : publicShareApi.getArchive(scope.segment, scope.name, id);
}

export function downloadUrlFor(job: TrackedJob): string {
  return job.scope.kind === 'user'
    ? archivesApi.downloadUrl(job.id)
    : publicShareApi.archiveDownloadUrl(job.scope.segment, job.scope.name, job.id);
}

/** Starts the download without navigating away from the app. */
function triggerDownload(job: TrackedJob): void {
  const link = document.createElement('a');
  link.href = downloadUrlFor(job);
  link.download = job.fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

/**
 * Lives above the router so archives keep building — and stay visible — while
 * the user navigates elsewhere.
 */
export function ArchiveProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<TrackedJob[]>([]);
  const timers = useRef(new Map<string, number>());
  // Archives whose download already fired, so a reload does not repeat it.
  const downloaded = useRef(new Set<string>());

  const stopPolling = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      clearInterval(timer);
      timers.current.delete(id);
    }
  }, []);

  const poll = useCallback(
    (id: string, scope: ArchiveScope) => {
      const timer = window.setInterval(async () => {
        try {
          const fresh = await fetchJob(id, scope);
          const tracked: TrackedJob = { ...fresh, scope };
          setJobs((current) => current.map((item) => (item.id === id ? tracked : item)));

          if (fresh.status === 'done' || fresh.status === 'error') {
            stopPolling(id);
            if (fresh.status === 'done' && !downloaded.current.has(id)) {
              downloaded.current.add(id);
              triggerDownload(tracked);
            }
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
    (job: ArchiveJob, scope: ArchiveScope) => {
      setJobs((current) => [...current, { ...job, scope }]);
      store([...readStored(), { id: job.id, scope }]);
      poll(job.id, scope);
    },
    [poll],
  );

  const createArchive = useCallback(
    async (paths: string[]) => {
      track(await archivesApi.start(paths), { kind: 'user' });
    },
    [track],
  );

  const createShareArchive = useCallback(
    async (segment: string, name: string, paths: string[]) => {
      track(await publicShareApi.startArchive(segment, name, paths), { kind: 'share', segment, name });
    },
    [track],
  );

  // Reattaches to jobs still running on the server after a reload.
  useEffect(() => {
    const stored = readStored();
    if (stored.length === 0) return;

    void Promise.all(
      stored.map((item) =>
        fetchJob(item.id, item.scope)
          .then((job): TrackedJob => ({ ...job, scope: item.scope }))
          .catch(() => null),
      ),
    ).then((recovered) => {
      const alive = recovered.filter((job): job is TrackedJob => job !== null);
      setJobs(alive);
      store(alive.map((job) => ({ id: job.id, scope: job.scope })));

      for (const job of alive) {
        if (job.status === 'preparing' || job.status === 'running') poll(job.id, job.scope);
        // Already finished before this page loaded: leave it to the button
        // rather than starting a download the user did not just ask for.
        else if (job.status === 'done') downloaded.current.add(job.id);
      }
    });
  }, [poll]);

  const dismiss = useCallback(
    (id: string) => {
      stopPolling(id);
      store(readStored().filter((item) => item.id !== id));

      setJobs((current) => {
        const job = current.find((item) => item.id === id);
        // Cancelling frees the work immediately, but a finished archive may
        // still be downloading, so leave it for the server's own cleanup.
        if (job && job.status !== 'done') {
          const request =
            job.scope.kind === 'user'
              ? archivesApi.remove(id)
              : publicShareApi.removeArchive(job.scope.segment, job.scope.name, id);
          void request.catch(() => undefined);
        }
        return current.filter((item) => item.id !== id);
      });
    },
    [stopPolling],
  );

  // Closing the tab kills the connection but not the server-side job; warn
  // anyway, since the user would lose track of the download.
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
    <ArchiveContext.Provider value={{ jobs, createArchive, createShareArchive, dismiss }}>
      {children}
    </ArchiveContext.Provider>
  );
}

export function useArchives() {
  const ctx = useContext(ArchiveContext);
  if (!ctx) throw new Error('useArchives must be used within ArchiveProvider');
  return ctx;
}
