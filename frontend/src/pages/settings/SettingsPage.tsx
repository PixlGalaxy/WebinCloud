import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  Info,
  Link2,
  Loader2,
  Palette,
  Pencil,
  Plus,
  SlidersHorizontal,
  Trash2,
  Upload,
  UserRound,
  X,
  type LucideIcon,
} from 'lucide-react';
import { avatarsApi } from '../../api/users';
import { api, ApiError } from '../../api/client';
import { sharesApi, type PathName } from '../../api/shares';
import { useAuth } from '../../context/AuthContext';
import { useI18n } from '../../i18n/I18nContext';
import { useTheme, type ThemeMode } from '../../context/ThemeContext';
import { useAutoplayVideos } from '../../hooks/useAutoplayVideos';
import { useThumbnailsPreference } from '../../hooks/useThumbnailsPreference';
import { useHiddenFilesPreference } from '../../hooks/useHiddenFilesPreference';
import { useAutoSignOut } from '../../context/AutoSignOutContext';
import type { SkinId } from '../../theme/themes';
import { SUPPORTED_LANGUAGES, LANGUAGE_NAMES, type Language, type TranslationKey } from '../../i18n/translations';
import { btn, card, errorBox, input, label } from '../../components/ui/styles';
import Avatar from '../../components/ui/Avatar';
import Toast from '../../components/ui/Toast';
import ThemePicker from '../../components/ThemePicker';
import AvatarCropModal from '../../components/AvatarCropModal';

type Section = 'account' | 'sharing' | 'appearance' | 'preferences';

function isSection(value: string | null): value is Section {
  return value === 'account' || value === 'sharing' || value === 'appearance' || value === 'preferences';
}

const SECTIONS: { key: Section; icon: LucideIcon; labelKey: TranslationKey }[] = [
  { key: 'account', icon: UserRound, labelKey: 'nav.account' },
  { key: 'sharing', icon: Link2, labelKey: 'nav.shareSettings' },
  { key: 'appearance', icon: Palette, labelKey: 'settings.appearanceTitle' },
  { key: 'preferences', icon: SlidersHorizontal, labelKey: 'settings.preferencesTitle' },
];

const sectionLinkClass = (active: boolean) =>
  `flex min-w-0 shrink-0 items-center gap-2.5 rounded-lg px-3.5 py-2.5 text-left text-sm font-medium transition sm:w-full ${
    active
      ? 'bg-[var(--accent-50)] text-[var(--accent-700)] dark:bg-[var(--accent-500)]/15 dark:text-[var(--accent-300)]'
      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
  }`;

