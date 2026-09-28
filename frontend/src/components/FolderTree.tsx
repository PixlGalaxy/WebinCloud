import { useCallback, useEffect, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Loader2,
  RefreshCw,
  X,
} from 'lucide-react';
import { filesApi } from '../api/files';
import { ApiError } from '../api/client';
import { useI18n } from '../i18n/I18nContext';
import { btn, errorBox, input } from './ui/styles';

interface Props {
  value: string;
  onChange: (path: string) => void;
}

/** Browsable tree of the data volume, with folder creation built in. */
const FolderTree = ({ value, onChange }: Props) => {
  const { t } = useI18n();
  const [children, setChildren] = useState<Record<string, string[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['']));
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [creatingIn, setCreatingIn] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async (path: string) => {
    setLoading((prev) => new Set(prev).add(path));
    try {
      const listing = await filesApi.list(path);
      setChildren((prev) => ({
        ...prev,
        [path]: listing.entries.filter((entry) => entry.type === 'folder').map((entry) => entry.path),
      }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setLoading((prev) => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
    }
  }, []);

  useEffect(() => {
    void load('');
  }, [load]);

  const toggle = (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
        // Always re-read: the folder may have changed since it was last opened.
        void load(path);
      }
      return next;
    });
  };

  /** Drops every cached listing and reloads what is currently open. */
  const refresh = () => {
    setError('');
    setChildren({});
    for (const path of expanded) void load(path);
  };

  const createFolder = async () => {
    const parent = creatingIn ?? '';
    setError('');
    try {
      const created = await filesApi.createFolder(parent, newName.trim());
      await load(parent);
      setExpanded((prev) => new Set(prev).add(parent));
      onChange(created.path);
      setCreatingIn(null);
      setNewName('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('files.actionFailed'));
    }
  };

  const renderNode = (path: string, depth: number) => {
    const name = path.slice(path.lastIndexOf('/') + 1);
    const isOpen = expanded.has(path);
    const isSelected = value === path;
    const kids = children[path];

    return (
      <div key={path}>
        <div
          className={`flex items-center gap-1 rounded-md py-1 pr-2 transition ${
            isSelected
              ? 'bg-[var(--accent-600)] text-white'
              : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'
          }`}
          style={{ paddingLeft: `${depth * 14 + 4}px` }}
        >
          <button
            type="button"
            onClick={() => toggle(path)}
            className="shrink-0 rounded p-0.5 hover:bg-black/10 dark:hover:bg-white/10"
          >
            {loading.has(path) ? (
              <Loader2 size={14} className="animate-spin" />
            ) : isOpen ? (
              <ChevronDown size={14} />
            ) : (
              <ChevronRight size={14} />
            )}
          </button>

          <button
            type="button"
            onClick={() => onChange(path)}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm"
          >
            {isOpen ? (
              <FolderOpen size={15} className={isSelected ? '' : 'text-[var(--accent-500)]'} />
            ) : (
              <Folder size={15} className={isSelected ? '' : 'text-[var(--accent-500)]'} />
            )}
            <span className="truncate">{name}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setCreatingIn(path);
              setNewName('');
              setExpanded((prev) => new Set(prev).add(path));
            }}
            title={t('folderTree.newHere')}
            className="shrink-0 rounded p-1 hover:bg-black/10 dark:hover:bg-white/10"
          >
            <FolderPlus size={14} />
          </button>
        </div>

        {isOpen && (
          <>
            {creatingIn === path && renderCreateRow(depth + 1)}
            {kids?.map((child) => renderNode(child, depth + 1))}
          </>
        )}
      </div>
    );
  };

  const renderCreateRow = (depth: number) => (
    <div className="flex items-center gap-1 py-1 pr-2" style={{ paddingLeft: `${depth * 14 + 4}px` }}>
      <FolderPlus size={15} className="shrink-0 text-emerald-500" />
      <input
        autoFocus
        value={newName}
        onChange={(e) => setNewName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (newName.trim()) void createFolder();
          }
          if (e.key === 'Escape') setCreatingIn(null);
        }}
        placeholder={t('files.folderName')}
        className={`${input} h-8 py-1 text-sm`}
      />
      <button
        type="button"
        onClick={() => void createFolder()}
        disabled={!newName.trim()}
        className={`${btn.primary} h-8 px-2 py-1`}
      >
        {t('common.create')}
      </button>
      <button
        type="button"
        onClick={() => setCreatingIn(null)}
        className="rounded p-1 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
      >
        <X size={14} />
      </button>
    </div>
  );

  return (
    <div className="space-y-2">
      {error && <div className={errorBox}>{error}</div>}

      <div className="flex items-center justify-between gap-2 rounded-t-lg border border-b-0 border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-700 dark:bg-slate-800/50">
        <span className="flex min-w-0 items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300">
          <HardDrive size={15} className="shrink-0 text-slate-400" />
          <span className="truncate font-mono text-xs">
            {t('folderTree.root')}/{value}
          </span>
        </span>

        <span className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={refresh}
            title={t('files.refresh')}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-200 dark:text-slate-400 dark:hover:bg-slate-700"
          >
            <RefreshCw size={14} className={loading.size > 0 ? 'animate-spin' : undefined} />
          </button>
          <button
            type="button"
            onClick={() => {
              setCreatingIn(value);
              setNewName('');
              if (value) setExpanded((prev) => new Set(prev).add(value));
            }}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent-600)] px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-[var(--accent-700)]"
          >
            <FolderPlus size={14} />
            {value ? t('folderTree.newHere') : t('folderTree.newAtRoot')}
          </button>
        </span>
      </div>

      <div className="!mt-0 max-h-64 overflow-auto rounded-b-lg border border-slate-200 p-2 dark:border-slate-700">
        {creatingIn === '' && renderCreateRow(1)}
        {children['']?.map((path) => renderNode(path, 1))}

        {children[''] && children[''].length === 0 && creatingIn !== '' && (
          <p className="px-2 py-3 text-center text-xs text-slate-400 dark:text-slate-500">
            {t('folderTree.empty')}
          </p>
        )}
      </div>
    </div>
  );
};

export default FolderTree;
