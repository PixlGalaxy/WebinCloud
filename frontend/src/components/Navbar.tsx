import { NavLink, Link } from 'react-router-dom';
import { Home, CircleUser, Share2, Users, LogOut, Sun, Moon, type LucideIcon } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useI18n } from '../i18n/I18nContext';
import type { TranslationKey } from '../i18n/translations';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2.5 px-4 py-2.5 rounded-lg text-base font-medium transition ${
    isActive
      ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300'
      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
  }`;

interface NavItem {
  to: string;
  labelKey: TranslationKey;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/files', labelKey: 'nav.home', icon: Home },
  { to: '/profile', labelKey: 'nav.account', icon: CircleUser },
  { to: '/share', labelKey: 'nav.share', icon: Share2 },
];

const Navbar = () => {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const { t } = useI18n();

  const logo = <img src="/logo.png" alt={t('nav.logoAlt')} className="h-16 w-auto" />;
  const themeLabel = t(theme === 'dark' ? 'nav.themeLight' : 'nav.themeDark');

  return (
    <nav className="bg-white border-b border-slate-200 dark:bg-slate-900 dark:border-slate-800">
      <div className="max-w-7xl mx-auto px-6 h-24 flex items-center justify-between gap-4">
        {user ? (
          <Link
            to="/files"
            className="shrink-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900"
          >
            {logo}
          </Link>
        ) : (
          <div className="shrink-0">{logo}</div>
        )}

        <div className="flex items-center gap-1">
          {user && (
            <>
              {NAV_ITEMS.map(({ to, labelKey, icon: Icon }) => (
                <NavLink key={to} to={to} className={navLinkClass}>
                  <Icon size={21} />
                  <span className="hidden sm:inline">{t(labelKey)}</span>
                </NavLink>
              ))}

              {user.role === 'admin' && (
                <NavLink to="/admin/users" className={navLinkClass}>
                  <Users size={21} />
                  <span className="hidden sm:inline">{t('nav.users')}</span>
                </NavLink>
              )}

              <button
                onClick={logout}
                className="flex items-center gap-2.5 px-4 py-2.5 rounded-lg text-base font-medium text-slate-600 hover:bg-rose-50 hover:text-rose-700 dark:text-slate-300 dark:hover:bg-rose-500/15 dark:hover:text-rose-300 transition"
              >
                <LogOut size={21} />
                <span className="hidden sm:inline">{t('nav.logout')}</span>
              </button>

              <span className="w-px h-7 bg-slate-200 dark:bg-slate-700 mx-2" />
            </>
          )}

          <button
            onClick={toggleTheme}
            title={themeLabel}
            aria-label={themeLabel}
            className="p-3 rounded-lg text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800 transition"
          >
            {theme === 'dark' ? (
              <Sun size={21} className="text-amber-400" />
            ) : (
              <Moon size={21} className="text-indigo-500" />
            )}
          </button>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
