import { useState } from 'react';
import { Check, Moon, Monitor, Palette, SlidersHorizontal, Sun, type LucideIcon } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import { useTheme, type ThemeMode } from '../../context/ThemeContext';
import { useAutoplayVideos } from '../../hooks/useAutoplayVideos';
import { useThumbnailsPreference } from '../../hooks/useThumbnailsPreference';
import { useAutoSignOut } from '../../context/AutoSignOutContext';
import { ApiError } from '../../api/client';
import { SKINS, THEME_MODES, type SkinId } from '../../theme/themes';
import type { TranslationKey } from '../../i18n/translations';
import { card, errorBox } from '../../components/ui/styles';
import Toast from '../../components/ui/Toast';

const MODE_ICON: Record<ThemeMode, LucideIcon> = { light: Sun, dark: Moon, system: Monitor };
const MODE_LABEL: Record<ThemeMode, TranslationKey> = {
  light: 'settings.themeModeLight',
  dark: 'settings.themeModeDark',
  system: 'settings.themeModeSystem',
};

type Section = 'appearance' | 'preferences';

const SECTIONS: { key: Section; icon: typeof Palette; labelKey: 'settings.appearanceTitle' | 'settings.preferencesTitle' }[] = [
  { key: 'appearance', icon: Palette, labelKey: 'settings.appearanceTitle' },
  { key: 'preferences', icon: SlidersHorizontal, labelKey: 'settings.preferencesTitle' },
];

const sectionLinkClass = (active: boolean) =>
  `flex shrink-0 items-center gap-2.5 rounded-lg px-3.5 py-2.5 text-sm font-medium transition sm:w-full ${
    active
      ? 'bg-[var(--accent-50)] text-[var(--accent-700)] dark:bg-[var(--accent-500)]/15 dark:text-[var(--accent-300)]'
      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
  }`;

const AppearanceSection = () => {
  const { t } = useI18n();
  const { themeMode, skin, setAppearance } = useTheme();
  const [savingMode, setSavingMode] = useState(false);
  const [savingSkin, setSavingSkin] = useState<SkinId | null>(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  const showToast = () => {
    const message = t('settings.appearanceSaved');
    setToast(message);
    setTimeout(() => setToast((current) => (current === message ? null : current)), 2000);
  };

  const chooseMode = async (mode: ThemeMode) => {
    if (mode === themeMode || savingMode) return;
    setSavingMode(true);
    setError('');
    try {
      await setAppearance({ mode });
      showToast();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('settings.appearanceSaveFailed'));
    } finally {
      setSavingMode(false);
    }
  };

  const chooseSkin = async (id: SkinId) => {
    if (id === skin || savingSkin) return;
    setSavingSkin(id);
    setError('');
    try {
      await setAppearance({ skin: id });
      showToast();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('settings.appearanceSaveFailed'));
    } finally {
      setSavingSkin(null);
    }
  };

  return (
    <section className={`${card} p-6`}>
      <h2 className="font-semibold text-slate-900 dark:text-slate-100">{t('settings.appearanceTitle')}</h2>
      <p className="mt-1 mb-6 text-sm text-slate-500 dark:text-slate-400">{t('settings.appearanceHint')}</p>

      {error && <div className={`${errorBox} mb-4`}>{error}</div>}

      <h3 className="font-medium text-slate-800 dark:text-slate-100">{t('settings.themeModeTitle')}</h3>
      <p className="mt-0.5 mb-3 text-xs text-slate-500 dark:text-slate-400">{t('settings.themeModeHint')}</p>
      <div className="grid max-w-md grid-cols-3 gap-3">
        {THEME_MODES.map((mode) => {
          const selected = mode === themeMode;
          const Icon = MODE_ICON[mode];
          return (
            <button
              key={mode}
              type="button"
              onClick={() => void chooseMode(mode)}
              disabled={savingMode}
              className={`relative flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition disabled:cursor-wait ${
                selected
                  ? 'border-[var(--accent-500)] bg-[var(--accent-50)] dark:bg-[var(--accent-500)]/10'
                  : 'border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600'
              }`}
            >
              {selected && (
                <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--accent-500)] text-white shadow">
                  <Check size={12} strokeWidth={3} />
                </span>
              )}
              <Icon size={22} className="text-slate-600 dark:text-slate-300" />
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{t(MODE_LABEL[mode])}</span>
            </button>
          );
        })}
      </div>

      <h3 className="mt-8 font-medium text-slate-800 dark:text-slate-100">{t('settings.skinTitle')}</h3>
      <p className="mt-0.5 mb-3 text-xs text-slate-500 dark:text-slate-400">{t('settings.skinHint')}</p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
        {SKINS.map((def) => {
          const selected = def.id === skin;
          return (
            <button
              key={def.id}
              type="button"
              onClick={() => void chooseSkin(def.id)}
              disabled={savingSkin !== null}
              className={`relative flex flex-col items-center gap-3 rounded-xl border-2 p-4 transition disabled:cursor-wait ${
                selected
                  ? 'bg-slate-50 dark:bg-slate-800'
                  : 'border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600'
              }`}
              style={selected ? { borderColor: def.dots[1], backgroundColor: `${def.dots[1]}1a` } : undefined}
            >
              {selected && (
                <span
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full text-white shadow"
                  style={{ backgroundColor: def.dots[1] }}
                >
                  <Check size={12} strokeWidth={3} />
                </span>
              )}
              <div className="flex gap-1.5">
                {def.dots.map((color) => (
                  <span key={color} className="h-4 w-4 rounded-full" style={{ backgroundColor: color }} />
                ))}
              </div>
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{t(def.labelKey)}</span>
            </button>
          );
        })}
      </div>

      {toast && <Toast message={toast} />}
    </section>
  );
};

