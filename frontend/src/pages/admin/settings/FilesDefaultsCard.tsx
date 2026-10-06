import { useEffect, useState } from 'react';
import { ApiError } from '../../../api/client';
import { settingsApi } from '../../../api/admin';
import { useI18n } from '../../../i18n/I18nContext';
import { card, errorBox } from '../../../components/ui/styles';
import Toast from '../../../components/ui/Toast';
import Tooltip from '../../../components/ui/Tooltip';

/**
 * System-wide defaults for the file explorer. Saved immediately and read on
 * every page load (no restart); each user can still override them in Settings.
 */
const FilesDefaultsCard = () => {
  const { t } = useI18n();
  const [showHidden, setShowHidden] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    settingsApi
      .get()
      .then((data) => setShowHidden(data.showHiddenFiles))
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  // Flips right away and rolls back if the save fails, so the click is never ignored.
  const toggle = async (next: boolean) => {
    setShowHidden(next);
    setSaving(true);
    setError('');
    try {
      await settingsApi.update({ showHiddenFiles: next });
      const message = t('adminSettings.saved');
      setToast(message);
      setTimeout(() => setToast((current) => (current === message ? null : current)), 2000);
    } catch (err) {
      setShowHidden(!next);
      setError(err instanceof ApiError ? err.message : t('adminSettings.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={`${card} p-6`}>
      <h2 className="font-semibold text-slate-900 dark:text-slate-100">{t('adminSettings.filesTitle')}</h2>
      <p className="mt-1 mb-4 text-sm text-slate-500 dark:text-slate-400">{t('adminSettings.filesHint')}</p>

      {error && <div className={`${errorBox} mb-4`}>{error}</div>}

      <label className="flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-200">
        <input
          type="checkbox"
          checked={showHidden}
          disabled={loading}
          onChange={(e) => {
            if (!saving) void toggle(e.target.checked);
          }}
          className="h-4 w-4 rounded border-slate-300 text-[var(--accent-600)] focus:ring-[var(--accent-500)] disabled:opacity-50"
        />
        <span className="flex items-center gap-1.5 font-medium">
          {t('adminSettings.showHiddenFilesLabel')}
          <Tooltip text={t('adminSettings.showHiddenFilesDescription')} />
        </span>
      </label>

      {toast && <Toast message={toast} />}
    </section>
  );
};

export default FilesDefaultsCard;
