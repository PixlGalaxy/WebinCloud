import { useCallback, useEffect, useState, type DragEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ClipboardPaste,
  Copy,
  Download,
  FolderPlus,
  Loader2,
  Pencil,
  FileArchive,
  RefreshCw,
  Scissors,
  Search,
  Share2,
  SquareCheck,
  Trash2,
  Upload,
  FolderUp,
  FolderOpen,
  Image as ImageIcon,
  Eye,
  X,
} from 'lucide-react';
import {
  filesApi,
  type ConflictMode,
  type DirEntry,
  type ExistingFile,
  type Listing,
  type SearchResponse,
} from '../../api/files';
import { ApiError } from '../../api/client';
import { useI18n } from '../../i18n/I18nContext';
import { useArchives } from '../../context/ArchiveContext';
import { useClipboard } from '../../context/ClipboardContext';
import { useTransfers } from '../../context/TransferContext';
import Modal from '../../components/ui/Modal';
import { pickedFromDrop } from '../../components/upload/useUploadQueue';
import { useUploads, useUploadsFinished } from '../../context/UploadContext';
import { btn, card, errorBox, input, label } from '../../components/ui/styles';
import Breadcrumbs from './Breadcrumbs';
import ConflictModal from './ConflictModal';
import EntryThumbnail from './EntryThumbnail';
import FileContextMenu from './FileContextMenu';
import FileIcon from './FileIcon';
import PreviewPanel from './PreviewPanel';
import ShareCreateModal from './ShareCreateModal';
import DotfileNotice from '../../components/DotfileNotice';
import { useFolderWatch } from './useFolderWatch';
import { formatSize, toFilesUrl } from './paths';
import { useThumbnailsPreference } from '../../hooks/useThumbnailsPreference';

