/**
 * Viewport del visor: qué tramo de profundidad se ve y a qué escala (docs/decisiones/0005-visor-multipista.md, D5).
 * Puro. Profundidad en metros; píxeles CSS.
 *
 *     y = (prof − top) · pxPerM        prof = top + y / pxPerM
 *
 * Un único viewport para todas las pistas: scroll y zoom quedan sincronizados por construcción.
 */

export interface Viewport {
  /** Profundidad en el borde superior (m). */
  top: number;
  /** Píxeles por metro (zoom). */
  pxPerM: number;
  /** Alto del área de dibujo (px CSS). */
  height: number;
}

export interface ViewportLimits {
  /** Primera y última profundidad del pozo (m). */
  min: number;
  max: number;
  /** Zoom mínimo: el pozo entero en el alto disponible. */
  minPxPerM: number;
  /** Zoom máximo: MAX_PX_PER_SAMPLE píxeles por muestra. */
  maxPxPerM: number;
}

/** Zoom máximo, en píxeles por muestra. */
export const MAX_PX_PER_SAMPLE = 32;

export const baseOf = (vp: Viewport): number => vp.top + vp.height / vp.pxPerM;
export const yOf = (vp: Viewport, depth: number): number => (depth - vp.top) * vp.pxPerM;
export const depthOf = (vp: Viewport, y: number): number => vp.top + y / vp.pxPerM;

/** Límites para un índice de profundidad y un alto de dibujo. `step` = paso de muestreo (null = se estima). */
export function viewportLimits(depth: ArrayLike<number>, height: number, step?: number | null): ViewportLimits {
  const n = depth.length;
  const min = n ? depth[0]! : 0;
  const max = n ? depth[n - 1]! : 1;
  const range = max > min ? max - min : 1;
  const h = Math.max(1, height);
  const minPxPerM = h / range;
  const s = step && step > 0 ? step : n > 1 ? range / (n - 1) : 1;
  return { min, max: max > min ? max : min + 1, minPxPerM, maxPxPerM: Math.max(minPxPerM, MAX_PX_PER_SAMPLE / s) };
}

/** Acota zoom y posición a los límites. Si el pozo entero entra, lo centra. */
export function clampViewport(vp: Viewport, lim: ViewportLimits): Viewport {
  const pxPerM = Math.min(lim.maxPxPerM, Math.max(lim.minPxPerM, vp.pxPerM));
  const span = vp.height / pxPerM;
  const range = lim.max - lim.min;
  let top: number;
  if (span >= range) top = lim.min - (span - range) / 2;
  else top = Math.min(lim.max - span, Math.max(lim.min, vp.top));
  if (top === vp.top && pxPerM === vp.pxPerM) return vp;
  return { top, pxPerM, height: vp.height };
}

/** Todo el pozo a la vista. */
export function fitAll(lim: ViewportLimits, height: number): Viewport {
  return { top: lim.min, pxPerM: lim.minPxPerM, height };
}

/** Muestra el tramo [top, base] (acotado a los límites), centrado. */
export function showRange(lim: ViewportLimits, height: number, top: number, base: number): Viewport {
  const span = Math.max(1e-6, base - top);
  const pxPerM = Math.min(lim.maxPxPerM, Math.max(lim.minPxPerM, height / span));
  const mid = (top + base) / 2;
  return clampViewport({ top: mid - height / pxPerM / 2, pxPerM, height }, lim);
}

/** Zoom por `factor` (> 1 acerca) manteniendo fija la profundidad bajo `anchorY`. */
export function zoomAt(vp: Viewport, factor: number, anchorY: number, lim: ViewportLimits): Viewport {
  const anchor = depthOf(vp, anchorY);
  const pxPerM = Math.min(lim.maxPxPerM, Math.max(lim.minPxPerM, vp.pxPerM * factor));
  return clampViewport({ top: anchor - anchorY / pxPerM, pxPerM, height: vp.height }, lim);
}

/** Desplaza `dy` píxeles (positivo = hacia abajo, más profundo). */
export function scrollBy(vp: Viewport, dy: number, lim: ViewportLimits): Viewport {
  return clampViewport({ ...vp, top: vp.top + dy / vp.pxPerM }, lim);
}

/** Desplaza lo mínimo para que `depth` quede a la vista con `marginPx` de margen. */
export function ensureVisible(vp: Viewport, depth: number, lim: ViewportLimits, marginPx = 24): Viewport {
  const y = yOf(vp, depth);
  const m = Math.min(marginPx, vp.height / 4);
  if (y < m) return scrollBy(vp, y - m, lim);
  if (y > vp.height - m) return scrollBy(vp, y - (vp.height - m), lim);
  return vp;
}

/** Cambio de alto: conserva el tope y el zoom (o el "ver todo" si estaba así). */
export function resizeViewport(vp: Viewport, prev: ViewportLimits, next: ViewportLimits, height: number): Viewport {
  const wasFit = vp.pxPerM <= prev.minPxPerM * 1.0001;
  if (wasFit) return fitAll(next, height);
  return clampViewport({ ...vp, height }, next);
}

/** Escala de impresión 1:N a 96 ppp (1 px CSS = 25,4/96 mm). */
export function scaleRatio(pxPerM: number): number {
  const mmPerPx = 25.4 / 96;
  return 1000 / (pxPerM * mmPerPx);
}
