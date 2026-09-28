import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpCircle, Cpu, HardDrive, Info, MemoryStick, Server } from 'lucide-react';
import { ApiError } from '../../../api/client';
import { systemApi, type SystemInfo } from '../../../api/admin';
import { useI18n } from '../../../i18n/I18nContext';
import type { TranslationKey } from '../../../i18n/translations';
import { card, errorBox } from '../../../components/ui/styles';
import { formatBytes, formatBytesPerSec } from '../format';

const POLL_MS = 3000;

/** A thin, single-hue usage bar — the shared visual language for cpu/memory/disk. */
const UsageBar = ({ percent }: { percent: number }) => (
  <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
    <div
      className="h-full rounded-full bg-[var(--accent-500)] transition-[width] duration-500"
      style={{ width: `${Math.max(0, Math.min(100, percent))}%` }}
    />
  </div>
);

const NotAvailableNotice = ({ labelKey }: { labelKey: TranslationKey }) => {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
      <Info size={12} className="shrink-0" />
      {t(labelKey)}
    </div>
  );
};

const SystemSection = () => {
  const { t } = useI18n();
  const [data, setData] = useState<SystemInfo | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      systemApi
        .get()
        .then((next) => {
          if (!cancelled) setData(next);
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof ApiError ? err.message : String(err));
        });

    load();
    const interval = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (error) return <div className={errorBox}>{error}</div>;
  if (!data) return null;

  const memoryPercent = data.memory ? (data.memory.usedBytes / data.memory.totalBytes) * 100 : 0;

  return (
    <div className="space-y-6">
      <section className={`${card} p-6`}>
        <div className="mb-4 flex items-center gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
          <Server size={16} className="text-slate-400 dark:text-slate-500" />
          <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
            {t('adminSystem.imageTitle')}
          </span>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-slate-500 dark:text-slate-400">{t('adminSystem.nodeVersion')}</dt>
            <dd className="font-medium text-slate-900 dark:text-slate-100">{data.image.nodeVersion}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500 dark:text-slate-400">{t('adminSystem.appVersion')}</dt>
            <dd className="font-medium text-slate-900 dark:text-slate-100">{data.image.appVersion}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500 dark:text-slate-400">{t('adminSystem.imageTag')}</dt>
            <dd
              className="truncate font-mono font-medium text-slate-900 dark:text-slate-100"
              title={data.image.imageRevision ? `commit ${data.image.imageRevision}` : undefined}
            >
              {data.image.imageRef}
              {data.image.imageRevision && (
                <span className="ml-1.5 text-xs font-normal text-slate-400 dark:text-slate-500">
                  @{data.image.imageRevision}
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500 dark:text-slate-400">{t('adminSystem.platform')}</dt>
            <dd className="font-medium text-slate-900 dark:text-slate-100">
              {data.image.platform} / {data.image.arch}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500 dark:text-slate-400">{t('adminSystem.osRelease')}</dt>
            <dd className="truncate font-medium text-slate-900 dark:text-slate-100" title={data.image.osRelease}>
              {data.image.osRelease}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500 dark:text-slate-400">{t('adminSystem.containerized')}</dt>
            <dd className="font-medium text-slate-900 dark:text-slate-100">
              {t(data.image.containerized ? 'common.yes' : 'common.no')}
            </dd>
          </div>
        </dl>
        {!data.image.containerized && (
          <p className="mt-4 flex items-start gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <Info size={12} className="mt-0.5 shrink-0" />
            {t('adminSystem.notContainerizedHint')}
          </p>
        )}
        {data.update.updateAvailable && (
          <a
            href="https://github.com/PixlGalaxy/WebinCloud/commits/main"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-4 flex items-start gap-1.5 rounded-lg border border-[var(--accent-200)] bg-[var(--accent-50)] px-3 py-2 text-xs font-medium text-[var(--accent-700)] hover:underline dark:border-[var(--accent-500)]/30 dark:bg-[var(--accent-500)]/10 dark:text-[var(--accent-300)]"
          >
            <ArrowUpCircle size={14} className="mt-0.5 shrink-0" />
            {t('adminSystem.updateAvailable', { revision: data.update.latestRevision ?? '' })}
          </a>
        )}
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className={`${card} p-6`}>
          <div className="mb-4 flex items-center gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
            <Cpu size={16} className="text-slate-400 dark:text-slate-500" />
            <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
              {t('adminSystem.resourcesTitle')}
            </span>
          </div>

          <div className="space-y-5">
            <div>
              <div className="mb-1.5 flex items-center justify-between text-sm">
                <span className="flex items-center gap-1.5 font-medium text-slate-700 dark:text-slate-200">
                  <Cpu size={14} /> {t('adminSystem.cpuLabel', { cores: String(data.cpu.cores) })}
                </span>
                <span className="text-slate-500 dark:text-slate-400">
                  {data.cpu.usagePercent === null ? '—' : `${data.cpu.usagePercent.toFixed(0)}%`}
                </span>
              </div>
              <UsageBar percent={data.cpu.usagePercent ?? 0} />
              {data.cpu.model && <p className="mt-1 truncate text-xs text-slate-400 dark:text-slate-500">{data.cpu.model}</p>}
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between text-sm">
                <span className="flex items-center gap-1.5 font-medium text-slate-700 dark:text-slate-200">
                  <MemoryStick size={14} /> {t('adminSystem.memoryLabel')}
                </span>
                <span className="text-slate-500 dark:text-slate-400">
                  {data.memory ? `${formatBytes(data.memory.usedBytes)} / ${formatBytes(data.memory.totalBytes)}` : '—'}
                </span>
              </div>
              <UsageBar percent={memoryPercent} />
            </div>

            {!data.resourcesAvailable && <NotAvailableNotice labelKey="adminSystem.resourcesUnavailable" />}
          </div>

          <div className="mt-5 border-t border-slate-100 pt-4 dark:border-slate-800">
            <div className="mb-1.5 flex items-center justify-between text-sm">
              <span className="font-medium text-slate-700 dark:text-slate-200">{t('adminSystem.networkLabel')}</span>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                <ArrowUp size={14} /> {formatBytesPerSec(data.network.upload)}/s
              </span>
              <span className="flex items-center gap-1.5 text-rose-600 dark:text-rose-400">
                <ArrowDown size={14} /> {formatBytesPerSec(data.network.download)}/s
              </span>
            </div>
            {!data.network.ready && (
              <div className="mt-2">
                <NotAvailableNotice labelKey="adminDashboard.networkStatsUnavailable" />
              </div>
            )}
          </div>
        </section>

        <section className={`${card} p-6`}>
          <div className="mb-4 flex items-center gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
            <HardDrive size={16} className="text-slate-400 dark:text-slate-500" />
            <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
              {t('adminSystem.diskTitle')}
            </span>
          </div>

          {data.disks.length === 0 ? (
            <NotAvailableNotice labelKey="adminSystem.resourcesUnavailable" />
          ) : (
            <div className="space-y-5">
              {data.disks.map((disk) => (
                <div key={disk.path}>
                  <div className="mb-1.5 flex items-center justify-between text-sm">
                    <span className="font-medium text-slate-700 dark:text-slate-200">{disk.label}</span>
                    <span className="text-slate-500 dark:text-slate-400">
                      {formatBytes(disk.usedBytes)} / {formatBytes(disk.totalBytes)}
                    </span>
                  </div>
                  <UsageBar percent={(disk.usedBytes / disk.totalBytes) * 100} />
                  <p className="mt-1 truncate text-xs text-slate-400 dark:text-slate-500" title={disk.path}>
                    {disk.path}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default SystemSection;
