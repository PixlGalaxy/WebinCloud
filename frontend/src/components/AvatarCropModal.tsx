import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Loader2, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import Modal from './ui/Modal';
import { btn } from './ui/styles';

interface Props {
  file: File;
  onCancel: () => void;
  onConfirm: (cropped: File) => Promise<void> | void;
}

/** Crop center (in natural image pixels) plus zoom relative to "cover the frame". */
interface View {
  zoom: number;
  cx: number;
  cy: number;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;
const OUTPUT_SIZE = 512;
const KEY_PAN_PX = 10;

const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

/** Keeps the square crop inside the image so the frame never shows empty space. */
function clampView(view: View, width: number, height: number): View {
  const zoom = clampZoom(view.zoom);
  const half = Math.min(width, height) / zoom / 2;
  return {
    zoom,
    cx: Math.min(width - half, Math.max(half, view.cx)),
    cy: Math.min(height - half, Math.max(half, view.cy)),
  };
}

/** Pointer position relative to the element's center. */
function fromCenter(el: HTMLElement, clientX: number, clientY: number) {
  const rect = el.getBoundingClientRect();
  return { x: clientX - rect.left - rect.width / 2, y: clientY - rect.top - rect.height / 2 };
}

const AvatarCropModal = ({ file, onCancel, onConfirm }: Props) => {
  const { t } = useI18n();

  const [src, setSrc] = useState('');
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [view, setView] = useState<View>({ zoom: 1, cx: 0, cy: 0 });
  const [frame, setFrame] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);

