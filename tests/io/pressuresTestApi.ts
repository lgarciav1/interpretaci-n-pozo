/** Lo que usan los tests de presiones (API pública de src/io más un atajo para leer columnas). */
import { pointNumbers, type PointSet } from '../../src/core/pointSets';
export { buildPressureSet, parseTable, suggestPressureMapping } from '../../src/io';
export type { PressureField } from '../../src/io';

export function pointNumbersOf(set: PointSet, key: string): Float64Array {
  const v = pointNumbers(set, key);
  if (!v) throw new Error(`Sin columna numérica '${key}'.`);
  return v;
}
