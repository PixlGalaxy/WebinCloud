import { useEffect } from 'react';
import { AlertCircle, CheckCircle2, Clock, UploadCloud, X } from 'lucide-react';
import { useUploads } from '../../context/UploadContext';
import { useI18n } from '../../i18n/I18nContext';

/** A run that ended without a single error goes away by itself after this long. */
const LINGER_MS = 15000;

/** Bottom-right card, like the ZIP one: a glance at how the upload is going. */
const UploadTray = () => {
  const { t } = useI18n();
  const { items, running, dialogOpen, openDialog, clear } = useUploads();

  const done = items.filter((item) => item.status === 'done').length;
  const failed = items.filter((item) => item.status === 'error').length;
  const left = items.length - done - failed;
  const finishedClean = !running && items.length > 0 && done === items.length;

  useEffect(() => {
    if (!finishedClean) return;
    const timer = window.setTimeout(clear, LINGER_MS);
    return () => window.clearTimeout(timer);
  }, [finishedClean, clear]);

  // The dialog already shows all of this while it is open.
  if (items.length === 0 || dialogOpen) return null;

  const total = items.reduce((sum, item) => sum + item.file.size, 0) || 1;
  const bytes = (statuses: string[], partial = false) =>
    items.reduce((sum, item) => {
      if (statuses.includes(item.status)) return sum + item.file.size;
      return partial && item.status === 'uploading' ? sum + item.file.size * item.progress : sum;
    }, 0);
  const donePercent = (bytes(['done'], true) / total) * 100;
  const failedPercent = (bytes(['error']) / total) * 100;

  const title = running
    ? t('upload.trayUploading')
    : finishedClean
      ? t('upload.trayDone')
      : failed > 0 && left === 0
        ? t('upload.trayErrors')
        : t('upload.trayReady');

  return (
    <div className="animate-toast-in rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800">
      <div className="flex items-start gap-3 p-3.5">
        <button
          onClick={openDialog}
          title={t('upload.openDetails')}
          className="flex min-w-0 flex-1 items-start gap-3 text-left"
        >
          {finishedClean ? (
            <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-emerald-500" />
          ) : failed > 0 && !running ? (
            <AlertCircle size={20} className="mt-0.5 shrink-0 text-rose-500" />
          ) : (
            <UploadCloud size={20} className="mt-0.5 shrink-0 text-amber-500" />
          )}

          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">{title}</p>

            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs font-medium">
              <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 size={12} /> {t('upload.uploaded', { count: done })}
              </span>
              <span className="inline-flex items-center gap-1 text-rose-600 dark:text-rose-400">
                <AlertCircle size={12} /> {t('upload.failed', { count: failed })}
              </span>
              <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                <Clock size={12} /> {t('upload.left', { count: left })}
              </span>
            </div>

            <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-amber-200 dark:bg-amber-500/30">
              <div className="h-full bg-emerald-500 transition-all" style={{ width: `${donePercent}%` }} />
              <div className="h-full bg-rose-500 transition-all" style={{ width: `${failedPercent}%` }} />
            </div>

            <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">{t('upload.openDetails')}</p>
          </div>
        </button>

        {!running && (
          <button
            onClick={clear}
            title={t('common.close')}
            className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700"
          >
            <X size={15} />
          </button>
        )}
      </div>
    </div>
  );
};

export default UploadTray;
