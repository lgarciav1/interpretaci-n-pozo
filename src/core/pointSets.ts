/**
 * Conjuntos de puntos del pozo (docs/decisiones/0009-presiones-mdt-y-conjuntos-de-puntos.md).
 *
 * Mediciones puntuales en profundidad que NO son curvas (no están en el índice de profundidad del pozo): presiones
 * de formación MDT/RFT (`kind: 'pressure'`), plugs de corona con φ, k y densidad de grano (`kind: 'core'`, 6b-3) y
 * lo que venga. El núcleo no sabe qué significa cada columna: las nombra el módulo dueño del tipo.
 *
 * Convenciones (las heredan todos los tipos):
 * - Viven en el POZO (`Well.pointSets`): son datos medidos, como las curvas. Lo que el usuario decide sobre ellos
 *   (descartar un punto, el fluido asignado, la puesta en profundidad de la corona) va en la INTERPRETACIÓN
 *   (`Interpretation.pointSets`), así entra en snapshots y no toca los datos.
 * - Arrays INMUTABLES (como las curvas): para cambiar un dato se crea un conjunto nuevo.
 * - `depth` en metros (MD), finita y NO decreciente (puede repetirse: dos pruebas a la misma cota). `createPointSet`
 *   ordena por profundidad si hace falta, arrastrando todas las columnas.
 * - `pointIds`: clave estable de cada punto (id de la prueba, número de plug). Es la que usan las exclusiones de las
 *   tendencias y las decisiones del usuario: nunca el índice.
 * - Cada columna numérica dice su unidad; las de texto no tienen unidad.
 */
import type { UnitId } from './units';

/** Tipo de conjunto: 'pressure' (MDT/RFT), 'core' (plugs) u otro que declare un módulo. */
export type PointSetKind = 'pressure' | 'core' | (string & {});

export interface NumericPointColumn {
  label: string;
  unit: UnitId;
  values: Float64Array;
}

export interface TextPointColumn {
  label: string;
  values: readonly string[];
}

export type PointColumn = NumericPointColumn | TextPointColumn;

export interface PointSet {
  /** Único dentro del pozo. */
  id: string;
  kind: PointSetKind;
  /** Nombre para la interfaz («MDT corrida 1»). */
  name: string;
  /** Archivo de origen, si vino de uno. */
  source?: string;
  /** Datos de ejemplo generados por la app: la interfaz lo rotula SIEMPRE como «ejemplo sintético». */
  synthetic?: boolean;
  /** Profundidad MD de cada punto (m), finita y no decreciente. */
  depth: Float64Array;
  pointIds: readonly string[];
  /** Columnas por clave (la define el módulo dueño del tipo: 'pressure', 'mobility', 'phi'…). */
  columns: Readonly<Record<string, PointColumn>>;
}

export const isNumericColumn = (c: PointColumn | undefined): c is NumericPointColumn => !!c && c.values instanceof Float64Array;

/** Valores numéricos de una columna (null si no existe o es de texto). */
export function pointNumbers(set: PointSet, key: string): Float64Array | null {
  const c = set.columns[key];
  return isNumericColumn(c) ? c.values : null;
}

/** Valores de texto de una columna (null si no existe o es numérica). */
export function pointTexts(set: PointSet, key: string): readonly string[] | null {
  const c = set.columns[key];
  return c && !isNumericColumn(c) ? c.values : null;
}

export interface CreatePointSetInput {
  id: string;
  kind: PointSetKind;
  name: string;
  source?: string;
  synthetic?: boolean;
  depth: Float64Array;
  pointIds: readonly string[];
  columns: Record<string, PointColumn>;
}

/**
 * Crea un conjunto validándolo. Lanza un Error en español si algo no cierra (largos distintos, ids repetidos o
 * vacíos, profundidad no finita). Si la profundidad no está ordenada, ordena todo (orden estable).
 */
