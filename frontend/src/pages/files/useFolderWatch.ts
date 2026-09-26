import { useEffect } from 'react';
import { filesApi } from '../../api/files';

/**
 * Subscribes to server-sent events for a folder so the listing refreshes as
 * soon as something changes on disk, no matter who changed it.
 */
export function useFolderWatch(path: string, onChange: () => void) {
  useEffect(() => {
    const source = new EventSource(filesApi.eventsUrl(path));
    source.onmessage = () => onChange();
    // The browser retries on its own; closing here would stop that.
    source.onerror = () => undefined;

    return () => source.close();
  }, [path, onChange]);
}
