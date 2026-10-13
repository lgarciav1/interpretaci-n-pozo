/** Tramas repetibles y geometría de la columna; pantalla y figuras usan el mismo dibujo. */
import { fillPatternRect, type TilePattern } from '../../viewer/fills';
import type { ThemeTokens } from '../../ui/tokens';
import { fillColor, type FillId } from '../../ui/curves';
import { mix } from '../../ui/color';
import type { SedLayer, SedLithology } from '../../petro/sedColumn';

export const LITHOLOGIES: readonly SedLithology[] = ['sandstone', 'siltstone', 'shale', 'limestone', 'dolomite', 'anhydrite', 'coal', 'unknown'];
export const LITHOLOGY_LABEL: Readonly<Record<SedLithology, string>> = {
  sandstone: 'Arenisca', siltstone: 'Limolita', shale: 'Lutita', limestone: 'Caliza',
  dolomite: 'Dolomía', anhydrite: 'Anhidrita', coal: 'Carbón', unknown: 'Sin interpretación',
};
const FILLS: Readonly<Record<SedLithology, FillId>> = {
  sandstone: 'sand', siltstone: 'shale', shale: 'shale', limestone: 'limestone',
  dolomite: 'dolomite', anhydrite: 'anhydrite', coal: 'coal', unknown: 'undivided',
};

// Fuente cotejada: FGDC/USGS, sección 37, láminas A–37–1 y A–37–2:
// https://ngmdb.usgs.gov/fgdc_gds/geolsymstd/fgdc-geolsym-sec37.pdf
// Mosaicos simplificados para el visor: arenisca607, limolita616, lutita620,
// caliza627, dolomía642 y carbón658; conservan los motivos, no el arte exacto del estándar.
// SIN VERIFICAR: la trama de anhidrita es propia; sección37 no enumera anhidrita (667 es yeso).
// Sin interpretación: rayado neutro propio del visor, sin asignación FGDC.
export const PATTERN_REFERENCE: Readonly<Record<SedLithology, string>> = {
  sandstone: 'FGDC 607', siltstone: 'FGDC 616', shale: 'FGDC 620', limestone: 'FGDC 627',
  dolomite: 'FGDC 642', coal: 'FGDC 658', anhydrite: 'SIN VERIFICAR', unknown: 'Sin dato',
};
export const LITHOLOGY_PATTERNS: Readonly<Record<SedLithology, TilePattern>> = {
  sandstone: { id: 'sed-sandstone', width: 12, height: 10, dots: [[3, 3, .7], [9, 8, .7]] },
  siltstone: { id: 'sed-siltstone', width: 12, height: 10, dots: [[3, 3, .65]], lines: [[7, 8, 11, 8]] },
  shale: { id: 'sed-shale', width: 12, height: 8, lines: [[1, 2, 7, 2], [6, 6, 11, 6]] },
  // Bordes opuestos duplicados: el rasterizado conserva el ancho completo del trazo entre mosaicos.
  limestone: { id: 'sed-limestone', width: 16, height: 12, lines: [[0, 0, 16, 0], [0, 6, 16, 6], [0, 12, 16, 12], [0, 0, 0, 6], [16, 0, 16, 6], [8, 6, 8, 12]] },
  dolomite: { id: 'sed-dolomite', width: 16, height: 12, lines: [[0, 0, 16, 0], [0, 6, 16, 6], [0, 12, 16, 12], [3, 0, 0, 6], [19, 0, 16, 6], [11, 6, 8, 12]] },
  anhydrite: { id: 'sed-anhydrite', width: 12, height: 12, lines: [[3, 1, 3, 5], [1, 3, 5, 3], [9, 7, 9, 11], [7, 9, 11, 9]] },
  coal: { id: 'sed-coal', width: 8, height: 8 },
  unknown: { id: 'sed-unknown', width: 12, height: 12, lines: [[0, 12, 12, 0]] },
};

export function lithologyPaint(lithology: SedLithology, theme: ThemeTokens): { background: string; stroke: string } {
  if (lithology === 'coal') return { background: '#08090b', stroke: theme.color.textMuted };
  const color = fillColor(FILLS[lithology], theme.name).color;
  return { background: mix(theme.viewer.trackBg, color, theme.name === 'dark' ? .53 : .62), stroke: mix(theme.viewer.trackBg, theme.color.text, theme.name === 'dark' ? .62 : .66) };
}

/** Las siete clases ocupan posiciones ordinales, no una escala cuantitativa de diámetro. */
export function layerRight(x: number, width: number, normalized: number): number {
  return x + width * (.09 + .66 * Math.max(0, Math.min(1, normalized)));
}

export function drawLayer(
  ctx: CanvasRenderingContext2D, layer: SedLayer, box: { x: number; y: number; width: number; height: number }, theme: ThemeTokens,
): void {
  const paint = lithologyPaint(layer.lithology, theme);
  fillPatternRect(ctx, box, LITHOLOGY_PATTERNS[layer.lithology], paint.background, paint.stroke);
}
