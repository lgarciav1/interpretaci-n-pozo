/**
 * Histograma de una curva (docs/decisiones/0014-histograma-y-crossplot.md, D5). Puro y testeado: clases automáticas
 * (Freedman–Diaconis con límites; Sturges si el rango intercuartil es 0), clases iguales en escala lineal o en log10,
 * conteo por serie (todas las zonas o una por zona), normalización a %, acumulada y estadísticos breves.
 *
 * Referencias:
 * - Freedman, D. y Diaconis, P. (1981). On the histogram as a density estimator: L2 theory. Zeitschrift für
 *   Wahrscheinlichkeitstheorie und verwandte Gebiete 57, 453–476. Ancho h = 2·IQR·n^(−1/3).
 * - Sturges, H. A. (1926). The choice of a class interval. JASA 21(153), 65–66. k = ⌈log2 n⌉ + 1.
 * - Percentiles: Hyndman y Fan (1996), definición 7 (la misma de `percentile` en src/petro/stats.ts, sobre un typed array
 *   ordenado una sola vez).
 */

export type HistScale = 'linear' | 'log';

/** Límites de las clases automáticas: menos de 5 no muestra forma; más de 80 en un panel del dock es ruido. */
export const AUTO_BINS = { min: 5, max: 80 } as const;

const t = (scale: HistScale, v: number) => (scale === 'log' ? (v > 0 ? Math.log10(v) : NaN) : v);
const inv = (scale: HistScale, v: number) => (scale === 'log' ? 10 ** v : v);

/** Valores finitos (y > 0 en log) de las muestras incluidas, ya transformados a la escala del eje. */
export function collect(values: ArrayLike<number>, scale: HistScale, include?: (i: number) => boolean): Float64Array {
  const out: number[] = [];
  for (let i = 0; i < values.length; i++) {
    if (include && !include(i)) continue;
    const v = t(scale, values[i]!);
    if (Number.isFinite(v)) out.push(v);
  }
  return Float64Array.from(out);
}

/**
 * Cantidad de clases automática para `n` valores con rango intercuartil `iqr` en un rango `span` (todo en la escala
 * del eje): Freedman–Diaconis, o Sturges si el IQR es 0 (datos muy repetidos). Acotada a [`AUTO_BINS.min`, `max`].
 */
export function autoBinCount(n: number, iqr: number, span: number): number {
  if (!(n > 1) || !(span > 0)) return AUTO_BINS.min;
  let k: number;
  if (iqr > 0) {
    const h = 2 * iqr * n ** (-1 / 3);
    k = Math.ceil(span / h);
  } else k = Math.ceil(Math.log2(n)) + 1;
  return Math.min(AUTO_BINS.max, Math.max(AUTO_BINS.min, k));
}

/**
 * Bordes de `bins` clases iguales entre `lo` y `hi` (en valores de la curva). En log, iguales en log10: los bordes
 * son una progresión geométrica.
 */
export function binEdges(lo: number, hi: number, bins: number, scale: HistScale): Float64Array {
  const a = t(scale, lo);
  const b = t(scale, hi);
  const k = Math.max(1, Math.round(bins));
  const out = new Float64Array(k + 1);
  for (let j = 0; j <= k; j++) out[j] = inv(scale, a + ((b - a) * j) / k);
  out[0] = lo;
  out[k] = hi;
  return out;
}

/** Índice de la clase de un valor (−1 si queda afuera). La última clase es cerrada a la derecha. */
export function binIndex(edges: ArrayLike<number>, v: number): number {
  const k = edges.length - 1;
  if (!(v >= edges[0]!) || !(v <= edges[k]!)) return -1;
  let lo = 0;
  let hi = k;
  while (hi - lo > 1) {
    const mid = (lo + hi) >>> 1;
    if (v >= edges[mid]!) lo = mid;
    else hi = mid;
  }
  return lo;
}

export interface HistogramCounts {
  counts: Float64Array;
  /** Muestras contadas (dentro del rango). */
  n: number;
  /** Válidas fuera del rango de las clases (por debajo / por encima). */
  below: number;
  above: number;
}

/** Cuenta las muestras incluidas en cada clase. En log, los valores ≤ 0 no cuentan (no se pueden ubicar). */
export function countBins(values: ArrayLike<number>, edges: ArrayLike<number>, scale: HistScale, include?: (i: number) => boolean): HistogramCounts {
  const k = edges.length - 1;
  const counts = new Float64Array(Math.max(0, k));
  let n = 0;
  let below = 0;
  let above = 0;
  for (let i = 0; i < values.length; i++) {
    if (include && !include(i)) continue;
    const v = values[i]!;
    if (!Number.isFinite(v) || (scale === 'log' && !(v > 0))) continue;
    const j = binIndex(edges, v);
    if (j >= 0) {
      counts[j]!++;
      n++;
    } else if (v < edges[0]!) below++;
    else above++;
  }
  return { counts, n, below, above };
}

