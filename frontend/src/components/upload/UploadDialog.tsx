import { memo } from 'react';
import { Ban, CheckCircle2, Clock, FilePlus2, FolderPlus, Loader2, Play, Trash2, X, XCircle } from 'lucide-react';
import { useUploads } from '../../context/UploadContext';
import { useI18n } from '../../i18n/I18nContext';
import { formatSize } from '../../pages/files/paths';
import Modal from '../ui/Modal';
import { btn } from '../ui/styles';
import type { UploadItem } from './useUploadQueue';

const STATUS_ICON = {
  queued: <Clock size={16} className="text-amber-500" />,
  uploading: <Loader2 size={16} className="animate-spin text-[var(--accent-500)]" />,
  done: <CheckCircle2 size={16} className="text-emerald-500" />,
  error: <XCircle size={16} className="text-rose-500" />,
  cancelled: <Ban size={16} className="text-amber-500" />,
};

const Row = memo(function Row({ item, onRemove }: { item: UploadItem; onRemove: (id: number) => void }) {
  const { t } = useI18n();

  return (
    <li className="flex items-center gap-3 px-4 py-2">
      <span className="shrink-0" title={t(`upload.${item.status}`)}>
        {STATUS_ICON[item.status]}
      </span>

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-slate-800 dark:text-slate-200">
          {item.dir && <span className="text-slate-400 dark:text-slate-500">{item.dir}/</span>}
          {item.name}
        </p>

        {item.status === 'uploading' && (
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
            <div className="h-full bg-emerald-500 transition-all" style={{ width: `${item.progress * 100}%` }} />
          </div>
        )}
        {item.status === 'error' && <p className="mt-0.5 text-xs text-rose-600 dark:text-rose-400">{item.error}</p>}
      </div>

      <span className="hidden w-20 shrink-0 text-right text-xs text-slate-500 dark:text-slate-400 sm:block">
        {item.status === 'uploading' ? `${Math.round(item.progress * 100)}%` : formatSize(item.file.size)}
      </span>

      <button
        onClick={() => onRemove(item.id)}
        disabled={item.status === 'uploading'}
        className={`${btn.iconGhost} shrink-0 disabled:invisible`}
        title={t('upload.remove')}
      >
        <X size={14} />
      </button>
    </li>
  );
});

/** The whole queue, with what each file is doing. Uploading continues when it is closed. */
const UploadDialog = () => {
  const { t } = useI18n();
  const uploads = useUploads();
  const { items, running } = uploads;

  const done = items.filter((item) => item.status === 'done').length;
  const failed = items.filter((item) => item.status === 'error').length;
  const pending = items.length - done;

  return (
    <Modal title={t('upload.dialogTitle')} onClose={uploads.closeDialog} size="lg">
      <div className="-m-6">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 px-4 py-3 dark:border-slate-800">
          <button onClick={uploads.pickMoreFiles} className={btn.primary}>
            <FilePlus2 size={16} /> {t('upload.addFiles')}
          </button>
          <button onClick={uploads.pickMoreFolder} className={btn.success}>
            <FolderPlus size={16} /> {t('upload.addFolder')}
          </button>

          <button onClick={uploads.start} disabled={running || pending === 0} className={btn.accent}>
            <Play size={16} /> {t('upload.start')}
          </button>
          <button onClick={uploads.cancel} disabled={!running} className={btn.warning}>
            <Ban size={16} /> {t('upload.cancel')}
          </button>
          <button onClick={uploads.clear} disabled={running || items.length === 0} className={`${btn.danger} disabled:opacity-40`}>
            <Trash2 size={16} /> {t('upload.clear')}
          </button>

          <span className="ml-auto text-sm text-slate-600 dark:text-slate-300">
            {t('upload.summary', { done, total: items.length })}
            {failed > 0 && (
              <span className="ml-2 font-medium text-rose-600 dark:text-rose-400">
                {t('upload.failed', { count: failed })}
              </span>
            )}
          </span>
        </div>

        {items.length === 0 ? (
          <p className="p-12 text-center text-slate-500 dark:text-slate-400">{t('upload.empty')}</p>
        ) : (
          <ul className="max-h-[60vh] divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
            {items.map((item) => (
              <Row key={item.id} item={item} onRemove={uploads.remove} />
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
};

export default UploadDialog;
