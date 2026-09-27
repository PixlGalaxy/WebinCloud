import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { DirEntry } from '../api/files';

export type ClipboardMode = 'copy' | 'cut';

export interface ClipboardState {
  mode: ClipboardMode;
  /** Folder the entries were copied/cut from, so a paste back into it can be blocked or allowed. */
  sourceFolder: string;
  entries: DirEntry[];
}

interface ClipboardContextValue {
  clipboard: ClipboardState | null;
  setClipboard: (mode: ClipboardMode, sourceFolder: string, entries: DirEntry[]) => void;
  clear: () => void;
}

const ClipboardContext = createContext<ClipboardContextValue | undefined>(undefined);

/**
 * Session-only clipboard for cut/copy: it lives above the router so it
 * survives folder navigation, but is not persisted — a reload starts empty,
 * same as a real OS clipboard would feel for this kind of transient intent.
 */
export function ClipboardProvider({ children }: { children: ReactNode }) {
  const [clipboard, setClipboardState] = useState<ClipboardState | null>(null);

  const setClipboard = useCallback((mode: ClipboardMode, sourceFolder: string, entries: DirEntry[]) => {
    setClipboardState({ mode, sourceFolder, entries });
  }, []);

  const clear = useCallback(() => setClipboardState(null), []);

  const value = useMemo(() => ({ clipboard, setClipboard, clear }), [clipboard, setClipboard, clear]);

  return <ClipboardContext.Provider value={value}>{children}</ClipboardContext.Provider>;
}

export function useClipboard() {
  const ctx = useContext(ClipboardContext);
  if (!ctx) throw new Error('useClipboard must be used within ClipboardProvider');
  return ctx;
}
