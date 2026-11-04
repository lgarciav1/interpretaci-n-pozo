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

/**
 * Medias de valores estrictamente positivos ponderadas por espesor (o por el peso que se pase): geométrica y armónica.
 * Solo cuentan las muestras con x > 0, x finito y peso > 0 finito; el resto es «nulo» (log y 1/x no están definidos).
 *
 *   Geométrica   x̄g = exp( Σ wᵢ·ln xᵢ / Σ wᵢ )     representativa de k en un medio log-normal (aleatorio 2D)
 *   Armónica     x̄h = Σ wᵢ / Σ (wᵢ / xᵢ)           k efectiva con flujo vertical, capas en SERIE (perpendicular a la estratificación)
 *   Aritmética   x̄a = Σ wᵢ·xᵢ / Σ wᵢ               k efectiva con flujo horizontal, capas en PARALELO (kh = Σ hᵢ·kᵢ)
 *
 * Siempre x̄h ≤ x̄g ≤ x̄a (desigualdad de medias ponderadas), con igualdad solo si todos los valores son iguales
 * (aritmética calculada sobre las mismas muestras positivas).
 *
 * Referencias: Warren, J.E. y Price, H.S. (1961), SPE Journal 1(3) (medias de k en capas); Lake, L.W. (1989),
 * "Enhanced Oil Recovery", cap. 2 (promedios de permeabilidad); Hardy, G.H., Littlewood, J.E. y Pólya, G. (1934),
 * "Inequalities" (armónica ≤ geométrica ≤ aritmética).
 */
export interface PositiveMeans {
  /** Media geométrica ponderada (NaN si no hay muestras positivas). */
  geo: number;
  /** Media armónica ponderada (NaN si no hay muestras positivas). */
  harm: number;
  /** Media aritmética ponderada sobre las MISMAS muestras positivas (para comparar; NaN si no hay). */
  arith: number;
  /** Muestras usadas (x > 0). */
  n: number;
  /** Muestras nulas: NaN, no finitas o ≤ 0 (con peso > 0). */
  nullCount: number;
  /** Peso (espesor) de las muestras nulas. */
  nullWeight: number;
}

/**
 * Ver `PositiveMeans`. `weights` por defecto vale 1 en todas las muestras. Las muestras con peso ≤ 0, NaN o no finito
 * se ignoran por completo (ni usadas ni nulas). Sin muestras positivas → medias NaN (nunca 0, nunca excepción).
 */
export function positiveMeans(values: ArrayLike<number>, weights?: ArrayLike<number>): PositiveMeans {
  let sw = 0;
  let sLn = 0;
  let sInv = 0;
  let sX = 0;
  let n = 0;
  let nullCount = 0;
  let nullWeight = 0;
  for (let i = 0; i < values.length; i++) {
    const w = weights ? weights[i]! : 1;
    if (!(w > 0) || !Number.isFinite(w)) continue;
    const x = values[i]!;
    if (!(x > 0) || !Number.isFinite(x)) {
      nullCount++;
      nullWeight += w;
      continue;
    }
    sw += w;
    sLn += w * Math.log(x);
    sInv += w / x;
    sX += w * x;
    n++;
  }
  if (n === 0) return { geo: NaN, harm: NaN, arith: NaN, n, nullCount, nullWeight };
  return { geo: Math.exp(sLn / sw), harm: sw / sInv, arith: sX / sw, n, nullCount, nullWeight };
}
