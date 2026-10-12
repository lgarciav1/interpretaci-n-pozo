/**
 * Selección compartida entre el crossplot, el histograma y el visor (fase 8b, docs/decisiones/0021, F). Puro y
 * testeado: lazo (punto en polígono), clases del histograma, tramo del visor → muestras, y de muestras → tramos de
 * profundidad y → puntos de una nube.
 *
 * Una selección es una MÁSCARA sobre las muestras del pozo (1 = seleccionada): no depende de los ejes ni del filtro del
 * gráfico que la creó, así que un lazo en el densidad–neutrón se ve en el Pickett, en el histograma y en el visor.
 */
import { axisFraction, inDataRect, type DataRect, type XYAxis } from './xy/axes';
import { depthRuns, type DepthRun } from './data';

/** Polígono en datos (vértices en orden; se cierra solo). */
export interface DataPolygon {
  x: readonly number[];
  y: readonly number[];
}

/** Forma con la que se eligió en un gráfico x–y: rectángulo o lazo, en datos (sobrevive a un cambio de tamaño). */
export type SelectionShape = { kind: 'rect'; rect: DataRect } | { kind: 'lasso'; poly: DataPolygon };

/**
 * Punto dentro de un polígono (regla par-impar: un rayo horizontal cruza el borde un número impar de veces). Los
 * vértices son `xs[k], ys[k]`; el último se une con el primero. Un lazo que se cruza a sí mismo deja afuera las partes
 * cubiertas dos veces, como en cualquier programa de dibujo.
 */
export function pointInPolygon(px: number, py: number, xs: ArrayLike<number>, ys: ArrayLike<number>): boolean {
  const n = Math.min(xs.length, ys.length);
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const yi = ys[i]!;
    const yj = ys[j]!;
    if (yi > py !== yj > py) {
      const x = xs[j]! + ((py - yj) * (xs[i]! - xs[j]!)) / (yi - yj);
      if (px < x) inside = !inside;
    }
  }
  return inside;
}

/**
 * Índices de los puntos `(x[k], y[k])` dentro de un lazo dado en datos. La comparación se hace en FRACCIONES de eje
 * (`axisFraction`), que es el espacio en que el usuario lo dibujó: vale con ejes log e invertidos. Los puntos que no
 * se pueden ubicar (NaN, ≤ 0 en log) quedan afuera. Prefiltro por la caja del polígono: O(n) + O(n_caja · vértices).
 */
export function pointsInPolygon(poly: DataPolygon, x: ArrayLike<number>, y: ArrayLike<number>, xAxis: XYAxis, yAxis: XYAxis): Int32Array {
  const nv = Math.min(poly.x.length, poly.y.length);
  if (nv < 3) return new Int32Array(0);
  const fx = new Float64Array(nv);
  const fy = new Float64Array(nv);
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let k = 0; k < nv; k++) {
    fx[k] = axisFraction(xAxis, poly.x[k]!);
    fy[k] = axisFraction(yAxis, poly.y[k]!);
    if (!Number.isFinite(fx[k]!) || !Number.isFinite(fy[k]!)) return new Int32Array(0);
    x0 = Math.min(x0, fx[k]!);
    x1 = Math.max(x1, fx[k]!);
    y0 = Math.min(y0, fy[k]!);
    y1 = Math.max(y1, fy[k]!);
  }
  const out: number[] = [];
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    const px = axisFraction(xAxis, x[i]!);
    if (!(px >= x0 && px <= x1)) continue;
    const py = axisFraction(yAxis, y[i]!);
    if (!(py >= y0 && py <= y1)) continue;
    if (pointInPolygon(px, py, fx, fy)) out.push(i);
  }
  return Int32Array.from(out);
}

/** Índices de los puntos dentro de una forma (rectángulo o lazo). */
export function pointsInShape(s: SelectionShape, x: ArrayLike<number>, y: ArrayLike<number>, xAxis: XYAxis, yAxis: XYAxis): Int32Array {
  if (s.kind === 'lasso') return pointsInPolygon(s.poly, x, y, xAxis, yAxis);
  const out: number[] = [];
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) if (inDataRect(s.rect, x[i]!, y[i]!)) out.push(i);
  return Int32Array.from(out);
}

/**
 * Traza del lazo en px, sin vértices redundantes: descarta los que están a menos de `minPx` del último guardado (un
 * arrastre lento deja cientos de eventos casi en el mismo lugar; el costo de `pointsInPolygon` es por vértice).
 */
export function simplifyPath(pts: readonly { x: number; y: number }[], minPx = 2): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= minPx) out.push(p);
  }
  return out;
}

