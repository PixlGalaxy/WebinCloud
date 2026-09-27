import { useCallback, useEffect, useState } from 'react';
import { Loader2, Pencil, Trash2, UserPlus } from 'lucide-react';
import { usersApi } from '../../api/users';
import type { User } from '../../api/types';
import { ApiError } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useI18n } from '../../i18n/I18nContext';
import Modal from '../../components/ui/Modal';
import Avatar from '../../components/ui/Avatar';
import { btn, card, errorBox } from '../../components/ui/styles';
import UserFormModal from './UserFormModal';

const UsersAdminPage = () => {
  const { t } = useI18n();
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<User | null | undefined>(undefined);
  const [deleting, setDeleting] = useState<User | null>(null);

  const reload = useCallback(async () => {
    setError('');
    try {
      setUsers(await usersApi.list());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('files.loadFailed'));
    }
  }, [t]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const remove = async (user: User) => {
    setError('');
    try {
      await usersApi.remove(user.id);
      setDeleting(null);
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('files.actionFailed'));
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{t('page.users')}</h1>
        <button onClick={() => setEditing(null)} className={btn.primary}>
          <UserPlus size={16} /> {t('users.new')}
        </button>
      </div>

      {error && <div className={errorBox}>{error}</div>}

      <div className={`${card} overflow-hidden`}>
        {users === null ? (
          <div className="flex justify-center p-12">
            <Loader2 className="animate-spin text-indigo-500" size={28} />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 dark:text-slate-400">
              <tr>
                <th className="px-5 py-3 font-medium">{t('users.username')}</th>
                <th className="hidden px-5 py-3 font-medium sm:table-cell">{t('users.email')}</th>
                <th className="w-28 px-5 py-3 font-medium">{t('users.role')}</th>
                <th className="w-40 px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr
                  key={user.id}
                  className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/50"
                >
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <Avatar user={user} size={36} />
                      <div>
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {user.display_name ?? user.username}
                        </div>
                        {user.display_name && (
                          <div className="text-xs text-slate-500 dark:text-slate-400">{user.username}</div>
                        )}
                        {user.is_active === 0 && (
                          <span className="mt-1 inline-block rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                            {t('users.inactive')}
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="hidden px-5 py-3 text-slate-600 dark:text-slate-300 sm:table-cell">{user.email}</td>
                  <td className="px-5 py-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                        user.role === 'admin'
                          ? 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300'
                          : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'
                      }`}
                    >
                      {t(user.role === 'admin' ? 'users.roleAdmin' : 'users.roleUser')}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => setEditing(user)} className={btn.iconGhost} title={t('users.edit')}>
                        <Pencil size={16} />
                      </button>
                      <button
                        onClick={() => setDeleting(user)}
                        disabled={user.id === currentUser?.id}
                        className={`${btn.iconDanger} disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-500`}
                        title={t('common.delete')}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing !== undefined && (
        <UserFormModal
          user={editing}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            void reload();
          }}
        />
      )}

      {deleting && (
        <Modal title={t('users.delete')} onClose={() => setDeleting(null)}>
          <p className="text-slate-600 dark:text-slate-300">
            {t('users.confirmDelete', { name: deleting.username })}
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <button onClick={() => setDeleting(null)} className={btn.secondary}>
              {t('common.cancel')}
            </button>
            <button onClick={() => void remove(deleting)} className={btn.danger}>
              <Trash2 size={16} /> {t('common.delete')}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default UsersAdminPage;
