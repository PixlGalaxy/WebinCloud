import { ArrowRight, Copy, FileWarning, Replace } from 'lucide-react';
import type { ConflictMode, ExistingFile } from '../../api/files';
import { useI18n } from '../../i18n/I18nContext';
import Modal from '../../components/ui/Modal';
import { btn } from '../../components/ui/styles';
import { formatSize } from './paths';

interface Props {
  conflicts: ExistingFile[];
  incoming: File[];
  onCancel: () => void;
  onResolve: (mode: ConflictMode) => void;
}

const ConflictModal = ({ conflicts, incoming, onCancel, onResolve }: Props) => {
  const { t, language } = useI18n();

  const formatDate = (iso: string) =>
    new Intl.DateTimeFormat(language, { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));

  return (
    <Modal title={t('conflict.title')} onClose={onCancel}>
      <div className="space-y-5">
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <FileWarning size={18} className="mt-0.5 shrink-0" />
          <p>{t('conflict.description', { count: conflicts.length })}</p>
        </div>

        <ul className="space-y-3">
          {conflicts.map((existing) => {
            const replacement = incoming.find((file) => file.name === existing.name);

            return (
              <li
                key={existing.name}
                className="rounded-lg border border-slate-200 p-3 dark:border-slate-700"
              >
                <p className="mb-2 truncate font-medium text-slate-900 dark:text-slate-100">{existing.name}</p>

                <div className="flex items-center gap-3 text-sm">
                  <div className="flex-1">
                    <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">
                      {t('conflict.existing')}
                    </p>
                    <p className="font-medium text-slate-700 dark:text-slate-200">{formatSize(existing.size)}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{formatDate(existing.modifiedAt)}</p>
                  </div>

                  <ArrowRight size={18} className="shrink-0 text-slate-300 dark:text-slate-600" />

                  <div className="flex-1">
                    <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">
                      {t('conflict.incoming')}
                    </p>
                    <p className="font-medium text-indigo-600 dark:text-indigo-400">
                      {replacement ? formatSize(replacement.size) : '—'}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {replacement ? formatDate(new Date(replacement.lastModified).toISOString()) : ''}
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="flex flex-wrap justify-end gap-2">
          <button onClick={onCancel} className={btn.secondary}>
            {t('common.cancel')}
          </button>
          <button onClick={() => onResolve('keepBoth')} className={btn.secondary}>
            <Copy size={16} /> {t('conflict.keepBoth')}
          </button>
          <button onClick={() => onResolve('overwrite')} className={btn.primary}>
            <Replace size={16} /> {t('conflict.overwrite')}
          </button>
        </div>

        <p className="text-xs text-slate-500 dark:text-slate-400">{t('conflict.safetyNote')}</p>
      </div>
    </Modal>
  );
};

export default ConflictModal;
