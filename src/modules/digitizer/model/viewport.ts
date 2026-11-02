/**
 * Vista del lienzo de la mesa (docs/decisiones/0063): conversión pantalla ↔ imagen, zoom alrededor de un punto,
 * encuadre y límites. Puro.
 *
 * Convención del motor: el centro del píxel (i, j) de la imagen está en (i, j), así que el píxel ocupa
 * [i − 0,5, i + 0,5]. En pantalla (px CSS del lienzo): sx = ox + (x + 0,5) · scale.
 */
import type { PixelPoint } from '../../../digitizer';

export interface Viewport {
  /** px de pantalla por px de imagen. */
  scale: number;
  /** Posición en pantalla del borde superior izquierdo de la imagen (x = −0,5, y = −0,5). */
  ox: number;
  oy: number;
}

export const MIN_SCALE = 0.02;
export const MAX_SCALE = 32;

export const clampScale = (s: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));

export function screenToImage(v: Viewport, sx: number, sy: number): PixelPoint {
  return { x: (sx - v.ox) / v.scale - 0.5, y: (sy - v.oy) / v.scale - 0.5 };
}

export function imageToScreen(v: Viewport, x: number, y: number): PixelPoint {
  return { x: v.ox + (x + 0.5) * v.scale, y: v.oy + (y + 0.5) * v.scale };
}

/** Zoom por un factor manteniendo fijo el punto de pantalla (sx, sy). */
export function zoomAt(v: Viewport, factor: number, sx: number, sy: number): Viewport {
  const scale = clampScale(v.scale * factor);
  const k = scale / v.scale;
  return { scale, ox: sx - (sx - v.ox) * k, oy: sy - (sy - v.oy) * k };
}

export function panBy(v: Viewport, dx: number, dy: number): Viewport {
  return { ...v, ox: v.ox + dx, oy: v.oy + dy };
}

/** Encuadra toda la imagen (con margen) centrada. */
export function fitImage(imgW: number, imgH: number, viewW: number, viewH: number, margin = 16): Viewport {
  const scale = clampScale(Math.min((viewW - 2 * margin) / imgW, (viewH - 2 * margin) / imgH));
  return { scale, ox: (viewW - imgW * scale) / 2, oy: (viewH - imgH * scale) / 2 };
}

/** Encuadra el ancho de la imagen (lo habitual en un registro: largo y angosto), arriba de todo. */
export function fitWidth(imgW: number, viewW: number, margin = 16): Viewport {
  const scale = clampScale((viewW - 2 * margin) / imgW);
  return { scale, ox: (viewW - imgW * scale) / 2, oy: margin };
}

/** Centra un punto de la imagen en la vista conservando el zoom. */
export function centerOn(v: Viewport, x: number, y: number, viewW: number, viewH: number): Viewport {
  return { scale: v.scale, ox: viewW / 2 - (x + 0.5) * v.scale, oy: viewH / 2 - (y + 0.5) * v.scale };
}

/**
 * Limita el desplazamiento para que siempre quede a la vista al menos `keep` px de la imagen (no se pierde en
 * el vacío al arrastrar).
 */
export function clampPan(v: Viewport, imgW: number, imgH: number, viewW: number, viewH: number, keep = 48): Viewport {
  const w = imgW * v.scale;
  const h = imgH * v.scale;
  const ox = Math.min(viewW - keep, Math.max(keep - w, v.ox));
  const oy = Math.min(viewH - keep, Math.max(keep - h, v.oy));
  return ox === v.ox && oy === v.oy ? v : { ...v, ox, oy };
}

/** Rango de filas de la imagen visibles en la vista (para dibujar solo lo necesario). */
export function visibleRows(v: Viewport, imgH: number, viewH: number): [number, number] {
  const a = Math.max(0, Math.floor(screenToImage(v, 0, 0).y));
  const b = Math.min(imgH - 1, Math.ceil(screenToImage(v, 0, viewH).y));
  return [a, b];
}

/** Distancia en pantalla entre un punto de la imagen y uno de pantalla (para elegir el más cercano). */
export function screenDistance(v: Viewport, p: PixelPoint, sx: number, sy: number): number {
  const s = imageToScreen(v, p.x, p.y);
  return Math.hypot(s.x - sx, s.y - sy);
}
