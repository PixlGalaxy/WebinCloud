import { useEffect, useRef, useState } from 'react';
import { NavLink, Link } from 'react-router-dom';
import {
  AlertTriangle,
  Home,
  Share2,
  Users,
  ScrollText,
  LogOut,
  UserRound,
  Link2,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useArchives } from '../context/ArchiveContext';
import { useAppConfig } from '../context/AppConfigContext';
import { useI18n } from '../i18n/I18nContext';
import type { TranslationKey } from '../i18n/translations';
import Modal from './ui/Modal';
import Avatar from './ui/Avatar';
import { btn } from './ui/styles';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `flex items-center gap-2.5 px-4 py-2.5 rounded-lg text-base font-medium transition ${
    isActive
      ? 'bg-[var(--accent-50)] text-[var(--accent-700)] dark:bg-[var(--accent-500)]/15 dark:text-[var(--accent-300)]'
      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white'
  }`;

interface NavItem {
  to: string;
  labelKey: TranslationKey;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItem[] = [
  { to: '/files', labelKey: 'nav.home', icon: Home },
  { to: '/share', labelKey: 'nav.share', icon: Share2 },
];

interface AccountMenuItem extends NavItem {
  /** Each entry gets its own accent so the dropdown reads at a glance. */
  color: string;
}

const ACCOUNT_MENU: AccountMenuItem[] = [
  { to: '/profile', labelKey: 'nav.account', icon: UserRound, color: 'text-sky-500' },
  { to: '/share-settings', labelKey: 'nav.shareSettings', icon: Link2, color: 'text-violet-500' },
  { to: '/settings', labelKey: 'nav.settings', icon: SlidersHorizontal, color: 'text-amber-500' },
];

const Navbar = () => {
  const { user, logout } = useAuth();
  const { jobs, dismiss } = useArchives();
  const { t } = useI18n();
  const { appName } = useAppConfig();
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  const running = jobs.filter((job) => job.status === 'preparing' || job.status === 'running');

  // Signing out makes the archive unreachable, so cancel it instead of leaving
  // it to burn CPU and disk for nobody.
  const signOut = async () => {
    for (const job of running) dismiss(job.id);
    setConfirmingLogout(false);
    await logout();
  };

  const logo = <img src="/backend/api/branding/logo.png" alt={appName} className="h-16 w-auto" />;

  return (
    <nav className="bg-white border-b border-slate-200 dark:bg-slate-900 dark:border-slate-800">
      <div className="w-full px-6 h-24 flex items-center justify-between gap-4">
        {user ? (
          <Link
            to="/files"
            className="shrink-0 rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--accent-500)] focus:ring-offset-2 dark:focus:ring-offset-slate-900"
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

              {user.role === 'admin' && (
                <NavLink to="/admin/logs" className={navLinkClass}>
                  <ScrollText size={21} />
                  <span className="hidden sm:inline">{t('nav.logs')}</span>
                </NavLink>
              )}

              <div className="relative ml-1" ref={menuRef}>
                <button
                  onClick={() => setMenuOpen((open) => !open)}
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  className="shrink-0 rounded-full focus:outline-none focus:ring-2 focus:ring-[var(--accent-500)] focus:ring-offset-2 dark:focus:ring-offset-slate-900"
                >
                  <Avatar user={user} size={36} />
                </button>

                {menuOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 z-30 mt-2 w-60 overflow-hidden rounded-xl border border-slate-200 bg-white py-1.5 shadow-lg dark:border-slate-700 dark:bg-slate-900"
                  >
                    {ACCOUNT_MENU.map(({ to, labelKey, icon: Icon, color }) => (
                      <Link
                        key={to}
                        to={to}
                        role="menuitem"
                        onClick={() => setMenuOpen(false)}
                        className="flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                      >
                        <Icon size={18} className={color} />
                        {t(labelKey)}
                      </Link>
                    ))}

                    <span className="my-1.5 block h-px bg-slate-200 dark:bg-slate-700" />

                    <button
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(false);
                        if (running.length > 0) setConfirmingLogout(true);
                        else void logout();
                      }}
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-rose-50 hover:text-rose-700 dark:text-slate-200 dark:hover:bg-rose-500/15 dark:hover:text-rose-300"
                    >
                      <LogOut size={18} className="text-rose-500" />
                      {t('nav.logout')}
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {confirmingLogout && (
        <Modal title={t('logout.title')} onClose={() => setConfirmingLogout(false)}>
          <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            <p>{t('logout.archivesRunning', { count: running.length })}</p>
          </div>

          <ul className="mt-4 space-y-1">
            {running.map((job) => (
              <li key={job.id} className="truncate font-mono text-xs text-slate-500 dark:text-slate-400">
                {job.fileName}
              </li>
            ))}
          </ul>

          <div className="mt-6 flex justify-end gap-2">
            <button onClick={() => setConfirmingLogout(false)} className={btn.secondary}>
              {t('logout.stay')}
            </button>
            <button onClick={() => void signOut()} className={btn.danger}>
              <LogOut size={16} /> {t('logout.confirm')}
            </button>
          </div>
        </Modal>
      )}
    </nav>
  );
};

export default Navbar;
