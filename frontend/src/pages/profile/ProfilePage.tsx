import { useRef, useState, type FormEvent } from 'react';
import { Eye, EyeOff, Loader2, Trash2, Upload } from 'lucide-react';
import { avatarsApi } from '../../api/users';
import { api, ApiError } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useI18n } from '../../i18n/I18nContext';
import { btn, card, errorBox, input, label } from '../../components/ui/styles';
import Avatar from '../../components/ui/Avatar';

const ProfilePage = () => {
  const { t } = useI18n();
  const { user, logout, updateUser } = useAuth();

  const [avatarError, setAvatarError] = useState('');
  const [savingAvatar, setSavingAvatar] = useState(false);
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
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{t('page.profile')}</h1>

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
                  if (file) void changeAvatar(file);
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

export default ProfilePage;
