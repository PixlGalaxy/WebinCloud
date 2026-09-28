import { Activity, ArrowDown, ArrowUp, Info } from 'lucide-react';
import { line, curveMonotoneX, area } from 'd3-shape';
import { useI18n } from '../../i18n/I18nContext';
import { card } from '../../components/ui/styles';

function formatBytesPerSec(bytesPerSec: number): string {
  if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B`;
  if (bytesPerSec < 1024 ** 2) return `${(bytesPerSec / 1024).toFixed(2)} KB`;
  if (bytesPerSec < 1024 ** 3) return `${(bytesPerSec / 1024 ** 2).toFixed(2)} MB`;
  return `${(bytesPerSec / 1024 ** 3).toFixed(2)} GB`;
}

interface Props {
  upload: number[];
  download: number[];
  intervalSeconds: number;
  networkStatsReady: boolean;
}

const WIDTH = 600;
const HEIGHT = 220;
const PADDING = { left: 8, right: 58, top: 12, bottom: 10 };
const PLOT_W = WIDTH - PADDING.left - PADDING.right;
const PLOT_H = HEIGHT - PADDING.top - PADDING.bottom;
/** A full "last minute" window like Unraid's 1m graph — older points just aren't there yet right after boot. */
const WINDOW = 60;

const xAt = (i: number) => PADDING.left + (i / (WINDOW - 1)) * PLOT_W;

/** One combined, smoothed line chart for both directions — a single shared scale, no dual axes. */
const NetworkTrafficCard = ({ upload, download, intervalSeconds, networkStatsReady }: Props) => {
  const { t } = useI18n();

  // Left-pad with zeros so there are always WINDOW points: new samples land on
  // the right and the whole thing reads as scrolling left as time passes.
  const pad = (series: number[]) => Array(Math.max(0, WINDOW - series.length)).fill(0).concat(series).slice(-WINDOW);
  const uploadRates = pad(upload).map((v) => v / intervalSeconds);
  const downloadRates = pad(download).map((v) => v / intervalSeconds);
  const currentUpload = uploadRates[uploadRates.length - 1] ?? 0;
  const currentDownload = downloadRates[downloadRates.length - 1] ?? 0;
  const max = Math.max(1, ...uploadRates, ...downloadRates);

  const y = (v: number) => PADDING.top + PLOT_H - (v / max) * PLOT_H;
  const lineGen = line<number>()
    .x((_, i) => xAt(i))
    .y((v) => y(v))
    .curve(curveMonotoneX);
  const areaGen = area<number>()
    .x((_, i) => xAt(i))
    .y0(PADDING.top + PLOT_H)
    .y1((v) => y(v))
    .curve(curveMonotoneX);

  return (
    <div className={`${card} flex h-full flex-col p-4`}>
      <div className="flex items-center gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
        <Activity size={16} className="text-slate-400 dark:text-slate-500" />
        <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
          {t('adminDashboard.bandwidthTitle')}
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1 py-3 text-sm">
        <span className="flex items-center gap-1.5 font-medium text-rose-600 dark:text-rose-400">
          <ArrowDown size={14} /> {t('adminDashboard.downloadSpeed')}: {formatBytesPerSec(currentDownload)}/s
        </span>
        <span className="flex items-center gap-1.5 font-medium text-amber-600 dark:text-amber-400">
          <ArrowUp size={14} /> {t('adminDashboard.uploadSpeed')}: {formatBytesPerSec(currentUpload)}/s
        </span>
      </div>

      <div className="relative flex-1">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="w-full">
          <defs>
            <linearGradient id="traffic-download-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-rose-500, #f43f5e)" stopOpacity={0.22} />
              <stop offset="100%" stopColor="var(--color-rose-500, #f43f5e)" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="traffic-upload-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-amber-500, #f59e0b)" stopOpacity={0.22} />
              <stop offset="100%" stopColor="var(--color-amber-500, #f59e0b)" stopOpacity={0} />
            </linearGradient>
          </defs>

          {[0, 0.5, 1].map((f) => {
            const gy = PADDING.top + PLOT_H * (1 - f);
            return (
              <g key={f}>
                <line
                  x1={PADDING.left}
                  y1={gy}
                  x2={WIDTH - PADDING.right}
                  y2={gy}
                  className="stroke-slate-200 dark:stroke-slate-700"
                  strokeWidth={1}
                  strokeDasharray={f === 0 ? undefined : '3 3'}
                />
                <text x={WIDTH - PADDING.right + 8} y={gy + 3} className="fill-slate-400 text-[9px] dark:fill-slate-500">
                  {formatBytesPerSec(max * f)}
                </text>
              </g>
            );
          })}

          <path d={areaGen(downloadRates) ?? undefined} fill="url(#traffic-download-fill)" />
          <path d={areaGen(uploadRates) ?? undefined} fill="url(#traffic-upload-fill)" />
          <path
            d={lineGen(downloadRates) ?? undefined}
            fill="none"
            className="stroke-rose-500"
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <path
            d={lineGen(uploadRates) ?? undefined}
            fill="none"
            className="stroke-amber-500"
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        </svg>

        {!networkStatsReady && (
          <div className="pointer-events-none absolute bottom-1 left-1 flex items-center gap-1.5 rounded-md bg-white/90 px-2 py-1 text-[11px] text-slate-500 shadow-sm dark:bg-slate-900/90 dark:text-slate-400">
            <Info size={12} className="shrink-0" />
            {t('adminDashboard.networkStatsUnavailable')}
          </div>
        )}
      </div>
    </div>
  );
};

export default NetworkTrafficCard;
