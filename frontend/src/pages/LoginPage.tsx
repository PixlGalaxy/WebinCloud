import { useState, type FormEvent } from 'react';
import { Navigate } from 'react-router-dom';
import { Lock, User as UserIcon, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useI18n } from '../i18n/I18nContext';
import { ApiError } from '../api/client';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

const inputClass =
  'w-full pl-12 pr-4 py-3.5 rounded-xl border border-slate-300 bg-white text-base text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100';

const iconClass = 'absolute left-4 top-4 text-slate-400 dark:text-slate-500';

const LoginPage = () => {
  const { user, isLoading, login } = useAuth();
  const { t } = useI18n();
  const [usernameOrEmail, setUsernameOrEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!isLoading && user) return <Navigate to="/files" replace />;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(usernameOrEmail, password);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('login.networkError'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950">
      <Navbar />

      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-10 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-12">
          <div className="flex items-center gap-4 mb-9">
            <div className="bg-indigo-600 text-white rounded-xl p-3.5">
              <Lock size={28} />
            </div>
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{t('login.title')}</h1>
          </div>

          {error && (
            <div className="mb-6 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-300">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label
                htmlFor="username"
                className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2"
              >
                {t('login.usernameOrEmail')}
              </label>
              <div className="relative">
                <UserIcon className={iconClass} size={20} />
                <input
                  id="username"
                  type="text"
                  autoComplete="username"
                  value={usernameOrEmail}
                  onChange={(e) => setUsernameOrEmail(e.target.value)}
                  className={inputClass}
                  disabled={submitting}
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2"
              >
                {t('login.password')}
              </label>
              <div className="relative">
                <Lock className={iconClass} size={20} />
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={inputClass}
                  disabled={submitting}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting || !usernameOrEmail || !password}
              className="mt-8 flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 py-3.5 text-base font-medium text-white transition hover:bg-indigo-700 disabled:bg-slate-300 dark:disabled:bg-slate-700 dark:disabled:text-slate-500"
            >
              {submitting && <Loader2 className="animate-spin" size={20} />}
              {submitting ? t('login.submitting') : t('login.submit')}
            </button>
          </form>
        </div>
      </div>

      <Footer />
    </div>
  );
};

export default LoginPage;
