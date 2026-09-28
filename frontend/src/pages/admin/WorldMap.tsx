import { useMemo, useState } from 'react';
import { geoEquirectangular, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import landTopology from 'world-atlas/land-110m.json';
import { Info } from 'lucide-react';
import { COUNTRY_CENTROIDS, flagEmoji } from './countries';
import { useI18n } from '../../i18n/I18nContext';

const WIDTH = 960;
const HEIGHT = 500;

const projection = geoEquirectangular().fitSize([WIDTH, HEIGHT], { type: 'Sphere' });
const pathGenerator = geoPath(projection);

const topology = landTopology as unknown as Topology;
const land = feature(topology, topology.objects.land as GeometryCollection);
const LAND_PATH = pathGenerator(land) ?? '';

interface Props {
  countries: { code: string; name: string; count: number }[];
  geoReady: boolean;
}

const WorldMap = ({ countries, geoReady }: Props) => {
  const { t } = useI18n();
  const [hovered, setHovered] = useState<{ code: string; name: string; count: number; x: number; y: number } | null>(
    null,
  );

  const maxCount = Math.max(1, ...countries.map((c) => c.count));

  const dots = useMemo(
    () =>
      countries.flatMap((c) => {
        const centroid = COUNTRY_CENTROIDS[c.code];
        if (!centroid) return [];
        const projected = projection([centroid[1], centroid[0]]);
        if (!projected) return [];
        const radius = 5 + 11 * Math.sqrt(c.count / maxCount);
        return [{ ...c, x: projected[0], y: projected[1], radius }];
      }),
    [countries, maxCount],
  );

  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-950">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} className="block w-full" role="img" aria-label="Connections by country">
        <path
          d={LAND_PATH}
          className="fill-slate-200 stroke-slate-300 dark:fill-slate-800 dark:stroke-slate-700"
          strokeWidth={0.5}
        />

        {dots.map((c) => (
          <circle
            key={c.code}
            cx={c.x}
            cy={c.y}
            r={c.radius}
            className="cursor-pointer fill-[var(--accent-500)] stroke-[var(--accent-700)]"
            fillOpacity={0.8}
            strokeWidth={1.5}
            onMouseEnter={() => setHovered(c)}
            onMouseLeave={() => setHovered((current) => (current?.code === c.code ? null : current))}
          />
        ))}
      </svg>

      {hovered && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium whitespace-nowrap text-slate-700 shadow-lg dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          style={{ left: `${(hovered.x / WIDTH) * 100}%`, top: `${(hovered.y / HEIGHT) * 100}%`, marginTop: -8 }}
        >
          {flagEmoji(hovered.code)} {hovered.name} · {hovered.count}
        </div>
      )}

      {!geoReady && (
        <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-md bg-white/90 px-2 py-1 text-[11px] text-slate-500 shadow-sm dark:bg-slate-900/90 dark:text-slate-400">
          <Info size={12} className="shrink-0" />
          {t('adminDashboard.geoNotConfigured')}
        </div>
      )}
    </div>
  );
};

export default WorldMap;