const FileExplorerPage = () => {
  const path = useParams()['*'] ?? '';
  const navigate = useNavigate();
  const { t, language } = useI18n();
  const { createArchive } = useArchives();
  const { clipboard: clip, setClipboard, clear: clearClipboard } = useClipboard();
  const { startCopy } = useTransfers();

  const [listing, setListing] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dragging, setDragging] = useState(false);
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ entry: DirEntry; value: string } | null>(null);
  const [deleting, setDeleting] = useState<DirEntry | null>(null);
  const [preview, setPreview] = useState<DirEntry | null>(null);
  const [dotfile, setDotfile] = useState<DirEntry | null>(null);
  const [sharing, setSharing] = useState<DirEntry | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState<SearchResponse | null>(null);
  const [searching, setSearching] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number; entries: DirEntry[]; multi: boolean } | null>(null);
  const [pasteConflicts, setPasteConflicts] = useState<ExistingFile[] | null>(null);

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

  const { thumbnails, setThumbnails } = useThumbnailsPreference();
  const toggleThumbnails = () => setThumbnails(!thumbnails);

  /** Small icon normally; a larger tile (thumbnail or icon) when previews are on. */
  const entryIcon = (entry: DirEntry, iconClass: string) =>
    thumbnails ? (
      <EntryThumbnail entry={entry} iconClass={iconClass} />
    ) : (
      <FileIcon type={entry.type} name={entry.name} size={18} className={iconClass} />
    );

  const uploads = useUploads();
  useUploadsFinished(() => void reload());

  // Moving to another folder ends the current search and selection.
  useEffect(() => {
    setQuery('');
    setSearch(null);
    setSelecting(false);
    setSelected(new Set());
    setMenu(null);
    setPasteConflicts(null);
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

  const toggleSelected = (entryPath: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(entryPath)) next.delete(entryPath);
      else next.add(entryPath);
      return next;
    });
  };

  const exitSelection = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const downloadZip = async () => {
    setError('');
    try {
      await createArchive([...selected]);
      exitSelection();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('files.actionFailed'));
    }
  };

  const startDownload = (entryPath: string) => {
    const link = document.createElement('a');
    link.href = filesApi.downloadUrl(entryPath);
    // No download attribute: the server's Content-Disposition carries the name.
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  /** Files download straight from the browser; folders have to go through a zip. */
  const downloadEach = () => {
    for (const entryPath of selected) {
      const link = document.createElement('a');
      link.href = filesApi.downloadUrl(entryPath);
      link.download = '';
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
    exitSelection();
  };

  const pasteHereDisabled = clip !== null && clip.mode === 'cut' && clip.sourceFolder === path;

  const handlePaste = async (mode?: ConflictMode) => {
    if (!clip || pasteHereDisabled) return;
    setError('');

    try {
      if (!mode) {
        const { conflicts } = await filesApi.checkConflicts(path, clip.entries.map((e) => e.name));
        if (conflicts.length > 0) {
          setPasteConflicts(conflicts);
          return;
        }
      }

      const onConflict: ConflictMode = mode ?? 'fail';
      const paths = clip.entries.map((e) => e.path);

      if (clip.mode === 'cut') {
        await filesApi.move(paths, path, onConflict);
        await reload();
      } else {
        const label = clip.entries.length === 1 ? clip.entries[0].name : t('files.itemsCount', { count: clip.entries.length });
        await startCopy(paths, path, onConflict, label);
      }
      clearClipboard();
      setPasteConflicts(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('files.actionFailed'));
    }
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

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (listing?.canWrite) {
      void pickedFromDrop(e.dataTransfer).then((picked) => uploads.addPicked(picked, { kind: 'user' }, path));
    }
  };

  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

  const canWrite = listing?.canWrite ?? false;

  // The table renders either the folder listing or the search hits.
  const rows = search ? search.results.map((result) => result.entry) : (listing?.entries ?? []);
  const parentByPath = new Map(
    search ? search.results.map((result) => [result.entry.path, result.parentPath]) : [],
  );
  const hasSelectedFolder = rows.some(
    (entry) => selected.has(entry.path) && entry.type === 'folder',
  );
  const cutPaths = clip?.mode === 'cut' ? new Set(clip.entries.map((e) => e.path)) : null;

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
          <button
            onClick={toggleThumbnails}
            title={t(thumbnails ? 'files.thumbnailsHide' : 'files.thumbnailsShow')}
            aria-pressed={thumbnails}
            className={thumbnails ? btn.primary : btn.secondary}
          >
            <ImageIcon size={16} />
          </button>

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

          <button
            onClick={() => (selecting ? exitSelection() : setSelecting(true))}
            className={
              selecting
                ? 'inline-flex items-center justify-center gap-2 rounded-lg bg-[var(--accent-600)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--accent-700)]'
                : btn.info
            }
          >
            <SquareCheck size={16} /> {t('files.select')}
          </button>

          {canWrite && (
            <>
              {clip && (
                <button
                  onClick={() => void handlePaste()}
                  disabled={pasteHereDisabled}
                  title={pasteHereDisabled ? t('files.pasteDisabledSameFolder') : t('files.clipboardReady', { count: clip.entries.length })}
                  className={`${btn.success} disabled:opacity-40`}
                >
                  <ClipboardPaste size={16} /> {t('files.paste')}
                </button>
              )}
              <button onClick={() => setNewFolder('')} className={btn.warning}>
                <FolderPlus size={16} /> {t('files.newFolder')}
              </button>
              <button onClick={() => uploads.pickFolder({ kind: 'user' }, path)} className={btn.success}>
                <FolderUp size={16} /> {t('files.uploadFolder')}
              </button>
              <button onClick={() => uploads.pickFiles({ kind: 'user' }, path)} className={btn.primary}>
                <Upload size={16} /> {t('files.uploadFiles')}
              </button>
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

      {selecting && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--accent-200)] bg-[var(--accent-50)] px-4 py-3 dark:border-[var(--accent-500)]/30 dark:bg-[var(--accent-500)]/10">
          <label className="flex items-center gap-2 text-sm font-medium text-[var(--accent-900)] dark:text-[var(--accent-200)]">
            <input
              type="checkbox"
              checked={rows.length > 0 && selected.size === rows.length}
              onChange={(e) =>
                setSelected(e.target.checked ? new Set(rows.map((entry) => entry.path)) : new Set())
              }
              className="h-4 w-4 rounded border-slate-300 text-[var(--accent-600)] focus:ring-[var(--accent-500)]"
            />
            {t('files.selectedCount', { count: selected.size })}
          </label>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button
              onClick={downloadEach}
              disabled={selected.size === 0 || hasSelectedFolder}
              title={hasSelectedFolder ? t('files.foldersNeedZip') : undefined}
              className={`${btn.secondary} disabled:opacity-40`}
            >
              <Download size={16} /> {t('files.downloadEach')}
            </button>
            <button
              onClick={() => void downloadZip()}
              disabled={selected.size === 0}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-amber-600 disabled:opacity-40"
            >
              <FileArchive size={16} /> {t('files.downloadZip')}
            </button>
            <button
              onClick={() => {
                setClipboard('copy', path, rows.filter((entry) => selected.has(entry.path)));
                exitSelection();
              }}
              disabled={selected.size === 0}
              className={`${btn.secondary} disabled:opacity-40`}
            >
              <Copy size={16} /> {t('files.copy')}
            </button>
            {canWrite && (
              <button
                onClick={() => {
                  setClipboard('cut', path, rows.filter((entry) => selected.has(entry.path)));
                  exitSelection();
                }}
                disabled={selected.size === 0}
                className={`${btn.secondary} disabled:opacity-40`}
              >
                <Scissors size={16} /> {t('files.cut')}
              </button>
            )}
            <button onClick={exitSelection} className={btn.iconGhost} title={t('common.cancel')}>
              <X size={18} />
            </button>
          </div>
        </div>
      )}

      {search && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <Search size={15} className="text-[var(--accent-500)]" />
          <span>
            {t('files.searchSummary', { count: search.results.length, query: search.query })}
            {search.path ? ` ${t('files.searchIn', { folder: search.path })}` : ` ${t('files.searchInRoot')}`}
          </span>
          {search.truncated && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
              {t('files.searchTruncated')}
            </span>
          )}
          <button onClick={clearSearch} className="text-[var(--accent-600)] hover:underline dark:text-[var(--accent-400)]">
            {t('files.clearSearch')}
          </button>
        </div>
      )}

      <div className={`${card} overflow-hidden ${dragging ? 'ring-2 ring-[var(--accent-500)]' : ''}`}>
        {loading || searching ? (
          <div className="flex justify-center p-12">
            <Loader2 className="animate-spin text-[var(--accent-500)]" size={28} />
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
                {selecting && <th className="w-10 pl-5" />}
                <th className="px-5 py-3 font-medium">{t('files.name')}</th>
                <th className="hidden w-32 px-5 py-3 font-medium sm:table-cell">{t('files.size')}</th>
                <th className="hidden w-56 px-5 py-3 font-medium md:table-cell">{t('files.modified')}</th>
                <th className="w-32 px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {rows.map((entry) => {
                const foundIn = parentByPath.get(entry.path);
                const isCutMarked = cutPaths?.has(entry.path) ?? false;
                return (
                  <tr
                    key={entry.path}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      const multiTarget = selecting && selected.has(entry.path) && selected.size > 1;
                      setMenu({
                        x: e.clientX,
                        y: e.clientY,
                        entries: multiTarget ? rows.filter((r) => selected.has(r.path)) : [entry],
                        multi: multiTarget,
                      });
                    }}
                    className={`border-b border-slate-100 last:border-0 dark:border-slate-800 ${
                      isCutMarked ? 'opacity-40' : ''
                    } ${
                      selected.has(entry.path)
                        ? 'bg-[var(--accent-50)] dark:bg-[var(--accent-500)]/10'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                    }`}
                  >
                    {selecting && (
                      <td className="pl-5">
                        <input
                          type="checkbox"
                          checked={selected.has(entry.path)}
                          onChange={() => toggleSelected(entry.path)}
                          className="h-4 w-4 rounded border-slate-300 text-[var(--accent-600)] focus:ring-[var(--accent-500)]"
                        />
                      </td>
                    )}
                    <td className="px-5 py-3">
                      {entry.type === 'folder' ? (
                        <button
                          onClick={() => navigate(toFilesUrl(entry.path))}
                          className="flex items-center gap-2.5 font-medium text-slate-900 hover:text-[var(--accent-600)] dark:text-slate-100 dark:hover:text-[var(--accent-400)]"
                        >
                          {entryIcon(entry, "text-[var(--accent-500)]")}
                          {entry.name}
                        </button>
                      ) : entry.previewKind === 'none' ? (
                        <span className="flex items-center gap-2.5 text-slate-800 dark:text-slate-200">
                          {entryIcon(entry, "text-slate-400 dark:text-slate-500")}
                          {entry.name}
                        </span>
                      ) : (
                        <button
                          onClick={() => setPreview(entry)}
                          className="flex items-center gap-2.5 text-slate-800 hover:text-[var(--accent-600)] dark:text-slate-200 dark:hover:text-[var(--accent-400)]"
                        >
                          {entryIcon(entry, "text-slate-400 dark:text-slate-500")}
                          {entry.name}
                        </button>
                      )}

                      {foundIn !== undefined && (
                        <button
                          onClick={() => navigate(toFilesUrl(foundIn))}
                          title={t('files.goToFolder')}
                          className={`mt-1 block max-w-full truncate ${thumbnails ? 'pl-[74px]' : 'pl-[27px]'} text-left font-mono text-xs text-slate-400 hover:text-[var(--accent-600)] hover:underline dark:text-slate-500 dark:hover:text-[var(--accent-400)]`}
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
                        {entry.type === 'file' ? (
                          <button
                            onClick={() =>
                              entry.name.startsWith('.') ? setDotfile(entry) : startDownload(entry.path)
                            }
                            className={btn.iconGhost}
                            title={t('files.download')}
                          >
                            <Download size={16} />
                          </button>
                        ) : (
                          <button
                            onClick={() => void createArchive([entry.path])}
                            title={t('files.downloadFolderZip')}
                            className={btn.iconGhost}
                          >
                            <Download size={16} />
                          </button>
                        )}
                        <button
                          onClick={() => setClipboard('copy', path, [entry])}
                          className={btn.iconGhost}
                          title={t('files.copy')}
                        >
                          <Copy size={16} />
                        </button>
                        {canWrite && (
                          <button
                            onClick={() => setClipboard('cut', path, [entry])}
                            className={btn.iconGhost}
                            title={t('files.cut')}
                          >
                            <Scissors size={16} />
                          </button>
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
                              className={btn.iconDanger}
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
        <PreviewPanel
          name={preview.name}
          previewKind={preview.previewKind}
          rawUrl={filesApi.rawUrl(preview.path)}
          downloadUrl={filesApi.downloadUrl(preview.path)}
          sizeBytes={preview.size}
          editor={{
            load: () => filesApi.readText(preview.path),
            save: (content) => filesApi.writeText(preview.path, content),
          }}
          onClose={() => setPreview(null)}
          onSaved={() => void reload()}
        />
      )}

      {sharing && <ShareCreateModal entry={sharing} onClose={() => setSharing(null)} />}

      {menu && (() => {
        const single = menu.multi ? null : menu.entries[0];
        const hasFolder = menu.entries.some((e) => e.type === 'folder');
        return (
          <FileContextMenu
            x={menu.x}
            y={menu.y}
            onClose={() => setMenu(null)}
            multi={menu.multi}
            canWrite={canWrite}
            previewable={single?.type === 'file' && single.previewKind !== 'none'}
            isFolder={single?.type === 'folder'}
            onPreview={single ? () => setPreview(single) : undefined}
            onDownload={
              single
                ? () => {
                    if (single.type === 'file') {
                      if (single.name.startsWith('.')) setDotfile(single);
                      else startDownload(single.path);
                    } else {
                      void createArchive([single.path]);
                    }
                  }
                : undefined
            }
            onShare={single ? () => setSharing(single) : undefined}
            onRename={single ? () => setRenaming({ entry: single, value: single.name }) : undefined}
            onDelete={single ? () => setDeleting(single) : undefined}
            onCopy={() => {
              setClipboard('copy', path, menu.entries);
              if (menu.multi) exitSelection();
            }}
            onCut={() => {
              setClipboard('cut', path, menu.entries);
              if (menu.multi) exitSelection();
            }}
            onDownloadEach={
              menu.multi && !hasFolder
                ? () => {
                    for (const e of menu.entries) {
                      const link = document.createElement('a');
                      link.href = filesApi.downloadUrl(e.path);
                      link.download = '';
                      document.body.appendChild(link);
                      link.click();
                      link.remove();
                    }
                  }
                : undefined
            }
            onDownloadZip={menu.multi ? () => void createArchive(menu.entries.map((e) => e.path)) : undefined}
            canPaste={clip !== null && !pasteHereDisabled}
            onPaste={clip && !pasteHereDisabled ? () => void handlePaste() : undefined}
          />
        );
      })()}

      {pasteConflicts && clip && (
        <ConflictModal
          conflicts={pasteConflicts}
          incoming={clip.entries.map((e) => ({ name: e.name, size: e.size, lastModified: new Date(e.modifiedAt).getTime() }))}
          onCancel={() => setPasteConflicts(null)}
          onResolve={(mode) => void handlePaste(mode)}
        />
      )}

      {dotfile && (
        <DotfileNotice
          name={dotfile.name}
          onDownloadAnyway={() => {
            startDownload(dotfile.path);
            setDotfile(null);
          }}
          onDownloadZip={() => {
            void createArchive([dotfile.path]);
            setDotfile(null);
          }}
          onClose={() => setDotfile(null)}
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