/** Frecuencia en % de `total` (las que quedaron fuera de rango también cuentan en el total). */
export function toPercent(counts: ArrayLike<number>, total: number): Float64Array {
  const out = new Float64Array(counts.length);
  if (!(total > 0)) return out;
  for (let j = 0; j < counts.length; j++) out[j] = (100 * counts[j]!) / total;
  return out;
}

/** Acumulada en % (0–100) en el borde derecho de cada clase, contando también las de abajo del rango. */
export function cumulativePercent(h: HistogramCounts): Float64Array {
  const total = h.n + h.below + h.above;
  const out = new Float64Array(h.counts.length);
  let acc = h.below;
  for (let j = 0; j < h.counts.length; j++) {
    acc += h.counts[j]!;
    out[j] = total > 0 ? (100 * acc) / total : NaN;
  }
  return out;
}

export interface AutoRange {
  lo: number;
  hi: number;
  bins: number;
}

/**
 * Rango y clases automáticos para un conjunto de valores: del percentil 0,5 al 99,5 ensanchado un 8 % (una lectura
 * espuria no aplasta el histograma; lo que queda afuera se informa) y Freedman–Diaconis sobre esos valores. `bins` fijo lo reemplaza.
 * null si no hay al menos dos valores distintos.
 */
export function autoRange(values: ArrayLike<number>, scale: HistScale, include?: (i: number) => boolean, bins?: number | null): AutoRange | null {
  const xs = collect(values, scale, include);
  if (xs.length < 2) return null;
  const sorted = Float64Array.from(xs).sort();
  const q = (p: number) => {
    const h = (sorted.length - 1) * p;
    const a = Math.floor(h);
    const b = Math.min(a + 1, sorted.length - 1);
    return sorted[a]! + (h - a) * (sorted[b]! - sorted[a]!);
  };
  // Percentiles 0,5–99,5 ensanchados un 8 % del tramo (sin pasar de los extremos reales): la moda de un borde no
  // queda cortada, y una lectura espuria lejana sigue afuera.
  const p0 = q(0.005);
  const p1 = q(0.995);
  const pad = (p1 - p0) * 0.08;
  let lo = Math.max(sorted[0]!, p0 - pad);
  let hi = Math.min(sorted[sorted.length - 1]!, p1 + pad);
  if (!(hi > lo)) {
    lo = sorted[0]!;
    hi = sorted[sorted.length - 1]!;
  }
  if (!(hi > lo)) {
    const d = Math.abs(lo) > 0 ? Math.abs(lo) * 0.05 : 0.5;
    lo -= d;
    hi += d;
  }
  const k = bins ?? autoBinCount(sorted.length, q(0.75) - q(0.25), hi - lo);
  return { lo: inv(scale, lo), hi: inv(scale, hi), bins: k };
}

export interface SampleStats {
  n: number;
  /** Media aritmética (lineal) o geométrica (escala log: resistividad, permeabilidad). */
  mean: number;
  geometric: boolean;
  p10: number;
  p50: number;
  p90: number;
  min: number;
  max: number;
}

/**
 * Estadísticos breves de las muestras incluidas. P10/P50/P90 son percentiles (P10 = el 10 % de las muestras queda
 * por debajo), no la convención de excedencia de reservas. En log, la media es geométrica.
 */
export function sampleStats(values: ArrayLike<number>, scale: HistScale, include?: (i: number) => boolean): SampleStats {
  const xs = collect(values, scale, include);
  const n = xs.length;
  if (n === 0) return { n: 0, mean: NaN, geometric: scale === 'log', p10: NaN, p50: NaN, p90: NaN, min: NaN, max: NaN };
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const v of xs) {
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  // Un solo ordenamiento numérico (typed array) para los tres percentiles; misma definición que `percentile`.
  const sorted = xs.sort();
  const q = (p: number) => {
    const h = (n - 1) * p;
    const a = Math.floor(h);
    const b = Math.min(a + 1, n - 1);
    return sorted[a]! + (h - a) * (sorted[b]! - sorted[a]!);
  };
  return {
    n,
    mean: inv(scale, sum / n),
    geometric: scale === 'log',
    p10: inv(scale, q(0.1)),
    p50: inv(scale, q(0.5)),
    p90: inv(scale, q(0.9)),
    min: inv(scale, min),
    max: inv(scale, max),
  };
}

export interface CutoffSplit {
  /** Muestras válidas incluidas. */
  n: number;
  /** % con valor ≤ cutoff y > cutoff. */
  below: number;
  above: number;
}

/** Reparto de las muestras incluidas a cada lado de un cutoff (inclusivo abajo, como los cutoffs del motor). */
export function cutoffSplit(values: ArrayLike<number>, cutoff: number, include?: (i: number) => boolean): CutoffSplit {
  let n = 0;
  let lo = 0;
  for (let i = 0; i < values.length; i++) {
    if (include && !include(i)) continue;
    const v = values[i]!;
    if (!Number.isFinite(v)) continue;
    n++;
    if (v <= cutoff) lo++;
  }
  return n === 0 ? { n, below: NaN, above: NaN } : { n, below: (100 * lo) / n, above: (100 * (n - lo)) / n };
}
