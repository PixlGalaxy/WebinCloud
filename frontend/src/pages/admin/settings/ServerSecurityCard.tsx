import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { ApiError } from '../../../api/client';
import { settingsApi, type AdminSettings } from '../../../api/admin';
import { useI18n } from '../../../i18n/I18nContext';
import type { TranslationKey } from '../../../i18n/translations';
import { btn, card, errorBox, input, label } from '../../../components/ui/styles';
import Toast from '../../../components/ui/Toast';
import Tooltip from '../../../components/ui/Tooltip';

type NumericKey =
  | 'sessionTtlHours'
  | 'loginRateLimitMax'
  | 'loginRateLimitWindowMinutes'
  | 'shareUnlockRateLimitMax'
  | 'shareUnlockRateLimitWindowMinutes'
  | 'archiveAbandonSeconds'
  | 'maxUploadMb';

const FIELDS: { key: NumericKey; labelKey: TranslationKey; descriptionKey: TranslationKey; min: number; max: number }[] = [
  {
    key: 'sessionTtlHours',
    labelKey: 'adminSettings.sessionTtlLabel',
    descriptionKey: 'adminSettings.sessionTtlDescription',
    min: 1,
    max: 720,
  },
  {
    key: 'loginRateLimitMax',
    labelKey: 'adminSettings.loginRateLimitMaxLabel',
    descriptionKey: 'adminSettings.loginRateLimitMaxDescription',
    min: 1,
    max: 1000,
  },
  {
    key: 'loginRateLimitWindowMinutes',
    labelKey: 'adminSettings.loginRateLimitWindowLabel',
    descriptionKey: 'adminSettings.loginRateLimitWindowDescription',
    min: 1,
    max: 1440,
  },
  {
    key: 'shareUnlockRateLimitMax',
    labelKey: 'adminSettings.shareUnlockRateLimitMaxLabel',
    descriptionKey: 'adminSettings.shareUnlockRateLimitMaxDescription',
    min: 1,
    max: 1000,
  },
  {
    key: 'shareUnlockRateLimitWindowMinutes',
    labelKey: 'adminSettings.shareUnlockRateLimitWindowLabel',
    descriptionKey: 'adminSettings.shareUnlockRateLimitWindowDescription',
    min: 1,
    max: 1440,
  },
  {
    key: 'archiveAbandonSeconds',
    labelKey: 'adminSettings.archiveAbandonLabel',
    descriptionKey: 'adminSettings.archiveAbandonDescription',
    min: 5,
    max: 3600,
  },
  {
    key: 'maxUploadMb',
    labelKey: 'adminSettings.maxUploadLabel',
    descriptionKey: 'adminSettings.maxUploadDescription',
    min: 0,
    max: 1024 * 1024,
  },
];

