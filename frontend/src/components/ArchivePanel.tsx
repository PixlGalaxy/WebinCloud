import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Download, FileArchive, Loader2, X } from 'lucide-react';
import { downloadUrlFor, useArchives } from '../context/ArchiveContext';
import { useI18n } from '../i18n/I18nContext';
import { formatSize } from '../pages/files/paths';

/** How long a finished card lingers before sliding away. */
const LINGER_MS = 15000;
const EXIT_MS = 260;

/** Google-Drive-style tray: progress stays visible while the user keeps working. */
const ArchivePanel = () => {
  const { jobs, dismiss } = useArchives();
  const { t } = useI18n();
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const scheduled = useRef(new Set<string>());

  const scheduleExit = useCallback(
    (id: string) => {
      window.setTimeout(() => {
        setLeaving((current) => new Set(current).add(id));
        window.setTimeout(() => dismiss(id), EXIT_MS);
      }, LINGER_MS);
    },
    [dismiss],
  );

  // A finished archive has already started downloading, so the card only needs
  // to stay long enough to be noticed.
  useEffect(() => {
    for (const job of jobs) {
      if (job.status !== 'done' || scheduled.current.has(job.id)) continue;
      scheduled.current.add(job.id);
      scheduleExit(job.id);
    }
  }, [jobs, scheduleExit]);

  if (jobs.length === 0) return null;

  return (
    <div className="space-y-2">
      {jobs.map((job) => {
        const percent = job.progress === null ? null : Math.round(job.progress * 100);

        return (
          <div
            key={job.id}
            className={`rounded-xl border border-slate-200 bg-white shadow-lg dark:border-slate-700 dark:bg-slate-800 ${
              leaving.has(job.id) ? 'animate-toast-out' : 'animate-toast-in'
            }`}
          >
            <div className="flex items-start gap-3 p-3.5">
              {job.status === 'done' ? (
                <CheckCircle2 size={20} className="mt-0.5 shrink-0 text-emerald-500" />
              ) : job.status === 'error' ? (
                <AlertCircle size={20} className="mt-0.5 shrink-0 text-rose-500" />
              ) : (
                <FileArchive size={20} className="mt-0.5 shrink-0 text-amber-500" />
              )}

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                  {job.fileName}
                </p>

                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  {job.status === 'done'
                    ? t('archive.ready', { size: formatSize(job.totalBytes) })
                    : job.status === 'error'
                      ? (job.error ?? t('archive.failed'))
                      : job.status === 'preparing'
                        ? t('archive.measuring')
                        : t('archive.building', {
                            done: formatSize(job.processedBytes),
                            total: formatSize(job.totalBytes),
                          })}
                </p>

                {(job.status === 'preparing' || job.status === 'running') && (
                  <>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                      <div
                        className={`h-full bg-amber-500 transition-all ${percent === null ? 'w-1/3 animate-pulse' : ''}`}
                        style={percent === null ? undefined : { width: `${percent}%` }}
                      />
                    </div>
                    <p className="mt-1.5 text-xs text-slate-400 dark:text-slate-500">
                      {t('archive.keepBrowsing')}
                    </p>
                  </>
                )}

                {job.status === 'done' && (
                  <a
                    href={downloadUrlFor(job)}
                    download={job.fileName}
                    className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-700"
                  >
                    <Download size={14} /> {t('archive.downloadAgain')}
                  </a>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-1">
                {(job.status === 'preparing' || job.status === 'running') && percent !== null && (
                  <span className="text-xs tabular-nums text-slate-500 dark:text-slate-400">{percent}%</span>
                )}
                {(job.status === 'preparing' || job.status === 'running') && percent === null && (
                  <Loader2 size={14} className="animate-spin text-slate-400" />
                )}
                <button
                  onClick={() => dismiss(job.id)}
                  title={t('common.close')}
                  className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700"
                >
                  <X size={15} />
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default ArchivePanel;
