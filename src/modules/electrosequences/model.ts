/**
 * Lógica pura de «Electrosecuencias» (sin React ni canvas): formas y su orden, geometría de los íconos (la comparten
 * la pista del visor, en canvas, y el panel, en SVG), lectura de las tablas del módulo y el cálculo en caché que usa
 * la pista (misma función y mismos parámetros que el módulo: ver index.ts).
 */
import type { TableCell } from '../../core/module';
import type { Interpretation } from '../../core/interpretation';
import { resolveModuleParams } from '../../core/params';
import type { Well } from '../../core/well';
import { analyzeElectrosequences, type Electrosequence, type SegmentConfidence, type SegmentShape } from '../../petro/segmentation';
import electrosequences, { engineParams } from './index';

export const SHAPES: readonly SegmentShape[] = ['cylinder', 'funnel', 'bell', 'symmetric', 'serrated', 'unclear'];

export const SHAPE_LABEL: Readonly<Record<SegmentShape, string>> = {
  cylinder: 'Cilindro',
  funnel: 'Embudo',
  bell: 'Campana',
  symmetric: 'Simétrico',
  serrated: 'Serrado',
  unclear: 'Sin forma',
};

/** Qué dice cada forma, en una línea (leyenda del panel). */
export const SHAPE_HINT: Readonly<Record<SegmentShape, string>> = {
  cylinder: 'GR parejo, contactos netos',
  funnel: 'GR baja hacia arriba: engrosamiento',
  bell: 'GR sube hacia arriba: afinamiento',
  symmetric: 'Engrosamiento y afinamiento',
  serrated: 'Alternancias finas',
  unclear: 'Sin patrón claro',
};

/** Índice en la paleta categórica del sistema de diseño (`CATEGORICAL` de ui/curves) para cada forma. */
export const SHAPE_COLOR_INDEX: Readonly<Record<SegmentShape, number>> = {
  cylinder: 1, // ámbar
  funnel: 0, // azul
  bell: 2, // verde
  symmetric: 6, // violeta
  serrated: 5, // cian
  unclear: 9, // pizarra
};

export const CONFIDENCE_LABEL: Readonly<Record<SegmentConfidence, string>> = { high: 'Alta', medium: 'Media', low: 'Baja' };
/** Opacidad del ícono según la confianza. */
export const CONFIDENCE_ALPHA: Readonly<Record<SegmentConfidence, number>> = { high: 0.9, medium: 0.62, low: 0.34 };

/**
 * Silueta del ícono en coordenadas normalizadas (x, y ∈ [0, 1]; y = 0 arriba). Es el «ancho de arena» del tramo,
 * anclado a la DERECHA: el borde izquierdo de la silueta es el trazo del GR (GR bajo = más a la izquierda), así el
 * ícono se lee como el propio perfil al lado de la pista de GR. Embudo = ancho arriba (GR bajo arriba); campana =
 * ancho abajo; cilindro = bloque; simétrico = rombo; serrado = borde en dientes.
 */
