import { Suspense, lazy, useEffect, useState } from 'react';
import { Code2, Download, Loader2, Play, Save, X, FileQuestion } from 'lucide-react';
import type { PreviewKind } from '../../api/files';
import { ApiError } from '../../api/client';
import { useI18n } from '../../i18n/I18nContext';
import { useTheme } from '../../context/ThemeContext';
import { useAutoplayVideos } from '../../hooks/useAutoplayVideos';
import { btn, errorBox } from '../../components/ui/styles';

const CodeEditor = lazy(() => import('./CodeEditor'));
const HtmlPreview = lazy(() => import('./HtmlPreview'));
const SpreadsheetViewer = lazy(() => import('./office/SpreadsheetViewer'));
const DocumentViewer = lazy(() => import('./office/DocumentViewer'));

/**
 * Office formats are parsed in the browser, unlike images or video which the
 * browser streams and decodes natively, so a huge file is worth stopping
 * before it locks up the tab. Unknown size (sizeBytes undefined) is let through.
 */
const MAX_OFFICE_PREVIEW_BYTES = 20 * 1024 * 1024;

interface Props {
  name: string;
  previewKind: PreviewKind;
  /** Same-origin URL that renders inline. */
  rawUrl: string;
  downloadUrl: string;
  /** Used only to gate the office viewers against very large files. */
  sizeBytes?: number;
  /** Omitted for read-only viewers such as public share links. */
  editor?: {
    load: () => Promise<{ content: string; canWrite: boolean }>;
    save: (content: string) => Promise<void>;
  };
  onClose: () => void;
  onSaved?: () => void;
}

