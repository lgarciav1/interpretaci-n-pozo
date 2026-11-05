/**
 * Tramas litológicas convencionales para las pilas del visor (pista de litología y mineralogía) en el perfil clásico
 * (docs/decisiones/0067). Puro: mosaicos geométricos en px CSS para `fillPatternRect` (fills.ts), que los cachea.
 *
 * Convención de las columnas litológicas (símbolos de la AAPG/USGS, simplificados para pantalla): arena o arenisca con
 * puntos, arcilla o lutita con rayas horizontales cortas, caliza con ladrillos, dolomía con ladrillos de juntas
 * inclinadas, marga con ladrillos y rayas, creta con ladrillos punteados, anhidrita y sal con cruces, toba con «v» y
 * basamento con cruces en aspa. El carbón va lleno (negro) y los fluidos (agua, hidrocarburo, porosidad) sin trama:
 * su color ya los distingue.
 */
import type { FillId } from '../ui/curves';
import type { TilePattern } from './fills';

export const LITHOLOGY_TILES: Readonly<Partial<Record<FillId, TilePattern>>> = {
  sand: { id: 'lit-sand', width: 9, height: 8, dots: [[2.25, 2, 0.7], [6.75, 6, 0.7]] },
  shale: { id: 'lit-shale', width: 14, height: 6, lines: [[1, 1.5, 8, 1.5], [8, 4.5, 14, 4.5], [0, 4.5, 1, 4.5]], lineWidth: 0.8 },
  limestone: { id: 'lit-limestone', width: 16, height: 10, lines: [[0, 0.5, 16, 0.5], [0, 5.5, 16, 5.5], [0.5, 0.5, 0.5, 5.5], [8.5, 5.5, 8.5, 10]], lineWidth: 0.75 },
  dolomite: { id: 'lit-dolomite', width: 16, height: 10, lines: [[0, 0.5, 16, 0.5], [0, 5.5, 16, 5.5], [2.5, 0.5, 0, 5.5], [18.5, 0.5, 16, 5.5], [10.5, 5.5, 8, 10.5]], lineWidth: 0.75 },
  marl: { id: 'lit-marl', width: 16, height: 10, lines: [[0, 0.5, 16, 0.5], [0.5, 0.5, 0.5, 5.5], [3, 7.5, 13, 7.5]], lineWidth: 0.75 },
  chalk: { id: 'lit-chalk', width: 16, height: 10, lines: [[0, 0.5, 16, 0.5], [0, 5.5, 16, 5.5], [0.5, 0.5, 0.5, 5.5], [8.5, 5.5, 8.5, 10]], dots: [[4.5, 3, 0.55], [12.5, 8, 0.55]], lineWidth: 0.6 },
  anhydrite: { id: 'lit-anhydrite', width: 12, height: 12, lines: [[3, 1, 3, 5], [1, 3, 5, 3], [9, 7, 9, 11], [7, 9, 11, 9]], lineWidth: 0.8 },
  salt: { id: 'lit-salt', width: 12, height: 12, lines: [[1, 1, 5, 5], [5, 1, 1, 5], [7, 7, 11, 11], [11, 7, 7, 11]], lineWidth: 0.8 },
  tuff: { id: 'lit-tuff', width: 12, height: 10, lines: [[2, 2, 4, 6], [4, 6, 6, 2], [8, 6, 10, 10], [10, 10, 12, 6]], lineWidth: 0.75 },
  basement: { id: 'lit-basement', width: 12, height: 12, lines: [[3, 1, 3, 5], [1, 3, 5, 3], [9, 7, 9, 11], [7, 9, 11, 9], [0, 0, 12, 12]], lineWidth: 0.6 },
};

/** Trama de un relleno de pila, o null si va lisa (fluidos, carbón, resto sin partir, rellenos desconocidos). */
export function lithologyTile(fill: string): TilePattern | null {
  return (LITHOLOGY_TILES as Record<string, TilePattern | undefined>)[fill] ?? null;
}

/** Escala (1:N) desde la que la trama se ve entera y desde la que ya no se dibuja. */
export const PATTERN_FULL_SCALE = 1500;
export const PATTERN_HIDDEN_SCALE = 5000;

/**
 * Opacidad de las tramas según el zoom (px CSS por metro, a 96 ppp): 1 hasta 1:1500, 0 desde 1:5000 y una rampa
 * logarítmica entre las dos. A escala de pozo completo una trama de 8–16 px cubriría decenas de metros y ensuciaría la
 * columna; a 1:200 se lee como en un perfil impreso. La rampa evita que aparezca de golpe al hacer zoom.
 */
export function patternOpacity(pxPerM: number): number {
  if (!(pxPerM > 0)) return 0;
  const full = 96 / 0.0254 / PATTERN_FULL_SCALE;
  const hidden = 96 / 0.0254 / PATTERN_HIDDEN_SCALE;
  if (pxPerM >= full) return 1;
  if (pxPerM <= hidden) return 0;
  return (Math.log(pxPerM) - Math.log(hidden)) / (Math.log(full) - Math.log(hidden));
}

/**
 * Desplazamiento vertical (px) del mosaico para que la trama acompañe a la profundidad al desplazar la vista (sin él,
 * la trama queda quieta en la pantalla mientras los datos se mueven). En [0, alto del mosaico).
 */
export function patternPhase(top: number, pxPerM: number, tileHeight: number): number {
  if (!(tileHeight > 0) || !Number.isFinite(top * pxPerM)) return 0;
  const r = -(top * pxPerM) % tileHeight;
  return r < 0 ? r + tileHeight : r + 0; // + 0: sin −0
}
