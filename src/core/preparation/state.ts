/** Recetas persistibles de P3. Intervalos MD cerrados [top, base], sin borrar filas. */
export interface MaskInterval { id: string; top: number; base: number }
export interface MaskNode {
  id: string;
  kind: 'mask';
  methodVersion: 1;
  enabled: boolean;
  input: { kind: 'original'; inputRevisionId: string; curveId: string };
  intervals: MaskInterval[];
}
export interface PreparationState { schemaVersion: 1; nodes: MaskNode[] }
export const PREPARATION_BUDGET = 128 * 1024 * 1024;
export const MAX_MASK_NODES = 32;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) && !ArrayBuffer.isView(v);
function shape(v: unknown, keys: string[]): asserts v is Record<string, unknown> {
  if (!object(v) || Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k))) throw new Error('Estructura de preparación inválida.');
}
const text = (v: unknown): v is string => typeof v === 'string' && !!v.trim();
export function validatePreparation(value: unknown): asserts value is PreparationState {
  shape(value, ['schemaVersion', 'nodes']);
  if (value.schemaVersion !== 1 || !Array.isArray(value.nodes) || value.nodes.length > MAX_MASK_NODES) throw new Error('Versión o cantidad de operaciones de preparación no admitida.');
  const ids = new Set<string>(), curves = new Set<string>();
  for (const n of value.nodes) {
    shape(n, ['id', 'kind', 'methodVersion', 'enabled', 'input', 'intervals']);
    if (!text(n.id) || !/^[a-zA-Z0-9_-]+$/.test(n.id) || ids.has(n.id) || n.kind !== 'mask' || n.methodVersion !== 1 || typeof n.enabled !== 'boolean') throw new Error('Operación de preparación desconocida o repetida.');
    ids.add(n.id);
    shape(n.input, ['kind', 'inputRevisionId', 'curveId']);
    if (n.input.kind !== 'original' || !text(n.input.inputRevisionId) || !text(n.input.curveId) || curves.has(n.input.curveId)) throw new Error('Cada curva admite una máscara sobre un original con revisión explícita.');
    curves.add(n.input.curveId);
    if (!Array.isArray(n.intervals) || !n.intervals.length || n.intervals.length > 256) throw new Error('Cantidad de intervalos de exclusión no admitida.');
    const intervals = new Set<string>();
    for (const r of n.intervals) {
      shape(r, ['id', 'top', 'base']);
      if (!text(r.id) || intervals.has(r.id) || typeof r.top !== 'number' || !Number.isFinite(r.top) || typeof r.base !== 'number' || !Number.isFinite(r.base) || r.base < r.top) throw new Error('Intervalo de exclusión inválido o repetido.');
      intervals.add(r.id);
    }
  }
}
export function maskRanges(intervals: readonly MaskInterval[]): { top: number; base: number }[] {
  const sorted = intervals.map(({ top, base }) => ({ top, base })).sort((a, b) => a.top - b.top || a.base - b.base);
  const result: { top: number; base: number }[] = [];
  for (const r of sorted) {
    const prev = result.at(-1);
    if (prev && r.top <= prev.base) prev.base = Math.max(prev.base, r.base);
    else result.push(r);
  }
  return result;
}
/** No incluye ids de intervalos ni tiempos de UI; sí la referencia explícita al origen. */
export function preparationStateKey(state: PreparationState | undefined): string {
  return JSON.stringify(state?.nodes.map(n => [n.id, n.kind, n.methodVersion, n.enabled, n.input.kind, n.input.inputRevisionId, n.input.curveId, maskRanges(n.intervals)]) ?? []);
}
