import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Pause, Play, RefreshCw } from 'lucide-react';
import { logsApi, PAGE_SIZES, type LogEntry, type LogPage } from '../../api/logs';
import { ApiError } from '../../api/client';
import { useI18n } from '../../i18n/I18nContext';
import { btn, card, errorBox } from '../../components/ui/styles';

const CHANNEL_STYLE: Record<LogEntry['channel'], string> = {
  BACKEND: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  AUTH: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  SYSTEM: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
};

const LEVEL_STYLE: Record<LogEntry['level'], string> = {
  INFO: 'text-slate-700 dark:text-slate-200',
  WARN: 'text-amber-700 dark:text-amber-300',
  ERROR: 'text-rose-700 dark:text-rose-300',
};

const LogsPage = () => {
  const { t, language } = useI18n();

  const [limit, setLimit] = useState<number>(PAGE_SIZES[0]);
  const [page, setPage] = useState(1);
  const [paused, setPaused] = useState(false);
  const [data, setData] = useState<LogPage | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const newestId = useRef(0);

  // Only page 1 has a "newest" edge to follow; older pages would shift under the reader.
  const live = !paused && page === 1;

  const load = useCallback(async () => {
    setError('');
    try {
      const next = await logsApi.list(limit, page);
      newestId.current = Math.max(newestId.current, next.entries[0]?.id ?? 0);
      setData(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('files.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [limit, page, t]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  useEffect(() => {
    if (!live) return;

    const source = new EventSource(logsApi.streamUrl(newestId.current));
    source.onmessage = (event) => {
      // A reconnect replays from the original position, so skip what is already shown.
      const fresh = (JSON.parse(event.data) as LogEntry[]).filter((entry) => entry.id > newestId.current);
      if (fresh.length === 0) return;

      newestId.current = fresh[fresh.length - 1].id;
      setData((current) => {
        if (!current) return current;
        const total = Math.min(current.total + fresh.length, current.capacity);
        return {
          ...current,
          total,
          pages: Math.max(1, Math.ceil(total / limit)),
          entries: [...fresh.reverse(), ...current.entries].slice(0, limit),
        };
      });
    };

    return () => source.close();
  }, [live, limit]);

  const resume = () => {
    setPaused(false);
    if (page !== 1) setPage(1);
    else void load();
  };

  const formatTime = (iso: string) =>
    new Intl.DateTimeFormat(language, {
      dateStyle: 'short',
      timeStyle: 'medium',
      hour12: false,
    }).format(new Date(iso));

  const pages = data?.pages ?? 1;
  const from = data && data.total > 0 ? (page - 1) * limit + 1 : 0;
  const to = data ? Math.min(page * limit, data.total) : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{t('page.logs')}</h1>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
              live
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300'
                : 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300'
            }`}
          >
            {live && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />}
            {t(live ? 'logs.live' : page !== 1 ? 'logs.history' : 'logs.paused')}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            {t('logs.perPage')}
            <select
              value={limit}
              onChange={(e) => {
                setLimit(Number(e.target.value));
                setPage(1);
              }}
              className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>

          {live ? (
            <button onClick={() => setPaused(true)} className={btn.secondary}>
              <Pause size={16} /> {t('logs.pause')}
            </button>
          ) : (
            <button onClick={resume} className={btn.primary}>
              <Play size={16} /> {t('logs.resume')}
            </button>
          )}

          <button onClick={() => void load()} className={btn.secondary} title={t('files.refresh')}>
            <RefreshCw size={16} />
            <span className="hidden sm:inline">{t('files.refresh')}</span>
          </button>
        </div>
      </div>

      {error && <div className={errorBox}>{error}</div>}

      <div className={`${card} overflow-hidden`}>
        {loading && !data ? (
          <div className="flex justify-center p-12">
            <Loader2 className="animate-spin text-indigo-500" size={28} />
          </div>
        ) : data && data.entries.length === 0 ? (
          <p className="p-12 text-center text-slate-500 dark:text-slate-400">{t('logs.empty')}</p>
        ) : (
          <ul className="divide-y divide-slate-100 font-mono text-xs dark:divide-slate-800">
            {data?.entries.map((entry) => (
              <li key={entry.id} className="flex items-start gap-3 px-4 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                <span className="w-36 shrink-0 text-slate-400 dark:text-slate-500" title={entry.time}>
                  {formatTime(entry.time)}
                </span>
                <span
                  className={`w-16 shrink-0 rounded px-1.5 py-0.5 text-center text-[10px] font-semibold ${CHANNEL_STYLE[entry.channel]}`}
                >
                  {entry.channel}
                </span>
                <span className={`w-10 shrink-0 font-semibold ${LEVEL_STYLE[entry.level]}`}>{entry.level}</span>
                <span className={`min-w-0 flex-1 break-all ${LEVEL_STYLE[entry.level]}`}>{entry.message}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600 dark:text-slate-300">
        <span>{t('logs.range', { from, to, total: data?.total ?? 0 })}</span>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setPage((current) => current - 1)}
            disabled={page <= 1}
            className={`${btn.secondary} disabled:opacity-40`}
          >
            <ChevronLeft size={16} /> {t('logs.newer')}
          </button>
          <span>{t('logs.page', { page, pages })}</span>
          <button
            onClick={() => setPage((current) => current + 1)}
            disabled={page >= pages}
            className={`${btn.secondary} disabled:opacity-40`}
          >
            {t('logs.older')} <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        {t('logs.memoryNote', { count: data?.capacity ?? 0 })}
      </p>
    </div>
  );
};

export default LogsPage;
