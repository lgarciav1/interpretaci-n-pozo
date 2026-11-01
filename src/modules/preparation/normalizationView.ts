/**
 * Lógica pura de la herramienta «Normalizar» (docs/decisiones/0060): estado previo de la curva, muestra del intervalo
 * de referencia, histograma con frecuencia acumulada (antes y después) y arrastre de los marcadores de percentil.
 * PURO: sin React ni DOM (lo dibujan `draw.ts` y `NormalizationHistogram.tsx`). Los números salen de las mismas
 * funciones que usa el motor (`src/core/preparation/normalization.ts`), así el histograma coincide con lo que se aplica.
 */
import { denormalizeValue, isNormalizationSource, normalizeValue, normalizationAnchors, percentileRank, percentileSorted, MIN_NORMALIZATION_SAMPLES, type NormalizationStats } from '../../core/preparation/normalization';
import { Quality } from '../../core/preparation/quality';
import type { CurveNormalization } from '../../core/preparation/state';

export interface CurveView {
  data: Float64Array;
  quality: Uint16Array;
}

/**
 * La curva tal como entra a la normalización. Sin normalización aplicada, es la vista misma; con normalización, se
 * invierte la transformación (es afín) en las muestras marcadas y se quitan sus banderas 256 y 128 (las de dominio de
 * la normalización; un NaN sin soporte de la alineación conserva su 128).
 */
export function stagePriorView(view: CurveView, config: CurveNormalization | undefined, stats: NormalizationStats | undefined): CurveView {
  if (!config || !stats) return view;
  const data = view.data.slice(), quality = view.quality.slice();
  for (let i = 0; i < data.length; i++) {
    const q = quality[i]!;
    if (!(q & Quality.Normalized)) continue;
    data[i] = denormalizeValue(data[i]!, config, stats);
    quality[i] = q & ~(Quality.Normalized | Quality.OutOfDomain);
  }
  return { data, quality };
}

/** Índices de origen del intervalo [top, base] (profundidad creciente), en orden de profundidad. */
export function referenceIndices(depth: ArrayLike<number>, view: CurveView, top: number, base: number): Int32Array {
  const out: number[] = [];
  for (let k = 0; k < depth.length; k++) {
    const d = depth[k]!;
    if (d < top) continue;
    if (d > base) break;
    if (isNormalizationSource(view.data[k]!, view.quality[k]!)) out.push(k);
  }
  return Int32Array.from(out);
}

export interface NormalizationPreview {
  /** Muestra de origen ordenada. */
  sorted: Float64Array;
  /** Valores de origen y normalizados de esa muestra (mismo orden: ordenados por valor de origen). */
  after: Float64Array | null;
  stats: Omit<NormalizationStats, 'outOfDomain'> | null;
  /** Motivo (en español) por el que no hay transformación, o null. */
  problem: string | null;
}

/** Vista previa local de la herramienta: la misma matemática que el motor, sobre la muestra del intervalo. */
export function normalizationPreview(view: CurveView, indices: Int32Array, config: CurveNormalization | null): NormalizationPreview {
  const sorted = new Float64Array(indices.length);
  for (let j = 0; j < indices.length; j++) sorted[j] = view.data[indices[j]!]!;
  sorted.sort();
  if (!config) return { sorted, after: null, stats: null, problem: null };
  try {
    const stats = normalizationAnchors(config, sorted);
    return { sorted, after: sorted.map((x) => normalizeValue(x, config, stats)), stats, problem: null };
  } catch (err) {
    return { sorted, after: null, stats: null, problem: err instanceof Error ? err.message : String(err) };
  }
}

/** La transformación no cambia la curva (ganancia 1 y anclajes que coinciden): no hay nada que aplicar. */
export function isIdentity(config: CurveNormalization, stats: Pick<NormalizationStats, 'sourceLow' | 'gain'>): boolean {
  const tol = 1e-12 * Math.max(1, Math.abs(stats.sourceLow));
  if (config.method === 'scale') return Math.abs(stats.gain - 1) <= 1e-12;
  const target = config.method === 'two-point' ? config.lowReference : config.reference;
  return Math.abs(stats.gain - 1) <= 1e-12 && Math.abs(target - stats.sourceLow) <= tol;
}

export { MIN_NORMALIZATION_SAMPLES };

// ── histograma ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface HistogramSeries {
  /** Frecuencia de cada clase en % del total de la serie. */
  percent: Float64Array;
  /** Acumulada en % en el borde derecho de cada clase (cuenta las de abajo del rango). */
  cumulative: Float64Array;
  below: number;
  above: number;
  n: number;
}

export interface HistogramModel {
  /** Bordes en valores de la curva (geométricos en escala log). */
  edges: Float64Array;
  log: boolean;
  lo: number;
  hi: number;
  before: HistogramSeries;
  after: HistogramSeries | null;
}

const tx = (log: boolean, v: number) => (log ? (v > 0 ? Math.log10(v) : NaN) : v);
const itx = (log: boolean, v: number) => (log ? 10 ** v : v);

/** Percentil tipo 7 de un array ya ordenado en la escala del eje. */
function q7(sorted: ArrayLike<number>, p: number) {
  return percentileSorted(sorted, p * 100);
}