/** "45m" under an hour, "2h" beyond it — an admin's 1440-minute cap reads as "24h". */
function formatMinutes(total: number): string {
  return total > 60 ? `${Math.round(total / 60)}h` : `${total}m`;
}

const PreferencesSection = () => {
  const { t } = useI18n();
  const { autoplay, setAutoplay } = useAutoplayVideos();
  const { thumbnails, setThumbnails } = useThumbnailsPreference();
  const { enabled, minutes, maxMinutes, setEnabled, setMinutes } = useAutoSignOut();

  const checkboxClass = 'mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-[var(--accent-600)] focus:ring-[var(--accent-500)]';

  // Past an hour, editing in raw minutes gets unwieldy (1440 for a 24h cap), so
  // the input itself switches to hours — same underlying `minutes` value, just
  // a different unit to type it in.
  const unit: 'm' | 'h' = minutes > 60 ? 'h' : 'm';
  const displayValue = unit === 'h' ? Math.round(minutes / 60) : minutes;
  const inputMax = unit === 'h' ? Math.max(1, Math.floor(maxMinutes / 60)) : Math.min(60, maxMinutes);

  const onMinutesInput = (raw: string) => {
    const value = Math.round(Number(raw));
    if (!Number.isFinite(value)) return;
    const asMinutes = unit === 'h' ? value * 60 : value;
    setMinutes(Math.min(Math.max(asMinutes, 1), maxMinutes));
  };

  return (
    <section className={`${card} p-6 space-y-5`}>
      <h2 className="font-semibold text-slate-900 dark:text-slate-100">{t('settings.preferencesTitle')}</h2>

      <label className="flex items-start gap-3 text-sm text-slate-700 dark:text-slate-200">
        <input
          type="checkbox"
          checked={autoplay}
          onChange={(e) => setAutoplay(e.target.checked)}
          className={checkboxClass}
        />
        <span className="max-w-xl">
          <span className="font-medium">{t('settings.autoplayVideos')}</span>
          <p className="mt-0.5 text-slate-500 dark:text-slate-400">{t('settings.autoplayVideosHint')}</p>
        </span>
      </label>

      <label className="flex items-start gap-3 text-sm text-slate-700 dark:text-slate-200">
        <input
          type="checkbox"
          checked={thumbnails}
          onChange={(e) => setThumbnails(e.target.checked)}
          className={checkboxClass}
        />
        <span className="max-w-xl">
          <span className="font-medium">{t('settings.alwaysShowThumbnails')}</span>
          <p className="mt-0.5 text-slate-500 dark:text-slate-400">{t('settings.alwaysShowThumbnailsHint')}</p>
        </span>
      </label>

      <div>
        <label className="flex items-start gap-3 text-sm text-slate-700 dark:text-slate-200">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            className={checkboxClass}
          />
          <span className="max-w-xl">
            <span className="font-medium">{t('settings.autoSignOut')}</span>
            <p className="mt-0.5 text-slate-500 dark:text-slate-400">{t('settings.autoSignOutHint')}</p>
          </span>
        </label>

        <div
          className={`mt-3 ml-7 max-w-sm rounded-lg bg-slate-50 px-4 py-3 transition-opacity dark:bg-slate-800/60 ${
            enabled ? '' : 'pointer-events-none opacity-50'
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <label className="text-sm font-medium text-slate-700 dark:text-slate-200">
              {t('settings.autoSignOutMinutesLabel')}
            </label>
            <div className="flex shrink-0 items-center gap-1.5">
              <input
                type="number"
                min={1}
                max={inputMax}
                value={displayValue}
                disabled={!enabled}
                onChange={(e) => onMinutesInput(e.target.value)}
                className="w-16 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-right text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[var(--accent-500)] dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
              />
              <span className="text-sm text-slate-500 dark:text-slate-400">{unit}</span>
            </div>
          </div>
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
            {t('settings.autoSignOutRangeHint', { min: formatMinutes(1), max: formatMinutes(maxMinutes) })}
          </p>
        </div>
      </div>
    </section>
  );
};

const SettingsPage = () => {
  const { t } = useI18n();
  const [active, setActive] = useState<Section>('appearance');

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{t('page.settings')}</h1>

      <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
        <nav className="flex shrink-0 gap-1 overflow-x-auto sm:w-52 sm:flex-col sm:overflow-visible">
          {SECTIONS.map(({ key, icon: Icon, labelKey }) => (
            <button key={key} type="button" onClick={() => setActive(key)} className={sectionLinkClass(active === key)}>
              <Icon size={18} />
              {t(labelKey)}
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1 space-y-6">
          {active === 'appearance' && <AppearanceSection />}
          {active === 'preferences' && <PreferencesSection />}
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
