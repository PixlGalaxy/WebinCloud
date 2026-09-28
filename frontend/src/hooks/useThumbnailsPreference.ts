import { useCallback, useState } from 'react';

const KEY = 'webincloud.thumbnails';

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Whether the file list always shows thumbnails instead of plain icons.
 * Per-browser, same key the file explorer's toolbar toggle already used —
 * this just lets Settings show and change the same preference.
 */
export function useThumbnailsPreference() {
  const [thumbnails, setThumbnailsState] = useState(read);

  const setThumbnails = useCallback((value: boolean) => {
    setThumbnailsState(value);
    try {
      localStorage.setItem(KEY, value ? '1' : '0');
    } catch {
      // Blocked storage: the choice just won't survive a reload.
    }
  }, []);

  return { thumbnails, setThumbnails };
}