/**
 * Clases comunes para antes y después: rango de P1 a P99 de las dos series juntas (más `extra`: marcadores y
 * referencias) ensanchado un 10 % (una lectura espuria no aplasta el histograma; las de afuera cuentan en la
 * acumulada), clases iguales en la escala del eje (log10 para resistividades). Entre 8 y 60 clases según
 * Freedman–Diaconis de la serie «antes».
 */
export function histogramModel(before: ArrayLike<number>, after: ArrayLike<number> | null, log: boolean, extra: readonly number[] = [], fixed: { lo: number; hi: number } | null = null): HistogramModel | null {
  const axis = (xs: ArrayLike<number>) => Array.from(xs, (v) => tx(log, v)).filter(Number.isFinite);
  const b = axis(before).sort((x, y) => x - y);
  const a = after ? axis(after).sort((x, y) => x - y) : [];
  if (b.length < 2) return null;
  let lo: number, hi: number;
  if (fixed && Number.isFinite(tx(log, fixed.lo)) && tx(log, fixed.hi) > tx(log, fixed.lo)) {
    // Eje fijo (mientras se arrastra un marcador: el eje no se mueve bajo el puntero).
    lo = tx(log, fixed.lo);
    hi = tx(log, fixed.hi);
  } else {
    const both = [...b, ...a].sort((x, y) => x - y);
    lo = q7(both, 0.01);
    hi = q7(both, 0.99);
    for (const v of extra.map((x) => tx(log, x)).filter(Number.isFinite)) {
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    const pad = (hi - lo) * 0.1 || Math.abs(lo) * 0.05 || 0.5;
    lo -= pad;
    hi += pad;
  }
  const iqr = q7(b, 0.75) - q7(b, 0.25);
  const width = iqr > 0 ? 2 * iqr * b.length ** (-1 / 3) : (hi - lo) / (Math.ceil(Math.log2(b.length)) + 1);
  const bins = Math.min(60, Math.max(8, Math.ceil((hi - lo) / width)));
  const edges = new Float64Array(bins + 1);
  for (let j = 0; j <= bins; j++) edges[j] = itx(log, lo + ((hi - lo) * j) / bins);
  const series = (xs: number[]): HistogramSeries => {
    const counts = new Float64Array(bins);
    let below = 0, above = 0;
    for (const v of xs) {
      if (v < lo) below++;
      else if (v > hi) above++;
      else counts[Math.min(bins - 1, Math.floor(((v - lo) / (hi - lo)) * bins))]!++;
    }
    const n = xs.length, percent = new Float64Array(bins), cumulative = new Float64Array(bins);
    let acc = below;
    for (let j = 0; j < bins; j++) {
      percent[j] = (100 * counts[j]!) / n;
      acc += counts[j]!;
      cumulative[j] = (100 * acc) / n;
    }
    return { percent, cumulative, below, above, n };
  };
  return { edges, log, lo: itx(log, lo), hi: itx(log, hi), before: series(b), after: a.length ? series(a) : null };
}

/** Fracción [0, 1] de un valor sobre el eje del histograma (lineal o log10). */
export function histogramFraction(model: Pick<HistogramModel, 'lo' | 'hi' | 'log'>, v: number): number {
  const a = tx(model.log, model.lo), b = tx(model.log, model.hi);
  return (tx(model.log, v) - a) / (b - a);
}

/** Inversa de `histogramFraction`. */
export function histogramValueAt(model: Pick<HistogramModel, 'lo' | 'hi' | 'log'>, f: number): number {
  const a = tx(model.log, model.lo), b = tx(model.log, model.hi);
  return itx(model.log, a + f * (b - a));
}

// ── marcadores de percentil ──────────────────────────────────────────────────────────────────────────────────────

export type MarkerId = 'low' | 'high' | 'single';

/** Separación mínima entre los dos percentiles (en puntos de percentil). */
export const MIN_PERCENTILE_GAP = 1;

/**
 * Nivel de percentil al soltar un marcador en `value`: rango empírico inverso de la definición 7, redondeado a 0,1 y
 * acotado para que el bajo quede por debajo del alto (con `MIN_PERCENTILE_GAP` entre ambos).
 */
export function draggedPercentile(sorted: ArrayLike<number>, value: number, marker: MarkerId, other: number | null): number {
  const raw = percentileRank(sorted, value);
  if (!Number.isFinite(raw)) return NaN;
  let p = Math.round(raw * 10) / 10;
  if (marker === 'low' && other !== null) p = Math.min(p, other - MIN_PERCENTILE_GAP);
  if (marker === 'high' && other !== null) p = Math.max(p, other + MIN_PERCENTILE_GAP);
  return Math.min(100, Math.max(0, Math.round(p * 10) / 10));
}

/** Marcador más cercano a `x` (px) dentro de `tolerance`, o null. */
export function nearestMarker(markers: readonly { id: MarkerId; x: number }[], x: number, tolerance: number): MarkerId | null {
  let best: MarkerId | null = null, dist = tolerance;
  for (const m of markers) {
    const d = Math.abs(m.x - x);
    if (d <= dist) {
      dist = d;
      best = m.id;
    }
  }
  return best;
}
