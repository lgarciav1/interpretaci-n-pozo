/**
 * Banderas por umbral.
 *
 * EJEMPLO DE FASE 1 (junto con igr.ts): sirve para demostrar el encadenamiento de módulos. Los cutoffs reales
 * (reservorio neto, pay neto) se implementan en la fase de cutoffs.
 */

/** 1 si valor ≥ umbral, 0 si es menor, NaN si no hay dato. */
export function thresholdFlag(value: number, cutoff: number): number {
  if (Number.isNaN(value)) return NaN;
  return value >= cutoff ? 1 : 0;
}

export function thresholdFlagInto(
  values: ArrayLike<number>,
  out: Float64Array,
  cutoff: number,
  start = 0,
  end = values.length,
): Float64Array {
  for (let i = start; i < end; i++) out[i] = thresholdFlag(values[i]!, cutoff);
  return out;
}
