/**
 * Minimapa del visor (fase 4b): el pozo entero en una columna angosta, con una curva resumen y las zonas, y el
 * rectángulo de la ventana visible. Puro: elección de la curva, perfil por fila y geometría de la ventana.
 */
import type { ResolvedCurve, ResolvedTrack } from './resolve';
import { lowerBound } from './decimate';

/** Curva resumen: GR (la calculada activa o la medida), si no la primera curva de línea que haya. */
export function pickMinimapCurve(tracks: readonly ResolvedTrack[]): ResolvedCurve | null {
  const lines = tracks.flatMap((t) => (t.kind === 'curves' ? t.curves.filter((c) => c.kind === 'line' && !c.alternative) : []));
  return lines.find((c) => c.role === 'GR') ?? lines[0] ?? null;
}

/** Mínimo y máximo de la fracción (0–1, acotada) por fila; NaN = fila sin dato. */
export function minimapRows(depth: ArrayLike<number>, frac: ArrayLike<number>, rows: number): { min: Float32Array; max: Float32Array } {
  const min = new Float32Array(rows).fill(NaN);
  const max = new Float32Array(rows).fill(NaN);
  const n = depth.length;
  if (n === 0 || rows <= 0) return { min, max };
  const d0 = depth[0]!;
  const span = depth[n - 1]! - d0 || 1;
  for (let r = 0; r < rows; r++) {
    const i0 = lowerBound(depth, d0 + (span * r) / rows);
    const i1 = r === rows - 1 ? n : lowerBound(depth, d0 + (span * (r + 1)) / rows);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = i0; i < Math.max(i1, i0 + 1) && i < n; i++) {
      const v = frac[i]!;
      if (v !== v) continue;
      const c = v < 0 ? 0 : v > 1 ? 1 : v;
      if (c < lo) lo = c;
      if (c > hi) hi = c;
    }
    if (lo <= hi) {
      min[r] = lo;
      max[r] = hi;
    }
  }
  return { min, max };
}

export interface MinimapScale {
  /** Primera y última profundidad del pozo. */
  min: number;
  max: number;
  /** Alto del minimapa (px). */
  height: number;
}

export const minimapY = (s: MinimapScale, depth: number): number => ((depth - s.min) / (s.max - s.min || 1)) * s.height;
export const minimapDepth = (s: MinimapScale, y: number): number => s.min + (y / (s.height || 1)) * (s.max - s.min);

/** Alto mínimo del rectángulo (px): a mucho zoom la ventana sigue siendo agarrable. */
export const MIN_WINDOW_PX = 8;

/** Rectángulo de la ventana visible [top, base] en px del minimapa, con alto mínimo y dentro del minimapa. */
export function windowRect(s: MinimapScale, top: number, base: number): { y: number; h: number } {
  const y0 = minimapY(s, Math.max(s.min, top));
  const y1 = minimapY(s, Math.min(s.max, base));
  const h = Math.max(MIN_WINDOW_PX, y1 - y0);
  const y = Math.min(Math.max(0, (y0 + y1) / 2 - h / 2), Math.max(0, s.height - h));
  return { y, h };
}

/** Tope del viewport para que la ventana quede centrada en la profundidad bajo `y`. */
export function topForCenter(s: MinimapScale, y: number, span: number): number {
  return minimapDepth(s, y) - span / 2;
}