  const frameRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());

  useEffect(() => {
    const reader = new FileReader();
    reader.onload = () => setSrc(reader.result as string);
    reader.readAsDataURL(file);
    return () => reader.abort();
  }, [file]);

  // The frame is as wide as the modal allows, so track its size for the px <-> image mapping.
  useLayoutEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setFrame(el.clientWidth));
    observer.observe(el);
    setFrame(el.clientWidth);
    return () => observer.disconnect();
  }, []);

  /** Screen pixels per image pixel at the given zoom. */
  const scaleFor = useCallback(
    (zoom: number) => (natural && frame ? (frame / Math.min(natural.width, natural.height)) * zoom : 1),
    [natural, frame],
  );

  const update = useCallback(
    (fn: (prev: View) => View) => {
      if (!natural) return;
      setView((prev) => clampView(fn(prev), natural.width, natural.height));
    },
    [natural],
  );

  const pan = useCallback(
    (dx: number, dy: number) =>
      update((prev) => {
        const scale = scaleFor(prev.zoom);
        return { ...prev, cx: prev.cx - dx / scale, cy: prev.cy - dy / scale };
      }),
    [update, scaleFor],
  );

  /** Zooms keeping the image point under (px, py) — offsets from the frame center — in place. */
  const zoomAt = useCallback(
    (next: number | ((zoom: number) => number), px = 0, py = 0) =>
      update((prev) => {
        const zoom = clampZoom(typeof next === 'function' ? next(prev.zoom) : next);
        const before = scaleFor(prev.zoom);
        const after = scaleFor(zoom);
        return { zoom, cx: prev.cx + px / before - px / after, cy: prev.cy + py / before - py / after };
      }),
    [update, scaleFor],
  );

  // React registers wheel listeners as passive, so preventDefault needs a native one.
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { x, y } = fromCenter(el, e.clientX, e.clientY);
      zoomAt((zoom) => zoom * Math.exp(-e.deltaY * 0.0015), x, y);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setDragging(true);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const map = pointers.current;
    const prev = map.get(e.pointerId);
    if (!prev) return;

    if (map.size === 1) {
      map.set(e.pointerId, { x: e.clientX, y: e.clientY });
      pan(e.clientX - prev.x, e.clientY - prev.y);
      return;
    }

    // Pinch: zoom by the change in finger distance around their midpoint, and pan with the midpoint.
    const [a, b] = [...map.values()];
    const beforeDist = Math.hypot(a.x - b.x, a.y - b.y);
    const beforeMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    map.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const [c, d] = [...map.values()];
    const afterDist = Math.hypot(c.x - d.x, c.y - d.y);
    const afterMid = { x: (c.x + d.x) / 2, y: (c.y + d.y) / 2 };

    if (beforeDist > 0) {
      const { x, y } = fromCenter(e.currentTarget, afterMid.x, afterMid.y);
      zoomAt((zoom) => zoom * (afterDist / beforeDist), x, y);
    }
    pan(afterMid.x - beforeMid.x, afterMid.y - beforeMid.y);
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) setDragging(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [KEY_PAN_PX, 0],
      ArrowRight: [-KEY_PAN_PX, 0],
      ArrowUp: [0, KEY_PAN_PX],
      ArrowDown: [0, -KEY_PAN_PX],
    };
    if (moves[e.key]) {
      e.preventDefault();
      pan(...moves[e.key]);
    } else if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      zoomAt((zoom) => zoom * 1.1);
    } else if (e.key === '-') {
      e.preventDefault();
      zoomAt((zoom) => zoom / 1.1);
    }
  };

  const reset = () => {
    if (natural) setView({ zoom: 1, cx: natural.width / 2, cy: natural.height / 2 });
  };

  const confirm = async () => {
    const img = imgRef.current;
    if (!img || !natural) return;
    setSaving(true);
    try {
      const crop = Math.min(natural.width, natural.height) / view.zoom;
      // Never upscale a small crop: it only adds bytes, not detail.
      const size = Math.max(1, Math.round(Math.min(OUTPUT_SIZE, crop)));
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, view.cx - crop / 2, view.cy - crop / 2, crop, crop, 0, 0, size, size);

      // JPEG stays JPEG; anything else may carry transparency, so keep it lossless-capable.
      const type = file.type === 'image/jpeg' ? 'image/jpeg' : file.type === 'image/webp' ? 'image/webp' : 'image/png';
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.92));
      if (!blob) throw new Error('Canvas export failed');
      const ext = blob.type.split('/')[1] === 'jpeg' ? 'jpg' : blob.type.split('/')[1];
      const base = file.name.replace(/\.[^.]+$/, '') || 'avatar';
      await onConfirm(new File([blob], `${base}.${ext}`, { type: blob.type }));
    } finally {
      setSaving(false);
    }
  };

  const scale = scaleFor(view.zoom);

  return (
    <Modal title={t('account.cropTitle')} onClose={saving ? () => undefined : onCancel}>
      <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">{t('account.cropHint')}</p>

      <div
        ref={frameRef}
        tabIndex={0}
        role="application"
        aria-label={t('account.cropTitle')}
        className={`relative mx-auto aspect-square w-full max-w-80 touch-none select-none overflow-hidden rounded-xl bg-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-500)] ${
          dragging ? 'cursor-grabbing' : 'cursor-grab'
        }`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={onKeyDown}
        onDoubleClick={reset}
      >
        {src && (
          <img
            ref={imgRef}
            src={src}
            alt=""
            draggable={false}
            onLoad={(e) => {
              const { naturalWidth: width, naturalHeight: height } = e.currentTarget;
              setNatural({ width, height });
              setView({ zoom: 1, cx: width / 2, cy: height / 2 });
            }}
            className={`pointer-events-none absolute left-0 top-0 max-w-none origin-top-left ${natural ? '' : 'invisible'}`}
            style={
              natural
                ? {
                    width: natural.width * scale,
                    height: natural.height * scale,
                    transform: `translate(${frame / 2 - view.cx * scale}px, ${frame / 2 - view.cy * scale}px)`,
                  }
                : undefined
            }
          />
        )}

        {!natural && (
          <div className="absolute inset-0 flex items-center justify-center text-slate-400">
            <Loader2 className="animate-spin" size={24} />
          </div>
        )}

        {/* Dims everything outside the circle the avatar is shown in. */}
        <div className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_9999px_rgba(15,23,42,0.55)]" />

        {/* Rule-of-thirds grid, brighter while dragging. */}
        <div
          className={`pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3 transition-opacity ${
            dragging ? 'opacity-90' : 'opacity-40'
          }`}
        >
          {Array.from({ length: 9 }, (_, i) => (
            <div
              key={i}
              className={`border-white/70 ${i % 3 !== 2 ? 'border-r' : ''} ${i < 6 ? 'border-b' : ''}`}
            />
          ))}
        </div>
        <div className="pointer-events-none absolute inset-0 rounded-full border-2 border-white/80" />
      </div>

      <div className="mx-auto mt-4 flex max-w-80 items-center gap-3">
        <button
          type="button"
          onClick={() => zoomAt((zoom) => zoom / 1.2)}
          disabled={!natural || view.zoom <= MIN_ZOOM}
          className={btn.iconGhost}
          title={t('account.zoomOut')}
        >
          <ZoomOut size={18} />
        </button>
        <input
          type="range"
          min={MIN_ZOOM}
          max={MAX_ZOOM}
          step={0.01}
          value={view.zoom}
          disabled={!natural}
          onChange={(e) => zoomAt(Number(e.target.value))}
          aria-label={t('account.zoom')}
          className="h-1.5 flex-1 cursor-pointer accent-[var(--accent-600)]"
        />
        <button
          type="button"
          onClick={() => zoomAt((zoom) => zoom * 1.2)}
          disabled={!natural || view.zoom >= MAX_ZOOM}
          className={btn.iconGhost}
          title={t('account.zoomIn')}
        >
          <ZoomIn size={18} />
        </button>
        <button
          type="button"
          onClick={reset}
          disabled={!natural}
          className={btn.iconGhost}
          title={t('account.resetCrop')}
        >
          <RotateCcw size={16} />
        </button>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <button type="button" onClick={onCancel} disabled={saving} className={btn.secondary}>
          {t('common.cancel')}
        </button>
        <button type="button" onClick={() => void confirm()} disabled={!natural || saving} className={btn.primary}>
          {saving && <Loader2 className="animate-spin" size={16} />}
          {t('common.save')}
        </button>
      </div>
    </Modal>
  );
};

export default AvatarCropModal;
