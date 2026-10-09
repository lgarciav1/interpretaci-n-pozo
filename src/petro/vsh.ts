/**
 * Volumen de arcilla (Vsh) a partir del índice de rayos gamma (IGR).
 *
 * Entrada: IGR adimensional (0–1), típicamente de `gammaRayIndex` (igr.ts). Salida: Vsh en v/v (0–1).
 * Sin dato (NaN) → NaN. Todos los métodos recortan el IGR de entrada a [0, 1] (el IGR es 0–1 por definición;
 * además evita dominios inválidos, p. ej. la raíz de Clavier para IGR > 1,1 o el denominador de Steiber en
 * IGR = 1,5) y recortan el resultado a [0, 1].
 *
 * Ecuaciones (IGR = índice de rayos gamma):
 *   Lineal                          Vsh = IGR
 *   Larionov terciario              Vsh = 0,083 · (2^(3,7·IGR) − 1)     (rocas poco consolidadas / Terciario)
 *   Larionov rocas antiguas         Vsh = 0,33  · (2^(2·IGR) − 1)       (rocas consolidadas / pre-Terciario)
 *   Clavier                         Vsh = 1,7 − √(3,38 − (IGR + 0,7)²)
 *   Steiber                         Vsh = IGR / (3 − 2·IGR)
 *
 * Observaciones:
 *  - Lineal, Clavier y Steiber cumplen Vsh(0) = 0 y Vsh(1) = 1.
 *  - Larionov NO llega a 1 en IGR = 1: terciario da 0,083·(2^3,7 − 1) ≈ 0,9957 y rocas antiguas 0,33·(2^2 − 1) = 0,99.
 *    Es una propiedad de las ecuaciones empíricas originales; no se renormaliza para no apartarse de la bibliografía.
 *  - Orden para un mismo IGR interior: lineal ≥ Larionov antiguo ≥ Clavier ≥ Steiber ≥ Larionov terciario
 *    (el lineal es el más pesimista; p. ej. con IGR = 0,5: 0,5 / 0,33 / 0,307 / 0,25 / 0,216).
 *
 * Referencia: Asquith, G. y Krygowski, D. (2004), "Basic Well Log Analysis", 2ª ed., AAPG Methods in
 * Exploration 16, cap. 4 (ecuaciones de Vsh); Larionov (1969), Clavier et al. (1971), Steiber (1970).
 */

/** Métodos de Vsh disponibles (ids estables, usados por el esquema de parámetros del módulo). */
export const VSH_METHODS = ['linear', 'larionovTertiary', 'larionovOlder', 'clavier', 'steiber'] as const;
export type VshMethod = (typeof VSH_METHODS)[number];

/** Recorta a [0, 1]. Interno. */
function clip01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Vsh lineal: Vsh = IGR. */
export function vshLinear(igr: number): number {
  if (Number.isNaN(igr)) return NaN;
  return clip01(igr);
}

/** Vsh de Larionov para rocas terciarias / poco consolidadas: 0,083·(2^(3,7·IGR) − 1). */
export function vshLarionovTertiary(igr: number): number {
  if (Number.isNaN(igr)) return NaN;
  return clip01(0.083 * (Math.pow(2, 3.7 * clip01(igr)) - 1));
}

/** Vsh de Larionov para rocas antiguas / consolidadas: 0,33·(2^(2·IGR) − 1). */
export function vshLarionovOlder(igr: number): number {
  if (Number.isNaN(igr)) return NaN;
  return clip01(0.33 * (Math.pow(2, 2 * clip01(igr)) - 1));
}

/** Vsh de Clavier: 1,7 − √(3,38 − (IGR + 0,7)²). */
export function vshClavier(igr: number): number {
  if (Number.isNaN(igr)) return NaN;
  const g = clip01(igr);
  const t = g + 0.7;
  return clip01(1.7 - Math.sqrt(3.38 - t * t));
}

/** Vsh de Steiber: IGR / (3 − 2·IGR). */
export function vshSteiber(igr: number): number {
  if (Number.isNaN(igr)) return NaN;
  const g = clip01(igr);
  return clip01(g / (3 - 2 * g));
}

function vshFunction(method: VshMethod): ((igr: number) => number) | undefined {
  switch (method) {
    case 'linear':
      return vshLinear;
    case 'larionovTertiary':
      return vshLarionovTertiary;
    case 'larionovOlder':
      return vshLarionovOlder;
    case 'clavier':
      return vshClavier;
    case 'steiber':
      return vshSteiber;
    default:
      return undefined;
  }
}

/** Vsh por nombre de método. Método desconocido → NaN. */
export function vshFromIgr(igr: number, method: VshMethod): number {
  const f = vshFunction(method);
  return f ? f(igr) : NaN;
}

/**
 * Vsh sobre el tramo [start, end) de `igr`, escrito en `out` (mismo índice).
 * Pensado para llamarse por segmento de zona con el método de esa zona. Método desconocido → NaN en el tramo.
 */
export function vshFromIgrInto(
  igr: ArrayLike<number>,
  out: Float64Array,
  method: VshMethod,
  start = 0,
  end = igr.length,
): Float64Array {
  const f = vshFunction(method);
  for (let i = start; i < end; i++) out[i] = f ? f(igr[i]!) : NaN;
  return out;
}
