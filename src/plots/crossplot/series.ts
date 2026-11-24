/**
 * Proveedor de series `crossplot` para tendencias (docs/decisiones/0008 D3 y 0014 D6): la nube del crossplot libre
 * como serie x–y (`xIsDepth: false`), para ajustar una tendencia lineal, log, exponencial o potencial sobre los puntos
 * visibles, con su ecuación y R² (la misma infraestructura que el modelo k–φ de la corona).
 *
 * Clave: `<curva x>|<curva y>|<zonas>` (curvas `m:<id>` o `r:<ROL>`; zonas = ids separados por coma, vacío = todas).
 * La tendencia queda atada a las zonas que estaban filtradas al crearla. Clave de punto = profundidad redondeada.
 * No se dibuja en el visor (sin `placement`): la dibuja el panel «Crossplot». Puro; lo registra
 * `src/modules/crossplot/series.ts` (la app descubre los proveedores de los módulos).
 */
import type { PlotFilterRule } from '../../core/plots';
import type { Zone } from '../../core/well';
import { gather, plottableIndices } from './crossplot';
import { resolvePlotCurve, zoneFilter } from '../data';
import { decodePlotFilters, encodePlotFilters, evaluatePlotFilters } from '../filters';
import { depthPointKey, type ResolvedSeries, type SeriesContext, type TrendSeriesProvider } from '../trend/series';

export const CROSSPLOT_PROVIDER_ID = 'crossplot';

export interface CrossplotSeriesKey {
  x: string;
  y: string;
  zones: string[];
  filters?: PlotFilterRule[];
}

export function crossplotSeriesKey(k: CrossplotSeriesKey): string {
  const base = `${k.x}|${k.y}|${[...k.zones].sort().join(',')}`;
  const encoded = encodePlotFilters(k.filters);
  return encoded ? `${base}|${encoded}` : base;
}

export function parseCrossplotSeriesKey(key: string): CrossplotSeriesKey | null {
  const parts = key.split('|');
  if ((parts.length !== 3 && parts.length !== 4) || !parts[0] || !parts[1]) return null;
  const filters = parts.length === 4 ? decodePlotFilters(parts[3]) : [];
  return {
    x: parts[0],
    y: parts[1],
    zones: parts[2] ? parts[2].split(',').filter(Boolean) : [],
    ...(filters.length ? { filters } : {}),
  };
}

interface CacheEntry {
  x: Float64Array;
  y: Float64Array;
  zones: readonly Zone[];
  filterData: readonly (Float64Array | null)[];
  series: ResolvedSeries;
}
const cache = new Map<string, CacheEntry>();

const sameFilterData = (a: readonly (Float64Array | null)[], b: readonly (Float64Array | null)[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/** Serie de la nube (misma identidad mientras no cambien los datos ni las zonas ni los filtros: cachés de ajuste estables). */
export function crossplotSeries(ctx: SeriesContext, key: string): ResolvedSeries | null {
  const k = parseCrossplotSeriesKey(key);
  if (!k) return null;
  const cx = resolvePlotCurve(ctx, k.x);
  const cy = resolvePlotCurve(ctx, k.y);
  if (!cx || !cy) return null;
  const zones = ctx.interpretation.zones;
  const filterData = k.filters ? k.filters.map((r) => resolvePlotCurve(ctx, r.curve)?.data ?? null) : [];
  const hit = cache.get(`${ctx.well.id}#${key}`);
  if (hit && hit.x === cx.data && hit.y === cy.data && hit.zones === zones && sameFilterData(hit.filterData, filterData)) return hit.series;
  const depth = ctx.well.depth.values;
  const f = zoneFilter(depth, zones, k.zones);
  const sf = k.filters?.length ? evaluatePlotFilters(ctx, k.filters, f.include) : null;
  const idx = plottableIndices(cx.data, cy.data, sf ? sf.include : f.include, cx.scale === 'log', cy.scale === 'log');
  const d = gather(depth, idx);
  const keys = Array.from(d, depthPointKey);
  const at = new Map(keys.map((s, j) => [s, j]));
  const series: ResolvedSeries = {
    ref: { provider: CROSSPLOT_PROVIDER_ID, key },
    label: cy.short,
    xLabel: cx.short,
    x: gather(cx.data, idx),
    y: gather(cy.data, idx),
    depth: d,
    xUnit: cx.unit,
    yUnit: cy.unit,
    xScale: cx.scale,
    yScale: cy.scale,
    xIsDepth: false,
    pointKey: (j) => keys[j]!,
    indexOfKey: (s) => at.get(s) ?? -1,
  };
  cache.set(`${ctx.well.id}#${key}`, { x: cx.data, y: cy.data, zones, filterData, series });
  return series;
}

export const crossplotSeriesProvider: TrendSeriesProvider = {
  id: CROSSPLOT_PROVIDER_ID,
  label: 'Crossplot libre',
  // Las tendencias del crossplot se crean desde su panel; el selector de series ofrece solo las que ya se usan.
  list(ctx) {
    const seen = new Set<string>();
    const out = [];
    for (const t of ctx.interpretation.trends) {
      if (t.series.provider !== CROSSPLOT_PROVIDER_ID || seen.has(t.series.key)) continue;
      seen.add(t.series.key);
      const s = crossplotSeries(ctx, t.series.key);
      const k = parseCrossplotSeriesKey(t.series.key);
      if (!s || !k) continue;
      const names = k.zones.map((id) => ctx.interpretation.zones.find((z) => z.id === id)?.name).filter(Boolean);
      out.push({ key: t.series.key, label: `${s.label} vs. ${s.xLabel}${names.length ? ` · zonas ${names.join(', ')}` : ''}`, group: 'Crossplot libre' });
    }
    return out;
  },
  resolve: crossplotSeries,
};

