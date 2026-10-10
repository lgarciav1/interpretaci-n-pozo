/**
 * Modelo de datos del pozo: índice de profundidad, curvas y zonas.
 *
 * Convenciones (las heredan todas las fases):
 * - La profundidad se guarda en metros (MD), estrictamente creciente, sin NaN.
 * - Cada curva es un Float64Array alineado con el índice de profundidad; NaN = sin dato.
 * - Los arrays son INMUTABLES por convención: para editar una curva se reemplaza su array por uno nuevo.
 *   El motor detecta cambios por identidad del array (no compara contenido).
 * - `unit` es la unidad en la que están los datos de la curva; el motor convierte a la unidad canónica del rol.
 */
import type { PointSet } from './pointSets';
import type { RoleId } from './roles';
import type { UnitId } from './units';

export type CurveOrigin =
  | { kind: 'measured'; source?: string }
  | { kind: 'computed'; moduleId: string; port: string };

export interface Curve {
  /** Único dentro del pozo. Para curvas medidas suele ser el mnemónico. */
  id: string;
  /** Mnemónico tal como vino en el archivo (ZDEN, AT90...). */
  mnemonic: string;
  description?: string;
  /** Rol asignado (null = sin asignar; el motor la ignora). */
  role: RoleId | null;
  /** Unidad de `data`. */
  unit: UnitId;
  data: Float64Array;
  origin: CurveOrigin;
}

export interface DepthIndex {
  /** Siempre metros. */
  unit: 'm';
  values: Float64Array;
  /** Paso si el muestreo es regular (tolerancia 1e-6 m), si no null. */
  step: number | null;
  /** Unidad original del archivo, solo informativa. */
  sourceUnit?: UnitId;
}

export interface HeaderEntry {
  value: string | number;
  unit?: UnitId;
  description?: string;
}

export interface Well {
  id: string;
  name: string;
  /** Metadatos de encabezado (UWI, compañía, yacimiento, KB...). Claves libres. */
  header: Record<string, HeaderEntry>;
  depth: DepthIndex;
  /** Solo curvas medidas o importadas. Las calculadas son resultados del motor y no se guardan acá. */
  curves: Curve[];
  /**
   * Mediciones puntuales en profundidad (presiones MDT, plugs de corona): ver `pointSets.ts`. El motor no las lee
   * (cambiarlas no recalcula nada); las usan superposiciones, proveedores de series y paneles de módulos.
   */
  pointSets: PointSet[];
}

export type ZoneKind = 'formation' | 'reservoir' | 'seal' | 'other';

export interface Zone {
  id: string;
  name: string;
  /** Tope y base en metros (tope < base). */
  top: number;
  base: number;
  /** Color CSS. */
  color: string;
  kind: ZoneKind;
}

/** Valida un índice de profundidad y calcula el paso si es regular. Lanza un Error en español. */
export function makeDepthIndex(values: Float64Array, sourceUnit?: UnitId): DepthIndex {
  if (values.length === 0) throw new Error('El índice de profundidad está vacío.');
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (!Number.isFinite(v)) throw new Error(`Profundidad inválida en la muestra ${i}: ${v}.`);
    if (i > 0 && v <= values[i - 1]!) {
      throw new Error(`La profundidad debe ser estrictamente creciente (muestra ${i}: ${values[i - 1]} → ${v}).`);
    }
  }
  return { unit: 'm', values, step: detectStep(values), ...(sourceUnit ? { sourceUnit } : {}) };
}

function detectStep(values: Float64Array): number | null {
  if (values.length < 2) return null;
  const n = values.length;
  const step = (values[n - 1]! - values[0]!) / (n - 1);
  for (let i = 1; i < n; i++) {
    if (Math.abs(values[i]! - values[i - 1]! - step) > 1e-6) return null;
  }
  return step;
}

export interface CreateWellInput {
  id: string;
  name: string;
  header?: Record<string, HeaderEntry>;
  depth: Float64Array;
  depthSourceUnit?: UnitId;
  curves: Curve[];
  pointSets?: PointSet[];
}

/** Crea un pozo validando que todas las curvas estén alineadas con la profundidad y que los ids sean únicos. */
export function createWell(input: CreateWellInput): Well {
  const depth = makeDepthIndex(input.depth, input.depthSourceUnit);
  const ids = new Set<string>();
  for (const c of input.curves) {
    if (ids.has(c.id)) throw new Error(`Hay dos curvas con el id '${c.id}'.`);
    ids.add(c.id);
    if (!(c.data instanceof Float64Array)) throw new Error(`La curva '${c.id}' debe ser un Float64Array.`);
    if (c.data.length !== depth.values.length) {
      throw new Error(
        `La curva '${c.id}' tiene ${c.data.length} muestras y la profundidad ${depth.values.length}.`,
      );
    }
  }
  const setIds = new Set<string>();
  for (const s of input.pointSets ?? []) {
    if (setIds.has(s.id)) throw new Error(`Hay dos conjuntos de puntos con el id '${s.id}'.`);
    setIds.add(s.id);
  }
  return { id: input.id, name: input.name, header: input.header ?? {}, depth, curves: input.curves, pointSets: input.pointSets ?? [] };
}

