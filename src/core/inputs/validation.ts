/** Validadores de la frontera de revisiones. No corrigen, ordenan ni descartan datos silenciosamente. */
import { createPointSet, type PointSet } from '../pointSets';
import { createWell, type Well } from '../well';

export function requireObject(value: unknown, where: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${where}: se esperaba un objeto.`);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) throw new Error(`${where}: el objeto debe contener solo datos.`);
  if (Object.getOwnPropertySymbols(value).length) throw new Error(`${where}: no se admiten claves Symbol.`);
  for (const key of Object.getOwnPropertyNames(value)) {
    const d = Object.getOwnPropertyDescriptor(value, key)!;
    if (!('value' in d) || !d.enumerable) throw new Error(`${where}: '${key}' debe ser un dato enumerable, sin getter.`);
  }
  return value as Record<string, unknown>;
}

export function requireShape(value: unknown, where: string, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  const obj = requireObject(value, where);
  for (const key of required) if (!Object.hasOwn(obj, key)) throw new Error(`${where}: falta '${key}'.`);
  for (const key of Object.keys(obj)) if (!required.includes(key) && !optional.includes(key)) throw new Error(`${where}: campo no admitido '${key}'.`);
  return obj;
}

export function requireText(value: unknown, where: string, nonempty = true): asserts value is string {
  if (typeof value !== 'string' || (nonempty && !value.trim())) throw new Error(`${where}: texto inválido.`);
}

export function requireArray(value: unknown, where: string): asserts value is unknown[] {
  if (!Array.isArray(value)) throw new Error(`${where}: se esperaba una lista.`);
  // No aceptar huecos ni propiedades que structuredClone/Array.map podrían omitir.
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1) throw new Error(`${where}: lista con huecos o propiedades adicionales.`);
  for (let i = 0; i < value.length; i++) {
    const d = Object.getOwnPropertyDescriptor(value, String(i));
    if (!d || !('value' in d) || !d.enumerable) throw new Error(`${where}: elemento ${i} inválido.`);
  }
}

export function requireFloat64(value: unknown, where: string): asserts value is Float64Array {
  if (!(value instanceof Float64Array) || !(value.buffer instanceof ArrayBuffer)) throw new Error(`${where}: se requiere Float64Array con buffer no compartido.`);
  // Detecta también un buffer detached; un array legítimamente vacío sigue siendo válido aquí.
  try { new Uint8Array(value.buffer, value.byteOffset, value.byteLength); } catch { throw new Error(`${where}: buffer desconectado.`); }
}

function validatePointSet(value: unknown, where: string): void {
  const ps = requireShape(value, where, ['id', 'kind', 'name', 'depth', 'pointIds', 'columns'], ['source', 'synthetic']);
  for (const key of ['id', 'kind', 'name']) requireText(ps[key], `${where}.${key}`);
  if (Object.hasOwn(ps, 'source')) requireText(ps.source, `${where}.source`, false);
  if (Object.hasOwn(ps, 'synthetic') && typeof ps.synthetic !== 'boolean') throw new Error(`${where}.synthetic: se requiere boolean.`);
  requireFloat64(ps.depth, `${where}.depth`);
  requireArray(ps.pointIds, `${where}.pointIds`);
  const columns = requireObject(ps.columns, `${where}.columns`);
  for (const [key, value] of Object.entries(columns)) {
    const col = requireObject(value, `${where}.${key}`);
    requireShape(col, `${where}.${key}`, ['label', 'values'], col.values instanceof Float64Array ? ['unit'] : []);
    requireText(col.label, `${where}.${key}.label`, false);
    if (col.values instanceof Float64Array) {
      requireFloat64(col.values, `${where}.${key}`);
      requireText(col.unit, `${where}.${key}.unit`);
    } else requireArray(col.values, `${where}.${key}.values`);
  }
  for (let i = 1; i < ps.depth.length; i++) if (ps.depth[i]! < ps.depth[i - 1]!) throw new Error(`${where}: profundidad de puntos desordenada.`);
  // Valida ids, finitud de profundidades, textos, unidades y alineación sin modificar la entrada.
  createPointSet(value as PointSet);
}

export function validateInputWell(value: unknown): asserts value is Well {
  const w = requireShape(value, 'Pozo', ['id', 'name', 'header', 'depth', 'curves', 'pointSets']);
  requireText(w.id, 'Pozo.id');
  requireText(w.name, 'Pozo.name', false);
  const header = requireObject(w.header, 'Encabezado');
  for (const [key, value] of Object.entries(header)) {
    const h = requireShape(value, `Encabezado.${key}`, ['value'], ['unit', 'description']);
    if (typeof h.value !== 'string' && !(typeof h.value === 'number' && Number.isFinite(h.value))) throw new Error(`Encabezado.${key}: valor inválido.`);
    if (Object.hasOwn(h, 'unit')) requireText(h.unit, `Encabezado.${key}.unit`);
    if (Object.hasOwn(h, 'description')) requireText(h.description, `Encabezado.${key}.description`, false);
  }
  const depth = requireShape(w.depth, 'Profundidad', ['unit', 'values', 'step'], ['sourceUnit']);
  if (depth.unit !== 'm') throw new Error('Profundidad: el índice maestro debe estar en metros.');
  requireFloat64(depth.values, 'Profundidad');
  if (Object.hasOwn(depth, 'sourceUnit')) requireText(depth.sourceUnit, 'Profundidad.sourceUnit');
  if (depth.step !== null && !(typeof depth.step === 'number' && Number.isFinite(depth.step) && depth.step > 0)) throw new Error('Profundidad: paso inválido.');
  requireArray(w.curves, 'Curvas');
  for (const value of w.curves) {
    const c = requireShape(value, 'Curva', ['id', 'mnemonic', 'role', 'unit', 'data', 'origin'], ['description']);
    for (const key of ['id', 'mnemonic', 'unit']) requireText(c[key], `Curva.${key}`);
    if (c.role !== null) requireText(c.role, 'Curva.role');
    if (Object.hasOwn(c, 'description')) requireText(c.description, 'Curva.description', false);
    requireFloat64(c.data, 'Curva.data');
    const origin = requireObject(c.origin, 'Origen de curva');
    if (origin.kind === 'measured') {
      requireShape(origin, 'Origen medido', ['kind'], ['source']);
      if (Object.hasOwn(origin, 'source')) requireText(origin.source, 'Origen.source', false);
    } else if (origin.kind === 'computed') {
      requireShape(origin, 'Origen importado calculado', ['kind', 'moduleId', 'port']);
      requireText(origin.moduleId, 'Origen.moduleId');
      requireText(origin.port, 'Origen.port');
    } else throw new Error('Origen de curva desconocido.');
  }
  requireArray(w.pointSets, 'Conjuntos de puntos');
  for (const ps of w.pointSets) validatePointSet(ps, 'Conjunto de puntos');
  const well = value as Well;
  const checked = createWell({ id: well.id, name: well.name, header: well.header, depth: well.depth.values, depthSourceUnit: well.depth.sourceUnit, curves: well.curves, pointSets: well.pointSets });
  if (checked.depth.step !== well.depth.step && (checked.depth.step === null || well.depth.step === null || Math.abs(checked.depth.step - well.depth.step) > 1e-6)) throw new Error('Profundidad: el paso declarado no coincide con el índice.');
}
