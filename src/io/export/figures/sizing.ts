/**
 * Dimensionado de figuras: centímetros, píxeles CSS (96 por pulgada), puntos de PDF, escala vertical 1:N y límites del
 * raster. Puro. docs/decisiones/0012-exportacion-de-figuras.md.
 *
 * La figura se dibuja en píxeles CSS a 96 ppp: así «1:200» es la escala real al imprimirla al 100 % y el texto (11 px)
 * mide lo mismo que en pantalla. El PNG la multiplica por `dpi / 96`; el SVG la deja en px; el PDF la ubica en la página
 * (1 px = 0,75 pt).
 */

export const CSS_DPI = 96;
const INCH_M = 0.0254;

export const cmToPx = (cm: number): number => (cm / 2.54) * CSS_DPI;
export const pxToCm = (px: number): number => (px / CSS_DPI) * 2.54;
export const mmToPt = (mm: number): number => (mm / 25.4) * 72;
export const pxToPt = (px: number): number => (px * 72) / CSS_DPI;
export const ptToPx = (pt: number): number => (pt * CSS_DPI) / 72;

/** Píxeles por metro de profundidad para una escala 1:`denominator` a 96 ppp. */
export const pxPerMeterForScale = (denominator: number): number => CSS_DPI / INCH_M / denominator;
/** Inversa: el N de 1:N para un zoom en px/m. */
export const scaleDenominatorFor = (pxPerM: number): number => CSS_DPI / INCH_M / pxPerM;

/** Escalas verticales que se ofrecen. */
export const VERTICAL_SCALES = [100, 200, 250, 500, 1000, 2000, 5000] as const;
export const DPI_OPTIONS = [150, 300, 600] as const;

/** «1:200», «1:3.500» (se redondea a 2 cifras significativas cuando no es una escala tabulada). */
export function formatScale(denominator: number): string {
  const d = (VERTICAL_SCALES as readonly number[]).includes(denominator) ? denominator : Number(denominator.toPrecision(2));
  return `1:${d.toLocaleString('es-AR')}`;
}

export type PageSize = 'a4';
export type Orientation = 'portrait' | 'landscape';

export const PAGE_SIZES_MM: Readonly<Record<PageSize, { width: number; height: number }>> = { a4: { width: 210, height: 297 } };

/** Página en puntos. */
export function pageSizePt(size: PageSize, orientation: Orientation): { width: number; height: number } {
  const { width, height } = PAGE_SIZES_MM[size];
  const [w, h] = orientation === 'portrait' ? [width, height] : [height, width];
  return { width: mmToPt(w), height: mmToPt(h) };
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Zona útil de la página (puntos) con un margen igual en los cuatro lados, en mm. */
export function pageContentBox(size: PageSize, orientation: Orientation, marginMm: number): Box {
  const p = pageSizePt(size, orientation);
  const m = mmToPt(marginMm);
  return { x: m, y: m, width: Math.max(0, p.width - 2 * m), height: Math.max(0, p.height - 2 * m) };
}

/** Mayor tamaño de w × h que entra en la caja conservando la proporción (no agranda más de `maxZoom`). */
export function fitInto(w: number, h: number, boxW: number, boxH: number, maxZoom = Infinity): { width: number; height: number; zoom: number } {
  if (!(w > 0 && h > 0 && boxW > 0 && boxH > 0)) return { width: 0, height: 0, zoom: 0 };
  const zoom = Math.min(boxW / w, boxH / h, maxZoom);
  return { width: w * zoom, height: h * zoom, zoom };
}

// ── raster ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Límites que aguantan los navegadores de uso general (lado máximo de un canvas y memoria razonable: 4 B por píxel). */
export const RASTER_LIMITS = { maxSide: 16384, maxPixels: 120_000_000 } as const;

export interface RasterSize {
  /** Factor sobre los px CSS. */
  scale: number;
  width: number;
  height: number;
}

export function rasterSize(cssWidth: number, cssHeight: number, dpi: number): RasterSize {
  const scale = dpi / CSS_DPI;
  return { scale, width: Math.max(1, Math.round(cssWidth * scale)), height: Math.max(1, Math.round(cssHeight * scale)) };
}

/** Mensaje en español si el raster no entra en los límites; null si está bien. */
export function rasterLimitProblem(width: number, height: number): string | null {
  if (width > RASTER_LIMITS.maxSide || height > RASTER_LIMITS.maxSide) {
    return `La imagen mediría ${width.toLocaleString('es-AR')} × ${height.toLocaleString('es-AR')} px y el navegador no dibuja más de ${RASTER_LIMITS.maxSide.toLocaleString('es-AR')} px por lado. Bajá la resolución, elegí una escala menor o exportá un tramo más corto (o SVG, que no tiene ese límite).`;
  }
  if (width * height > RASTER_LIMITS.maxPixels) {
    return `La imagen tendría ${Math.round((width * height) / 1e6)} millones de píxeles (el máximo es ${RASTER_LIMITS.maxPixels / 1e6}). Bajá la resolución o exportá un tramo más corto (o SVG).`;
  }
  return null;
}

/** Mayor resolución (ppp) que respeta los límites para una figura de ese tamaño en px CSS; 0 si ni a 96 ppp entra. */
export function maxDpiFor(cssWidth: number, cssHeight: number): number {
  const bySide = RASTER_LIMITS.maxSide / Math.max(cssWidth, cssHeight, 1);
  const byArea = Math.sqrt(RASTER_LIMITS.maxPixels / Math.max(cssWidth * cssHeight, 1));
  const dpi = Math.floor(Math.min(bySide, byArea) * CSS_DPI);
  return dpi >= CSS_DPI ? dpi : 0;
}
