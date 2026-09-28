import { useEffect, useState } from 'react';
import { Loader2, Power, Server as ServerIcon } from 'lucide-react';
import { ApiError } from '../../../api/client';
import { servicesApi, type ServiceStatus } from '../../../api/admin';
import { useI18n } from '../../../i18n/I18nContext';
import type { TranslationKey } from '../../../i18n/translations';
import { btn, card, errorBox } from '../../../components/ui/styles';
import Tooltip from '../../../components/ui/Tooltip';

/** "45m" under an hour, "2h 5m" beyond it, "—" while unknown. */
function formatUptime(seconds: number | null): string {
  if (seconds === null) return '—';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

type Service = 'backend' | 'frontend';

const ROWS: { key: Service; labelKey: TranslationKey; descriptionKey: TranslationKey }[] = [
  { key: 'backend', labelKey: 'adminSettings.backendLabel', descriptionKey: 'adminSettings.backendDescription' },
  { key: 'frontend', labelKey: 'adminSettings.frontendLabel', descriptionKey: 'adminSettings.frontendDescription' },
];

const ServiceRow = ({ service, labelKey, descriptionKey, status, onRestarted }: {
  service: Service;
  labelKey: TranslationKey;
  descriptionKey: TranslationKey;
  status: ServiceStatus;
  onRestarted: () => void;
}) => {
  const { t } = useI18n();
  const [confirming, setConfirming] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [error, setError] = useState('');

  const restart = async () => {
    setRestarting(true);
    setError('');
    setConfirming(false);
    try {
      await servicesApi.restart(service);
      // The service is briefly down while it respawns — poll once after a beat.
      setTimeout(onRestarted, 2500);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('files.actionFailed'));
      setRestarting(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 border-b border-slate-100 py-4 last:border-0 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <ServerIcon size={18} className="shrink-0 text-slate-400 dark:text-slate-500" />
        <div>
          <p className="flex items-center gap-1.5 text-sm font-medium text-slate-800 dark:text-slate-100">
            {t(labelKey)}
            <Tooltip text={t(descriptionKey)} />
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400">
            <span className={`h-1.5 w-1.5 rounded-full ${status.running ? 'bg-emerald-500' : 'bg-rose-500'}`} />
            {t(status.running ? 'adminSettings.statusRunning' : 'adminSettings.statusDown')}
            {status.running && ` · ${t('adminSettings.uptimeLabel', { value: formatUptime(status.uptimeSeconds) })}`}
          </p>
          {error && <div className={`${errorBox} mt-2`}>{error}</div>}
        </div>
      </div>

      {confirming ? (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-slate-500 dark:text-slate-400">{t('adminSettings.restartConfirm')}</span>
          <button type="button" onClick={() => void restart()} className={btn.danger}>
            {t('common.confirm')}
          </button>
          <button type="button" onClick={() => setConfirming(false)} className={btn.secondary}>
            {t('common.cancel')}
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setConfirming(true)} disabled={restarting} className={btn.secondary}>
          {restarting ? <Loader2 className="animate-spin" size={16} /> : <Power size={16} />}
          {restarting ? t('adminSettings.restarting') : t('adminSettings.restartButton')}
        </button>
      )}
    </div>
  );
};

const ServicesCard = () => {
  const { t } = useI18n();
  const [status, setStatus] = useState<{ backend: ServiceStatus; frontend: ServiceStatus } | null>(null);
  const [error, setError] = useState('');

  const load = () => servicesApi.status().then(setStatus);

  useEffect(() => {
    load().catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
  }, []);

  if (!status) return null;

  return (
    <section className={`${card} p-6`}>
      <h2 className="font-semibold text-slate-900 dark:text-slate-100">{t('adminSettings.servicesTitle')}</h2>
      <p className="mt-1 mb-2 text-sm text-slate-500 dark:text-slate-400">{t('adminSettings.servicesHint')}</p>

      {error && <div className={`${errorBox} my-4`}>{error}</div>}

      <div>
        {ROWS.map(({ key, labelKey, descriptionKey }) => (
          <ServiceRow
            key={key}
            service={key}
            labelKey={labelKey}
            descriptionKey={descriptionKey}
            status={status[key]}
            onRestarted={() => void load().catch(() => undefined)}
          />
        ))}
      </div>
    </section>
  );
};

export default ServicesCard;
