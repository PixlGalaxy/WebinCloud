import { useEffect, useRef, useState } from 'react';
import { Loader2, RotateCcw, Upload } from 'lucide-react';
import { ApiError } from '../../../api/client';
import { settingsApi, brandingAdminApi, type BrandingAsset } from '../../../api/admin';
import { useI18n } from '../../../i18n/I18nContext';
import type { TranslationKey } from '../../../i18n/translations';
import { btn, card, errorBox, input, label } from '../../../components/ui/styles';
import Toast from '../../../components/ui/Toast';
import Tooltip from '../../../components/ui/Tooltip';

const ASSETS: {
  name: BrandingAsset;
  labelKey: TranslationKey;
  hintKey: TranslationKey;
  descriptionKey: TranslationKey;
  accept: string;
}[] = [
  {
    name: 'logo.png',
    labelKey: 'adminSettings.logoLabel',
    hintKey: 'adminSettings.logoHint',
    descriptionKey: 'adminSettings.logoDescription',
    accept: 'image/png',
  },
  {
    name: 'icon.png',
    labelKey: 'adminSettings.iconLabel',
    hintKey: 'adminSettings.iconHint',
    descriptionKey: 'adminSettings.iconDescription',
    accept: 'image/png',
  },
  {
    name: 'favicon.ico',
    labelKey: 'adminSettings.faviconLabel',
    hintKey: 'adminSettings.faviconHint',
    descriptionKey: 'adminSettings.faviconDescription',
    accept: '.ico,image/x-icon,image/vnd.microsoft.icon',
  },
];

const AssetUploader = ({ name, labelKey, hintKey, descriptionKey, accept }: (typeof ASSETS)[number]) => {
  const { t } = useI18n();
  const [version, setVersion] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    setBusy(true);
    setError('');
    try {
      await brandingAdminApi.upload(name, file);
      setVersion(Date.now());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('files.actionFailed'));
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    setError('');
    try {
      await brandingAdminApi.reset(name);
      setVersion(Date.now());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('files.actionFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-start gap-4">
      <img
        src={brandingAdminApi.url(name, version)}
        alt={t(labelKey)}
        className="h-14 w-14 shrink-0 rounded-lg border border-slate-200 bg-white object-contain p-1 dark:border-slate-700 dark:bg-slate-800"
      />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-200">
          {t(labelKey)}
          <Tooltip text={t(descriptionKey)} />
        </p>
        <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{t(hintKey)}</p>
        {error && <div className={`${errorBox} mt-2`}>{error}</div>}
        <div className="mt-2 flex items-center gap-2">
          <button type="button" onClick={() => fileInput.current?.click()} disabled={busy} className={btn.secondary}>
            {busy ? <Loader2 className="animate-spin" size={16} /> : <Upload size={16} />}
            {t('adminSettings.uploadImage')}
          </button>
          <button type="button" onClick={() => void reset()} disabled={busy} className={btn.iconGhost} title={t('adminSettings.resetToDefault')}>
            <RotateCcw size={16} />
          </button>
          <input
            ref={fileInput}
            type="file"
            accept={accept}
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void upload(file);
              e.target.value = '';
            }}
          />
        </div>
      </div>
    </div>
  );
};

const BrandingCard = () => {
  const { t } = useI18n();
  const [appTitle, setAppTitle] = useState('');
  const [appName, setAppName] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    settingsApi
      .get()
      .then((data) => {
        setAppTitle(data.appTitle);
        setAppName(data.appName);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await settingsApi.update({ appTitle: appTitle.trim(), appName: appName.trim() });
      const message = t('adminSettings.saved');
      setToast(message);
      setTimeout(() => setToast((current) => (current === message ? null : current)), 2000);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('adminSettings.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return null;

  return (
    <section className={`${card} p-6`}>
      <h2 className="font-semibold text-slate-900 dark:text-slate-100">{t('adminSettings.brandingTitle')}</h2>
      <p className="mt-1 mb-6 text-sm text-slate-500 dark:text-slate-400">{t('adminSettings.brandingHint')}</p>

      {error && <div className={`${errorBox} mb-4`}>{error}</div>}

      <div className="grid max-w-2xl grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={`${label} flex items-center gap-1.5`} htmlFor="admin-app-title">
            {t('adminSettings.appTitleLabel')}
            <Tooltip text={t('adminSettings.appTitleDescription')} />
          </label>
          <input id="admin-app-title" value={appTitle} onChange={(e) => setAppTitle(e.target.value)} className={input} />
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('adminSettings.appTitleHint')}</p>
        </div>
        <div>
          <label className={`${label} flex items-center gap-1.5`} htmlFor="admin-app-name">
            {t('adminSettings.appNameLabel')}
            <Tooltip text={t('adminSettings.appNameDescription')} />
          </label>
          <input id="admin-app-name" value={appName} onChange={(e) => setAppName(e.target.value)} className={input} />
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t('adminSettings.appNameHint')}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => void save()}
        disabled={saving || !appTitle.trim() || !appName.trim()}
        className={`${btn.primary} mt-4`}
      >
        {saving && <Loader2 className="animate-spin" size={16} />}
        {t('common.save')}
      </button>

      <div className="mt-8 space-y-6 border-t border-slate-100 pt-6 dark:border-slate-800">
        {ASSETS.map((asset) => (
          <AssetUploader key={asset.name} {...asset} />
        ))}
      </div>

      {toast && <Toast message={toast} />}
    </section>
  );
};

export default BrandingCard;
