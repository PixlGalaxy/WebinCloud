import { useCallback, useState } from 'react';

const KEY = 'webincloud.autoplayVideos';

function read(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'false';
  } catch {
    return true;
  }
}

/**
 * Whether video previews start playing immediately. Kept per-browser in
 * localStorage rather than the account: it is a small viewing convenience,
 * not identity data that should follow the user to another device.
 */
export function useAutoplayVideos() {
  const [autoplay, setAutoplayState] = useState(read);

  const setAutoplay = useCallback((value: boolean) => {
    setAutoplayState(value);
    try {
      localStorage.setItem(KEY, String(value));
    } catch {
      // Private browsing or blocked storage: the choice just won't survive a reload.
    }
  }, []);

  return { autoplay, setAutoplay };
}
