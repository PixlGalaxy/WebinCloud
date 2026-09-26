import { Suspense, lazy, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { ChevronRight, Download, ExternalLink, Folder, Loader2, Lock, Upload } from 'lucide-react';
import {
  publicShareApi,
  uploadToShare,
  type PublicEntry,
  type PublicShareInfo,
} from '../../api/shares';
import { ApiError } from '../../api/client';
import { useI18n } from '../../i18n/I18nContext';
import { useTheme } from '../../context/ThemeContext';
import Navbar from '../../components/Navbar';
import { btn, card, errorBox, input } from '../../components/ui/styles';
import { formatSize, iconFor } from '../files/paths';

const CodeEditor = lazy(() => import('../files/CodeEditor'));

const PublicSharePage = () => {
  const params = useParams();
  const segment = params.segment ?? '';
  const shareName = params.name ?? '';
  const { t, language } = useI18n();
  const { theme } = useTheme();

  const [textContent, setTextContent] = useState<string | null>(null);
  const [info, setInfo] = useState<PublicShareInfo | null>(null);
  const [entries, setEntries] = useState<PublicEntry[] | null>(null);
  const [innerPath, setInnerPath] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [progress, setProgress] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

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

  const upload = async (files: File[]) => {
    if (files.length === 0) return;
    setProgress(0);
    setError('');
    try {
      await uploadToShare(publicShareApi.uploadUrl(segment, shareName, innerPath), files, setProgress);
      if (info?.allowDownload) await loadEntries(innerPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('files.actionFailed'));
    } finally {
      setProgress(null);
    }
  };

  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

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

          {info.type === 'file' && info.allowDownload && info.previewKind !== 'none' && (
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
              {info.previewKind !== 'none' && (
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
              <a href={publicShareApi.downloadUrl(segment, shareName)} className={btn.primary}>
                <Download size={16} /> {t('files.download')}
              </a>
            </>
          )}
          {info.allowUpload && (
            <>
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
            <video src={publicShareApi.rawUrl(segment, shareName)} controls className="mx-auto max-h-[70vh]" />
          ) : info.previewKind === 'audio' ? (
            <audio src={publicShareApi.rawUrl(segment, shareName)} controls className="w-full" />
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
                  <th className="px-5 py-3 font-medium">{t('files.name')}</th>
                  <th className="hidden w-32 px-5 py-3 font-medium sm:table-cell">{t('files.size')}</th>
                  <th className="hidden w-56 px-5 py-3 font-medium md:table-cell">{t('files.modified')}</th>
                  <th className="w-20 px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const Icon = iconFor(entry.type, entry.name);
                  return (
                    <tr
                      key={entry.path}
                      className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
                    >
                      <td className="px-5 py-3">
                        {entry.type === 'folder' ? (
                          <button
                            onClick={() => void loadEntries(entry.path)}
                            className="flex items-center gap-2.5 font-medium text-slate-900 hover:text-indigo-600 dark:text-slate-100 dark:hover:text-indigo-400"
                          >
                            <Folder size={18} className="text-indigo-500" />
                            {entry.name}
                          </button>
                        ) : (
                          <span className="flex items-center gap-2.5 text-slate-800 dark:text-slate-200">
                            <Icon size={18} className="text-slate-400 dark:text-slate-500" />
                            {entry.name}
                          </span>
                        )}
                      </td>
                      <td className="hidden px-5 py-3 text-slate-500 dark:text-slate-400 sm:table-cell">
                        {entry.type === 'folder' ? '—' : formatSize(entry.size)}
                      </td>
                      <td className="hidden px-5 py-3 text-slate-500 dark:text-slate-400 md:table-cell">
                        {formatDate(entry.modifiedAt)}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {entry.type === 'file' && (
                          <a
                            href={publicShareApi.downloadUrl(segment, shareName, entry.path)}
                            className={btn.iconGhost}
                            title={t('files.download')}
                          >
                            <Download size={16} />
                          </a>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>,
  );
};

export default PublicSharePage;
