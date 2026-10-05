import { useEffect, useState } from 'react';
import { Download, Globe, Upload, Users, type LucideIcon } from 'lucide-react';
import { adminApi, type ConnectionActivity, type MetricsSnapshot } from '../../api/admin';
import { useI18n } from '../../i18n/I18nContext';
import type { TranslationKey } from '../../i18n/translations';
import { card } from '../../components/ui/styles';
import { flagEmoji, formatCount } from './countries';
import WorldMap from './WorldMap';
import NetworkTrafficCard from './NetworkTrafficCard';

const LOCAL_IPS = new Set(['::1', '127.0.0.1', '::ffff:127.0.0.1']);
function formatIp(ip: string): string {
  return LOCAL_IPS.has(ip) ? 'localhost' : ip;
}

function elapsedSince(iso: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

const ACTIVITY_STYLE: Record<ConnectionActivity, string> = {
  downloading: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  uploading: 'bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300',
  modifying: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  browsing: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  idle: 'bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500',
};

const ACTIVITY_LABEL: Record<ConnectionActivity, TranslationKey> = {
  downloading: 'adminDashboard.activityDownloading',
  uploading: 'adminDashboard.activityUploading',
  modifying: 'adminDashboard.activityModifying',
  browsing: 'adminDashboard.activityBrowsing',
  idle: 'adminDashboard.activityIdle',
};

const DashboardSection = () => {
  const { t } = useI18n();
  const [data, setData] = useState<MetricsSnapshot | null>(null);

  // Live for as long as the page is open — a fresh snapshot arrives every
  // second, so there's no refresh to remember, and the "since" durations stay
  // current on their own. A dropped connection reconnects by itself, same as
  // the logs stream.
  useEffect(() => {
    let streaming = false;
    let poll: number | undefined;
    const load = () => adminApi.metrics().then(setData).catch(() => undefined);

    // Shown right away, without waiting for the stream's first message.
    void load();

    const source = new EventSource(adminApi.metricsStreamUrl());
    source.onmessage = (event) => {
      streaming = true;
      if (poll !== undefined) {
        window.clearInterval(poll);
        poll = undefined;
      }
      setData(JSON.parse(event.data) as MetricsSnapshot);
    };

    // A reverse proxy that buffers or compresses event streams would leave the
    // dashboard frozen; poll once a second instead until the stream gets through.
    const fallback = window.setTimeout(() => {
      if (!streaming) poll = window.setInterval(() => void load(), 1000);
    }, 5000);

    return () => {
      source.close();
      window.clearTimeout(fallback);
      if (poll !== undefined) window.clearInterval(poll);
    };
  }, []);

  const tiles: { key: string; icon: LucideIcon; color: string; value: number; labelKey: TranslationKey }[] = [
    { key: 'uploads', icon: Upload, color: 'bg-sky-500', value: data?.totals.uploads ?? 0, labelKey: 'adminDashboard.uploads' },
    { key: 'downloads', icon: Download, color: 'bg-teal-500', value: data?.totals.downloads ?? 0, labelKey: 'adminDashboard.downloads' },
    { key: 'total', icon: Globe, color: 'bg-emerald-500', value: data?.totals.connections ?? 0, labelKey: 'adminDashboard.totalConnections' },
    { key: 'current', icon: Users, color: 'bg-violet-500', value: data?.current.length ?? 0, labelKey: 'adminDashboard.currentConnections' },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {tiles.map(({ key, icon: Icon, color, value, labelKey }) => (
          <div key={key} className={`${card} flex items-center gap-4 p-4`}>
            <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg text-white ${color}`}>
              <Icon size={22} />
            </div>
            <div>
              <div className="text-2xl font-bold text-slate-900 dark:text-slate-100">{formatCount(value)}</div>
              <div className="text-xs font-medium tracking-wide text-slate-500 uppercase dark:text-slate-400">
                {t(labelKey)}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <WorldMap countries={data?.countries ?? []} geoReady={data ? data.geoReady : null} />
        <NetworkTrafficCard
          upload={data?.bandwidth.upload ?? []}
          download={data?.bandwidth.download ?? []}
          intervalSeconds={data?.bandwidth.intervalSeconds ?? 1}
          networkStatsReady={data?.networkStatsReady ?? false}
        />
      </div>

      <div className={`${card} p-4`}>
        <h3 className="mb-3 text-sm font-medium text-slate-700 dark:text-slate-200">
          {t('adminDashboard.connectionsTitle')}
        </h3>
        {!data || data.current.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500 dark:text-slate-400">
            {t('adminDashboard.noConnections')}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs tracking-wide text-slate-500 uppercase dark:text-slate-400">
                  <th className="py-2 pr-4 font-medium">{t('adminDashboard.colIp')}</th>
                  <th className="py-2 pr-4 font-medium">{t('adminDashboard.colCountry')}</th>
                  <th className="py-2 pr-4 font-medium">{t('adminDashboard.colUser')}</th>
                  <th className="py-2 pr-4 font-medium">{t('adminDashboard.colActivity')}</th>
                  <th className="py-2 font-medium">{t('adminDashboard.colSince')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.current.map((c, i) => (
                  <tr key={`${c.ip}-${i}`}>
                    <td className="py-2 pr-4 font-mono text-xs text-slate-700 dark:text-slate-300">{formatIp(c.ip)}</td>
                    <td className="py-2 pr-4 text-slate-700 dark:text-slate-300">
                      {c.country ? `${flagEmoji(c.country)} ${c.countryName}` : '—'}
                    </td>
                    <td className="py-2 pr-4 text-slate-700 dark:text-slate-300">
                      {c.kind === 'user' ? c.username : t('adminDashboard.publicVisitor')}
                    </td>
                    <td className="py-2 pr-4">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ACTIVITY_STYLE[c.activity]}`}>
                        {t(ACTIVITY_LABEL[c.activity])}
                      </span>
                    </td>
                    <td className="py-2 text-slate-500 dark:text-slate-400">{elapsedSince(c.since)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </div>
  );
};

export default DashboardSection;
