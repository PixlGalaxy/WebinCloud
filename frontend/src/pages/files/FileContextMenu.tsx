import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Copy,
  Download,
  Eye,
  FileArchive,
  ClipboardPaste,
  Pencil,
  Scissors,
  Share2,
  Trash2,
} from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';

interface MenuItem {
  key: string;
  icon: typeof Copy;
  label: string;
  onClick: () => void;
  danger?: boolean;
}

interface Props {
  x: number;
  y: number;
  onClose: () => void;
  /** True when the target is the whole current multi-selection, not just the clicked row. */
  multi: boolean;
  canWrite: boolean;
  previewable?: boolean;
  isFolder?: boolean;
  onPreview?: () => void;
  onDownload?: () => void;
  onShare?: () => void;
  onRename?: () => void;
  onDelete?: () => void;
  onCopy: () => void;
  onCut?: () => void;
  onDownloadEach?: () => void;
  onDownloadZip?: () => void;
  canPaste: boolean;
  onPaste?: () => void;
}

/** Floating menu positioned at the click point, clamped so it never runs off-screen. */
const FileContextMenu = ({
  x,
  y,
  onClose,
  multi,
  canWrite,
  previewable,
  isFolder,
  onPreview,
  onDownload,
  onShare,
  onRename,
  onDelete,
  onCopy,
  onCut,
  onDownloadEach,
  onDownloadZip,
  canPaste,
  onPaste,
}: Props) => {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const clampedX = Math.min(x, window.innerWidth - rect.width - 8);
    const clampedY = Math.min(y, window.innerHeight - rect.height - 8);
    setPos({ x: Math.max(8, clampedX), y: Math.max(8, clampedY) });
  }, [x, y]);

  useEffect(() => {
    const handlePointer = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    window.addEventListener('scroll', onClose, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
      window.removeEventListener('scroll', onClose, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const run = (action?: () => void) => () => {
    if (!action) return;
    action();
    onClose();
  };

  const items: MenuItem[] = [];

  if (!multi) {
    if (previewable && onPreview) items.push({ key: 'preview', icon: Eye, label: t('files.preview'), onClick: run(onPreview) });
    if (onDownload) {
      items.push({
        key: 'download',
        icon: Download,
        label: isFolder ? t('files.downloadFolderZip') : t('files.download'),
        onClick: run(onDownload),
      });
    }
    if (onShare) items.push({ key: 'share', icon: Share2, label: t('share.action'), onClick: run(onShare) });
  } else {
    if (onDownloadEach) items.push({ key: 'downloadEach', icon: Download, label: t('files.downloadEach'), onClick: run(onDownloadEach) });
    if (onDownloadZip) items.push({ key: 'downloadZip', icon: FileArchive, label: t('files.downloadZip'), onClick: run(onDownloadZip) });
  }

  items.push({ key: 'copy', icon: Copy, label: t('files.copy'), onClick: run(onCopy) });
  if (canWrite && onCut) items.push({ key: 'cut', icon: Scissors, label: t('files.cut'), onClick: run(onCut) });

  if (canPaste && onPaste) {
    items.push({ key: 'paste', icon: ClipboardPaste, label: t('files.pasteHere'), onClick: run(onPaste) });
  }

  if (!multi && canWrite) {
    if (onRename) items.push({ key: 'rename', icon: Pencil, label: t('files.rename'), onClick: run(onRename) });
    if (onDelete) items.push({ key: 'delete', icon: Trash2, label: t('files.delete'), onClick: run(onDelete), danger: true });
  }

  return (
    <div
      ref={ref}
      style={{ left: pos.x, top: pos.y }}
      className="fixed z-50 w-72 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-xl dark:border-slate-700 dark:bg-slate-800"
    >
      {items.map((item) => (
        <button
          key={item.key}
          onClick={item.onClick}
          className={`flex w-full items-center gap-2.5 whitespace-nowrap px-3 py-2 text-left text-sm ${
            item.danger
              ? 'text-rose-600 hover:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10'
              : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700'
          }`}
        >
          <item.icon size={16} />
          {item.label}
        </button>
      ))}
    </div>
  );
};

export default FileContextMenu;
