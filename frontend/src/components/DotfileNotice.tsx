import { AlertTriangle, Download, FileArchive } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import Modal from './ui/Modal';
import { btn } from './ui/styles';

interface Props {
  name: string;
  onDownloadAnyway: () => void;
  onDownloadZip: () => void;
  onClose: () => void;
}

/**
 * Browsers strip the leading dot when saving a download, and no header can stop
 * them, so the choice is offered explicitly instead of silently renaming.
 */
const DotfileNotice = ({ name, onDownloadAnyway, onDownloadZip, onClose }: Props) => {
  const { t } = useI18n();

  return (
    <Modal title={t('dotfile.title')} onClose={onClose}>
      <div className="space-y-5">
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertTriangle size={18} className="mt-0.5 shrink-0" />
          <p>{t('dotfile.explanation', { name, stripped: name.replace(/^\.+/, '') })}</p>
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <button onClick={onDownloadAnyway} className={btn.secondary}>
            <Download size={16} /> {t('dotfile.downloadAnyway')}
          </button>
          <button
            onClick={onDownloadZip}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white transition hover:bg-amber-600"
          >
            <FileArchive size={16} /> {t('dotfile.downloadZip')}
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default DotfileNotice;
