/**
 * Agua de formación como solución de NaCl: salinidad equivalente ↔ resistividad ↔ temperatura (calculadora de agua
 * de formación), y Rw a lo largo del pozo.
 *
 * Unidades: salinidad en ppm de NaCl equivalente (mg/kg), resistividad en Ω·m, temperatura en °C (la unidad
 * canónica de la app; internamente Arps trabaja en °F). Sin dato, ≤ 0 o no finito → NaN.
 *
 * Ecuaciones:
 *   Rw a 75 °F (Bateman y Konen 1977)   Rw75 = 0,0123 + 3647,5 / C^0,955              (C en ppm de NaCl)
 *   Inversa                              C = [3647,5 / (Rw75 − 0,0123)]^(1/0,955)       (exige Rw75 > 0,0123 Ω·m)
 *   Temperatura (Arps 1953)              Rw(T) = Rw75 · (75 + 6,77) / (T(°F) + 6,77)    (ver `temperature.ts`)
 *   Temperatura de una solución          T(°F) = Rw75 · (75 + 6,77) / Rw − 6,77          (inversa de Arps)
 *
 * Origen y validez de la correlación:
 *  - La expresión de Bateman y Konen (1977) es un ajuste de la carta Gen-9 de Schlumberger (resistividad de
 *    soluciones de NaCl en función de la concentración y la temperatura, basada en los datos de Arps 1953). Su forma
 *    con la temperatura, Rw = [0,0123 + 3647,5/C^0,955]·82/(1,8·T°C + 39), es la misma que usar Arps con 81,77 ≈ 82.
 *  - Rango: 1 000–250 000 ppm de NaCl. Contra conductividades medidas de NaCl a 25 °C (CRC Handbook; Robinson y
 *    Stokes 1959) el error es ≲ 5 % entre 1 000 y 150 000 ppm; por debajo de 1 000 ppm crece (≈ 9 % a 100 ppm) y por
 *    encima de 150 000 ppm la correlación se aparta de la carta (≈ 12 % a 200 000 ppm). Temperatura: la carta Gen-9
 *    llega a ≈ 200 °C; más allá es extrapolación.
 *  - «NaCl equivalente»: una salmuera real con otras sales (Ca, Mg, SO4…) no tiene la misma resistividad que la
 *    de NaCl de igual salinidad total; para ella se usan los multiplicadores iónicos de la carta Gen-8 (NO
 *    implementados). La salinidad que se obtiene de una Rw medida es la de NaCl equivalente.
 *  - No hay conversión de Rmf desde Rm: queda pendiente (la tabla de Km de Overton y Lipson no se verificó).
 *
 * Referencias: Bateman, R.M. y Konen, C.E. (1977), «The log analyst and the programmable pocket calculator»,
 * The Log Analyst 18(5); Arps, J.J. (1953), Trans. AIME 198; Schlumberger, «Log Interpretation Charts», cartas Gen-9
 * (Rw de NaCl vs. temperatura y salinidad) y Gen-8; Asquith y Krygowski (2004), «Basic Well Log Analysis», AAPG
 * Methods in Exploration 16; Robinson, R.A. y Stokes, R.H. (1959), «Electrolyte Solutions».
 */
import { arpsResistivityC, arpsTemperatureC, fahrenheitToCelsius } from './temperature';

/** Constantes de Bateman y Konen (1977). */
export const BK_CONST = 0.0123;
export const BK_COEF = 3647.5;
export const BK_EXPONENT = 0.955;

/** Temperatura de referencia de la correlación: 75 °F en °C (≈ 23,89). */
export const NACL_REF_TEMP_C = fahrenheitToCelsius(75);

/** Rango de validez de la correlación (ppm de NaCl) y límite de buena concordancia con la carta. */
export const SALINITY_RANGE_PPM = { min: 1_000, accurateMax: 150_000, max: 250_000 } as const;
/** Temperatura por encima de la cual la carta Gen-9 y la corrección de Arps están extrapoladas (°C). */
export const TEMPERATURE_EXTRAPOLATION_C = 200;

const isPositiveFinite = (x: number): boolean => x > 0 && x < Infinity;

/** Rw (Ω·m) de una solución de NaCl de `ppm` a 75 °F: 0,0123 + 3647,5/ppm^0,955. ppm ≤ 0 o no finito → NaN. */
export function naclResistivity75F(ppm: number): number {
  if (!isPositiveFinite(ppm)) return NaN;
  return BK_CONST + BK_COEF / Math.pow(ppm, BK_EXPONENT);
}

