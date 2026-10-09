/**
 * Reducción de muestras por fila de píxel (eje de profundidad) con el algoritmo M4: por fila se guardan la primera,
 * la mínima, la máxima y la última muestra, más la media (para rellenos). La línea que pasa por
 * primera → mín → máx → última de cada fila es idéntica píxel a píxel a la curva completa: no se pierden picos.
 * Puro y sin asignar memoria por cuadro (los buffers se reusan). docs/decisiones/0005-visor-multipista.md, D2.
 */

/** Estado de una fila: sin muestras (no corta la línea), con dato, o hueco (solo NaN: corta la línea). */
export const ROW_EMPTY = 0;
export const ROW_DATA = 1;
export const ROW_GAP = 2;

export interface RowBuffers {
  rows: number;
  first: Float32Array;
  last: Float32Array;
  min: Float32Array;
  max: Float32Array;
  mean: Float32Array;
  state: Uint8Array;
}

export function createRowBuffers(rows: number): RowBuffers {
  return {
    rows,
    first: new Float32Array(rows),
    last: new Float32Array(rows),
    min: new Float32Array(rows),
    max: new Float32Array(rows),
    mean: new Float32Array(rows),
    state: new Uint8Array(rows),
  };
}

/** Reusa `buf` si alcanza; si no, crea uno nuevo. */
export function ensureRowBuffers(buf: RowBuffers | undefined, rows: number): RowBuffers {
  if (buf && buf.first.length >= rows) {
    buf.rows = rows;
    return buf;
  }
  return createRowBuffers(Math.max(rows, 64));
}

/** Primer índice con depth[i] ≥ d (búsqueda binaria; depth creciente). */
export function lowerBound(depth: ArrayLike<number>, d: number): number {
  let lo = 0;
  let hi = depth.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (depth[mid]! < d) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Muestras visibles [i0, i1) para el tramo [top, base], con una muestra extra a cada lado para que la línea llegue
 * hasta el borde.
 */
export function visibleRange(depth: ArrayLike<number>, top: number, base: number): [number, number] {
  const n = depth.length;
  const i0 = Math.max(0, lowerBound(depth, top) - 1);
  const i1 = Math.min(n, lowerBound(depth, base) + 1);
  return [i0, Math.max(i0, i1)];
}

/** Muestras por fila por encima de este valor → conviene reducir. */
export const DECIMATE_THRESHOLD = 1.5;

/**
 * Límites de fila por índice, compartidos por todas las curvas del cuadro: la fila r tiene las muestras
 * [bounds[r], bounds[r+1]), las de profundidad en [top + r/pxPerM, top + (r+1)/pxPerM). Búsqueda binaria por fila:
 * O(filas · log n), una vez por cuadro.
 */
export function rowBounds(depth: ArrayLike<number>, i0: number, i1: number, top: number, pxPerM: number, rows: number, out?: Int32Array): Int32Array {
  const b = out && out.length >= rows + 1 ? out : new Int32Array(Math.max(rows + 1, 65));
  for (let r = 0; r <= rows; r++) {
    const d = top + r / pxPerM;
    let lo = r === 0 ? i0 : b[r - 1]!;
    let hi = i1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (depth[mid]! < d) lo = mid + 1;
      else hi = mid;
    }
    b[r] = lo;
  }
  return b;
}

/** Muestras por bloque del resumen. */
export const BLOCK = 32;

/** Resumen por bloques de BLOCK muestras: con él, una fila de miles de muestras se reduce en decenas de pasos. */
export interface BlockSummary {
  min: Float32Array;
  max: Float32Array;
  sum: Float64Array;
  /** Muestras con dato (0 = bloque todo NaN). */
  count: Int32Array;
  first: Float32Array;
  last: Float32Array;
}

const summaries = new WeakMap<object, BlockSummary>();