export function shapeOutline(shape: SegmentShape): [number, number][] {
  switch (shape) {
    case 'cylinder':
      return [[0.18, 0], [1, 0], [1, 1], [0.18, 1]];
    case 'funnel':
      return [[0.12, 0], [1, 0], [1, 1], [0.86, 1]];
    case 'bell':
      return [[0.86, 0], [1, 0], [1, 1], [0.12, 1]];
    case 'symmetric':
      return [[0.86, 0], [1, 0], [1, 1], [0.86, 1], [0.14, 0.5]];
    case 'serrated': {
      const pts: [number, number][] = [[1, 0], [1, 1]];
      const teeth = 5;
      for (let k = teeth * 2; k >= 0; k--) pts.push([k % 2 === 0 ? 0.62 : 0.2, k / (teeth * 2)]);
      return pts;
    }
    default:
      return [[0.45, 0], [1, 0], [1, 1], [0.45, 1]];
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Tablas del módulo

type Row = Readonly<Record<string, TableCell>>;
const num = (c: TableCell | undefined): number => (typeof c === 'number' && Number.isFinite(c) ? c : NaN);
const str = (c: TableCell | undefined): string => (c === null || c === undefined ? '' : String(c));
const pick = <T extends string>(c: TableCell | undefined, allowed: readonly T[], fallback: T): T => (allowed.includes(str(c) as T) ? (str(c) as T) : fallback);

export interface SequenceRow {
  zoneId: string;
  zone: string;
  top: number;
  base: number;
  thickness: number;
  shape: SegmentShape;
  confidence: SegmentConfidence;
  serrated: boolean;
  mean: number;
  description: string;
  interpretation: string;
}

export function sequencesFrom(rows: readonly Row[]): SequenceRow[] {
  return rows
    .map((r) => ({
      zoneId: str(r.zoneId),
      zone: str(r.zone),
      top: num(r.top),
      base: num(r.base),
      thickness: num(r.thickness),
      shape: pick(r.shape, SHAPES, 'unclear'),
      confidence: pick(r.confidence, ['high', 'medium', 'low'] as const, 'low'),
      serrated: r.serrated === 1,
      mean: num(r.mean),
      description: str(r.description),
      interpretation: str(r.interpretation),
    }))
    .filter((r) => Number.isFinite(r.top) && Number.isFinite(r.base));
}

/** Cantidad de tramos por forma. */
export function countByShape(rows: readonly { shape: SegmentShape }[]): Record<SegmentShape, number> {
  const out = Object.fromEntries(SHAPES.map((s) => [s, 0])) as Record<SegmentShape, number>;
  for (const r of rows) out[r.shape]++;
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Cálculo para la pista del visor

/**
 * GR que usa el motor para este pozo: la curva elegida explícitamente para el puerto GR, o la primera curva medida
 * con rol GR (la regla por defecto del grafo de cálculo). null si el pozo no tiene GR.
 */
export function grCurveOf(well: Readonly<Well>, interp: Readonly<Interpretation>): Float64Array | null {
  const src = interp.sources['GR'];
  if (src?.kind === 'curve') {
    const c = well.curves.find((x) => x.id === src.curveId);
    if (c) return c.data;
  }
  return well.curves.find((c) => c.role === 'GR')?.data ?? null;
}

/** Parámetros del módulo guardados en la interpretación, en la forma del motor. */
export function moduleEngineParams(interp: Readonly<Interpretation>) {
  const r = resolveModuleParams(electrosequences.id, electrosequences.params, interp.params, []);
  return { key: r.key, params: engineParams(r.global as Parameters<typeof engineParams>[0]) };
}

const cache = new WeakMap<Float64Array, { depth: ArrayLike<number>; key: string; out: Electrosequence[] }>();

/** Electrosecuencias del pozo (caché por curva, profundidad y parámetros: ~20 ms en el pozo del TP). */
export function sequencesForWell(well: Readonly<Well>, interp: Readonly<Interpretation>): Electrosequence[] | null {
  const gr = grCurveOf(well, interp);
  if (!gr) return null;
  const depth = well.depth.values;
  const { key, params } = moduleEngineParams(interp);
  const hit = cache.get(gr);
  if (hit && hit.depth === depth && hit.key === key) return hit.out;
  const out = analyzeElectrosequences(depth, gr, params);
  cache.set(gr, { depth, key, out });
  return out;
}

/** Tramo que contiene la profundidad d (búsqueda binaria; los tramos están ordenados y no se superponen). */
export function sequenceAt(list: readonly Electrosequence[], d: number): Electrosequence | null {
  let lo = 0;
  let hi = list.length - 1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    const s = list[m]!;
    if (d < s.top) hi = m - 1;
    else if (d > s.base) lo = m + 1;
    else return s;
  }
  return null;
}
