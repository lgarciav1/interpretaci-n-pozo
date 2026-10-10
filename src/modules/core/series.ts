/**
 * Plugs de corona como serie de tendencias (docs/decisiones/0008 D3 y 0010): proveedor `core`.
 *
 * Serie `<conjunto>:kphi`: crossplot k–φ de los plugs INCLUIDOS con φ y k finitos (los descartados no entran en
 * ningún ajuste). x = φ (v/v, lineal), y = k (mD, log), `xIsDepth: false` y `depth` = profundidad CORREGIDA (para
 * filtrar por tramo o zona: «usar zona como tramo» ajusta el modelo de una zona). Clave de punto = id del plug.
 * No se dibuja en el visor (sin `placement`): la dibuja el gráfico x–y del panel «Corona».
 *
 * El modelo k–φ es una tendencia normal (`model: 'exp'`: k = A·e^(B·φ), recta en log k) sobre esta serie; el panel
 * la convierte a log10 k = a + b·φ para el módulo del motor `perm-core` (`kphiModelOf`).
 *
 * Interfaz (importa `src/plots`): el worker no lo carga.
 */
import type { Interpretation } from '../../core/interpretation';
import { pointNumbers, shiftedDepth, type PointSet } from '../../core/pointSets';
import type { TrendSpec } from '../../core/trends';
import { evaluateTrend, type TrendResult } from '../../plots/trend/compute';
import type { ResolvedSeries, SeriesOption, TrendSeriesProvider } from '../../plots/trend/series';
import { COL, CORE_KIND, CORE_PROVIDER_ID, coreSets, KPHI, kphiModelOf, kphiSeriesKey, parseCoreSeriesKey, plugStatuses } from './model';
import type { LogLinearPermModel } from '../../petro/permeability';

const cache = new WeakMap<PointSet, WeakMap<object, ResolvedSeries>>();
const NO_DEC = {};

/** Serie k–φ de un conjunto (plugs incluidos con φ y k > 0). Misma identidad mientras no cambien datos ni decisiones. */
export function kphiSeries(set: PointSet, interpretation: Pick<Interpretation, 'pointSets'>): ResolvedSeries | null {
  const phi = pointNumbers(set, COL.phi);
  const k = pointNumbers(set, COL.k);
  if (!phi || !k) return null;
  const dec = interpretation.pointSets?.[set.id];
  let byDec = cache.get(set);
  if (!byDec) cache.set(set, (byDec = new WeakMap()));
  const hit = byDec.get(dec ?? NO_DEC);
  if (hit) return hit;
  const st = plugStatuses(set, dec);
  const z = shiftedDepth(set, dec);
  const idx: number[] = [];
  for (let i = 0; i < set.depth.length; i++) if (st[i]!.included && Number.isFinite(phi[i]!) && k[i]! > 0) idx.push(i);
  const ids = idx.map((i) => set.pointIds[i]!);
  const at = new Map(ids.map((id, j) => [id, j]));
  const s: ResolvedSeries = {
    ref: { provider: CORE_PROVIDER_ID, key: kphiSeriesKey(set.id) },
    label: 'k',
    xLabel: 'φ',
    x: Float64Array.from(idx, (i) => phi[i]!),
    y: Float64Array.from(idx, (i) => k[i]!),
    depth: Float64Array.from(idx, (i) => z[i]!),
    xUnit: 'v/v',
    yUnit: 'mD',
    xScale: 'linear',
    yScale: 'log',
    xIsDepth: false,
    pointKey: (j) => ids[j]!,
    indexOfKey: (key) => at.get(key) ?? -1,
  };
  byDec.set(dec ?? NO_DEC, s);
  return s;
}

export const coreSeriesProvider: TrendSeriesProvider = {
  id: CORE_PROVIDER_ID,
  label: 'Plugs de corona',
  list(ctx) {
    const out: SeriesOption[] = [];
    for (const set of coreSets(ctx.well.pointSets)) {
      if (!pointNumbers(set, COL.phi) || !pointNumbers(set, COL.k)) continue;
      const name = set.synthetic && !/sint[eé]tic/i.test(set.name) ? `${set.name} (ejemplo sintético)` : set.name;
      out.push({ key: kphiSeriesKey(set.id), label: `${name} · k vs. φ`, group: 'Corona', unit: 'mD' });
    }
    return out;
  },
  resolve(ctx, key) {
    const { setId, what } = parseCoreSeriesKey(key);
    if (what !== KPHI) return null;
    const set = ctx.well.pointSets.find((s) => s.id === setId && s.kind === CORE_KIND);
    return set ? kphiSeries(set, ctx.interpretation) : null;
  },
};

export const seriesProviders: TrendSeriesProvider[] = [coreSeriesProvider];

// ── modelos k–φ del conjunto ─────────────────────────────────────────────────────────────────────────────────

export interface KPhiTrend {
  spec: TrendSpec;
  /** Índice en `interpretation.trends` (color de paleta). */
  index: number;
  series: ResolvedSeries | null;
  result: TrendResult | null;
  /** log10 k = a + b·φ (solo si el modelo es exponencial y hay ajuste). */
  model: LogLinearPermModel | null;
}

/** Tendencias k–φ de un conjunto, con su ajuste y el modelo para el motor. */
export function kphiTrends(set: PointSet, interpretation: Interpretation): KPhiTrend[] {
  const key = kphiSeriesKey(set.id);
  const out: KPhiTrend[] = [];
  interpretation.trends.forEach((spec, index) => {
    if (spec.series.provider !== CORE_PROVIDER_ID || spec.series.key !== key) return;
    const series = kphiSeries(set, interpretation);
    const result = series ? evaluateTrend(spec, series, interpretation.zones) : null;
    out.push({ spec, index, series, result, model: kphiModelOf(result?.coeffs) });
  });
  return out;
}
