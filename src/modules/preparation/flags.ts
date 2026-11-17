/**
 * Banderas de calidad por muestra para la interfaz de «Preparar datos» (0058). PURO: sin React ni DOM.
 *
 * Los nueve bits son los de `Quality` (src/core/preparation/quality.ts; «normalizada» desde 0060); acá solo se nombran,
 * se cuentan y se reducen a columnas de píxeles para dibujar. «Sospechoso» no lo escribe el motor: la interfaz lo marca
 * para mostrar los picos del control de calidad y los candidatos de la búsqueda de espurios (solo vista, nunca se guarda).
 */
import { Quality } from '../../core/preparation/quality';

export type FlagKey = 'missing' | 'excluded' | 'suspect' | 'interpolated' | 'filtered' | 'shifted' | 'corrected' | 'outOfDomain' | 'normalized' | 'estimated' | 'unsupported';

export interface FlagDef {
  key: FlagKey;
  bit: number;
  label: string;
  /** Una línea, en español, sin ecuaciones. */
  description: string;
}

/** En el orden de los bits. */
export const QUALITY_FLAGS: readonly FlagDef[] = [
  { key: 'missing', bit: Quality.OriginallyMissing, label: 'Faltante original', description: 'La medición no tenía dato en el archivo.' },
  { key: 'excluded', bit: Quality.Excluded, label: 'Excluida', description: 'Medición quitada a mano; el original se conserva.' },
  { key: 'suspect', bit: Quality.Suspect, label: 'Sospechosa', description: 'Pico del control de calidad o candidato a espurio: revisalo.' },
  { key: 'interpolated', bit: Quality.Interpolated, label: 'Interpolada', description: 'Valor estimado entre dos mediciones, no medido.' },
  { key: 'filtered', bit: Quality.Filtered, label: 'Filtrada', description: 'Suavizada con mediana móvil.' },
  { key: 'shifted', bit: Quality.Shifted, label: 'Corrida', description: 'Desplazada en profundidad y remuestreada.' },
  { key: 'corrected', bit: Quality.Corrected, label: 'Corregida', description: 'Corrección ambiental aplicada (no garantiza exactitud).' },
  { key: 'outOfDomain', bit: Quality.OutOfDomain, label: 'Fuera de dominio', description: 'Sin soporte para estimar, fuera del rango del método o del rango físico de la curva.' },
  { key: 'normalized', bit: Quality.Normalized, label: 'Normalizada', description: 'Llevada a los valores de referencia por la normalización.' },
  { key: 'estimated', bit: Quality.EstimatedML, label: 'Estimada ML', description: 'Densidad estimada por un modelo del mismo pozo; no es una medición.' },
  { key: 'unsupported', bit: Quality.UnsupportedML, label: 'Sin soporte ML', description: 'Sin estimación por datos no fiables, extrapolación o validación insuficiente.' },
];

export const FLAG_BY_KEY: Readonly<Record<FlagKey, FlagDef>> = Object.fromEntries(QUALITY_FLAGS.map((f) => [f.key, f])) as Record<FlagKey, FlagDef>;

export type FlagCounts = Record<FlagKey, number>;

const zeroCounts = (): FlagCounts => ({ missing: 0, excluded: 0, suspect: 0, interpolated: 0, filtered: 0, shifted: 0, corrected: 0, outOfDomain: 0, normalized: 0, estimated: 0, unsupported: 0 });

/** Calidad mínima de una curva sin preparar: solo «faltante original» donde no hay dato. */
export function qualityOf(data: ArrayLike<number>): Uint16Array {
  const q = new Uint16Array(data.length);
  for (let i = 0; i < data.length; i++) if (Number.isNaN(data[i]!)) q[i] = Quality.OriginallyMissing;
  return q;
}

/** Copia con el bit «sospechoso» en esos índices (solo vista; los fuera de rango se ignoran). */
export function withSuspects(quality: Uint16Array, indices: Iterable<number>): Uint16Array {
  const q = quality.slice();
  for (const i of indices) if (i >= 0 && i < q.length) q[i] = q[i]! | Quality.Suspect;
  return q;
}

