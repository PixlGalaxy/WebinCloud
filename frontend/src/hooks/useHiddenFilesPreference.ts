import { useCallback, useState } from 'react';
import { useAppConfig } from '../context/AppConfigContext';

const KEY = 'webincloud.showHiddenFiles';

/** null when this browser never chose, so the admin's default applies. */
function read(): boolean | null {
  try {
    const value = localStorage.getItem(KEY);
    return value === null ? null : value === '1';
  } catch {
    return null;
  }
}

/** Dotfiles and dot-folders (.env, .git, .gitkeep...), hidden by default like most file managers. */
export function isHiddenName(name: string): boolean {
  return name.startsWith('.');
}

/** True when any segment of a relative path is hidden, e.g. ".git/config". */
export function isHiddenPath(path: string): boolean {
  return path.split('/').some(isHiddenName);
}

/**
 * Whether file lists show hidden entries. Per-browser, like the thumbnails
 * toggle: the file explorer toolbar and Settings share it. Until the user picks
 * one, it follows the admin's system-wide default (Admin Panel -> Settings).
 * Display only — hidden entries stay reachable through the API.
 */
export function useHiddenFilesPreference() {
  const { showHiddenFilesDefault } = useAppConfig();
  const [own, setOwn] = useState(read);

  const setShowHidden = useCallback((value: boolean) => {
    setOwn(value);
    try {
      localStorage.setItem(KEY, value ? '1' : '0');
    } catch {
      // Blocked storage: the choice just won't survive a reload.
    }
  }, []);

  return { showHidden: own ?? showHiddenFilesDefault, setShowHidden };
}
