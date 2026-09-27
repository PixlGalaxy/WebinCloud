import { useState, type FormEvent } from 'react';
import { Eye, EyeOff, Loader2, ShieldAlert } from 'lucide-react';
import { api, ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n/I18nContext';
import { btn, errorBox, input, label } from './ui/styles';
import Modal from './ui/Modal';

/** Matches the ADMIN_PASSWORD default in .env.example: nag anyone still using it. */
const DEFAULT_PASSWORD = 'changeme';

const ForceChangePasswordModal = () => {
  const { t } = useI18n();
  const { logout, clearMustChangePassword } = useAuth();

  const [next, setNext] = useState('');
  const [confirmNext, setConfirmNext] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (next !== confirmNext) {
      setError(t('account.passwordsMismatch'));
      return;
    }

    setSaving(true);
    try {
      await api.post('/auth/change-password', { currentPassword: DEFAULT_PASSWORD, newPassword: next });
      clearMustChangePassword();
      // The server drops every session after a password change, so sign back in with it.
      await logout();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('files.actionFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={t('account.mustChangePasswordTitle')} onClose={() => undefined} dismissible={false}>
      <div className="mb-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
        <ShieldAlert size={18} className="mt-0.5 shrink-0" />
        <p>{t('account.mustChangePasswordHint')}</p>
      </div>

      {error && <div className={`${errorBox} mb-4`}>{error}</div>}

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className={label} htmlFor="force-next-password">
            {t('users.newPassword')}
          </label>
          <div className="relative">
            <input
              id="force-next-password"
              type={showPasswords ? 'text' : 'password'}
              autoComplete="new-password"
              autoFocus
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
          <label className={label} htmlFor="force-confirm-password">
            {t('account.confirmNewPassword')}
          </label>
          <div className="relative">
            <input
              id="force-confirm-password"
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

        <div className="flex items-center justify-between gap-2 pt-2">
          <button type="button" onClick={() => void logout()} className={btn.secondary}>
            {t('nav.logout')}
          </button>
          <button type="submit" disabled={saving || !next || !confirmNext} className={btn.primary}>
            {saving && <Loader2 className="animate-spin" size={16} />}
            {t('common.save')}
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default ForceChangePasswordModal;
