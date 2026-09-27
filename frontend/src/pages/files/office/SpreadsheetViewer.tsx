import { useEffect, useState } from 'react';
import { read, utils, type WorkBook } from 'xlsx';
import { FileQuestion, Loader2 } from 'lucide-react';
import { useI18n } from '../../../i18n/I18nContext';
import { errorBox } from '../../../components/ui/styles';

/** Past this many rows or columns, the sheet is cut off: a preview, not a spreadsheet app. */
const MAX_ROWS = 500;
const MAX_COLS = 60;

interface Props {
  url: string;
}

/** Renders a workbook fetched from `url` as plain tables, with a tab per sheet. */
const SpreadsheetViewer = ({ url }: Props) => {
  const { t } = useI18n();
  const [workbook, setWorkbook] = useState<WorkBook | null>(null);
  const [error, setError] = useState('');
  const [sheetIndex, setSheetIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(url, { credentials: 'include' })
      .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(String(res.status)))))
      .then((buffer) => {
        if (cancelled) return;
        setWorkbook(read(buffer, { type: 'array' }));
      })
      .catch((err) => {
        console.error('SpreadsheetViewer failed to parse', url, err);
        if (!cancelled) setError(t('files.previewFailed'));
      });
    return () => {
      cancelled = true;
    };
  }, [url, t]);

  if (error) return <div className={`${errorBox} m-5`}>{error}</div>;

  if (!workbook) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="animate-spin text-indigo-500" size={32} />
      </div>
    );
  }

  const names = workbook.SheetNames;
  const sheet = workbook.Sheets[names[sheetIndex]];
  const rows = utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '', blankrows: false });
  const rowsTruncated = rows.length > MAX_ROWS;
  const shownRows = rows.slice(0, MAX_ROWS);
  const colCount = Math.min(shownRows.reduce((max, row) => Math.max(max, row.length), 0), MAX_COLS);
  const colsTruncated = shownRows.some((row) => row.length > MAX_COLS);

  return (
    <div className="flex h-full flex-col">
      {(rowsTruncated || colsTruncated) && (
        <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          {t('files.previewTruncated')}
        </p>
      )}

      {shownRows.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 text-slate-500 dark:text-slate-400">
          <FileQuestion size={40} className="text-slate-300 dark:text-slate-600" />
          <p>{t('files.previewSheetEmpty')}</p>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="border-collapse text-sm">
            <tbody>
              {shownRows.map((row, r) => (
                <tr key={r} className="even:bg-slate-50 dark:even:bg-slate-800/40">
                  {Array.from({ length: colCount }, (_, c) => (
                    <td
                      key={c}
                      className="whitespace-nowrap border border-slate-200 px-3 py-1.5 text-slate-700 dark:border-slate-700 dark:text-slate-200"
                    >
                      {String(row[c] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {names.length > 1 && (
        <div className="flex gap-1 overflow-x-auto border-t border-slate-200 bg-white px-2 py-1.5 dark:border-slate-700 dark:bg-slate-900">
          {names.map((sheetName, index) => (
            <button
              key={sheetName}
              onClick={() => setSheetIndex(index)}
              className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition ${
                index === sheetIndex
                  ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300'
                  : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              {sheetName}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default SpreadsheetViewer;
