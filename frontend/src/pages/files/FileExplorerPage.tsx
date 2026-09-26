import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Download,
  FolderPlus,
  Loader2,
  Pencil,
  RefreshCw,
  Search,
  Share2,
  Trash2,
  Upload,
  FolderOpen,
  Eye,
  X,
} from 'lucide-react';
import {
  filesApi,
  uploadFiles,
  type ConflictMode,
  type DirEntry,
  type ExistingFile,
  type Listing,
  type SearchResponse,
} from '../../api/files';
import { ApiError } from '../../api/client';
import { useI18n } from '../../i18n/I18nContext';
import Modal from '../../components/ui/Modal';
import { btn, card, errorBox, input, label } from '../../components/ui/styles';
import Breadcrumbs from './Breadcrumbs';
import PreviewPanel from './PreviewPanel';
import ConflictModal from './ConflictModal';
import ShareCreateModal from './ShareCreateModal';
import { useFolderWatch } from './useFolderWatch';
import { formatSize, iconFor, toFilesUrl } from './paths';

const FileExplorerPage = () => {
  const path = useParams()['*'] ?? '';
  const navigate = useNavigate();
  const { t, language } = useI18n();

  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ entry: DirEntry; value: string } | null>(null);
  const [deleting, setDeleting] = useState<DirEntry | null>(null);
  const [preview, setPreview] = useState<DirEntry | null>(null);
  const [sharing, setSharing] = useState<DirEntry | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState<SearchResponse | null>(null);
  const [searching, setSearching] = useState(false);
  const [pending, setPending] = useState<{ files: File[]; conflicts: ExistingFile[] } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    setError('');
    try {
      setListing(await filesApi.list(path));
    } catch (err) {
      setListing(null);
      setError(err instanceof ApiError ? err.message : t('files.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [path, t]);

  useEffect(() => {
    setLoading(true);
    void reload();
  }, [reload]);

  // Picks up changes made by anyone else while this folder is open.
  useFolderWatch(path, reload);

  // Moving to another folder ends the current search.
  useEffect(() => {
    setQuery('');
    setSearch(null);
  }, [path]);

  const runSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    setError('');
    try {
      setSearch(await filesApi.search(path, query.trim()));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('files.actionFailed'));
    } finally {
      setSearching(false);
    }
  };

  const clearSearch = () => {
    setQuery('');
    setSearch(null);
  };

  const refreshNow = async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  };

  const run = async (action: () => Promise<unknown>) => {
    setError('');
    try {
      await action();
      await reload();
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('files.actionFailed'));
      return false;
    }
  };

  const send = async (files: File[], mode: ConflictMode) => {
    setError('');
    setProgress(0);
    try {
      await uploadFiles(path, files, setProgress, mode);
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('files.actionFailed'));
    } finally {
      setProgress(null);
    }
  };

  /** Asks what to do before anything is overwritten. */
  const upload = async (files: File[]) => {
    if (files.length === 0) return;
    setError('');
    try {
      const { conflicts } = await filesApi.checkConflicts(
        path,
        files.map((file) => file.name),
      );
      if (conflicts.length > 0) {
        setPending({ files, conflicts });
        return;
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('files.actionFailed'));
      return;
    }
    await send(files, 'fail');
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (listing?.canWrite) void upload(Array.from(e.dataTransfer.files));
  };

  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

  const canWrite = listing?.canWrite ?? false;

  // The table renders either the folder listing or the search hits.
  const rows = search ? search.results.map((result) => result.entry) : (listing?.entries ?? []);
  const parentByPath = new Map(
    search ? search.results.map((result) => [result.entry.path, result.parentPath]) : [],
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (canWrite) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className="space-y-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Breadcrumbs path={path} rootLabel={t('files.root')} />

        <div className="flex flex-wrap items-center gap-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void runSearch();
            }}
            className="relative"
          >
            <Search className="absolute left-3 top-2.5 text-slate-400 dark:text-slate-500" size={16} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('files.searchPlaceholder')}
              className={`${input} w-56 pl-9 ${search ? 'pr-9' : ''}`}
            />
            {search && (
              <button
                type="button"
                onClick={clearSearch}
                title={t('files.clearSearch')}
                className="absolute right-2 top-2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700"
              >
                <X size={15} />
              </button>
            )}
          </form>

          {canWrite && (
            <>
              <button onClick={() => setNewFolder('')} className={btn.secondary}>
                <FolderPlus size={16} /> {t('files.newFolder')}
              </button>
              <button onClick={() => fileInput.current?.click()} className={btn.primary}>
                <Upload size={16} /> {t('files.upload')}
              </button>
              <input
                ref={fileInput}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  void upload(Array.from(e.target.files ?? []));
                  e.target.value = '';
                }}
              />
            </>
          )}
          <button
            onClick={() => void refreshNow()}
            className={btn.secondary}
            title={t('files.refresh')}
            disabled={refreshing}
          >
            <RefreshCw size={16} className={refreshing ? 'animate-spin' : undefined} />
            <span className="hidden sm:inline">{t('files.refresh')}</span>
          </button>
        </div>
      </div>

      {error && <div className={errorBox}>{error}</div>}

      {progress !== null && (
        <div className={`${card} p-4`}>
          <div className="mb-2 flex justify-between text-sm text-slate-600 dark:text-slate-300">
            <span>{t('files.uploading')}</span>
            <span>{Math.round(progress * 100)}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
            <div className="h-full bg-indigo-600 transition-all" style={{ width: `${progress * 100}%` }} />
          </div>
        </div>
      )}

      {search && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <Search size={15} className="text-indigo-500" />
          <span>
            {t('files.searchSummary', { count: search.results.length, query: search.query })}
            {search.path ? ` ${t('files.searchIn', { folder: search.path })}` : ` ${t('files.searchInRoot')}`}
          </span>
          {search.truncated && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
              {t('files.searchTruncated')}
            </span>
          )}
          <button onClick={clearSearch} className="text-indigo-600 hover:underline dark:text-indigo-400">
            {t('files.clearSearch')}
          </button>
        </div>
      )}

      <div className={`${card} overflow-hidden ${dragging ? 'ring-2 ring-indigo-500' : ''}`}>
        {loading || searching ? (
          <div className="flex justify-center p-12">
            <Loader2 className="animate-spin text-indigo-500" size={28} />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-12 text-center">
            <FolderOpen className="mx-auto mb-3 text-slate-300 dark:text-slate-600" size={44} />
            <p className="text-slate-500 dark:text-slate-400">
              {search ? t('files.searchEmpty') : error ? t('files.unavailable') : t('files.empty')}
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
              <tr>
                <th className="px-5 py-3 font-medium">{t('files.name')}</th>
                <th className="hidden w-32 px-5 py-3 font-medium sm:table-cell">{t('files.size')}</th>
                <th className="hidden w-56 px-5 py-3 font-medium md:table-cell">{t('files.modified')}</th>
                <th className="w-32 px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((entry) => {
                const Icon = iconFor(entry.type, entry.name);
                const foundIn = parentByPath.get(entry.path);
                return (
                  <tr
                    key={entry.path}
                    className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
                  >
                    <td className="px-5 py-3">
                      {entry.type === 'folder' ? (
                        <button
                          onClick={() => navigate(toFilesUrl(entry.path))}
                          className="flex items-center gap-2.5 font-medium text-slate-900 hover:text-indigo-600 dark:text-slate-100 dark:hover:text-indigo-400"
                        >
                          <Icon size={18} className="text-indigo-500" />
                          {entry.name}
                        </button>
                      ) : entry.previewKind === 'none' ? (
                        <span className="flex items-center gap-2.5 text-slate-800 dark:text-slate-200">
                          <Icon size={18} className="text-slate-400 dark:text-slate-500" />
                          {entry.name}
                        </span>
                      ) : (
                        <button
                          onClick={() => setPreview(entry)}
                          className="flex items-center gap-2.5 text-slate-800 hover:text-indigo-600 dark:text-slate-200 dark:hover:text-indigo-400"
                        >
                          <Icon size={18} className="text-slate-400 dark:text-slate-500" />
                          {entry.name}
                        </button>
                      )}

                      {foundIn !== undefined && (
                        <button
                          onClick={() => navigate(toFilesUrl(foundIn))}
                          title={t('files.goToFolder')}
                          className="mt-1 block max-w-full truncate pl-[27px] text-left font-mono text-xs text-slate-400 hover:text-indigo-600 hover:underline dark:text-slate-500 dark:hover:text-indigo-400"
                        >
                          {foundIn ? `${t('files.root')}/${foundIn}` : t('files.root')}
                        </button>
                      )}
                    </td>
                    <td className="hidden px-5 py-3 text-slate-500 dark:text-slate-400 sm:table-cell">
                      {entry.type === 'folder' ? '—' : formatSize(entry.size)}
                    </td>
                    <td className="hidden px-5 py-3 text-slate-500 dark:text-slate-400 md:table-cell">
                      {formatDate(entry.modifiedAt)}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {entry.type === 'file' && entry.previewKind !== 'none' && (
                          <button
                            onClick={() => setPreview(entry)}
                            className={btn.iconGhost}
                            title={t('files.preview')}
                          >
                            <Eye size={16} />
                          </button>
                        )}
                        {entry.type === 'file' && (
                          <a
                            href={filesApi.downloadUrl(entry.path)}
                            className={btn.iconGhost}
                            title={t('files.download')}
                          >
                            <Download size={16} />
                          </a>
                        )}
                        <button
                          onClick={() => setSharing(entry)}
                          className={btn.iconGhost}
                          title={t('share.action')}
                        >
                          <Share2 size={16} />
                        </button>
                        {canWrite && (
                          <>
                            <button
                              onClick={() => setRenaming({ entry, value: entry.name })}
                              className={btn.iconGhost}
                              title={t('files.rename')}
                            >
                              <Pencil size={16} />
                            </button>
                            <button
                              onClick={() => setDeleting(entry)}
                              className="rounded-lg p-2 text-slate-500 transition hover:bg-rose-50 hover:text-rose-600 dark:text-slate-400 dark:hover:bg-rose-500/15 dark:hover:text-rose-400"
                              title={t('files.delete')}
                            >
                              <Trash2 size={16} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {preview && (
        <PreviewPanel entry={preview} onClose={() => setPreview(null)} onSaved={() => void reload()} />
      )}

      {sharing && <ShareCreateModal entry={sharing} onClose={() => setSharing(null)} />}

      {pending && (
        <ConflictModal
          conflicts={pending.conflicts}
          incoming={pending.files}
          onCancel={() => setPending(null)}
          onResolve={(mode) => {
            const files = pending.files;
            setPending(null);
            void send(files, mode);
          }}
        />
      )}

      {newFolder !== null && (
        <Modal title={t('files.newFolder')} onClose={() => setNewFolder(null)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (await run(() => filesApi.createFolder(path, newFolder))) setNewFolder(null);
            }}
          >
            <label className={label} htmlFor="folder-name">
              {t('files.folderName')}
            </label>
            <input
              id="folder-name"
              autoFocus
              value={newFolder}
              onChange={(e) => setNewFolder(e.target.value)}
              className={input}
            />
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setNewFolder(null)} className={btn.secondary}>
                {t('common.cancel')}
              </button>
              <button type="submit" disabled={!newFolder.trim()} className={btn.primary}>
                {t('common.create')}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {renaming && (
        <Modal title={t('files.rename')} onClose={() => setRenaming(null)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (await run(() => filesApi.rename(renaming.entry.path, renaming.value))) setRenaming(null);
            }}
          >
            <label className={label} htmlFor="new-name">
              {t('files.name')}
            </label>
            <input
              id="new-name"
              autoFocus
              value={renaming.value}
              onChange={(e) => setRenaming({ ...renaming, value: e.target.value })}
              className={input}
            />
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setRenaming(null)} className={btn.secondary}>
                {t('common.cancel')}
              </button>
              <button type="submit" disabled={!renaming.value.trim()} className={btn.primary}>
                {t('common.save')}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {deleting && (
        <Modal title={t('files.delete')} onClose={() => setDeleting(null)}>
          <p className="text-slate-600 dark:text-slate-300">
            {t('files.confirmDelete', { name: deleting.name })}
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <button onClick={() => setDeleting(null)} className={btn.secondary}>
              {t('common.cancel')}
            </button>
            <button
              onClick={async () => {
                if (await run(() => filesApi.remove(deleting.path))) setDeleting(null);
              }}
              className={btn.danger}
            >
              <Trash2 size={16} /> {t('common.delete')}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default FileExplorerPage;
