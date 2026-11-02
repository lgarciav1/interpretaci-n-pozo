/**
 * Edición manual de una traza (docs/decisiones/0063). Puro e inmutable: cada operación devuelve una traza NUEVA
 * (arrays copiados), así deshacer/rehacer de la mesa solo guarda referencias.
 *
 * - `paintTrace`: entre dos puntos (p. ej. dos posiciones del puntero al arrastrar, o dos clics de «agregar puntos»)
 *   cada fila recibe la x interpolada linealmente; quedan como observadas con confianza 1 (las marcó la persona).
 * - `eraseTrace`: borra un tramo de filas (NaN: sin dato).
 * Si la edición sale del tramo de la traza, la traza crece (filas nuevas sin dato).
 */
import type { PixelPoint, TracedCurve } from '../../../digitizer';

export function emptyTrace(y0: number, n: number): TracedCurve {
  return {
    y0,
    x: new Float64Array(n).fill(NaN),
    width: new Float64Array(n).fill(NaN),
    confidence: new Float64Array(n),
    observed: new Uint8Array(n),
    warnings: [],
  };
}

/** Copia la traza abarcando al menos las filas [ya, yb] (enteras). */
export function withRows(trace: TracedCurve | null, ya: number, yb: number): TracedCurve {
  const lo = Math.floor(Math.min(ya, yb));
  const hi = Math.ceil(Math.max(ya, yb));
  if (!trace) return emptyTrace(lo, hi - lo + 1);
  const y0 = Math.min(trace.y0, lo);
  const end = Math.max(trace.y0 + trace.x.length - 1, hi);
  const out = emptyTrace(y0, end - y0 + 1);
  const off = trace.y0 - y0;
  out.x.set(trace.x, off);
  out.width.set(trace.width, off);
  out.confidence.set(trace.confidence, off);
  out.observed.set(trace.observed, off);
  out.warnings = [...trace.warnings];
  return out;
}

/** Pinta la traza entre `a` y `b` (filas enteras entre ambos, x interpolada). Un solo punto: esa fila. */
export function paintTrace(trace: TracedCurve | null, a: PixelPoint, b: PixelPoint = a): TracedCurve {
  const out = withRows(trace, a.y, b.y);
  const ya = Math.round(a.y);
  const yb = Math.round(b.y);
  const lo = Math.min(ya, yb);
  const hi = Math.max(ya, yb);
  for (let y = lo; y <= hi; y++) {
    const t = ya === yb ? 0 : (y - ya) / (yb - ya);
    const x = a.x + t * (b.x - a.x);
    const i = y - out.y0;
    out.x[i] = x;
    out.width[i] = 1;
    out.confidence[i] = 1;
    out.observed[i] = 1;
  }
  return out;
}

/** Borra las filas entre `ya` y `yb` (inclusive). Fuera de la traza no hace nada. */
export function eraseTrace(trace: TracedCurve, ya: number, yb: number): TracedCurve {
  const lo = Math.max(trace.y0, Math.round(Math.min(ya, yb)));
  const hi = Math.min(trace.y0 + trace.x.length - 1, Math.round(Math.max(ya, yb)));
  if (hi < lo) return trace;
  const out = withRows(trace, trace.y0, trace.y0 + trace.x.length - 1);
  for (let y = lo; y <= hi; y++) {
    const i = y - out.y0;
    out.x[i] = NaN;
    out.width[i] = NaN;
    out.confidence[i] = 0;
    out.observed[i] = 0;
  }
  return out;
}

/** Filas con dato de la traza. */
export function tracedRows(trace: TracedCurve | null): number {
  if (!trace) return 0;
  let n = 0;
  for (let i = 0; i < trace.x.length; i++) if (!Number.isNaN(trace.x[i]!)) n++;
  return n;
}

/** Primera y última fila con dato (null si no hay). */
export function traceExtent(trace: TracedCurve | null): [number, number] | null {
  if (!trace) return null;
  let a = -1;
  let b = -1;
  for (let i = 0; i < trace.x.length; i++) {
    if (Number.isNaN(trace.x[i]!)) continue;
    if (a < 0) a = i;
    b = i;
  }
  return a < 0 ? null : [trace.y0 + a, trace.y0 + b];
}

/** x de la traza en la fila `y` (NaN si no hay dato). */
export function traceXAt(trace: TracedCurve | null, y: number): number {
  if (!trace) return NaN;
  const i = Math.round(y) - trace.y0;
  return i >= 0 && i < trace.x.length ? trace.x[i]! : NaN;
}

/**
 * Polilíneas de la traza entre las filas [ya, yb], tomando una fila cada `step` (al alejar el zoom no hace falta
 * dibujar cada fila). Cada tramo continuo es una polilínea; los huecos la cortan.
 */
export function tracePolylines(trace: TracedCurve, ya: number, yb: number, step = 1): PixelPoint[][] {
  const out: PixelPoint[][] = [];
  let cur: PixelPoint[] = [];
  const s = Math.max(1, Math.floor(step));
  const i0 = Math.max(0, Math.floor(ya) - trace.y0);
  const i1 = Math.min(trace.x.length - 1, Math.ceil(yb) - trace.y0);
  for (let i = i0; i <= i1; i++) {
    const x = trace.x[i]!;
    if (Number.isNaN(x)) {
      if (cur.length) out.push(cur);
      cur = [];
      continue;
    }
    // Siempre la primera y la última de un tramo; en el medio, una cada `step`.
    const nextNaN = i === i1 || Number.isNaN(trace.x[i + 1]!);
    if (cur.length === 0 || nextNaN || (i - i0) % s === 0) cur.push({ x, y: trace.y0 + i });
  }
  if (cur.length) out.push(cur);
  return out;
}
