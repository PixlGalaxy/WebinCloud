import { useState, type FormEvent } from 'react';
import { Eye, EyeOff, Loader2, ShieldAlert } from 'lucide-react';
import { api, ApiError } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n/I18nContext';
import { btn, errorBox, input, label } from './ui/styles';
import Modal from './ui/Modal';

/** The seeded first-run account — see backend/src/modules/auth/bootstrap.ts. */
const DEFAULT_PASSWORD = 'changeme';

/**
 * Blocks the whole app until the seeded "admin"/"changeme" account is
 * replaced with a real username, email and password. Shown instead of
 * ForceChangePasswordModal (mutually exclusive — see AuthContext).
 */
const CompleteAdminSetupModal = () => {
  const { t } = useI18n();
  const { logout, clearMustCompleteSetup } = useAuth();

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
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
      await api.post('/auth/complete-setup', {
        currentPassword: DEFAULT_PASSWORD,
        newUsername: username.trim(),
        newEmail: email.trim(),
        newPassword: next,
      });
      clearMustCompleteSetup();
      // The server drops every session once setup completes, so sign back in with the new credentials.
      await logout();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('files.actionFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={t('account.completeSetupTitle')} onClose={() => undefined} dismissible={false}>
      <div className="mb-4 flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
        <ShieldAlert size={18} className="mt-0.5 shrink-0" />
        <p>{t('account.completeSetupHint')}</p>
      </div>

      {error && <div className={`${errorBox} mb-4`}>{error}</div>}

      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className={label} htmlFor="setup-username">
            {t('users.username')}
          </label>
          <input
            id="setup-username"
            type="text"
            autoComplete="username"
            autoFocus
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className={input}
            required
          />
        </div>

        <div>
          <label className={label} htmlFor="setup-email">
            {t('users.email')}
          </label>
          <input
            id="setup-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={input}
            required
          />
        </div>

        <div>
          <label className={label} htmlFor="setup-next-password">
            {t('users.newPassword')}
          </label>
          <div className="relative">
            <input
              id="setup-next-password"
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
          <label className={label} htmlFor="setup-confirm-password">
            {t('account.confirmNewPassword')}
          </label>
          <div className="relative">
            <input
              id="setup-confirm-password"
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
          <button
            type="submit"
            disabled={saving || !username.trim() || !email.trim() || !next || !confirmNext}
            className={btn.primary}
          >
            {saving && <Loader2 className="animate-spin" size={16} />}
            {t('common.save')}
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default CompleteAdminSetupModal;
