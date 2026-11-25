/**
 * Búsqueda del punto bajo el puntero en una nube grande (crossplot libre con decenas de miles de muestras). Pura:
 * una grilla de celdas en px armada una vez por dibujo (O(n)); cada búsqueda mira solo las celdas vecinas.
 */
import type { XYMapping } from './axes';

export interface PointGrid {
  cell: number;
  cols: number;
  rows: number;
  x0: number;
  y0: number;
  /** Posición en px de cada punto (NaN si no se ubica). */
  px: Float32Array;
  py: Float32Array;
  /** Índices de puntos ordenados por celda; `start[c]`…`start[c + 1]` son los de la celda c. */
  start: Int32Array;
  items: Int32Array;
}

export function buildPointGrid(xs: ArrayLike<number>, ys: ArrayLike<number>, m: XYMapping, cell = 16): PointGrid {
  const n = Math.min(xs.length, ys.length);
  const r = m.rect;
  const cols = Math.max(1, Math.ceil(r.width / cell) + 2);
  const rows = Math.max(1, Math.ceil(r.height / cell) + 2);
  const x0 = r.x - cell;
  const y0 = r.y - cell;
  const px = new Float32Array(n);
  const py = new Float32Array(n);
  const cellOf = new Int32Array(n).fill(-1);
  const count = new Int32Array(cols * rows + 1);
  for (let i = 0; i < n; i++) {
    const a = m.x(xs[i]!);
    const b = m.y(ys[i]!);
    px[i] = a;
    py[i] = b;
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const c = Math.floor((a - x0) / cell);
    const rr = Math.floor((b - y0) / cell);
    if (c < 0 || rr < 0 || c >= cols || rr >= rows) continue;
    const k = rr * cols + c;
    cellOf[i] = k;
    count[k + 1]!++;
  }
  for (let k = 1; k < count.length; k++) count[k]! += count[k - 1]!;
  const start = Int32Array.from(count);
  const fill = Int32Array.from(count);
  const items = new Int32Array(start[start.length - 1]!);
  for (let i = 0; i < n; i++) {
    const k = cellOf[i]!;
    if (k >= 0) items[fill[k]!++] = i;
  }
  return { cell, cols, rows, x0, y0, px, py, start, items };
}

/** Punto más cercano a (x, y) dentro de `maxDist` px, o null. Ante empates, el de índice mayor (dibujado encima). */
export function gridNearest(g: PointGrid, x: number, y: number, maxDist: number): { i: number; d: number } | null {
  const c0 = Math.floor((x - maxDist - g.x0) / g.cell);
  const c1 = Math.floor((x + maxDist - g.x0) / g.cell);
  const r0 = Math.floor((y - maxDist - g.y0) / g.cell);
  const r1 = Math.floor((y + maxDist - g.y0) / g.cell);
  let best = -1;
  let bestD = maxDist;
  for (let r = Math.max(0, r0); r <= Math.min(g.rows - 1, r1); r++) {
    for (let c = Math.max(0, c0); c <= Math.min(g.cols - 1, c1); c++) {
      const k = r * g.cols + c;
      for (let t = g.start[k]!; t < g.start[k + 1]!; t++) {
        const i = g.items[t]!;
        const d = Math.hypot(g.px[i]! - x, g.py[i]! - y);
        if (d < bestD || (d === bestD && i > best)) {
          bestD = d;
          best = i;
        }
      }
    }
  }
  return best >= 0 ? { i: best, d: bestD } : null;
}

/**
 * Elige el punto interactivo bajo `(px, py)` entre varias capas. Los marcadores discretos (`!dense`, p. ej. quiebres
 * SMLP o plugs de corona) tienen prioridad dentro de su radio visual para que una nube/curva densa subyacente no robe
 * el clic sobre un marcador visible.
 */
export function pickInteractivePoint(
  layers: readonly { dense?: boolean; radius?: number }[],
  grids: readonly (PointGrid | null)[],
  px: number,
  py: number,
  uiScale = 1,
): { layer: number; i: number } | null {
  let bestMarker: { layer: number; i: number } | null = null;
  let bestMarkerD = Infinity;
  for (let k = 0; k < grids.length; k++) {
    const g = grids[k];
    const l = layers[k];
    if (!g || !l || l.dense) continue;
    const maxD = Math.max(8, (l.radius ?? 4) + 3) * uiScale;
    const hit = gridNearest(g, px, py, Math.min(maxD, bestMarkerD));
    if (hit && hit.d <= bestMarkerD) {
      bestMarkerD = hit.d;
      bestMarker = { layer: k, i: hit.i };
    }
  }
  if (bestMarker) return bestMarker;

  let best: { layer: number; i: number } | null = null;
  let bestD = 8 * uiScale;
  for (let k = 0; k < grids.length; k++) {
    const g = grids[k];
    const l = layers[k];
    if (!g || !l || !l.dense) continue;
    const hit = gridNearest(g, px, py, bestD);
    if (hit && hit.d <= bestD) {
      bestD = hit.d;
      best = { layer: k, i: hit.i };
    }
  }
  return best;
}
