import { Construction } from 'lucide-react';
import { useI18n } from '../../../i18n/I18nContext';
import { card } from '../../../components/ui/styles';

/** Placeholder — more goes here in a future update. */
const SystemSection = () => {
  const { t } = useI18n();

  return (
    <section className={`${card} flex flex-col items-center gap-3 p-10 text-center`}>
      <Construction size={28} className="text-slate-400 dark:text-slate-500" />
      <p className="text-sm text-slate-500 dark:text-slate-400">{t('adminSystem.comingSoon')}</p>
    </section>
  );
};

export default SystemSection;