/** Cantidad de muestras con cada bandera en [start, end). */
export function flagCounts(quality: ArrayLike<number>, start = 0, end = quality.length): FlagCounts {
  const out = zeroCounts();
  const a = Math.max(0, start), b = Math.min(quality.length, end);
  for (let i = a; i < b; i++) {
    const q = quality[i]!;
    if (!q) continue;
    for (const f of QUALITY_FLAGS) if (q & f.bit) out[f.key]++;
  }
  return out;
}

/** Tramos contiguos [desde, hasta) de índices con ese bit dentro de [start, end). */
export function flagRuns(quality: ArrayLike<number>, bit: number, start = 0, end = quality.length): [number, number][] {
  const runs: [number, number][] = [];
  const a = Math.max(0, start), b = Math.min(quality.length, end);
  let from = -1;
  for (let i = a; i < b; i++) {
    const on = (quality[i]! & bit) !== 0;
    if (on && from < 0) from = i;
    else if (!on && from >= 0) {
      runs.push([from, i]);
      from = -1;
    }
  }
  if (from >= 0) runs.push([from, b]);
  return runs;
}

/** Índices [start, end) de las muestras con profundidad en [top, base] (índice creciente; extremos incluidos). */
export function indexRange(depth: ArrayLike<number>, top: number, base: number): { start: number; end: number } {
  const lower = (v: number, strict: boolean) => {
    let lo = 0, hi = depth.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (strict ? depth[mid]! <= v : depth[mid]! < v) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  if (!(top <= base)) return { start: 0, end: 0 };
  return { start: lower(top, false), end: lower(base, true) };
}

/**
 * Reduce [start, end) a `columns` columnas: OR de las banderas de las muestras de cada columna (para dibujar miles de
 * muestras en pocos píxeles sin perder una muestra marcada).
 */
export function columnFlags(quality: ArrayLike<number>, start: number, end: number, columns: number): Uint16Array {
  const out = new Uint16Array(Math.max(0, columns));
  const n = end - start;
  if (n <= 0 || columns <= 0) return out;
  for (let i = start; i < end; i++) {
    const c = Math.min(columns - 1, Math.floor(((i - start) * columns) / n));
    out[c] = out[c]! | quality[i]!;
  }
  return out;
}

/** Prioridad para la barra de una sola fila (tarjetas): lo que más importa ver primero. */
const PRIORITY: readonly FlagKey[] = ['excluded', 'unsupported', 'estimated', 'outOfDomain', 'suspect', 'corrected', 'interpolated', 'filtered', 'shifted', 'normalized', 'missing'];

/** Bandera dominante de un conjunto de bits (o null si no hay ninguna). */
export function dominantFlag(bits: number): FlagKey | null {
  for (const k of PRIORITY) if (bits & FLAG_BY_KEY[k].bit) return k;
  return null;
}

/**
 * Envolvente mínimo–máximo por columna en [start, end) (NaN si la columna no tiene datos finitos). Para dibujar una
 * curva de miles de muestras en cientos de píxeles conservando los picos.
 */
export function minMaxColumns(data: ArrayLike<number>, start: number, end: number, columns: number): { min: Float64Array; max: Float64Array } {
  const min = new Float64Array(Math.max(0, columns)).fill(NaN);
  const max = new Float64Array(Math.max(0, columns)).fill(NaN);
  const n = end - start;
  if (n <= 0 || columns <= 0) return { min, max };
  for (let i = start; i < end; i++) {
    const v = data[i]!;
    if (!Number.isFinite(v)) continue;
    const c = Math.min(columns - 1, Math.floor(((i - start) * columns) / n));
    if (!(v >= min[c]!)) min[c] = v;
    if (!(v <= max[c]!)) max[c] = v;
  }
  return { min, max };
}
