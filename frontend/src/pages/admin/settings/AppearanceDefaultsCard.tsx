import { useEffect, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { ApiError } from '../../../api/client';
import { settingsApi } from '../../../api/admin';
import { useI18n } from '../../../i18n/I18nContext';
import { isThemeMode, isSkinId, type ThemeMode, type SkinId } from '../../../theme/themes';
import { SUPPORTED_LANGUAGES, LANGUAGE_NAMES, isLanguage, type Language } from '../../../i18n/translations';
import { card, errorBox } from '../../../components/ui/styles';
import ThemePicker from '../../../components/ThemePicker';
import Toast from '../../../components/ui/Toast';
import Tooltip from '../../../components/ui/Tooltip';

/**
 * The system-wide default a signed-out visitor sees (login page, public share
 * links). Same picker UI as the per-account Appearance section, wired to the
 * admin settings API instead — takes effect immediately, no restart needed.
 */
const AppearanceDefaultsCard = () => {
  const { t } = useI18n();
  const [mode, setMode] = useState<ThemeMode>('dark');
  const [skin, setSkin] = useState<SkinId>('default');
  const [language, setLanguageState] = useState<Language>('en');
  const [loading, setLoading] = useState(true);
  const [savingMode, setSavingMode] = useState(false);
  const [savingSkin, setSavingSkin] = useState<SkinId | null>(null);
  const [savingLanguage, setSavingLanguage] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    settingsApi
      .get()
      .then((data) => {
        if (isThemeMode(data.defaultThemeMode)) setMode(data.defaultThemeMode);
        if (isSkinId(data.defaultThemeSkin)) setSkin(data.defaultThemeSkin);
        if (isLanguage(data.defaultLanguage)) setLanguageState(data.defaultLanguage);
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  const showToast = () => {
    const message = t('adminSettings.saved');
    setToast(message);
    setTimeout(() => setToast((current) => (current === message ? null : current)), 2000);
  };

  const chooseMode = async (next: ThemeMode) => {
    if (next === mode || savingMode) return;
    setSavingMode(true);
    setError('');
    try {
      await settingsApi.update({ defaultThemeMode: next });
      setMode(next);
      showToast();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('adminSettings.saveFailed'));
    } finally {
      setSavingMode(false);
    }
  };

  const chooseSkin = async (next: SkinId) => {
    if (next === skin || savingSkin) return;
    setSavingSkin(next);
    setError('');
    try {
      await settingsApi.update({ defaultThemeSkin: next });
      setSkin(next);
      showToast();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('adminSettings.saveFailed'));
    } finally {
      setSavingSkin(null);
    }
  };

  const chooseLanguage = async (next: Language) => {
    if (next === language || savingLanguage) return;
    setSavingLanguage(true);
    setError('');
    try {
      await settingsApi.update({ defaultLanguage: next });
      setLanguageState(next);
      showToast();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('adminSettings.saveFailed'));
    } finally {
      setSavingLanguage(false);
    }
  };

  if (loading) return null;

  return (
    <section className={`${card} p-6`}>
      <h2 className="font-semibold text-slate-900 dark:text-slate-100">{t('adminSettings.appearanceTitle')}</h2>
      <p className="mt-1 mb-6 text-sm text-slate-500 dark:text-slate-400">{t('adminSettings.appearanceHint')}</p>

      {error && <div className={`${errorBox} mb-4`}>{error}</div>}

      <h3 className="flex items-center gap-1.5 font-medium text-slate-800 dark:text-slate-100">
        {t('adminSettings.languageLabel')}
        <Tooltip text={t('adminSettings.languageDescription')} />
      </h3>
      <p className="mt-0.5 mb-3 text-xs text-slate-500 dark:text-slate-400">{t('adminSettings.languageHint')}</p>
      <div className="relative mb-8 inline-block w-56">
        <select
          value={language}
          disabled={savingLanguage}
          onChange={(e) => void chooseLanguage(e.target.value as Language)}
          className="w-full appearance-none rounded-lg border border-slate-300 bg-white px-3 py-1.5 pr-9 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[var(--accent-500)] disabled:cursor-wait dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
        >
          {SUPPORTED_LANGUAGES.map((id) => (
            <option key={id} value={id}>
              {LANGUAGE_NAMES[id]}
            </option>
          ))}
        </select>
        <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" />
      </div>

      <ThemePicker
        mode={mode}
        skin={skin}
        onModeChange={(next) => void chooseMode(next)}
        onSkinChange={(next) => void chooseSkin(next)}
        savingMode={savingMode}
        savingSkin={savingSkin}
      />

      {toast && <Toast message={toast} />}
    </section>
  );
};

export default AppearanceDefaultsCard;
