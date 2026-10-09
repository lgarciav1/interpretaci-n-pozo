/**
 * Lectura en el cursor: muestra más cercana a una profundidad y formato del valor. Puro.
 */
import { formatNumber } from '../ui/format';
import { lowerBound } from './decimate';

/**
 * Índice de la muestra más cercana a `d`, o -1 si `d` cae fuera del pozo (más de medio paso antes de la primera
 * o después de la última muestra).
 */
export function nearestIndex(depth: ArrayLike<number>, d: number): number {
  const n = depth.length;
  if (n === 0 || !Number.isFinite(d)) return -1;
  const halfFirst = n > 1 ? (depth[1]! - depth[0]!) / 2 : 0;
  const halfLast = n > 1 ? (depth[n - 1]! - depth[n - 2]!) / 2 : 0;
  if (d < depth[0]! - halfFirst || d > depth[n - 1]! + halfLast) return -1;
  const i = lowerBound(depth, d);
  if (i <= 0) return 0;
  if (i >= n) return n - 1;
  return d - depth[i - 1]! <= depth[i]! - d ? i - 1 : i;
}

/** Valor de una curva en el cursor: NaN si no hay dato o el cursor está fuera del pozo. */
export function valueAt(data: ArrayLike<number>, index: number): number {
  return index >= 0 && index < data.length ? data[index]! : NaN;
}

/** Texto de la lectura: 4 cifras significativas, «—» sin dato; banderas como «sí»/«no». */
export function formatReadout(v: number, kind: 'line' | 'band' = 'line'): string {
  if (!Number.isFinite(v)) return '—';
  if (kind === 'band') return v >= 0.5 ? 'sí' : 'no';
  return formatNumber(v, { significant: 4, grouping: false });
}

/** Profundidad del cursor para rótulos: 2 decimales. */
export function formatDepth(d: number): string {
  return formatNumber(d, { digits: 2, grouping: false });
}
