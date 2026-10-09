/** Estadísticas por intervalo de muestras (ponderadas por espesor). Ignoran NaN. */

export interface IntervalStats {
  /** Media ponderada por espesor de las muestras con dato (NaN si no hay ninguna). */
  mean: number;
  /** Espesor total del intervalo (m). */
  thickness: number;
  /** Espesor con dato (m). */
  validThickness: number;
  /** Cantidad de muestras con dato. */
  count: number;
}

export function intervalStats(
  values: ArrayLike<number>,
  thickness: ArrayLike<number>,
  start = 0,
  end = values.length,
): IntervalStats {
  let sum = 0;
  let total = 0;
  let valid = 0;
  let count = 0;
  for (let i = start; i < end; i++) {
    const h = thickness[i]!;
    total += h;
    const v = values[i]!;
    if (Number.isNaN(v)) continue;
    sum += v * h;
    valid += h;
    count++;
  }
  return { mean: valid > 0 ? sum / valid : NaN, thickness: total, validThickness: valid, count };
}

/** Espesor (m) de las muestras cuyo valor es exactamente `target` (útil para banderas 0/1). */
export function thicknessWhere(
  values: ArrayLike<number>,
  thickness: ArrayLike<number>,
  target: number,
  start = 0,
  end = values.length,
): number {
  let h = 0;
  for (let i = start; i < end; i++) if (values[i] === target) h += thickness[i]!;
  return h;
}

/**
 * Percentil p ∈ [0, 1] de los valores finitos de [start, end) que cumplen `include` (todos si se omite), con
 * interpolación lineal entre estadísticos de orden (tipo 7: el de NumPy por defecto, `np.percentile`).
 *
 *   h = (m − 1)·p;   resultado = x₍⌊h⌋₎ + (h − ⌊h⌋)·(x₍⌊h⌋+1₎ − x₍⌊h⌋₎)     con x₍·₎ ordenados y m valores.
 *
 * Sin valores → NaN. p fuera de [0, 1] o NaN → NaN. Se ignoran NaN e ±Infinity. Copia los valores (no muta la
 * entrada). `include` recibe el índice de la muestra en `values`.
 *
 * Referencia: Hyndman, R.J. y Fan, Y. (1996), "Sample quantiles in statistical packages", The American
 * Statistician 50(4), definición 7.
 */
export function percentile(
  values: ArrayLike<number>,
  p: number,
  start = 0,
  end = values.length,
  include?: (i: number) => boolean,
): number {
  if (!(p >= 0 && p <= 1)) return NaN;
  const xs: number[] = [];
  for (let i = start; i < end; i++) {
    const v = values[i]!;
    if (!Number.isFinite(v)) continue;
    if (include && !include(i)) continue;
    xs.push(v);
  }
  const m = xs.length;
  if (m === 0) return NaN;
  xs.sort((a, b) => a - b);
  const h = (m - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.min(lo + 1, m - 1);
  return xs[lo]! + (h - lo) * (xs[hi]! - xs[lo]!);
}
