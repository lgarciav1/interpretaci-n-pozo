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
export interface GapFill { top: number; base: number; maxGapM: number }
/** Exclusiones primero, interpolación de faltantes originales después. */
export interface InterpolationNode extends Omit<MaskNode, 'kind'> {
  kind: 'linear-interpolation';
  gapFill: GapFill;
}
export interface MedianFilter { top: number; base: number; radiusM: number; maxStepM: number }
export interface FilterNode extends Omit<MaskNode, 'kind'> {
  kind: 'median-filter';
  filter: MedianFilter;
  gapFill?: GapFill;
}
export type PreparationNode = MaskNode | InterpolationNode | FilterNode;
export function nodeGapFill(node: PreparationNode): GapFill | undefined { return node.kind === 'mask' ? undefined : node.gapFill; }
export interface PreparationState { schemaVersion: 1 | 2 | 3; nodes: PreparationNode[] }
export function preparationState(nodes: PreparationNode[]): PreparationState {
  return { schemaVersion: nodes.some(n => n.kind === 'median-filter') ? 3 : nodes.some(n => n.kind === 'linear-interpolation') ? 2 : 1, nodes };
}
export const PREPARATION_BUDGET = 128 * 1024 * 1024;
export const MAX_MASK_NODES = 32;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) && !ArrayBuffer.isView(v);
function shape(v: unknown, keys: string[]): asserts v is Record<string, unknown> {
  if (!object(v) || Object.keys(v).length !== keys.length || keys.some(k => !Object.hasOwn(v, k))) throw new Error('Estructura de preparación inválida.');
}
const text = (v: unknown): v is string => typeof v === 'string' && !!v.trim();
export function validatePreparation(value: unknown): asserts value is PreparationState {
  shape(value, ['schemaVersion', 'nodes']);
  if (![1, 2, 3].includes(value.schemaVersion as number) || !Array.isArray(value.nodes) || value.nodes.length > MAX_MASK_NODES) throw new Error('Versión o cantidad de operaciones de preparación no admitida.');
  const ids = new Set<string>(), curves = new Set<string>();
  for (const n of value.nodes) {
    shape(n, ['id', 'kind', 'methodVersion', 'enabled', 'input', 'intervals', ...(n?.kind === 'linear-interpolation' || n?.kind === 'median-filter' && Object.hasOwn(n, 'gapFill') ? ['gapFill'] : []), ...(n?.kind === 'median-filter' ? ['filter'] : [])]);
    if (!text(n.id) || !/^[a-zA-Z0-9_-]+$/.test(n.id) || ids.has(n.id) || !['mask', 'linear-interpolation', 'median-filter'].includes(n.kind as string) || n.methodVersion !== 1 || typeof n.enabled !== 'boolean') throw new Error('Operación de preparación desconocida o repetida.');
    ids.add(n.id);
    shape(n.input, ['kind', 'inputRevisionId', 'curveId']);
    if (n.input.kind !== 'original' || !text(n.input.inputRevisionId) || !text(n.input.curveId) || curves.has(n.input.curveId)) throw new Error('Cada curva admite una receta sobre un original con revisión explícita.');
    curves.add(n.input.curveId);
    if (!Array.isArray(n.intervals) || (n.kind === 'mask' && !n.intervals.length) || n.intervals.length > 256) throw new Error('Cantidad de intervalos de exclusión no admitida.');
    const intervals = new Set<string>();
    for (const r of n.intervals) {
      shape(r, ['id', 'top', 'base']);
      if (!text(r.id) || intervals.has(r.id) || typeof r.top !== 'number' || !Number.isFinite(r.top) || typeof r.base !== 'number' || !Number.isFinite(r.base) || r.base < r.top) throw new Error('Intervalo de exclusión inválido o repetido.');
      intervals.add(r.id);
    }
    if (n.kind === 'linear-interpolation' || Object.hasOwn(n, 'gapFill')) validateGapFill(n.gapFill);
    if (n.kind === 'median-filter') validateMedianFilter(n.filter);
  }
  if (value.schemaVersion !== preparationState(value.nodes as PreparationNode[]).schemaVersion) throw new Error('La versión de preparación no corresponde a sus métodos.');
}
export function validateGapFill(value: unknown): asserts value is GapFill {
  shape(value, ['top', 'base', 'maxGapM']);
  if (typeof value.top !== 'number' || typeof value.base !== 'number' || typeof value.maxGapM !== 'number' || ![value.top, value.base, value.maxGapM].every(Number.isFinite) || value.top > value.base || value.maxGapM <= 0) throw new Error('La interpolación requiere un tramo válido y una longitud máxima positiva.');
}
export function validateMedianFilter(value: unknown): asserts value is MedianFilter {
  shape(value, ['top', 'base', 'radiusM', 'maxStepM']);
  if (![value.top, value.base, value.radiusM, value.maxStepM].every(v => typeof v === 'number' && Number.isFinite(v)) || (value.top as number) > (value.base as number) || (value.radiusM as number) <= 0 || (value.maxStepM as number) <= 0) throw new Error('El filtro requiere tramo válido, radio y separación máxima positivos.');
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
  return JSON.stringify(state?.nodes.map(n => [n.id, n.kind, n.methodVersion, n.enabled, n.input.kind, n.input.inputRevisionId, n.input.curveId, maskRanges(n.intervals), ...(nodeGapFill(n) ? [[nodeGapFill(n)!.top, nodeGapFill(n)!.base, nodeGapFill(n)!.maxGapM]] : []), ...(n.kind === 'median-filter' ? [[n.filter.top, n.filter.base, n.filter.radiusM, n.filter.maxStepM]] : [])]) ?? []);
}
