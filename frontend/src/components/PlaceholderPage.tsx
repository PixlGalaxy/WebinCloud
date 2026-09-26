import type { LucideIcon } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import type { TranslationKey } from '../i18n/translations';

interface Props {
  icon: LucideIcon;
  titleKey: TranslationKey;
  phase: number;
}

const PlaceholderPage = ({ icon: Icon, titleKey, phase }: Props) => {
  const { t } = useI18n();

  return (
    <div className="bg-white border border-dashed border-slate-300 rounded-xl p-12 text-center dark:bg-slate-900 dark:border-slate-700">
      <Icon className="mx-auto text-slate-300 dark:text-slate-600 mb-4" size={48} />
      <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{t(titleKey)}</h1>
      <p className="text-slate-500 dark:text-slate-400 text-sm mt-2">{t('page.placeholder', { phase })}</p>
    </div>
  );
};

export default PlaceholderPage;
