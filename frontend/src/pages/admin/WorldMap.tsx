import { useEffect, useMemo, useRef, useState } from 'react';
import { geoEquirectangular, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import type { Topology, GeometryCollection } from 'topojson-specification';
import countriesTopology from 'world-atlas/countries-110m.json';
import { all as allIsoCountries } from 'iso-3166-1';
import { select } from 'd3-selection';
import 'd3-transition'; // adds Selection.prototype.transition(), used by resetView
import { zoom, zoomIdentity, type ZoomBehavior } from 'd3-zoom';
import { Globe, Info, RotateCcw } from 'lucide-react';
import { flagEmoji } from './countries';
import { useI18n } from '../../i18n/I18nContext';

const WIDTH = 960;
const HEIGHT = 500;

const projection = geoEquirectangular().fitSize([WIDTH, HEIGHT], { type: 'Sphere' });
const pathGenerator = geoPath(projection);

const topology = countriesTopology as unknown as Topology;
// Real per-country shapes (not just a merged landmass outline), so each one
// gets its own border and can be filled on its own when it has a connection.
const countryFeatures = feature(topology, topology.objects.countries as GeometryCollection).features;

// world-atlas identifies each country by its ISO 3166-1 NUMERIC code; GeoIP
// gives us alpha-2. Built once at module load, not per render.
const NUMERIC_TO_ALPHA2: Record<string, string> = Object.fromEntries(
  allIsoCountries().map((c) => [c.numeric, c.alpha2]),
);

// Precomputed once: the SVG path and screen-space centroid (tooltip anchor)
// never change — only which ones are "connected" does, every tick.
const SHAPES = countryFeatures.map((f) => ({
  key: String(f.id),
  d: pathGenerator(f) ?? '',
  alpha2: NUMERIC_TO_ALPHA2[String(f.id)] ?? null,
  centroid: pathGenerator.centroid(f),
}));

interface CountryStat {
  code: string;
  name: string;
  count: number;
}

interface Props {
  countries: CountryStat[];
  /** null while the first snapshot is still loading, so the "not configured" notice doesn't flash. */
  geoReady: boolean | null;
}

const WorldMap = ({ countries, geoReady }: Props) => {
  const { t } = useI18n();
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomBehaviorRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const [transform, setTransform] = useState(zoomIdentity);
  const [hovered, setHovered] = useState<{ stat: CountryStat; x: number; y: number } | null>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const zoomBehavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 10])
      .translateExtent([
        [0, 0],
        [WIDTH, HEIGHT],
      ])
      .on('zoom', (event) => {
        // The gesture is measured in the SVG's rendered CSS pixels, but its
        // content lives in viewBox units — rescale so a drag tracks the
        // cursor 1:1 regardless of how much the container shrinks the map.
        const rect = svg.getBoundingClientRect();
        const pxToViewBox = rect.width > 0 ? WIDTH / rect.width : 1;
        const t = event.transform;
        setTransform(zoomIdentity.translate(t.x * pxToViewBox, t.y * pxToViewBox).scale(t.k));
      });

    zoomBehaviorRef.current = zoomBehavior;
    select(svg).call(zoomBehavior);

    return () => {
      select(svg).on('.zoom', null);
    };
  }, []);

  const resetView = () => {
    const svg = svgRef.current;
    const zoomBehavior = zoomBehaviorRef.current;
    if (!svg || !zoomBehavior) return;
    select(svg).transition().duration(300).call(zoomBehavior.transform, zoomIdentity);
  };

  const maxCount = Math.max(1, ...countries.map((c) => c.count));
  const statByAlpha2 = useMemo(() => new Map(countries.map((c) => [c.code, c])), [countries]);

  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-950">
      <div className="pointer-events-none absolute left-3 top-3 z-10 flex items-center gap-2">
        <Globe size={16} className="text-slate-400 dark:text-slate-500" />
        <span className="text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
          {t('adminDashboard.mapTitle')}
        </span>
      </div>

      <button
        type="button"
        onClick={resetView}
        className="absolute right-2 top-2 z-10 flex items-center gap-1.5 rounded-md border border-slate-200 bg-white/90 px-2 py-1 text-[11px] font-medium text-slate-600 shadow-sm hover:bg-white dark:border-slate-700 dark:bg-slate-900/90 dark:text-slate-300 dark:hover:bg-slate-800"
      >
        <RotateCcw size={12} />
        {t('adminDashboard.resetView')}
      </button>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="block w-full cursor-grab touch-none active:cursor-grabbing"
        role="img"
        aria-label="Connections by country"
      >
        <g transform={transform.toString()}>
          {SHAPES.map(({ key, d, alpha2, centroid }) => {
            const stat = alpha2 ? statByAlpha2.get(alpha2) : undefined;
            // One hue, light-to-dark by connection count — a country with a
            // single connection still reads clearly, a busier one stands out more.
            const intensity = stat ? 0.35 + 0.65 * Math.sqrt(stat.count / maxCount) : undefined;

            return (
              <path
                key={key}
                d={d}
                vectorEffect="non-scaling-stroke"
                className={
                  stat
                    ? 'cursor-pointer fill-[var(--accent-500)] stroke-[var(--accent-700)]'
                    : 'fill-slate-200 stroke-slate-300 dark:fill-slate-800 dark:stroke-slate-700'
                }
                fillOpacity={intensity}
                strokeWidth={0.5}
                onMouseEnter={stat ? () => setHovered({ stat, x: centroid[0], y: centroid[1] }) : undefined}
                onMouseLeave={
                  stat ? () => setHovered((current) => (current?.stat.code === stat.code ? null : current)) : undefined
                }
              />
            );
          })}
        </g>
      </svg>

      {hovered && (
        <div
          className="pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium whitespace-nowrap text-slate-700 shadow-lg dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          style={{
            left: `${(transform.applyX(hovered.x) / WIDTH) * 100}%`,
            top: `${(transform.applyY(hovered.y) / HEIGHT) * 100}%`,
            marginTop: -8,
          }}
        >
          {flagEmoji(hovered.stat.code)} {hovered.stat.name} · {hovered.stat.count}
        </div>
      )}

      {geoReady === false && (
        <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-md bg-white/90 px-2 py-1 text-[11px] text-slate-500 shadow-sm dark:bg-slate-900/90 dark:text-slate-400">
          <Info size={12} className="shrink-0" />
          {t('adminDashboard.geoNotConfigured')}
        </div>
      )}

      {/* Required by the GeoLite2 license: "This product includes GeoLite2 data created by MaxMind". */}
      {geoReady && (
        <a
          href="https://www.maxmind.com"
          target="_blank"
          rel="noopener noreferrer"
          className="absolute bottom-1.5 right-2 z-10 text-[10px] text-slate-400 hover:text-slate-500 hover:underline dark:text-slate-500 dark:hover:text-slate-400"
        >
          {t('adminDashboard.geoAttribution')}
        </a>
      )}
    </div>
  );
};

export default WorldMap;
