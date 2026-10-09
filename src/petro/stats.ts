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
