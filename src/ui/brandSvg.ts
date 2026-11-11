/**
 * Geometría de la marca de fiubaLog (docs/decisiones/0070-marca.md), pura y sin DOM: la usan el componente
 * `BrandMark` y los documentos que se arman como texto (informe). viewBox 0 0 64 64.
 */
import { BASE_TOKENS } from './tokens';

/** Nombre del producto. */
export const PRODUCT_NAME = 'fiubaLog';

/** Traza compacta: pocos quiebres, esquinas redondeadas (se lee a 16 px). */
export const BRAND_TRACE_COMPACT =
  'M37 0 L37.4 10.4 Q37.5 13 34.97 13.61 L25.53 15.89 Q23 16.5 22.85 19.1 L22.65 22.4 Q22.5 25 25.05 25.51 L37.45 27.99 Q40 28.5 40 31.1 L40 33.4 Q40 36 37.48 36.66 L31.02 38.34 Q28.5 39 31 39.73 L38 41.77 Q40.5 42.5 38.46 44.11 L23.54 55.89 Q21.5 57.5 21.7 60.09 L22 64';

/** Traza detallada: arcilla, arena en bloque, arcilla, arena delgada y embudo granocreciente. */
export const BRAND_TRACE_DETAIL =
  'M37 0 L37.37 4.41 Q37.5 6 37 7.5 Q36.5 9 37.52 10.23 L37.98 10.77 Q39 12 38.25 13.25 Q37.5 14.5 35.92 14.73 L25.58 16.27 Q24 16.5 23 17.75 Q22 19 22.72 20.43 L22.78 20.57 Q23.5 22 22.61 23.33 L22.39 23.67 Q21.5 25 22.96 25.65 L24.54 26.35 Q26 27 27.59 27.17 L38.41 28.33 Q40 28.5 40.5 30 Q41 31.5 39.87 32.63 L39.63 32.87 Q38.5 34 39.5 35.25 Q40.5 36.5 38.92 36.75 L29.58 38.25 Q28 38.5 28.75 39.5 Q29.5 40.5 31.09 40.71 L39.41 41.79 Q41 42 40.11 43.33 L39.89 43.67 Q39 45 37.63 45.82 L22.87 55.13 Q21 57 21.23 58.58 L22 64';

/** Cierra la traza por la derecha: el área del relleno térmico. */
export const brandFillOf = (trace: string) => `${trace} L64 64 L64 0 Z`;

/** Estratos: contactos suavemente inclinados que cruzan el cuadro. */
export const BRAND_STRATA = ['M0 15.5 C18 14 40 17 64 15', 'M0 27.5 C20 26 42 29.5 64 27', 'M0 37.5 C18 36 44 39.5 64 37', 'M0 47 C16 45.5 44 49 64 46'];

/** Grilla de papel de perfil (sobre la tinta): verticales cada 5, horizontales cada 4 (más marcada cada 5). */
export const BRAND_GRID_V = [5, 10, 15, 20, 25, 30];
export const BRAND_GRID_H = Array.from({ length: 16 }, (_, i) => 2 + i * 4);

/** Paradas del gradiente térmico (frío arriba, caliente en profundidad). */
export const BRAND_HEAT_STOPS: readonly (readonly [number, string])[] = [
  [0, BASE_TOKENS.brand.thermal1],
  [0.42, BASE_TOKENS.brand.thermal2],
  [0.75, BASE_TOKENS.brand.thermal3],
  [1, BASE_TOKENS.brand.thermal4],
];

/** Grosor de la traza según la versión y el tamaño en px. */
export function brandStroke(full: boolean, size: number): number {
  return full ? (size >= 96 ? 1.8 : 2.2) : size <= 18 ? 4.2 : 3.4;
}

/**
 * La marca como texto SVG autocontenido (sin filtros: imprime igual en cualquier navegador). `idPrefix` separa los
 * ids de gradientes si hay varias marcas en el mismo documento.
 */
export function brandMarkSvg({ size = 48, detail, idPrefix = 'fl', title }: { size?: number; detail?: 'compact' | 'full'; idPrefix?: string; title?: string } = {}): string {
  const full = (detail ?? (size >= 40 ? 'full' : 'compact')) === 'full';
  const trace = full ? BRAND_TRACE_DETAIL : BRAND_TRACE_COMPACT;
  const id = (k: string) => `${idPrefix}-${k}`;
  const B = BASE_TOKENS.brand;
  const a11y = title ? `role="img" aria-label="${title.replace(/[&<>"]/g, '')}"` : 'aria-hidden="true"';
  const grid = full
    ? `<g stroke="#fff" stroke-width="0.45">${BRAND_GRID_V.map((x) => `<path d="M${x} 0V64" stroke-opacity="${x % 10 === 0 ? 0.11 : 0.06}"/>`).join('')}${BRAND_GRID_H.map((y, i) => `<path d="M0 ${y}H64" stroke-opacity="${i % 5 === 0 ? 0.11 : 0.05}"/>`).join('')}</g>`
    : '';
  const strata = (full ? BRAND_STRATA : BRAND_STRATA.slice(1, 3)).map((d) => `<path d="${d}"/>`).join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64" ${a11y}><defs>` +
    `<linearGradient id="${id('ink')}" x1="0" y1="0" x2="0.6" y2="1"><stop offset="0" stop-color="${B.ink}"/><stop offset="1" stop-color="${B.inkDeep}"/></linearGradient>` +
    `<linearGradient id="${id('heat')}" x1="0" y1="0" x2="0" y2="1">${BRAND_HEAT_STOPS.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')}</linearGradient>` +
    `<clipPath id="${id('tile')}"><rect width="64" height="64" rx="15"/></clipPath></defs>` +
    `<g clip-path="url(#${id('tile')})"><rect width="64" height="64" fill="url(#${id('ink')})"/>${grid}` +
    `<g fill="none" stroke="#fff" stroke-opacity="${full ? 0.12 : 0.1}" stroke-width="0.8">${strata}</g>` +
    `<path d="${brandFillOf(trace)}" fill="url(#${id('heat')})"/>` +
    `<path d="${trace}" fill="none" stroke="#fff" stroke-width="${brandStroke(full, size)}" stroke-linecap="round" stroke-linejoin="round"/></g></svg>`
  );
}