// ── máscaras sobre las muestras del pozo ─────────────────────────────────────────────────────────────────────────

/** Máscara de `n` muestras con 1 en los índices dados (los fuera de rango se ignoran). */
export function maskOf(n: number, samples: ArrayLike<number>): Uint8Array {
  const m = new Uint8Array(n);
  for (let k = 0; k < samples.length; k++) {
    const i = samples[k]!;
    if (i >= 0 && i < n) m[i] = 1;
  }
  return m;
}

/** Máscara de las muestras de una nube: `cloudIdx[k]` es la muestra del punto k; `inside` son puntos de la nube. */
export function maskFromCloud(n: number, cloudIdx: ArrayLike<number>, inside: ArrayLike<number>): Uint8Array {
  const m = new Uint8Array(n);
  for (let k = 0; k < inside.length; k++) {
    const i = cloudIdx[inside[k]!];
    if (i !== undefined && i >= 0 && i < n) m[i] = 1;
  }
  return m;
}

export function maskCount(m: Uint8Array): number {
  let c = 0;
  for (let i = 0; i < m.length; i++) c += m[i]!;
  return c;
}

/** Unión de dos máscaras del mismo largo (Mayús: sumar a la selección). */
export function unionMask(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(Math.max(a.length, b.length));
  for (let i = 0; i < out.length; i++) out[i] = a[i] || b[i] ? 1 : 0;
  return out;
}

/**
 * Muestras de un tramo de profundidad del visor (top ≤ d ≤ base, depth creciente). Un tramo dado al revés se ordena.
 * Bisección: O(log n) para ubicarlo.
 */
export function intervalSamples(depth: ArrayLike<number>, top: number, base: number): { start: number; end: number } {
  const [a, b] = top <= base ? [top, base] : [base, top];
  const lower = (v: number) => {
    let lo = 0;
    let hi = depth.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (depth[mid]! < v) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const upper = (v: number) => {
    let lo = 0;
    let hi = depth.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (depth[mid]! <= v) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  return { start: lower(a), end: upper(b) };
}

/** Máscara del tramo del visor. */
export function intervalMask(depth: ArrayLike<number>, top: number, base: number): Uint8Array {
  const m = new Uint8Array(depth.length);
  const { start, end } = intervalSamples(depth, top, base);
  m.fill(1, start, end);
  return m;
}

/**
 * Muestras de unas clases del histograma: valor en [borde j, borde j+1) —la última clase incluye su borde derecho,
 * igual que el conteo y que la clase bajo el puntero— y dentro del filtro de zonas del gráfico.
 */
export function binsMask(data: ArrayLike<number>, edges: ArrayLike<number>, bins: readonly number[], include: (i: number) => boolean = () => true): Uint8Array {
  const m = new Uint8Array(data.length);
  const last = edges.length - 2;
  const ranges = bins.filter((j) => j >= 0 && j <= last).map((j) => [edges[j]!, edges[j + 1]!, j === last] as const);
  if (ranges.length === 0) return m;
  for (let i = 0; i < data.length; i++) {
    const v = data[i]!;
    if (!Number.isFinite(v) || !include(i)) continue;
    for (const [lo, hi, closed] of ranges) {
      if (v >= lo && (closed ? v <= hi : v < hi)) {
        m[i] = 1;
        break;
      }
    }
  }
  return m;
}

/** Agrega la clase si no estaba o la quita si estaba (Mayús + clic). Ordenadas. */
export function toggleBin(bins: readonly number[], j: number): number[] {
  return bins.includes(j) ? bins.filter((b) => b !== j) : [...bins, j].sort((a, b) => a - b);
}

/** Tramos de profundidad de la selección para el visor (huecos de una muestra unidos, como el rectángulo de la 7a). */
export function maskRuns(depth: ArrayLike<number>, mask: Uint8Array): DepthRun[] {
  return depthRuns(depth, (i) => mask[i] === 1, 1);
}

/** Máscara POR PUNTO de una nube (`cloudIdx[k]` = muestra del punto k): qué puntos del gráfico resaltar. */
export function cloudMask(mask: Uint8Array, cloudIdx: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(cloudIdx.length);
  for (let k = 0; k < cloudIdx.length; k++) out[k] = mask[cloudIdx[k]!] ?? 0;
  return out;
}

/** Bordes iguales (la selección por clases se refiere a otro binning si cambiaron). */
export function sameEdges(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i]! - b[i]!) > 1e-12 * Math.max(1, Math.abs(a[i]!))) return false;
  return true;
}
