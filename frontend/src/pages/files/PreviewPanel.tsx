import { Suspense, lazy, useEffect, useState } from 'react';
import { Download, Loader2, Save, X, FileQuestion } from 'lucide-react';
import type { PreviewKind } from '../../api/files';
import { ApiError } from '../../api/client';
import { useI18n } from '../../i18n/I18nContext';
import { useTheme } from '../../context/ThemeContext';
import { btn, errorBox } from '../../components/ui/styles';

const CodeEditor = lazy(() => import('./CodeEditor'));

interface Props {
  name: string;
  previewKind: PreviewKind;
  /** Same-origin URL that renders inline. */
  rawUrl: string;
  downloadUrl: string;
  /** Omitted for read-only viewers such as public share links. */
  editor?: {
    load: () => Promise<{ content: string; canWrite: boolean }>;
    save: (content: string) => Promise<void>;
  };
  onClose: () => void;
  onSaved?: () => void;
}

const PreviewPanel = ({ name, previewKind, rawUrl, downloadUrl, editor, onClose, onSaved }: Props) => {
  const { t } = useI18n();
  const { theme } = useTheme();

  const [text, setText] = useState<string | null>(null);
  const [original, setOriginal] = useState('');
  const [canWrite, setCanWrite] = useState(false);
  const [loading, setLoading] = useState(previewKind === 'text');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);

  const dirty = text !== null && text !== original;

  useEffect(() => {
    if (previewKind !== 'text') return;

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

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-900/60 p-4 sm:p-8" onClick={requestClose}>
      <div
        className="mx-auto flex h-full w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-3 border-b border-slate-200 px-5 py-3 dark:border-slate-700">
          <h2 className="flex-1 truncate font-medium text-slate-900 dark:text-slate-100">{name}</h2>

          {previewKind === 'text' && canWrite && editor && (
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
              <Loader2 className="animate-spin text-indigo-500" size={32} />
            </div>
          ) : previewKind === 'image' ? (
            <div className="flex h-full items-center justify-center p-6">
              <img src={raw} alt={name} className="max-h-full max-w-full object-contain" />
            </div>
          ) : previewKind === 'video' ? (
            <div className="flex h-full items-center justify-center p-6">
              <video src={raw} controls className="max-h-full max-w-full" />
            </div>
          ) : previewKind === 'audio' ? (
            <div className="flex h-full items-center justify-center p-6">
              <audio src={raw} controls className="w-full max-w-lg" />
            </div>
          ) : previewKind === 'pdf' ? (
            <iframe src={raw} title={name} className="h-full w-full border-0" />
          ) : previewKind === 'text' && text !== null ? (
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center">
                  <Loader2 className="animate-spin text-indigo-500" size={32} />
                </div>
              }
            >
              <CodeEditor
                name={name}
                value={text}
                readOnly={!canWrite}
                isDark={theme === 'dark'}
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
