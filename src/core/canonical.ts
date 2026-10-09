/**
 * Curva medida en la unidad canónica de su rol (la misma conversión que hace el motor antes de pasarla a un módulo).
 * Con caché por identidad del array: el visor y las tendencias comparten el MISMO array convertido, así sus
 * cachés (fracciones, resúmenes, ajustes) también se comparten. Puro (sin interfaz).
 */
import type { RoleCatalog } from './roles';
import { convertArray, getUnit, sameDimension, type UnitId } from './units';
import type { Curve } from './well';

const converted = new WeakMap<Float64Array, Map<string, Float64Array>>();

export function canonicalCurveData(c: Pick<Curve, 'data' | 'unit' | 'role'>, catalog: RoleCatalog): { data: Float64Array; unit: UnitId } {
  const role = c.role ? catalog.get(c.role) : undefined;
  if (!role || role.unit === c.unit || !getUnit(c.unit) || !sameDimension(c.unit, role.unit)) return { data: c.data, unit: c.unit };
  let byUnit = converted.get(c.data);
  if (!byUnit) converted.set(c.data, (byUnit = new Map()));
  const key = `${c.unit}>${role.unit}`;
  let data = byUnit.get(key);
  if (!data) byUnit.set(key, (data = convertArray(c.data, c.unit, role.unit)));
  return { data, unit: role.unit };
}