const ServerSecurityCard = () => {
  const { t } = useI18n();
  const [data, setData] = useState<AdminSettings | null>(null);
  const [values, setValues] = useState<Record<NumericKey, number>>({
    sessionTtlHours: 24,
    loginRateLimitMax: 10,
    loginRateLimitWindowMinutes: 15,
    shareUnlockRateLimitMax: 10,
    shareUnlockRateLimitWindowMinutes: 15,
    archiveAbandonSeconds: 30,
    maxUploadMb: 0,
  });
  const [cookieSecure, setCookieSecure] = useState(false);
  const [maxmindKey, setMaxmindKey] = useState('');
  const [trustProxy, setTrustProxy] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  const load = () =>
    settingsApi.get().then((d) => {
      setData(d);
      setValues({
        sessionTtlHours: d.server.sessionTtlHours.saved,
        loginRateLimitMax: d.server.loginRateLimitMax.saved,
        loginRateLimitWindowMinutes: d.server.loginRateLimitWindowMinutes.saved,
        shareUnlockRateLimitMax: d.server.shareUnlockRateLimitMax.saved,
        shareUnlockRateLimitWindowMinutes: d.server.shareUnlockRateLimitWindowMinutes.saved,
        archiveAbandonSeconds: d.server.archiveAbandonSeconds.saved,
        maxUploadMb: d.server.maxUploadMb.saved,
      });
      setCookieSecure(d.server.cookieSecure.saved);
      setTrustProxy(d.server.trustProxy.saved);
    });

  useEffect(() => {
    load().catch((err) => setError(err instanceof ApiError ? err.message : String(err)));
  }, []);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await settingsApi.update({
        ...values,
        cookieSecure,
        trustProxy,
        ...(maxmindKey.trim() ? { maxmindLicenseKey: maxmindKey.trim() } : {}),
      });
      setMaxmindKey('');
      await load();
      const message = t('adminSettings.saved');
      setToast(message);
      setTimeout(() => setToast((current) => (current === message ? null : current)), 2000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('adminSettings.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  if (!data) return null;

  return (
    <section className={`${card} p-6`}>
      <h2 className="font-semibold text-slate-900 dark:text-slate-100">{t('adminSettings.serverTitle')}</h2>
      <p className="mt-1 mb-4 text-sm text-slate-500 dark:text-slate-400">{t('adminSettings.serverHint')}</p>

      {data.restartRequired && (
        <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          {t('adminSettings.restartBanner')}
        </div>
      )}

      {error && <div className={`${errorBox} mb-4`}>{error}</div>}

      <div className="grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
        {FIELDS.map(({ key, labelKey, descriptionKey, min, max }) => (
          <div key={key}>
            <label className={`${label} flex items-center gap-1.5`} htmlFor={`admin-${key}`}>
              {t(labelKey)}
              <Tooltip text={t(descriptionKey)} />
            </label>
            <input
              id={`admin-${key}`}
              type="number"
              min={min}
              max={max}
              value={values[key]}
              onChange={(e) => setValues((v) => ({ ...v, [key]: Number(e.target.value) }))}
              className={input}
            />
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {t('adminSettings.rangeHint', { min: String(min), max: String(max) })}
            </p>
          </div>
        ))}
      </div>

      <label className="mt-5 flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-200">
        <input
          type="checkbox"
          checked={cookieSecure}
          onChange={(e) => setCookieSecure(e.target.checked)}
          className="h-4 w-4 rounded border-slate-300 text-[var(--accent-600)] focus:ring-[var(--accent-500)]"
        />
        <span className="flex items-center gap-1.5 font-medium">
          {t('adminSettings.cookieSecureLabel')}
          <Tooltip text={t('adminSettings.cookieSecureDescription')} />
        </span>
      </label>

      <div className="mt-5 max-w-md">
        <label className={`${label} flex items-center gap-1.5`} htmlFor="admin-trust-proxy">
          {t('adminSettings.trustProxyLabel')}
          <Tooltip text={t('adminSettings.trustProxyDescription')} />
        </label>
        <input
          id="admin-trust-proxy"
          type="text"
          value={trustProxy}
          onChange={(e) => setTrustProxy(e.target.value)}
          placeholder="uniquelocal"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          className={`${input} font-mono`}
        />
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('adminSettings.trustProxyHint')}</p>
        {data.yourIp && (
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {t('adminSettings.trustProxyYourIp', { ip: data.yourIp })}
          </p>
        )}
      </div>

      <div className="mt-5 max-w-md">
        <label className={`${label} flex items-center gap-1.5`} htmlFor="admin-maxmind-key">
          {t('adminSettings.maxmindLabel')}
          <Tooltip text={t('adminSettings.maxmindDescription')} />
        </label>
        <input
          id="admin-maxmind-key"
          type="password"
          value={maxmindKey}
          onChange={(e) => setMaxmindKey(e.target.value)}
          placeholder={data.maxmindLicenseKeySaved ? t('adminSettings.maxmindSetPlaceholder') : ''}
          className={input}
        />
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('adminSettings.maxmindHint')}</p>
      </div>

      <button type="button" onClick={() => void save()} disabled={saving} className={`${btn.primary} mt-5`}>
        {saving && <Loader2 className="animate-spin" size={16} />}
        {t('common.save')}
      </button>

      {toast && <Toast message={toast} />}
    </section>
  );
};

export default ServerSecurityCard;
