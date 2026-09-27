import { Suspense, lazy, useCallback, useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import {
  ChevronRight,
  Download,
  ExternalLink,
  Eye,
  FileArchive,
  Folder,
  Loader2,
  Lock,
  SquareCheck,
  FolderUp,
  Upload,
  X,
} from 'lucide-react';
import { publicShareApi, type PublicEntry, type PublicShareInfo } from '../../api/shares';
import { ApiError } from '../../api/client';
import { useI18n } from '../../i18n/I18nContext';
import { useTheme } from '../../context/ThemeContext';
import { useArchives } from '../../context/ArchiveContext';
import Navbar from '../../components/Navbar';
import { useUploads, useUploadsFinished } from '../../context/UploadContext';
import { btn, card, errorBox, input } from '../../components/ui/styles';
import { formatSize } from '../files/paths';
import FileIcon from '../files/FileIcon';
import PreviewPanel from '../files/PreviewPanel';
import DotfileNotice from '../../components/DotfileNotice';

const CodeEditor = lazy(() => import('../files/CodeEditor'));
const SpreadsheetViewer = lazy(() => import('../files/office/SpreadsheetViewer'));
const DocumentViewer = lazy(() => import('../files/office/DocumentViewer'));

/** Office formats are parsed in the browser, so a huge file is worth stopping before it locks up the tab. */
const MAX_OFFICE_PREVIEW_BYTES = 20 * 1024 * 1024;

/** Whether navigating straight to the raw URL would show something, instead of downloading it. */
const opensInBrowser = (kind: string) => !['none', 'spreadsheet', 'document'].includes(kind);

const PublicSharePage = () => {
  const params = useParams();
  const segment = params.segment ?? '';
  const shareName = params.name ?? '';
  const { t, language } = useI18n();
  const { theme } = useTheme();
  const { createShareArchive } = useArchives();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<PublicEntry | null>(null);
  const [dotfile, setDotfile] = useState<{ name: string; path: string } | null>(null);

  const [textContent, setTextContent] = useState<string | null>(null);
  const [info, setInfo] = useState<PublicShareInfo | null>(null);
  const [entries, setEntries] = useState<PublicEntry[] | null>(null);
  const [innerPath, setInnerPath] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const loadInfo = useCallback(async () => {
    try {
      setInfo(await publicShareApi.info(segment, shareName));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('share.unavailable'));
    } finally {
      setLoading(false);
    }
  }, [segment, shareName, t]);

  useEffect(() => {
    void loadInfo();
  }, [loadInfo]);

  const loadEntries = useCallback(
    async (path: string) => {
      try {
        const data = await publicShareApi.list(segment, shareName, path);
        setEntries(data.entries);
        setInnerPath(data.path);
        setError('');
      } catch (err) {
        setError(err instanceof ApiError ? err.message : t('share.unavailable'));
      }
    },
    [segment, shareName, t],
  );

  useEffect(() => {
    if (info?.type === 'folder' && info.unlocked && info.allowDownload) void loadEntries('');
  }, [info, loadEntries]);

  // Text is fetched as plain text and shown with syntax highlighting.
  useEffect(() => {
    if (info?.type !== 'file' || info.previewKind !== 'text' || !info.unlocked || !info.allowDownload) return;

    fetch(publicShareApi.rawUrl(segment, shareName), { credentials: 'include' })
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error(String(res.status)))))
      .then(setTextContent)
      .catch(() => undefined);
  }, [info, segment, shareName]);

  const unlock = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await publicShareApi.unlock(segment, shareName, password);
      setLoading(true);
      await loadInfo();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('share.unavailable'));
    }
  };

  const uploads = useUploads();
  const shareScope = { kind: 'share', segment, name: shareName } as const;
  useUploadsFinished(() => {
    if (info?.allowDownload) void loadEntries(innerPath);
  });

  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat(language, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso));

  const startDownload = (path: string) => {
    const link = document.createElement('a');
    link.href = publicShareApi.downloadUrl(segment, shareName, path);
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const requestDownload = (name: string, path: string) => {
    if (name.startsWith('.')) setDotfile({ name, path });
    else startDownload(path);
  };

  const exitSelection = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  const zipSelection = async (paths: string[]) => {
    setError('');
    try {
      await createShareArchive(segment, shareName, paths);
      exitSelection();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('files.actionFailed'));
    }
  };

  // Navigating into a subfolder ends the selection, whose paths no longer show.
  useEffect(() => {
    exitSelection();
  }, [innerPath]);

  // Same chrome as the signed-in app, so a link does not feel like a different site.
  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <Navbar />
      <main className="mx-auto max-w-7xl p-6">{children}</main>
    </div>
  );

  if (loading) {
    return shell(
      <div className="flex justify-center py-20">
        <Loader2 className="animate-spin text-indigo-500" size={32} />
      </div>,
    );
  }

  if (!info) {
    return shell(
      <div className={`${card} p-12 text-center`}>
        <p className="text-slate-600 dark:text-slate-300">{error || t('share.unavailable')}</p>
      </div>,
    );
  }

  if (!info.unlocked) {
    return shell(
      <div className={`${card} mx-auto max-w-md p-8`}>
        <div className="mb-6 flex items-center gap-3">
          <div className="rounded-xl bg-amber-500 p-2.5 text-white">
            <Lock size={20} />
          </div>
          <h1 className="text-lg font-semibold text-slate-900 dark:text-slate-100">{t('share.locked')}</h1>
        </div>

        {error && <div className={`${errorBox} mb-4`}>{error}</div>}

        <form onSubmit={unlock} className="space-y-4">
          <input
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t('login.password')}
            className={input}
          />
          <button type="submit" disabled={!password} className={`${btn.primary} w-full`}>
            {t('share.unlock')}
          </button>
        </form>
      </div>,
    );
  }

  const segments = innerPath ? innerPath.split('/') : [];

  return shell(
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{info.name}</h1>

          {info.type === 'file' && info.allowDownload && opensInBrowser(info.previewKind) && (
            <a
              href={publicShareApi.rawUrl(segment, shareName)}
              target="_blank"
              rel="noreferrer"
              className="mt-1 block truncate font-mono text-xs text-indigo-600 hover:underline dark:text-indigo-400"
            >
              {window.location.origin}
              {publicShareApi.rawUrl(segment, shareName)}
            </a>
          )}

          {info.type === 'folder' && (
            <nav className="mt-1 flex flex-wrap items-center gap-1 text-sm">
              <button
                onClick={() => void loadEntries('')}
                className="rounded px-1.5 py-0.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                {info.name}
              </button>
              {segments.map((part, index) => (
                <span key={part} className="flex items-center gap-1">
                  <ChevronRight size={13} className="text-slate-400" />
                  <button
                    onClick={() => void loadEntries(segments.slice(0, index + 1).join('/'))}
                    className="rounded px-1.5 py-0.5 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
                  >
                    {part}
                  </button>
                </span>
              ))}
            </nav>
          )}
        </div>

        <div className="flex items-center gap-2">
          {info.type === 'file' && info.allowDownload && (
            <>
              {opensInBrowser(info.previewKind) && (
                <a
                  href={publicShareApi.rawUrl(segment, shareName)}
                  target="_blank"
                  rel="noreferrer"
                  className={btn.secondary}
                  title={t('share.openDirectHint')}
                >
                  <ExternalLink size={16} /> {t('share.openDirect')}
                </a>
              )}
              <button onClick={() => requestDownload(info.name, '')} className={btn.primary}>
                <Download size={16} /> {t('files.download')}
              </button>
            </>
          )}
          {info.type === 'folder' && info.allowDownload && (
            <>
              <button
                onClick={() => (selecting ? exitSelection() : setSelecting(true))}
                className={
                  selecting
                    ? 'inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700'
                    : btn.secondary
                }
              >
                <SquareCheck size={16} /> {t('files.select')}
              </button>
              <button onClick={() => void zipSelection([])} className={btn.primary}>
                <FileArchive size={16} /> {t('share.downloadFolderZip')}
              </button>
            </>
          )}

          {info.allowUpload && (
            <>
              <button onClick={() => uploads.pickFolder(shareScope, innerPath)} className={btn.success}>
                <FolderUp size={16} /> {t('files.uploadFolder')}
              </button>
              <button onClick={() => uploads.pickFiles(shareScope, innerPath)} className={btn.primary}>
                <Upload size={16} /> {t('files.uploadFiles')}
              </button>
            </>
          )}
        </div>
      </div>

      {error && <div className={errorBox}>{error}</div>}

      {selecting && entries && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 dark:border-indigo-500/30 dark:bg-indigo-500/10">
          <label className="flex items-center gap-2 text-sm font-medium text-indigo-900 dark:text-indigo-200">
            <input
              type="checkbox"
              checked={entries.length > 0 && selected.size === entries.length}
              onChange={(e) =>
                setSelected(e.target.checked ? new Set(entries.map((entry) => entry.path)) : new Set())
              }
              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            {t('files.selectedCount', { count: selected.size })}
          </label>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => void zipSelection([...selected])}
              disabled={selected.size === 0}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-amber-600 disabled:opacity-40"
            >
              <FileArchive size={16} /> {t('files.downloadZip')}
            </button>
            <button onClick={exitSelection} className={btn.iconGhost} title={t('common.cancel')}>
              <X size={18} />
            </button>
          </div>
        </div>
      )}

      {info.type === 'file' ? (
        <div className={`${card} ${info.previewKind === 'text' ? 'overflow-hidden' : 'p-6'}`}>
          {!info.allowDownload ? (
            <p className="p-6 text-center text-slate-500 dark:text-slate-400">{t('share.uploadOnly')}</p>
          ) : info.previewKind === 'image' ? (
            <img
              src={publicShareApi.rawUrl(segment, shareName)}
              alt={info.name}
              className="mx-auto max-h-[70vh]"
            />
          ) : info.previewKind === 'pdf' ? (
            <iframe
              src={publicShareApi.rawUrl(segment, shareName)}
              title={info.name}
              className="h-[75vh] w-full border-0"
            />
          ) : info.previewKind === 'video' ? (
            <video
              src={publicShareApi.rawUrl(segment, shareName)}
              controls
              className="mx-auto max-h-[70vh]"
            />
          ) : info.previewKind === 'audio' ? (
            <audio src={publicShareApi.rawUrl(segment, shareName)} controls className="w-full" />
          ) : info.previewKind === 'spreadsheet' ? (
            info.size === 0 ? (
              <p className="text-center text-slate-500 dark:text-slate-400">{t('files.previewEmpty')}</p>
            ) : info.size !== undefined && info.size > MAX_OFFICE_PREVIEW_BYTES ? (
              <p className="text-center text-slate-500 dark:text-slate-400">{t('files.tooLargeToPreview')}</p>
            ) : (
              <Suspense
                fallback={
                  <div className="flex justify-center p-12">
                    <Loader2 className="animate-spin text-indigo-500" size={28} />
                  </div>
                }
              >
                <div className="h-[75vh]">
                  <SpreadsheetViewer url={publicShareApi.rawUrl(segment, shareName)} />
                </div>
              </Suspense>
            )
          ) : info.previewKind === 'document' ? (
            info.size === 0 ? (
              <p className="text-center text-slate-500 dark:text-slate-400">{t('files.previewEmpty')}</p>
            ) : info.size !== undefined && info.size > MAX_OFFICE_PREVIEW_BYTES ? (
              <p className="text-center text-slate-500 dark:text-slate-400">{t('files.tooLargeToPreview')}</p>
            ) : (
              <Suspense
                fallback={
                  <div className="flex justify-center p-12">
                    <Loader2 className="animate-spin text-indigo-500" size={28} />
                  </div>
                }
              >
                <div className="h-[75vh]">
                  <DocumentViewer url={publicShareApi.rawUrl(segment, shareName)} />
                </div>
              </Suspense>
            )
          ) : info.previewKind === 'text' ? (
            textContent === null ? (
              <div className="flex justify-center p-12">
                <Loader2 className="animate-spin text-indigo-500" size={28} />
              </div>
            ) : (
              <Suspense
                fallback={
                  <div className="flex justify-center p-12">
                    <Loader2 className="animate-spin text-indigo-500" size={28} />
                  </div>
                }
              >
                <div className="max-h-[75vh] overflow-auto">
                  <CodeEditor
                    name={info.name}
                    value={textContent}
                    readOnly
                    isDark={theme === 'dark'}
                    onChange={() => undefined}
                  />
                </div>
              </Suspense>
            )
          ) : (
            <p className="text-center text-slate-500 dark:text-slate-400">{t('share.notPreviewable')}</p>
          )}
        </div>
      ) : !info.allowDownload ? (
        <div className={`${card} p-12 text-center`}>
          <Upload className="mx-auto mb-3 text-slate-300 dark:text-slate-600" size={44} />
          <p className="text-slate-500 dark:text-slate-400">{t('share.uploadOnly')}</p>
        </div>
      ) : entries === null ? (
        <div className={`${card} flex justify-center p-12`}>
          <Loader2 className="animate-spin text-indigo-500" size={28} />
        </div>
      ) : (
        <div className={`${card} overflow-hidden`}>
          {entries.length === 0 ? (
            <p className="p-12 text-center text-slate-500 dark:text-slate-400">{t('files.empty')}</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-left text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
                <tr>
                  {selecting && <th className="w-10 pl-5" />}
                  <th className="px-5 py-3 font-medium">{t('files.name')}</th>
                  <th className="hidden w-32 px-5 py-3 font-medium sm:table-cell">{t('files.size')}</th>
                  <th className="hidden w-56 px-5 py-3 font-medium md:table-cell">{t('files.modified')}</th>
                  <th className="w-28 px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  return (
                    <tr
                      key={entry.path}
                      className={`border-b border-slate-100 last:border-0 dark:border-slate-800 ${
                        selected.has(entry.path)
                          ? 'bg-indigo-50 dark:bg-indigo-500/10'
                          : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                      }`}
                    >
                      {selecting && (
                        <td className="pl-5">
                          <input
                            type="checkbox"
                            checked={selected.has(entry.path)}
                            onChange={() =>
                              setSelected((current) => {
                                const next = new Set(current);
                                if (next.has(entry.path)) next.delete(entry.path);
                                else next.add(entry.path);
                                return next;
                              })
                            }
                            className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                          />
                        </td>
                      )}
                      <td className="px-5 py-3">
                        {entry.type === 'folder' ? (
                          <button
                            onClick={() => void loadEntries(entry.path)}
                            className="flex items-center gap-2.5 font-medium text-slate-900 hover:text-indigo-600 dark:text-slate-100 dark:hover:text-indigo-400"
                          >
                            <Folder size={18} className="text-indigo-500" />
                            {entry.name}
                          </button>
                        ) : entry.previewKind === 'none' ? (
                          <span className="flex items-center gap-2.5 text-slate-800 dark:text-slate-200">
                            <FileIcon type={entry.type} name={entry.name} size={18} className="text-slate-400 dark:text-slate-500" />
                            {entry.name}
                          </span>
                        ) : (
                          <button
                            onClick={() => setPreview(entry)}
                            className="flex items-center gap-2.5 text-slate-800 hover:text-indigo-600 dark:text-slate-200 dark:hover:text-indigo-400"
                          >
                            <FileIcon type={entry.type} name={entry.name} size={18} className="text-slate-400 dark:text-slate-500" />
                            {entry.name}
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
                              onClick={() => requestDownload(entry.name, entry.path)}
                              className={btn.iconGhost}
                              title={t('files.download')}
                            >
                              <Download size={16} />
                            </button>
                          ) : (
                            <button
                              onClick={() => void zipSelection([entry.path])}
                              className={btn.iconGhost}
                              title={t('files.downloadFolderZip')}
                            >
                              <Download size={16} />
                            </button>
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
      )}

      {dotfile && (
        <DotfileNotice
          name={dotfile.name}
          onDownloadAnyway={() => {
            startDownload(dotfile.path);
            setDotfile(null);
          }}
          onDownloadZip={() => {
            void zipSelection(dotfile.path ? [dotfile.path] : []);
            setDotfile(null);
          }}
          onClose={() => setDotfile(null)}
        />
      )}

      {preview && (
        <PreviewPanel
          name={preview.name}
          previewKind={preview.previewKind}
          rawUrl={publicShareApi.rawUrl(segment, shareName, preview.path)}
          downloadUrl={publicShareApi.downloadUrl(segment, shareName, preview.path)}
          sizeBytes={preview.size}
          onClose={() => setPreview(null)}
        />
      )}
    </div>,
  );
};

export default PublicSharePage;
