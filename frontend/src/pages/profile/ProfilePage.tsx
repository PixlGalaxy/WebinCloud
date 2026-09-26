import { useEffect, useState, type FormEvent } from 'react';
import { Check, Link2, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { sharesApi, type PathName } from '../../api/shares';
import { api, ApiError } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useI18n } from '../../i18n/I18nContext';
import { btn, card, errorBox, input, label } from '../../components/ui/styles';

const ProfilePage = () => {
  const { t } = useI18n();
  const { user, logout } = useAuth();

  const [pathNames, setPathNames] = useState<PathName[] | null>(null);
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<{ id: string; value: string } | null>(null);
  const [pathError, setPathError] = useState('');

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

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

  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPasswordError('');
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
        <dl className="mt-4 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
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
        <h2 className="font-semibold text-slate-900 dark:text-slate-100">{t('account.pathNames')}</h2>
        <p className="mt-1 mb-4 text-sm text-slate-500 dark:text-slate-400">{t('account.pathNamesHint')}</p>

        {pathError && <div className={`${errorBox} mb-4`}>{pathError}</div>}

        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (await runPath(() => sharesApi.createPathName(newName))) setNewName('');
          }}
          className="mb-4 flex gap-2"
        >
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t('account.pathNamePlaceholder')}
            className={input}
          />
          <button type="submit" disabled={!newName.trim()} className={btn.primary}>
            <Plus size={16} /> {t('common.add')}
          </button>
        </form>

        {pathNames === null ? (
          <div className="flex justify-center py-6">
            <Loader2 className="animate-spin text-indigo-500" size={24} />
          </div>
        ) : pathNames.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500 dark:text-slate-400">{t('account.noPathNames')}</p>
        ) : (
          <ul className="divide-y divide-slate-200 dark:divide-slate-700">
            {pathNames.map((pathName) => (
              <li key={pathName.id} className="flex items-center gap-3 py-3">
                <Link2 size={16} className="shrink-0 text-indigo-500" />

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
                    <code className="flex-1 truncate text-sm text-slate-700 dark:text-slate-200">
                      /public/{pathName.name}/…
                    </code>
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

      <section className={`${card} p-6`}>
        <h2 className="mb-4 font-semibold text-slate-900 dark:text-slate-100">{t('account.changePassword')}</h2>

        {passwordError && <div className={`${errorBox} mb-4`}>{passwordError}</div>}

        <form onSubmit={changePassword} className="space-y-4">
          <div>
            <label className={label} htmlFor="current-password">
              {t('account.currentPassword')}
            </label>
            <input
              id="current-password"
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              className={input}
              required
            />
          </div>
          <div>
            <label className={label} htmlFor="next-password">
              {t('users.newPassword')}
            </label>
            <input
              id="next-password"
              type="password"
              autoComplete="new-password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              className={input}
              required
            />
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('account.passwordLogoutNote')}</p>
          <button type="submit" disabled={savingPassword || !current || !next} className={btn.primary}>
            {savingPassword && <Loader2 className="animate-spin" size={16} />}
            {t('common.save')}
          </button>
        </form>
      </section>
    </div>
  );
};

export default ProfilePage;
