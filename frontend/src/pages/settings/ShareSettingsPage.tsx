import { useEffect, useState } from 'react';
import { Check, Info, Link2, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { sharesApi, type PathName } from '../../api/shares';
import { ApiError } from '../../api/client';
import { useI18n } from '../../i18n/I18nContext';
import { btn, card, errorBox, input } from '../../components/ui/styles';

const ShareSettingsPage = () => {
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
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{t('page.shareSettings')}</h1>

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
    </div>
  );
};

export default ShareSettingsPage;
