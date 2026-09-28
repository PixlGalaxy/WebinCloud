import { useSearchParams } from 'react-router-dom';
import { LayoutDashboard, ScrollText, Settings, Users, Wrench, type LucideIcon } from 'lucide-react';
import { useI18n } from '../../i18n/I18nContext';
import type { TranslationKey } from '../../i18n/translations';
import DashboardSection from './DashboardSection';
import UsersAdminPage from './UsersAdminPage';
import LogsPage from './LogsPage';
import SettingsAdminSection from './settings/SettingsAdminSection';
import SystemSection from './system/SystemSection';

type Section = 'dashboard' | 'users' | 'logs' | 'settings' | 'system';

function isSection(value: string | null): value is Section {
  return value === 'dashboard' || value === 'users' || value === 'logs' || value === 'settings' || value === 'system';
}

const SECTIONS: { key: Section; icon: LucideIcon; labelKey: TranslationKey }[] = [
  { key: 'dashboard', icon: LayoutDashboard, labelKey: 'adminDashboard.title' },
  { key: 'users', icon: Users, labelKey: 'page.users' },
  { key: 'logs', icon: ScrollText, labelKey: 'page.logs' },
  { key: 'settings', icon: Settings, labelKey: 'adminSettings.navLabel' },
  { key: 'system', icon: Wrench, labelKey: 'adminSystem.navLabel' },
];

const sectionLinkClass = (active: boolean) =>
  `flex shrink-0 items-center gap-2.5 rounded-lg px-3.5 py-2.5 text-sm font-medium transition sm:w-full ${
    active
      ? 'bg-[var(--accent-50)] text-[var(--accent-700)] dark:bg-[var(--accent-500)]/15 dark:text-[var(--accent-300)]'
      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
  }`;

const AdminPage = () => {
  const { t } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = searchParams.get('section');
  const active: Section = isSection(requested) ? requested : 'dashboard';

  const selectSection = (key: Section) => {
    setSearchParams(key === 'dashboard' ? {} : { section: key }, { replace: true });
  };

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold text-slate-900 dark:text-slate-100">{t('nav.adminPanel')}</h1>

      <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
        <nav className="flex shrink-0 gap-1 overflow-x-auto sm:w-64 sm:flex-col sm:overflow-visible">
          {SECTIONS.map(({ key, icon: Icon, labelKey }) => (
            <button key={key} type="button" onClick={() => selectSection(key)} className={sectionLinkClass(active === key)}>
              <Icon size={18} />
              {t(labelKey)}
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1">
          {active === 'dashboard' && <DashboardSection />}
          {active === 'users' && <UsersAdminPage />}
          {active === 'logs' && <LogsPage />}
          {active === 'settings' && <SettingsAdminSection />}
          {active === 'system' && <SystemSection />}
        </div>
      </div>
    </div>
  );
};

export default AdminPage;