/** Espesor representado por cada muestra (m): mitad del intervalo a cada lado. */
export function sampleThickness(depth: ArrayLike<number>): Float64Array {
  const n = depth.length;
  const out = new Float64Array(n);
  if (n === 1) {
    out[0] = 0;
    return out;
  }
  for (let i = 0; i < n; i++) {
    const prev = i > 0 ? depth[i - 1]! : depth[i]!;
    const next = i < n - 1 ? depth[i + 1]! : depth[i]!;
    const span = next - prev;
    out[i] = i === 0 || i === n - 1 ? span : span / 2;
  }
  return out;
}

/** Zona ubicada sobre el índice de muestras: [start, end). */
export interface ZoneSpan {
  id: string;
  name: string;
  /** Tipo de la zona (reservorio, sello…): el sumario y el volumétrico lo usan sin mirar el proyecto. */
  kind: ZoneKind;
  top: number;
  base: number;
  start: number;
  end: number;
}

/** Tramo contiguo de muestras que comparten zona (zoneId null = fuera de toda zona). */
export interface Segment {
  start: number;
  end: number;
  zoneId: string | null;
}

export interface ZoneLayout {
  spans: ZoneSpan[];
  segments: Segment[];
  /** Índice de zona por muestra (-1 = sin zona), en el orden de `spans`. */
  zoneIndex: Int32Array;
  problems: string[];
}

/**
 * Ubica las zonas sobre las muestras. Una muestra pertenece a la zona con tope ≤ prof ≤ base; si hay
 * solapamiento gana la de tope más somero (y se informa el problema).
 */
export function layoutZones(depth: ArrayLike<number>, zones: readonly Zone[]): ZoneLayout {
  const problems: string[] = [];
  const valid = zones.filter((z) => {
    const ok = Number.isFinite(z.top) && Number.isFinite(z.base) && z.top < z.base;
    if (!ok) problems.push(`La zona '${z.name}' tiene tope ${z.top} y base ${z.base}: se ignora.`);
    return ok;
  });
  const sorted = [...valid].sort((a, b) => a.top - b.top);
  for (let k = 1; k < sorted.length; k++) {
    if (sorted[k]!.top < sorted[k - 1]!.base) {
      problems.push(`Las zonas '${sorted[k - 1]!.name}' y '${sorted[k]!.name}' se superponen.`);
    }
  }
  const n = depth.length;
  const zoneIndex = new Int32Array(n).fill(-1);
  const spans: ZoneSpan[] = sorted.map((z) => ({ id: z.id, name: z.name, kind: z.kind ?? 'formation', top: z.top, base: z.base, start: n, end: n }));
  // Barrido: profundidad creciente, zonas ordenadas por tope.
  let k = 0;
  for (let i = 0; i < n; i++) {
    const d = depth[i]!;
    while (k < sorted.length && sorted[k]!.base < d) k++;
    // Puede haber solapamiento: la primera zona (por tope) que contenga d gana.
    for (let j = k; j < sorted.length && sorted[j]!.top <= d; j++) {
      if (d <= sorted[j]!.base) {
        zoneIndex[i] = j;
        break;
      }
    }
  }
  for (let i = 0; i < n; i++) {
    const j = zoneIndex[i]!;
    if (j < 0) continue;
    const s = spans[j]!;
    if (s.start === n) s.start = i;
    s.end = i + 1;
  }
  for (const s of spans) if (s.start === n) s.start = s.end = 0;
  const segments: Segment[] = [];
  let start = 0;
  for (let i = 1; i <= n; i++) {
    if (i === n || zoneIndex[i] !== zoneIndex[start]) {
      const j = zoneIndex[start]!;
      segments.push({ start, end: i, zoneId: j >= 0 ? spans[j]!.id : null });
      start = i;
    }
  }
  return { spans, segments, zoneIndex, problems };
}

/** Firma de la geometría de zonas (el motor le suma nombres y tipos: los módulos los usan en tablas y avisos). */
export function zoneGeometryKey(zones: readonly Zone[]): string {
  return zones.map((z) => `${z.id}:${z.top}:${z.base}`).join('|');
}