/** Resumen por bloques de un array (en caché por identidad; los arrays son inmutables). */
export function blockSummary(values: Float32Array | Float64Array): BlockSummary {
  let s = summaries.get(values);
  if (s) return s;
  const nb = Math.ceil(values.length / BLOCK);
  s = { min: new Float32Array(nb), max: new Float32Array(nb), sum: new Float64Array(nb), count: new Int32Array(nb), first: new Float32Array(nb), last: new Float32Array(nb) };
  for (let k = 0; k < nb; k++) {
    let lo = Infinity;
    let hi = -Infinity;
    let sum = 0;
    let count = 0;
    let f = NaN;
    let l = NaN;
    const end = Math.min(values.length, (k + 1) * BLOCK);
    for (let i = k * BLOCK; i < end; i++) {
      const v = values[i]!;
      if (v !== v) continue;
      if (count === 0) f = v;
      l = v;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
      sum += v;
      count++;
    }
    s.min[k] = lo;
    s.max[k] = hi;
    s.sum[k] = sum;
    s.count[k] = count;
    s.first[k] = f;
    s.last[k] = l;
  }
  summaries.set(values, s);
  return s;
}

/**
 * Reduce `values` a `rows` filas con límites ya calculados (`rowBounds`). Sin asignar memoria si `out` alcanza.
 * Con `summary` (de `blockSummary(values)`), las filas largas se recorren por bloques enteros: el costo deja de
 * depender del largo del pozo.
 */
export function decimateWithBounds(values: ArrayLike<number>, bounds: Int32Array, rows: number, out?: RowBuffers, summary?: BlockSummary): RowBuffers {
  const b = ensureRowBuffers(out, rows);
  const { first, last, min, max, mean, state } = b;
  let lo = Infinity;
  let hi = -Infinity;
  let sum = 0;
  let count = 0;
  let f = NaN;
  let l = NaN;
  const scan = (s: number, e: number) => {
    for (let i = s; i < e; i++) {
      const v = values[i]!;
      if (v !== v) continue;
      if (count === 0) f = v;
      l = v;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
      sum += v;
      count++;
    }
  };
  for (let r = 0; r < rows; r++) {
    const s = bounds[r]!;
    const e = bounds[r + 1]!;
    if (s >= e) {
      state[r] = ROW_EMPTY;
      continue;
    }
    lo = Infinity;
    hi = -Infinity;
    sum = 0;
    count = 0;
    f = l = NaN;
    if (summary && e - s >= 2 * BLOCK) {
      const k0 = Math.ceil(s / BLOCK);
      const k1 = Math.floor(e / BLOCK);
      scan(s, k0 * BLOCK);
      for (let k = k0; k < k1; k++) {
        const c = summary.count[k]!;
        if (c === 0) continue;
        if (count === 0) f = summary.first[k]!;
        l = summary.last[k]!;
        if (summary.min[k]! < lo) lo = summary.min[k]!;
        if (summary.max[k]! > hi) hi = summary.max[k]!;
        sum += summary.sum[k]!;
        count += c;
      }
      scan(k1 * BLOCK, e);
    } else scan(s, e);
    if (count === 0) {
      state[r] = ROW_GAP;
      continue;
    }
    state[r] = ROW_DATA;
    first[r] = f;
    last[r] = l;
    min[r] = lo;
    max[r] = hi;
    mean[r] = sum / count;
  }
  return b;
}

/**
 * Reduce `values[i0..i1)` a `rows` filas: la fila de la muestra i es la de su profundidad,
 * floor((depth[i] − top) · pxPerM). Las muestras fuera de [0, rows) se ignoran.
 */
export function decimateRows(
  depth: ArrayLike<number>,
  values: ArrayLike<number>,
  i0: number,
  i1: number,
  top: number,
  pxPerM: number,
  rows: number,
  out?: RowBuffers,
): RowBuffers {
  return decimateWithBounds(values, rowBounds(depth, i0, i1, top, pxPerM, rows), rows, out);
}
