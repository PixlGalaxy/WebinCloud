import { Link } from 'react-router-dom';
import { ChevronRight, HardDrive } from 'lucide-react';
import { toFilesUrl } from './paths';

interface Props {
  path: string;
  rootLabel: string;
}

const Breadcrumbs = ({ path, rootLabel }: Props) => {
  const segments = path ? path.split('/') : [];

  return (
    <nav className="flex items-center gap-1 text-sm flex-wrap">
      <Link
        to={toFilesUrl('')}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
      >
        <HardDrive size={16} />
        {rootLabel}
      </Link>

      {segments.map((segment, index) => {
        const target = segments.slice(0, index + 1).join('/');
        const isLast = index === segments.length - 1;

        return (
          <span key={target} className="flex items-center gap-1">
            <ChevronRight size={14} className="text-slate-400 dark:text-slate-600" />
            {isLast ? (
              <span className="px-2 py-1 font-semibold text-slate-900 dark:text-slate-100">{segment}</span>
            ) : (
              <Link
                to={toFilesUrl(target)}
                className="rounded-md px-2 py-1 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
              >
                {segment}
              </Link>
            )}
          </span>
        );
      })}
    </nav>
  );
};

export default Breadcrumbs;
