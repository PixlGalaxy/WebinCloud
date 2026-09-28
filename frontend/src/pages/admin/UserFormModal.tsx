import { useEffect, useState, type FormEvent } from 'react';
import { FolderPlus, Loader2, Mail, Shield, Trash2, User as UserIcon } from 'lucide-react';
import { permissionsApi, usersApi, type FolderGrant } from '../../api/users';
import type { User } from '../../api/types';
import { ApiError } from '../../api/client';
import { useI18n } from '../../i18n/I18nContext';
import Modal from '../../components/ui/Modal';
import FolderTree from '../../components/FolderTree';
import { btn, errorBox, input, label } from '../../components/ui/styles';

interface Props {
  user: User | null;
  onClose: () => void;
  onSaved: () => void;
}

const checkbox = 'h-4 w-4 rounded border-slate-300 text-[var(--accent-600)] focus:ring-[var(--accent-500)]';
const sectionTitle = 'flex items-center gap-2 text-sm font-semibold text-slate-900 dark:text-slate-100';

const UserFormModal = ({ user, onClose, onSaved }: Props) => {
  const { t } = useI18n();
  const isNew = user === null;

  const [email, setEmail] = useState(user?.email ?? '');
  const [username, setUsername] = useState(user?.username ?? '');
  const [displayName, setDisplayName] = useState(user?.display_name ?? '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'admin' | 'user'>(user?.role ?? 'user');
  const [isActive, setIsActive] = useState(user ? user.is_active === 1 : true);

  // Folder access
  const [grants, setGrants] = useState<FolderGrant[]>([]);
  const [folderPath, setFolderPath] = useState('');
  const [canRead, setCanRead] = useState(true);
  const [canWrite, setCanWrite] = useState(true);

  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (user) permissionsApi.listByUser(user.id).then(setGrants).catch(() => undefined);
  }, [user]);

  const refreshGrants = async () => {
    if (user) setGrants(await permissionsApi.listByUser(user.id));
  };

  const runGrant = async (action: () => Promise<unknown>) => {
    setError('');
    try {
      await action();
      await refreshGrants();
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('files.actionFailed'));
      return false;
    }
  };

  const addGrantToExisting = async () => {
    if (!user || !folderPath) return;
    if (
      await runGrant(() =>
        permissionsApi.create({ userId: user.id, folderPath, canRead, canWrite }),
      )
    ) {
      setFolderPath('');
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      if (user) {
        await usersApi.update(user.id, {
          email,
          displayName: displayName || null,
          role,
          isActive,
          ...(password ? { password } : {}),
        });
      } else {
        const created = await usersApi.create({
          email,
          username,
          password,
          displayName: displayName || null,
          role,
        });

        if (folderPath) {
          await permissionsApi.create({ userId: created.id, folderPath, canRead, canWrite });
        }
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('files.actionFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={isNew ? t('users.new') : t('users.edit')} onClose={onClose} size="lg">
      <form onSubmit={submit} className="space-y-6">
        {error && <div className={errorBox}>{error}</div>}

        <section className="space-y-4">
          <h3 className={sectionTitle}>
            <UserIcon size={16} className="text-[var(--accent-500)]" />
            {t('users.accountSection')}
          </h3>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="u-username">
                {t('users.username')}
              </label>
              <input
                id="u-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className={input}
                disabled={!isNew}
                required
                autoFocus={isNew}
              />
            </div>

            <div>
              <label className={label} htmlFor="u-email">
                {t('users.email')}
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-2.5 text-slate-400" size={16} />
                <input
                  id="u-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={`${input} pl-9`}
                  required
                />
              </div>
            </div>

            <div>
              <label className={label} htmlFor="u-display">
                {t('users.displayName')}
              </label>
              <input
                id="u-display"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className={input}
                placeholder={username || undefined}
              />
            </div>

            <div>
              <label className={label} htmlFor="u-password">
                {isNew ? t('users.password') : t('users.newPassword')}
              </label>
              <input
                id="u-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={input}
                placeholder={isNew ? undefined : t('users.passwordUnchanged')}
                required={isNew}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-6">
            <div className="flex items-center gap-3">
              <span className="text-sm text-slate-600 dark:text-slate-300">{t('users.role')}</span>
              <div className="flex rounded-lg border border-slate-300 p-0.5 dark:border-slate-600">
                {(['user', 'admin'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setRole(value)}
                    className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${
                      role === value
                        ? 'bg-[var(--accent-600)] text-white'
                        : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
                    }`}
                  >
                    {value === 'admin' && <Shield size={14} />}
                    {t(value === 'admin' ? 'users.roleAdmin' : 'users.roleUser')}
                  </button>
                ))}
              </div>
            </div>

            {!isNew && (
              <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  className={checkbox}
                />
                {t('users.active')}
              </label>
            )}
          </div>
        </section>

        <section className="space-y-4 border-t border-slate-200 pt-5 dark:border-slate-700">
          <h3 className={sectionTitle}>
            <FolderPlus size={16} className="text-[var(--accent-500)]" />
            {t('users.foldersSection')}
          </h3>

          {role === 'admin' ? (
            <p className="rounded-lg bg-violet-50 px-4 py-3 text-sm text-violet-800 dark:bg-violet-500/10 dark:text-violet-200">
              {t('users.adminSeesEverything')}
            </p>
          ) : (
            <>
              {!isNew && grants.length > 0 && (
                <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 dark:divide-slate-700 dark:border-slate-700">
                  {grants.map((grant) => (
                    <li key={grant.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                      <code className="flex-1 truncate text-sm text-slate-800 dark:text-slate-200">
                        {grant.folder_path}
                      </code>
                      <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                        <input
                          type="checkbox"
                          checked={grant.can_read === 1}
                          onChange={(e) =>
                            void runGrant(() => permissionsApi.update(grant.id, { canRead: e.target.checked }))
                          }
                          className={checkbox}
                        />
                        {t('permissions.read')}
                      </label>
                      <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                        <input
                          type="checkbox"
                          checked={grant.can_write === 1}
                          onChange={(e) =>
                            void runGrant(() =>
                              permissionsApi.update(grant.id, { canWrite: e.target.checked }),
                            )
                          }
                          className={checkbox}
                        />
                        {t('permissions.write')}
                      </label>
                      <button
                        type="button"
                        onClick={() => void runGrant(() => permissionsApi.remove(grant.id))}
                        className={btn.iconDanger}
                        title={t('common.delete')}
                      >
                        <Trash2 size={15} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                <span className={label}>{isNew ? t('users.pickFolder') : t('permissions.addFolder')}</span>

                <FolderTree value={folderPath} onChange={setFolderPath} />

                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-5">
                    <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                      <input
                        type="checkbox"
                        checked={canRead}
                        onChange={(e) => setCanRead(e.target.checked)}
                        className={checkbox}
                      />
                      {t('permissions.read')}
                    </label>
                    <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300">
                      <input
                        type="checkbox"
                        checked={canWrite}
                        onChange={(e) => setCanWrite(e.target.checked)}
                        className={checkbox}
                      />
                      {t('permissions.write')}
                    </label>
                  </div>

                  {!isNew && (
                    <button
                      type="button"
                      onClick={() => void addGrantToExisting()}
                      disabled={!folderPath}
                      className={btn.primary}
                    >
                      {t('common.add')}
                    </button>
                  )}
                </div>

                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  {folderPath ? t('users.folderSelected', { path: folderPath }) : t('users.noFolderSelected')}
                </p>
              </div>
            </>
          )}
        </section>

        <div className="flex justify-end gap-2 border-t border-slate-200 pt-5 dark:border-slate-700">
          <button type="button" onClick={onClose} className={btn.secondary}>
            {t('common.cancel')}
          </button>
          <button type="submit" disabled={saving} className={btn.primary}>
            {saving && <Loader2 className="animate-spin" size={16} />}
            {isNew ? t('common.create') : t('common.save')}
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default UserFormModal;
