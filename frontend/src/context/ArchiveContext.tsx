import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { archivesApi, type ArchiveJob } from '../api/archives';
import { ApiError } from '../api/client';

interface ArchiveContextValue {
  jobs: ArchiveJob[];
  createArchive: (paths: string[]) => Promise<void>;
  dismiss: (id: string) => void;
}

const ArchiveContext = createContext<ArchiveContextValue | undefined>(undefined);

const STORAGE_KEY = 'webincloud.archives';

/** Job ids survive a reload here; the work itself lives on the server. */
function readStoredIds(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

function storeIds(ids: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Private mode or blocked storage: the tray just won't survive a reload.
  }
}

/** Starts the download without navigating away from the app. */
function triggerDownload(job: ArchiveJob): void {
  const link = document.createElement('a');
  link.href = archivesApi.downloadUrl(job.id);
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
  const [jobs, setJobs] = useState<ArchiveJob[]>([]);
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
    (id: string) => {
      const timer = window.setInterval(async () => {
        try {
          const job = await archivesApi.get(id);
          setJobs((current) => current.map((item) => (item.id === id ? job : item)));

          if (job.status === 'done' || job.status === 'error') {
            stopPolling(id);
            if (job.status === 'done' && !downloaded.current.has(id)) {
              downloaded.current.add(id);
              triggerDownload(job);
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

  const createArchive = useCallback(
    async (paths: string[]) => {
      const job = await archivesApi.start(paths);
      setJobs((current) => [...current, job]);
      storeIds([...readStoredIds(), job.id]);
      poll(job.id);
    },
    [poll],
  );

  // Reattaches to jobs still running on the server after a reload.
  useEffect(() => {
    const ids = readStoredIds();
    if (ids.length === 0) return;

    void Promise.all(
      ids.map((id) =>
        archivesApi
          .get(id)
          .then((job) => job)
          .catch(() => null),
      ),
    ).then((recovered) => {
      const alive = recovered.filter((job): job is ArchiveJob => job !== null);
      setJobs(alive);
      storeIds(alive.map((job) => job.id));
      for (const job of alive) {
        if (job.status === 'preparing' || job.status === 'running') poll(job.id);
        // Already finished before this page loaded: leave it to the button
        // rather than starting a download the user did not just ask for.
        else if (job.status === 'done') downloaded.current.add(job.id);
      }
    });
  }, [poll]);

  const dismiss = useCallback(
    (id: string) => {
      stopPolling(id);
      storeIds(readStoredIds().filter((stored) => stored !== id));

      setJobs((current) => {
        const job = current.find((item) => item.id === id);
        // Cancelling frees the work immediately, but a finished archive may
        // still be downloading, so leave it for the server's own cleanup.
        if (job && job.status !== 'done') void archivesApi.remove(id).catch(() => undefined);
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
    <ArchiveContext.Provider value={{ jobs, createArchive, dismiss }}>{children}</ArchiveContext.Provider>
  );
}

export function useArchives() {
  const ctx = useContext(ArchiveContext);
  if (!ctx) throw new Error('useArchives must be used within ArchiveProvider');
  return ctx;
}