const AccountSection = () => {
  const { t } = useI18n();
  const { user, logout, updateUser } = useAuth();

  const [avatarError, setAvatarError] = useState('');
  const [savingAvatar, setSavingAvatar] = useState(false);
  const [cropping, setCropping] = useState<File | null>(null);
  const avatarInput = useRef<HTMLInputElement>(null);

  const changeAvatar = async (file: File) => {
    setAvatarError('');
    setSavingAvatar(true);
    try {
      updateUser(await avatarsApi.upload(file));
    } catch (err) {
      setAvatarError(err instanceof ApiError ? err.message : t('files.actionFailed'));
    } finally {
      setSavingAvatar(false);
    }
  };

  const removeAvatar = async () => {
    setAvatarError('');
    setSavingAvatar(true);
    try {
      updateUser(await avatarsApi.remove());
    } catch (err) {
      setAvatarError(err instanceof ApiError ? err.message : t('files.actionFailed'));
    } finally {
      setSavingAvatar(false);
    }
  };

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmNext, setConfirmNext] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPasswordError('');

    if (next !== confirmNext) {
      setPasswordError(t('account.passwordsMismatch'));
      return;
    }

    setSavingPassword(true);
    try {
      await api.post('/auth/change-password', { currentPassword: current, newPassword: next });
      // The server drops every session after a password change.
      await logout();
    } catch (err) {
      setPasswordError(err instanceof ApiError ? err.message : t('files.actionFailed'));
    } finally {
      setSavingPassword(false);
    }
  };

  return (
    <div className="space-y-6">
      {cropping && (
        <AvatarCropModal
          file={cropping}
          onCancel={() => setCropping(null)}
          onConfirm={async (cropped) => {
            setCropping(null);
            await changeAvatar(cropped);
          }}
        />
      )}

      <section className={`${card} p-6`}>
        <h2 className="mb-1 font-semibold text-slate-900 dark:text-slate-100">{t('account.details')}</h2>

        {avatarError && <div className={`${errorBox} mt-4`}>{avatarError}</div>}

        <div className="mt-4 flex items-center gap-4">
          <Avatar user={user} size={64} />
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">{t('account.avatarHint')}</p>
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={() => avatarInput.current?.click()}
                disabled={savingAvatar}
                className={btn.secondary}
              >
                {savingAvatar ? <Loader2 className="animate-spin" size={16} /> : <Upload size={16} />}
                {t('account.changeAvatar')}
              </button>
              {user?.avatar_path && (
                <button
                  type="button"
                  onClick={() => void removeAvatar()}
                  disabled={savingAvatar}
                  className={btn.iconDanger}
                  title={t('account.removeAvatar')}
                >
                  <Trash2 size={16} />
                </button>
              )}
              <input
                ref={avatarInput}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  // GIFs skip the cropper: drawing them to a canvas would drop the animation.
                  if (file) {
                    if (file.type === 'image/gif') void changeAvatar(file);
                    else setCropping(file);
                  }
                  e.target.value = '';
                }}
              />
            </div>
          </div>
        </div>

        <dl className="mt-6 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-slate-500 dark:text-slate-400">{t('users.username')}</dt>
            <dd className="font-medium text-slate-900 dark:text-slate-100">{user?.username}</dd>
          </div>
          <div>
            <dt className="text-slate-500 dark:text-slate-400">{t('users.email')}</dt>
            <dd className="font-medium text-slate-900 dark:text-slate-100">{user?.email}</dd>
          </div>
        </dl>
      </section>

      <section className={`${card} p-6`}>
        <h2 className="mb-4 font-semibold text-slate-900 dark:text-slate-100">{t('account.changePassword')}</h2>

        {passwordError && <div className={`${errorBox} mb-4`}>{passwordError}</div>}

        <form onSubmit={changePassword} className="space-y-4">
          <div>
            <label className={label} htmlFor="current-password">
              {t('account.currentPassword')}
            </label>
            <div className="relative">
              <input
                id="current-password"
                type={showPasswords ? 'text' : 'password'}
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                className={`${input} pr-10`}
                required
              />
              <button
                type="button"
                onClick={() => setShowPasswords((show) => !show)}
                title={t(showPasswords ? 'account.hidePasswords' : 'account.showPasswords')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                {showPasswords ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <div>
            <label className={label} htmlFor="next-password">
              {t('users.newPassword')}
            </label>
            <div className="relative">
              <input
                id="next-password"
                type={showPasswords ? 'text' : 'password'}
                autoComplete="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                className={`${input} pr-10`}
                required
              />
              <button
                type="button"
                onClick={() => setShowPasswords((show) => !show)}
                title={t(showPasswords ? 'account.hidePasswords' : 'account.showPasswords')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                {showPasswords ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <div>
            <label className={label} htmlFor="confirm-next-password">
              {t('account.confirmNewPassword')}
            </label>
            <div className="relative">
              <input
                id="confirm-next-password"
                type={showPasswords ? 'text' : 'password'}
                autoComplete="new-password"
                value={confirmNext}
                onChange={(e) => setConfirmNext(e.target.value)}
                className={`${input} pr-10`}
                required
              />
              <button
                type="button"
                onClick={() => setShowPasswords((show) => !show)}
                title={t(showPasswords ? 'account.hidePasswords' : 'account.showPasswords')}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              >
                {showPasswords ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('account.passwordLogoutNote')}</p>
          <button
            type="submit"
            disabled={savingPassword || !current || !next || !confirmNext}
            className={btn.primary}
          >
            {savingPassword && <Loader2 className="animate-spin" size={16} />}
            {t('common.save')}
          </button>
        </form>
      </section>
    </div>
  );
};

const SharingSection = () => {
  const { t } = useI18n();

  const [pathNames, setPathNames] = useState<PathName[] | null>(null);
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const [pathError, setPathError] = useState('');

  const reload = () => sharesApi.listPathNames().then(setPathNames);

  useEffect(() => {
    reload().catch((err) => setPathError(err instanceof ApiError ? err.message : String(err)));
  }, []);

  const runPath = async (action: () => Promise<unknown>) => {
    setPathError('');
    try {
      await action();
      await reload();
      return true;
    } catch (err) {
      setPathError(err instanceof ApiError ? err.message : t('files.actionFailed'));
      return false;
    }
  };

  return (
    <div className="space-y-6">
      <section className={`${card} p-6`}>
        <div className="flex items-start gap-3">
          <Info size={20} className="mt-0.5 shrink-0 text-[var(--accent-500)]" />
          <div>
            <p className="text-sm text-slate-600 dark:text-slate-300">{t('shareSettings.intro')}</p>

            <h2 className="mt-5 font-semibold text-slate-900 dark:text-slate-100">
              {t('shareSettings.howItWorksTitle')}
            </h2>
            <ol className="mt-3 space-y-2.5 text-sm text-slate-600 dark:text-slate-300">
              {[
                'shareSettings.howItWorks1',
                'shareSettings.howItWorks2',
                'shareSettings.howItWorks3',
                'shareSettings.howItWorks4',
                'shareSettings.howItWorks5',
              ].map((key, i) => (
                <li key={key} className="flex gap-2.5">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--accent-50)] text-xs font-semibold text-[var(--accent-700)] dark:bg-[var(--accent-500)]/15 dark:text-[var(--accent-300)]">
                    {i + 1}
                  </span>
                  {t(key as 'shareSettings.howItWorks1')}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <section className={`${card} p-6`}>
        <h2 className="font-semibold text-slate-900 dark:text-slate-100">{t('shareSettings.yourPathNames')}</h2>

        {pathError && <div className={`${errorBox} mt-4`}>{pathError}</div>}

        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (await runPath(() => sharesApi.createPathName(newName))) setNewName('');
          }}
          className="mt-4 mb-4 flex gap-2"
        >
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t('shareSettings.pathNamePlaceholder')}
            className={input}
          />
          <button type="submit" disabled={!newName.trim()} className={btn.primary}>
            <Plus size={16} /> {t('shareSettings.addNew')}
          </button>
        </form>

        {pathNames === null ? (
          <div className="flex justify-center py-6">
            <Loader2 className="animate-spin text-[var(--accent-500)]" size={24} />
          </div>
        ) : pathNames.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500 dark:text-slate-400">
            {t('shareSettings.noPathNames')}
          </p>
        ) : (
          <ul className="divide-y divide-slate-200 dark:divide-slate-700">
            {pathNames.map((pathName) => (
              <li key={pathName.id} className="flex items-center gap-3 py-3">
                <Link2 size={16} className="shrink-0 text-[var(--accent-500)]" />

                {editing?.id === pathName.id ? (
                  <>
                    <input
                      autoFocus
                      value={editing.value}
                      onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                      className={`${input} flex-1`}
                    />
                    <button
                      onClick={async () => {
                        if (await runPath(() => sharesApi.renamePathName(pathName.id, editing.value))) {
                          setEditing(null);
                        }
                      }}
                      className={btn.iconGhost}
                    >
                      <Check size={16} className="text-emerald-600" />
                    </button>
                    <button onClick={() => setEditing(null)} className={btn.iconGhost}>
                      <X size={16} />
                    </button>
                  </>
                ) : (
                  <>
                    <div className="flex min-w-0 flex-1 items-baseline gap-2">
                      <span className="shrink-0 font-medium text-slate-900 dark:text-slate-100">
                        {pathName.name}
                      </span>
                      <code className="truncate text-xs text-slate-500 dark:text-slate-400">
                        /public/{pathName.name}/…
                      </code>
                    </div>
                    <button
                      onClick={() => setEditing({ id: pathName.id, value: pathName.name })}
                      className={btn.iconGhost}
                      title={t('files.rename')}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      onClick={() => void runPath(() => sharesApi.removePathName(pathName.id))}
                      className={btn.iconDanger}
                      title={t('common.delete')}
                    >
                      <Trash2 size={16} />
                    </button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};

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

      <ThemePicker
        mode={themeMode}
        skin={skin}
        onModeChange={(mode) => void chooseMode(mode)}
        onSkinChange={(id) => void chooseSkin(id)}
        savingMode={savingMode}
        savingSkin={savingSkin}
      />

      {toast && <Toast message={toast} />}
    </section>
  );
};

/** "45m" under an hour, "2h" beyond it — an admin's 1440-minute cap reads as "24h". */
function formatMinutes(total: number): string {
  return total > 60 ? `${Math.round(total / 60)}h` : `${total}m`;
}

const PreferencesSection = () => {
  const { t, language, setLanguage } = useI18n();
  const { autoplay, setAutoplay } = useAutoplayVideos();
  const { thumbnails, setThumbnails } = useThumbnailsPreference();
  const { showHidden, setShowHidden } = useHiddenFilesPreference();
  const { enabled, minutes, maxMinutes, setEnabled, setMinutes } = useAutoSignOut();
  const [savingLanguage, setSavingLanguage] = useState<Language | null>(null);
  const [languageError, setLanguageError] = useState('');

  const checkboxClass = 'mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-[var(--accent-600)] focus:ring-[var(--accent-500)]';

  const chooseLanguage = async (id: Language) => {
    if (id === language || savingLanguage) return;
    setSavingLanguage(id);
    setLanguageError('');
    try {
      await setLanguage(id);
    } catch (err) {
      setLanguageError(err instanceof ApiError ? err.message : t('settings.appearanceSaveFailed'));
    } finally {
      setSavingLanguage(null);
    }
  };

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

      <div>
        <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{t('settings.language')}</span>
        <p className="mt-0.5 mb-2 max-w-xl text-sm text-slate-500 dark:text-slate-400">{t('settings.languageHint')}</p>
        {languageError && <div className={`${errorBox} mb-2`}>{languageError}</div>}
        <div className="relative inline-block w-56">
          <select
            value={language}
            disabled={savingLanguage !== null}
            onChange={(e) => void chooseLanguage(e.target.value as Language)}
            className="w-full appearance-none rounded-lg border border-slate-300 bg-white px-3 py-1.5 pr-9 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[var(--accent-500)] disabled:cursor-wait dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
          >
            {SUPPORTED_LANGUAGES.map((id) => (
              <option key={id} value={id}>
                {LANGUAGE_NAMES[id]}
              </option>
            ))}
          </select>
          <ChevronDown
            size={16}
            className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
        </div>
      </div>

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

      <label className="flex items-start gap-3 text-sm text-slate-700 dark:text-slate-200">
        <input
          type="checkbox"
          checked={showHidden}
          onChange={(e) => setShowHidden(e.target.checked)}
          className={checkboxClass}
        />
        <span className="max-w-xl">
          <span className="font-medium">{t('settings.showHiddenFiles')}</span>
          <p className="mt-0.5 text-slate-500 dark:text-slate-400">{t('settings.showHiddenFilesHint')}</p>
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
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('section');
  const active: Section = isSection(requested) ? requested : 'appearance';

  const selectSection = (key: Section) => {
    setSearchParams(key === 'appearance' ? {} : { section: key }, { replace: true });
  };

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{t('page.settings')}</h1>

      <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
        <nav className="grid shrink-0 grid-cols-2 gap-1 sm:flex sm:w-64 sm:flex-col">
          {SECTIONS.map(({ key, icon: Icon, labelKey }) => (
            <button key={key} type="button" onClick={() => selectSection(key)} className={sectionLinkClass(active === key)}>
              <Icon size={18} />
              {t(labelKey)}
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1 space-y-6">
          {active === 'account' && <AccountSection />}
          {active === 'sharing' && <SharingSection />}
          {active === 'appearance' && <AppearanceSection />}
          {active === 'preferences' && <PreferencesSection />}
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
