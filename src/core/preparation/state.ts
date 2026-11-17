/** Recetas persistibles de P3. Intervalos MD cerrados [top, base], sin borrar filas. */
import { validateDensityConfig, type DensityReconstructionConfig } from './density';
import { validateMgtConfig, type MgtConfig } from './mgt';
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
export interface DepthShift { offsetM: number; maxGapM: number; referenceId: string; depthKind: 'MD'; datum: string }
export interface ShiftNode extends Omit<MaskNode, 'kind'> {
  kind: 'constant-shift';
  shift: DepthShift;
  gapFill?: GapFill;
  filter?: MedianFilter;
}
export interface MgtNode extends Omit<MaskNode, 'kind'> { kind: 'mgt-borehole'; mgt: MgtConfig }
/**
 * Normalización de la curva (0060), después de la alineación. La receta guarda niveles de percentil y valores de
 * referencia; los percentiles de origen se recalculan al evaluar sobre la etapa anterior.
 * - two-point: x' = y_lo + (x − x_lo)·(y_hi − y_lo)/(x_hi − x_lo), con x_lo = P_lo y x_hi = P_hi del intervalo.
 * - shift: x' = x + (y − x_p); scale: x' = x·y/x_p, con x_p = P_p del intervalo.
 */
export type CurveNormalization =
  | { method: 'two-point'; top: number; base: number; lowPercentile: number; highPercentile: number; lowReference: number; highReference: number }
  | { method: 'shift' | 'scale'; top: number; base: number; percentile: number; reference: number };