/** Salinidad (ppm de NaCl) de una solución cuya resistividad a 75 °F es `rw75`. Exige rw75 > 0,0123 Ω·m. */
export function naclSalinityFrom75F(rw75: number): number {
  if (!isPositiveFinite(rw75) || !(rw75 > BK_CONST)) return NaN;
  return Math.pow(BK_COEF / (rw75 - BK_CONST), 1 / BK_EXPONENT);
}

/** Rw (Ω·m) de una solución de NaCl de `ppm` a la temperatura `tC` (°C): correlación a 75 °F + Arps. */
export function naclResistivityC(ppm: number, tC: number): number {
  return arpsResistivityC(naclResistivity75F(ppm), NACL_REF_TEMP_C, tC);
}

/** Salinidad (ppm de NaCl) de una solución de resistividad `rw` (Ω·m) medida a `tC` (°C). */
export function naclSalinityFromResistivityC(rw: number, tC: number): number {
  return naclSalinityFrom75F(arpsResistivityC(rw, tC, NACL_REF_TEMP_C));
}

/** Temperatura (°C) a la que una solución de NaCl de `ppm` tiene resistividad `rw` (Ω·m). NaN si no existe. */
export function naclTemperatureC(ppm: number, rw: number): number {
  return arpsTemperatureC(naclResistivity75F(ppm), NACL_REF_TEMP_C, rw);
}

/** Avisos de la calculadora: cada código se traduce a un texto en la interfaz. */
export type WaterWarning = 'salinity-low' | 'salinity-high' | 'salinity-accuracy' | 'temperature-high' | 'temperature-low';

/**
 * Avisos de validez: salinidad fuera de 1 000–250 000 ppm (`salinity-low` / `salinity-high`), salinidad en
 * 150 000–250 000 ppm (`salinity-accuracy`: la correlación se aleja de la carta), temperatura > 200 °C
 * (`temperature-high`, extrapolación) o < 0 °C (`temperature-low`, fuera de la carta). Valores NaN no avisan.
 * Los bordes (1 000, 150 000, 250 000 ppm y 0, 200 °C) son válidos, sin aviso.
 */
export function waterWarnings(salinityPpm: number, tempC: number): WaterWarning[] {
  const w: WaterWarning[] = [];
  if (salinityPpm < SALINITY_RANGE_PPM.min) w.push('salinity-low');
  else if (salinityPpm > SALINITY_RANGE_PPM.max) w.push('salinity-high');
  else if (salinityPpm > SALINITY_RANGE_PPM.accurateMax) w.push('salinity-accuracy');
  if (tempC > TEMPERATURE_EXTRAPOLATION_C) w.push('temperature-high');
  else if (tempC < 0) w.push('temperature-low');
  return w;
}

/**
 * Rw a lo largo del pozo: lleva una Rw medida a `tRefC` a la temperatura de cada muestra (Arps). Mismo largo y
 * orden que `tempC`; temperatura NaN → NaN.
 */
export function waterResistivityProfile(rwRef: number, tRefC: number, tempC: ArrayLike<number>): Float64Array {
  const out = new Float64Array(tempC.length);
  for (let i = 0; i < out.length; i++) out[i] = arpsResistivityC(rwRef, tRefC, tempC[i]!);
  return out;
}

/**
 * Valor de una curva a la profundidad `z` por interpolación lineal. `depth` estrictamente creciente. NaN si `z`
 * queda fuera del rango o si alguna de las dos muestras vecinas no tiene dato. En una profundidad exacta devuelve
 * el valor de esa muestra (aunque la vecina no tenga dato).
 */
export function valueAtDepth(depth: ArrayLike<number>, values: ArrayLike<number>, z: number): number {
  const n = Math.min(depth.length, values.length);
  if (n === 0 || !Number.isFinite(z) || z < depth[0]! || z > depth[n - 1]!) return NaN;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (depth[mid]! <= z) lo = mid;
    else hi = mid;
  }
  if (z === depth[lo]!) return values[lo]!;
  if (z === depth[hi]!) return values[hi]!;
  const v0 = values[lo]!;
  const v1 = values[hi]!;
  if (Number.isNaN(v0) || Number.isNaN(v1)) return NaN;
  return v0 + ((v1 - v0) * (z - depth[lo]!)) / (depth[hi]! - depth[lo]!);
}
