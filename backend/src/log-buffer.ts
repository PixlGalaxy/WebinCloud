export interface LogEntry {
  id: number;
  time: string;
  channel: 'BACKEND' | 'AUTH' | 'SYSTEM';
  level: 'INFO' | 'WARN' | 'ERROR';
  message: string;
}

/** Bounds memory, and the deepest page an admin can page back to. */
const CAPACITY = 5000;

const entries: LogEntry[] = [];
const listeners = new Set<(entry: LogEntry) => void>();
let nextId = 1;

export const logBuffer = {
  push(entry: Omit<LogEntry, 'id'>): void {
    const stored = { id: nextId++, ...entry };
    entries.push(stored);
    if (entries.length > CAPACITY) entries.shift();
    for (const listener of listeners) listener(stored);
  },

  /** Newest first. Page 1 is the most recent `limit` entries. */
  page(limit: number, page: number): { entries: LogEntry[]; total: number; pages: number; capacity: number } {
    const total = entries.length;
    const pages = Math.max(1, Math.ceil(total / limit));
    const end = total - (page - 1) * limit;
    const slice = end <= 0 ? [] : entries.slice(Math.max(0, end - limit), end);
    return { entries: slice.reverse(), total, pages, capacity: CAPACITY };
  },

  /** Entries newer than `id`, oldest first, for a stream catching up. */
  since(id: number): LogEntry[] {
    return entries.filter((entry) => entry.id > id);
  },

  subscribe(listener: (entry: LogEntry) => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};