const PreviewPanel = ({ name, previewKind, rawUrl, downloadUrl, sizeBytes, editor, onClose, onSaved }: Props) => {
  const { t } = useI18n();
  const { mode } = useTheme();
  const { autoplay } = useAutoplayVideos();

  const [text, setText] = useState<string | null>(null);
  const [original, setOriginal] = useState('');
  const [canWrite, setCanWrite] = useState(false);
  const [loading, setLoading] = useState(previewKind === 'text' || previewKind === 'html');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  // A page is more useful running than as code at a glance, so it opens rendered.
  const [htmlView, setHtmlView] = useState<'rendered' | 'raw'>('rendered');

  const dirty = text !== null && text !== original;
  const isTextLike = previewKind === 'text' || previewKind === 'html';

  useEffect(() => {
    if (!isTextLike) return;

    // Without an editor the text is read straight from the inline URL.
    const load = editor
      ? editor.load()
      : fetch(rawUrl, { credentials: 'include' })
          .then((res) => (res.ok ? res.text() : Promise.reject(new ApiError(res.status, 'load failed'))))
          .then((content) => ({ content, canWrite: false }));

    let cancelled = false;
    load
      .then((data) => {
        if (cancelled) return;
        setText(data.content);
        setOriginal(data.content);
        setCanWrite(data.canWrite);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : t('files.loadFailed'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawUrl, previewKind, t]);

  const save = async () => {
    if (text === null || !editor) return;
    setSaving(true);
    setError('');
    try {
      await editor.save(text);
      setOriginal(text);
      setConfirmClose(false);
      onSaved?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('files.actionFailed'));
    } finally {
      setSaving(false);
    }
  };

  const requestClose = () => {
    if (dirty) setConfirmClose(true);
    else onClose();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose();
      if ((e.ctrlKey || e.metaKey) && e.key === 's' && dirty && canWrite && editor) {
        e.preventDefault();
        void save();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const raw = rawUrl;
  const isOffice = previewKind === 'spreadsheet' || previewKind === 'document';
  // A 0-byte file isn't a valid package of either kind: xlsx silently shows an
  // empty sheet, but docx-preview's zip reader throws on it. Catch it up front,
  // the same way, before either viewer ever fetches it.
  const emptyOffice = isOffice && sizeBytes === 0;
  const tooLargeForOffice = isOffice && sizeBytes !== undefined && sizeBytes > MAX_OFFICE_PREVIEW_BYTES;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-900/60 p-4 sm:p-8" onClick={requestClose}>
      <div
        className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-3 border-b border-slate-200 px-5 py-3 dark:border-slate-700">
          <h2 className="flex-1 truncate font-medium text-slate-900 dark:text-slate-100">{name}</h2>

          {previewKind === 'html' && (
            <div className="flex items-center rounded-lg border border-slate-300 p-0.5 dark:border-slate-600">
              <button
                onClick={() => setHtmlView('rendered')}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  htmlView === 'rendered'
                    ? 'bg-[var(--accent-600)] text-white'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                <Play size={14} /> {t('files.htmlRendered')}
              </button>
              <button
                onClick={() => setHtmlView('raw')}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  htmlView === 'raw'
                    ? 'bg-[var(--accent-600)] text-white'
                    : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                <Code2 size={14} /> {t('files.htmlRaw')}
              </button>
            </div>
          )}

          {isTextLike && canWrite && editor && (
            <button onClick={() => void save()} disabled={!dirty || saving} className={btn.primary}>
              {saving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
              {t('common.save')}
            </button>
          )}

          <a href={downloadUrl} className={btn.secondary}>
            <Download size={16} /> {t('files.download')}
          </a>

          <button onClick={requestClose} className={btn.iconGhost} title={t('common.close')}>
            <X size={20} />
          </button>
        </header>

        {confirmClose && (
          <div className="flex items-center gap-3 border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            <span className="flex-1">{t('files.unsavedChanges')}</span>
            <button onClick={onClose} className={btn.secondary}>
              {t('files.discard')}
            </button>
            <button onClick={() => void save()} className={btn.primary}>
              {t('common.save')}
            </button>
          </div>
        )}

        {error && <div className="m-5 mb-0">{<div className={errorBox}>{error}</div>}</div>}

        <div className="min-h-0 flex-1 overflow-auto bg-slate-50 dark:bg-slate-950">
          {loading ? (
            <div className="flex h-full items-center justify-center">
              <Loader2 className="animate-spin text-[var(--accent-500)]" size={32} />
            </div>
          ) : previewKind === 'image' ? (
            <div className="flex h-full items-center justify-center p-6">
              <img src={raw} alt={name} className="max-h-full max-w-full object-contain" />
            </div>
          ) : previewKind === 'video' ? (
            <div className="flex h-full items-center justify-center p-6">
              <video src={raw} controls autoPlay={autoplay} className="max-h-full max-w-full" />
            </div>
          ) : previewKind === 'audio' ? (
            <div className="flex h-full items-center justify-center p-6">
              <audio src={raw} controls className="w-full max-w-lg" />
            </div>
          ) : previewKind === 'pdf' ? (
            <iframe src={raw} title={name} className="h-full w-full border-0" />
          ) : emptyOffice ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-500 dark:text-slate-400">
              <FileQuestion size={48} className="text-slate-300 dark:text-slate-600" />
              <p>{t('files.previewEmpty')}</p>
            </div>
          ) : tooLargeForOffice ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-500 dark:text-slate-400">
              <FileQuestion size={48} className="text-slate-300 dark:text-slate-600" />
              <p>{t('files.tooLargeToPreview')}</p>
              <a href={downloadUrl} className={btn.primary}>
                <Download size={16} /> {t('files.download')}
              </a>
            </div>
          ) : previewKind === 'spreadsheet' ? (
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center">
                  <Loader2 className="animate-spin text-[var(--accent-500)]" size={32} />
                </div>
              }
            >
              <SpreadsheetViewer url={raw} />
            </Suspense>
          ) : previewKind === 'document' ? (
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center">
                  <Loader2 className="animate-spin text-[var(--accent-500)]" size={32} />
                </div>
              }
            >
              <DocumentViewer url={raw} />
            </Suspense>
          ) : previewKind === 'html' && text !== null ? (
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center">
                  <Loader2 className="animate-spin text-[var(--accent-500)]" size={32} />
                </div>
              }
            >
              {htmlView === 'rendered' ? (
                <HtmlPreview html={text} title={name} />
              ) : (
                <CodeEditor
                  name={name}
                  value={text}
                  readOnly={!canWrite}
                  isDark={mode === 'dark'}
                  onChange={setText}
                />
              )}
            </Suspense>
          ) : previewKind === 'text' && text !== null ? (
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center">
                  <Loader2 className="animate-spin text-[var(--accent-500)]" size={32} />
                </div>
              }
            >
              <CodeEditor
                name={name}
                value={text}
                readOnly={!canWrite}
                isDark={mode === 'dark'}
                onChange={setText}
              />
            </Suspense>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 text-slate-500 dark:text-slate-400">
              <FileQuestion size={48} className="text-slate-300 dark:text-slate-600" />
              <p>{t('files.notPreviewable')}</p>
              <a href={downloadUrl} className={btn.primary}>
                <Download size={16} /> {t('files.download')}
              </a>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PreviewPanel;
