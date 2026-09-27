import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { filesApi, type DirEntry } from '../../api/files';
import FileIcon from './FileIcon';

/** Rows this far below the fold start loading, so scrolling rarely shows an empty tile. */
const LOAD_MARGIN = '300px';

/** Hovering must last this long, so sweeping the cursor past a column does not fetch every large preview. */
const HOVER_DELAY_MS = 250;

const PREVIEW_MAX = 420;
const GAP = 12;

/** True once the element has come near the viewport; it stays true after that. */
function useNearViewport(ref: React.RefObject<Element | null>): boolean {
  const [near, setNear] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || near) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true);
      },
      { rootMargin: LOAD_MARGIN },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, near]);

  return near;
}

function HoverPreview({ entry, anchor }: { entry: DirEntry; anchor: DOMRect }) {
  const [loaded, setLoaded] = useState(false);

  // To the right of the tile when it fits, otherwise to the left, and never off the screen.
  const room = window.innerWidth - anchor.right - GAP;
  const left = room >= PREVIEW_MAX ? anchor.right + GAP : Math.max(8, anchor.left - GAP - PREVIEW_MAX);
  const top = Math.min(Math.max(8, anchor.top + anchor.height / 2 - PREVIEW_MAX / 2), window.innerHeight - PREVIEW_MAX - 8);

  return createPortal(
    <div
      className={`pointer-events-none fixed z-50 flex items-center justify-center rounded-xl border border-slate-200 bg-white p-1.5 shadow-2xl transition-opacity duration-150 dark:border-slate-600 dark:bg-slate-800 ${
        loaded ? 'opacity-100' : 'opacity-0'
      }`}
      style={{ left, top, maxWidth: PREVIEW_MAX, maxHeight: PREVIEW_MAX }}
    >
      <img
        src={filesApi.thumbnailUrl(entry.path, entry.modifiedAt, 'lg')}
        alt={entry.name}
        onLoad={() => setLoaded(true)}
        className="rounded-lg object-contain"
        style={{ maxWidth: PREVIEW_MAX - 12, maxHeight: PREVIEW_MAX - 12 }}
      />
    </div>,
    document.body,
  );
}

interface Props {
  entry: DirEntry;
  /** Classes for the icon shown when there is no thumbnail. */
  iconClass: string;
}

/** A square tile: the file's own thumbnail when it has one, its icon otherwise. */
const EntryThumbnail = ({ entry, iconClass }: Props) => {
  const tile = useRef<HTMLSpanElement>(null);
  const near = useNearViewport(tile);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [hover, setHover] = useState<DOMRect | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const showImage = entry.thumbnail && !failed;

  return (
    <span
      ref={tile}
      onMouseEnter={() => {
        if (!showImage || !ready) return;
        timer.current = window.setTimeout(() => {
          if (tile.current) setHover(tile.current.getBoundingClientRect());
        }, HOVER_DELAY_MS);
      }}
      onMouseLeave={() => {
        window.clearTimeout(timer.current);
        setHover(null);
      }}
      className="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800"
    >
      <FileIcon type={entry.type} name={entry.name} size={34} className={iconClass} showLogo />

      {showImage && near && (
        <img
          src={filesApi.thumbnailUrl(entry.path, entry.modifiedAt, 'sm')}
          alt=""
          decoding="async"
          onLoad={() => setReady(true)}
          onError={() => setFailed(true)}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-200 ${
            ready ? 'opacity-100' : 'opacity-0'
          }`}
        />
      )}

      {hover && <HoverPreview entry={entry} anchor={hover} />}
    </span>
  );
};

export default EntryThumbnail;