export function createPointSet(input: CreatePointSetInput): PointSet {
  const { id, kind, name, depth, pointIds, columns } = input;
  if (typeof id !== 'string' || !id) throw new Error('El conjunto de puntos no tiene id.');
  if (typeof kind !== 'string' || !kind) throw new Error(`El conjunto '${id}' no dice de qué tipo es.`);
  if (!(depth instanceof Float64Array)) throw new Error(`La profundidad del conjunto '${id}' debe ser un Float64Array.`);
  const n = depth.length;
  if (pointIds.length !== n) throw new Error(`El conjunto '${id}' tiene ${n} profundidades y ${pointIds.length} ids.`);
  const seen = new Set<string>();
  for (const pid of pointIds) {
    if (typeof pid !== 'string' || !pid) throw new Error(`El conjunto '${id}' tiene un punto sin id.`);
    if (seen.has(pid)) throw new Error(`El conjunto '${id}' tiene dos puntos con el id '${pid}'.`);
    seen.add(pid);
  }
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(depth[i]!)) throw new Error(`El punto '${pointIds[i]}' del conjunto '${id}' no tiene una profundidad válida.`);
  }
  for (const [key, c] of Object.entries(columns)) {
    if (!c || typeof c.label !== 'string') throw new Error(`La columna '${key}' del conjunto '${id}' es inválida.`);
    if (c.values instanceof Float64Array) {
      if (typeof (c as NumericPointColumn).unit !== 'string' || !(c as NumericPointColumn).unit) throw new Error(`La columna numérica '${key}' del conjunto '${id}' no tiene unidad.`);
    } else if (!Array.isArray(c.values) || !c.values.every((v) => typeof v === 'string')) {
      throw new Error(`La columna '${key}' del conjunto '${id}' no es numérica ni de texto.`);
    }
    if (c.values.length !== n) throw new Error(`La columna '${key}' del conjunto '${id}' tiene ${c.values.length} valores y hay ${n} puntos.`);
  }
  let sorted = true;
  for (let i = 1; i < n && sorted; i++) if (depth[i]! < depth[i - 1]!) sorted = false;
  const base = {
    id,
    kind,
    name: typeof name === 'string' && name.trim() ? name : id,
    ...(input.source ? { source: input.source } : {}),
    ...(input.synthetic ? { synthetic: true } : {}),
  };
  if (sorted) return { ...base, depth, pointIds: [...pointIds], columns: { ...columns } };
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => depth[a]! - depth[b]! || a - b);
  const pick = <T,>(arr: ArrayLike<T>): T[] => order.map((i) => arr[i]!);
  const cols: Record<string, PointColumn> = {};
  for (const [key, c] of Object.entries(columns)) {
    cols[key] = isNumericColumn(c) ? { label: c.label, unit: c.unit, values: Float64Array.from(pick(c.values)) } : { label: c.label, values: pick(c.values) };
  }
  return { ...base, depth: Float64Array.from(pick(depth)), pointIds: pick(pointIds), columns: cols };
}

// ── decisiones del usuario (van en la interpretación) ───────────────────────────────────────────────────────────

/** Lo que el usuario decidió sobre un punto. Ausente = lo que propongan las reglas del módulo. */
export interface PointDecision {
  /** Forzar incluido o descartado (por encima de la propuesta automática). */
  status?: 'include' | 'exclude';
  /** Etiqueta libre del módulo dueño (fluido asignado a mano, tipo de roca de un plug…). */
  tag?: string;
}

/** Decisiones sobre un conjunto de puntos. JSON puro: vive en `Interpretation.pointSets[idDelConjunto]`. */
export interface PointSetDecisions {
  /** Por id de punto. Sin entrada = sin decisión. */
  points: Record<string, PointDecision>;
  /** Puesta en profundidad (m, se suma a la profundidad del archivo): corona–perfil (6b-3). */
  depthShift?: number;
  /** Ajustes del módulo dueño para este conjunto (umbral de movilidad…). */
  settings?: Record<string, number | string | boolean>;
}

export function emptyPointSetDecisions(): PointSetDecisions {
  return { points: {} };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Decisiones guardadas, validadas: lo inválido se descarta con aviso (como las tendencias). */
export function sanitizePointSetDecisions(raw: unknown, where: string, warn: (m: string) => void = () => {}): Record<string, PointSetDecisions> {
  if (raw === undefined || raw === null) return {};
  if (!isObj(raw)) {
    warn(`${where}: las decisiones sobre conjuntos de puntos no son un objeto; se descartan.`);
    return {};
  }
  const out: Record<string, PointSetDecisions> = {};
  for (const [setId, d] of Object.entries(raw)) {
    if (!isObj(d)) {
      warn(`${where}: las decisiones del conjunto '${setId}' son inválidas; se descartan.`);
      continue;
    }
    const points: Record<string, PointDecision> = {};
    let bad = 0;
    if (isObj(d['points'])) {
      for (const [pid, p] of Object.entries(d['points'])) {
        if (!isObj(p)) {
          bad++;
          continue;
        }
        const dec: PointDecision = {};
        if (p['status'] === 'include' || p['status'] === 'exclude') dec.status = p['status'];
        else if (p['status'] !== undefined) bad++;
        if (typeof p['tag'] === 'string' && p['tag']) dec.tag = p['tag'];
        if (dec.status || dec.tag) points[pid] = dec;
      }
    }
    if (bad) warn(`${where}: se descartaron ${bad} decisiones inválidas sobre puntos del conjunto '${setId}'.`);
    const clean: PointSetDecisions = { points };
    const shift = d['depthShift'];
    if (typeof shift === 'number' && Number.isFinite(shift)) clean.depthShift = shift;
    else if (shift !== undefined) warn(`${where}: la puesta en profundidad del conjunto '${setId}' no es un número; se quita.`);
    if (isObj(d['settings'])) {
      const settings: Record<string, number | string | boolean> = {};
      for (const [k, v] of Object.entries(d['settings'])) {
        if ((typeof v === 'number' && Number.isFinite(v)) || typeof v === 'string' || typeof v === 'boolean') settings[k] = v;
      }
      if (Object.keys(settings).length) clean.settings = settings;
    }
    out[setId] = clean;
  }
  return out;
}
