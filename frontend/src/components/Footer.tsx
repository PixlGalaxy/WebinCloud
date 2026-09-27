import { FaGithub } from 'react-icons/fa';
import { useI18n } from '../i18n/I18nContext';

const linkClass =
  'inline-flex items-center gap-1.5 text-indigo-600 hover:text-indigo-700 hover:underline dark:text-indigo-400 dark:hover:text-indigo-300 transition-colors';

const Footer = () => {
  const { t } = useI18n();
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-slate-200 bg-slate-100/60 backdrop-blur-sm dark:border-slate-800 dark:bg-slate-800/40">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-center gap-x-3 gap-y-1 px-6 py-3 text-center text-xs text-slate-500 dark:text-slate-400">
        <span>{t('footer.copyright', { year })}</span>

        <span aria-hidden="true">&middot;</span>
        <a
          href="https://github.com/PixlGalaxy"
          target="_blank"
          rel="noreferrer noopener"
          className={linkClass}
        >
          <FaGithub size={13} /> PixlGalaxy
        </a>

        <span aria-hidden="true">&middot;</span>
        <a
          href="https://github.com/PixlGalaxy/WebinCloud"
          target="_blank"
          rel="noreferrer noopener"
          className={linkClass}
        >
          {t('footer.viewSource')}
        </a>

        <span aria-hidden="true">&middot;</span>
        <span>{t('footer.rights')}</span>
      </div>
    </footer>
  );
};

export default Footer;