export interface NormalizationNode extends Omit<MaskNode, 'kind'> {
  kind: 'linear-normalization';
  normalization: CurveNormalization;
  gapFill?: GapFill;
  filter?: MedianFilter;
  shift?: DepthShift;
}
export interface DensityNode extends Omit<MaskNode, 'kind'> { kind: 'density-reconstruction'; density: DensityReconstructionConfig }
export type PreparationNode = DensityNode | MaskNode | InterpolationNode | FilterNode | ShiftNode | MgtNode | NormalizationNode;
export function nodeShift(node: PreparationNode): DepthShift | undefined { return node.kind === 'constant-shift' || node.kind === 'linear-normalization' ? node.shift : undefined; }
export function nodeNormalization(node: PreparationNode): CurveNormalization | undefined { return node.kind === 'linear-normalization' ? node.normalization : undefined; }
/** Nodo mínimo con esas etapas: el `kind` es la última etapa presente; las anteriores quedan como campos opcionales. */
export function withNodeStages(node: PreparationNode, gapFill: GapFill | undefined, filter: MedianFilter | undefined, shift: DepthShift | undefined, normalization: CurveNormalization | undefined): PreparationNode {
  if (node.kind === 'density-reconstruction') throw new Error('Retirá la reconstrucción de densidad antes de cambiar etapas.');
  if (node.kind === 'mgt-borehole') throw new Error('Retirá la corrección MGT antes de cambiar etapas de limpieza o alineación; no se descarta silenciosamente.');
  const base = { id: node.id, methodVersion: 1 as const, enabled: node.enabled, input: node.input, intervals: node.intervals };
  return normalization ? { ...base, kind: 'linear-normalization', normalization, ...(gapFill ? { gapFill } : {}), ...(filter ? { filter } : {}), ...(shift ? { shift } : {}) }
    : shift ? { ...base, kind: 'constant-shift', shift, ...(gapFill ? { gapFill } : {}), ...(filter ? { filter } : {}) }
    : filter ? { ...base, kind: 'median-filter', filter, ...(gapFill ? { gapFill } : {}) }
    : gapFill ? { ...base, kind: 'linear-interpolation', gapFill } : { ...base, kind: 'mask' };
}
export function nodeFilter(node: PreparationNode): MedianFilter | undefined { return node.kind === 'median-filter' || node.kind === 'constant-shift' || node.kind === 'linear-normalization' ? node.filter : undefined; }
export function nodeGapFill(node: PreparationNode): GapFill | undefined { return node.kind === 'mask' || node.kind === 'mgt-borehole' || node.kind === 'density-reconstruction' ? undefined : node.gapFill; }
/** Versión mínima que exige el contenido (0038): 6 normalización (0060), 5 MGT, 4 alineación, 3 mediana, 2 interpolación. */
export interface PreparationState { schemaVersion: 1 | 2 | 3 | 4 | 5 | 6 | 7; nodes: PreparationNode[] }
export function preparationState(nodes: PreparationNode[]): PreparationState {
  return { schemaVersion: nodes.some(n => n.kind === 'density-reconstruction') ? 7 : nodes.some(n => n.kind === 'linear-normalization') ? 6 : nodes.some(n => n.kind === 'mgt-borehole') ? 5 : nodes.some(n => n.kind === 'constant-shift') ? 4 : nodes.some(n => n.kind === 'median-filter') ? 3 : nodes.some(n => n.kind === 'linear-interpolation') ? 2 : 1, nodes };
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
  if (![1, 2, 3, 4, 5, 6, 7].includes(value.schemaVersion as number) || !Array.isArray(value.nodes) || value.nodes.length > MAX_MASK_NODES) throw new Error('Versión o cantidad de operaciones de preparación no admitida.');
  const ids = new Set<string>(), curves = new Set<string>();
  for (const n of value.nodes) {
    const normalized = n?.kind === 'linear-normalization';
    shape(n, ['id', 'kind', 'methodVersion', 'enabled', 'input', 'intervals', ...(n?.kind === 'linear-interpolation' || (n?.kind === 'median-filter' || n?.kind === 'constant-shift' || normalized) && Object.hasOwn(n, 'gapFill') ? ['gapFill'] : []), ...(n?.kind === 'median-filter' || (n?.kind === 'constant-shift' || normalized) && Object.hasOwn(n, 'filter') ? ['filter'] : []), ...(n?.kind === 'constant-shift' || normalized && Object.hasOwn(n, 'shift') ? ['shift'] : []), ...(normalized ? ['normalization'] : []), ...(n?.kind === 'mgt-borehole' ? ['mgt'] : []), ...(n?.kind === 'density-reconstruction' ? ['density'] : [])]);
    if (!text(n.id) || !/^[a-zA-Z0-9_-]+$/.test(n.id) || ids.has(n.id) || !['mask', 'linear-interpolation', 'median-filter', 'constant-shift', 'mgt-borehole', 'linear-normalization', 'density-reconstruction'].includes(n.kind as string) || n.methodVersion !== 1 || typeof n.enabled !== 'boolean') throw new Error('Operación de preparación desconocida o repetida.');
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
    if (n.kind === 'median-filter' || Object.hasOwn(n, 'filter')) validateMedianFilter(n.filter);
    if (n.kind === 'constant-shift' || n.kind === 'linear-normalization' && Object.hasOwn(n, 'shift')) validateDepthShift(n.shift);
    if (n.kind === 'linear-normalization') validateNormalization(n.normalization);
    if (n.kind === 'density-reconstruction') { validateDensityConfig(n.density); if (n.intervals.length) throw new Error('La reconstrucción no se combina con exclusiones.'); }
    if (n.kind === 'mgt-borehole') { validateMgtConfig(n.mgt); if (n.intervals.length) throw new Error('MGT v1 no se combina con exclusiones u otras etapas sobre sus entradas.'); }
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
export function validateDepthShift(value: unknown): asserts value is DepthShift {
  shape(value, ['offsetM', 'maxGapM', 'referenceId', 'depthKind', 'datum']);
  if (typeof value.offsetM !== 'number' || !Number.isFinite(value.offsetM) || value.offsetM === 0 || typeof value.maxGapM !== 'number' || !Number.isFinite(value.maxGapM) || value.maxGapM <= 0 || value.depthKind !== 'MD' || !text(value.referenceId) || !text(value.datum) || value.datum.length > 128) throw new Error('La alineación requiere desplazamiento finito distinto de cero, hueco máximo positivo y referencia/datum MD explícitos.');
}
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const level = (v: unknown): v is number => finite(v) && v >= 0 && v <= 100;
/** Forma exacta por método y dominio de los parámetros (0060). El dominio de los datos se revisa al evaluar. */
export function validateNormalization(value: unknown): asserts value is CurveNormalization {
  const method = object(value) ? value.method : undefined;
  if (method === 'two-point') shape(value, ['method', 'top', 'base', 'lowPercentile', 'highPercentile', 'lowReference', 'highReference']);
  else if (method === 'shift' || method === 'scale') shape(value, ['method', 'top', 'base', 'percentile', 'reference']);
  else throw new Error('Método de normalización desconocido.');
  if (!finite(value.top) || !finite(value.base) || !(value.top < value.base)) throw new Error('La normalización requiere un intervalo de referencia con tope menor que la base.');
  if (method === 'two-point') {
    if (!level(value.lowPercentile) || !level(value.highPercentile) || !(value.lowPercentile < value.highPercentile)) throw new Error('Los percentiles deben estar entre 0 y 100, con el bajo menor que el alto.');
    if (!finite(value.lowReference) || !finite(value.highReference) || !(value.highReference > value.lowReference)) throw new Error('El valor de referencia alto debe ser mayor que el bajo (una normalización no invierte la curva).');
  } else {
    if (!level(value.percentile)) throw new Error('El percentil debe estar entre 0 y 100.');
    if (!finite(value.reference) || (method === 'scale' && value.reference === 0)) throw new Error(method === 'scale' ? 'La escala requiere un valor de referencia finito distinto de cero.' : 'El desplazamiento requiere un valor de referencia finito.');
  }
}
/** Lista estable de la receta de normalización (clave de estado y de receta). */
export function normalizationKey(n: CurveNormalization): (string | number)[] {
  return n.method === 'two-point' ? [n.method, n.top, n.base, n.lowPercentile, n.highPercentile, n.lowReference, n.highReference] : [n.method, n.top, n.base, n.percentile, n.reference];
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
  return JSON.stringify(state?.nodes.map(n => [n.id, n.kind, n.methodVersion, n.enabled, n.input.kind, n.input.inputRevisionId, n.input.curveId, maskRanges(n.intervals), ...(nodeGapFill(n) ? [[nodeGapFill(n)!.top, nodeGapFill(n)!.base, nodeGapFill(n)!.maxGapM]] : []), ...(nodeFilter(n) ? [[nodeFilter(n)!.top, nodeFilter(n)!.base, nodeFilter(n)!.radiusM, nodeFilter(n)!.maxStepM]] : []), ...(nodeShift(n) ? [[nodeShift(n)!.offsetM, nodeShift(n)!.maxGapM, nodeShift(n)!.referenceId, nodeShift(n)!.depthKind, nodeShift(n)!.datum]] : []), ...(n.kind === 'mgt-borehole' ? [n.mgt] : []), ...(n.kind === 'density-reconstruction' ? [n.density] : []), ...(nodeNormalization(n) ? [normalizationKey(nodeNormalization(n)!)] : [])]) ?? []);
}
