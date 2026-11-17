/**
 * Saturación de agua (Archie, Simandoux, Indonesia), BVW, saturación de hidrocarburos y resistividad mojada (R0).
 *
 * Unidades: resistividades (Rt, Rw, Rsh, R0) en Ω·m; φ, Vsh, Sw, BVW y Sh en v/v (fracción, NO %). Rw a temperatura de
 * formación. Sin dato (NaN) → NaN. Parámetros degenerados → NaN: Rt ≤ 0, Rw ≤ 0, φ ≤ 0, a ≤ 0, m ≤ 0, n ≤ 0, o
 * Rsh ≤ 0 cuando Vsh > 0 (con Vsh = 0 Rsh no interviene y se ignora). Valores no finitos (±Infinity) → NaN.
 * Vsh se recorta a [0, 1] antes de calcular; la Sw resultante se recorta a [0, 1] (el recorte oculta valores no
 * físicos, p. ej. Sw > 1 por Rt demasiado bajo para la porosidad; no los corrige). φ no se recorta: se espera ya
 * limitada a su rango físico (0–0,5) por el módulo de porosidad.
 *
 * Ecuaciones (Sw = saturación de agua; φ porosidad; a, m, n parámetros de Archie):
 *   Archie       Sw = ( a·Rw / (φ^m · Rt) )^(1/n)
 *   Simandoux    Sw = (a·Rw / (2·φ^m)) · [ √( (Vsh/Rsh)² + 4·φ^m / (a·Rw·Rt) ) − Vsh/Rsh ]          (n = 2)
 *                Solución positiva de   1/Rt = φ^m·Sw² / (a·Rw) + Vsh·Sw / Rsh.
 *   Indonesia    1/√Rt = [ Vsh^(1 − Vsh/2) / √Rsh + φ^(m/2) / √(a·Rw) ] · Sw^(n/2)
 *                → Sw = { (1/√Rt) / [ Vsh^(1 − Vsh/2)/√Rsh + φ^(m/2)/√(a·Rw) ] }^(2/n)       (Poupon y Leveaux)
 *   BVW          BVW = φ · Sw
 *   Hidrocarb.   Sh = 1 − Sw
 *   R0 (mojada)  R0 = a·Rw / φ^m                 resistividad de la roca con Sw = 1 (Archie con Sw = 1)
 *
 * Notas:
 *  - R0 y Archie son la misma ley: Sw = (R0/Rt)^(1/n), es decir Rt = R0 / Sw^n. Donde Rt = R0, Sw = 1 (agua); donde
 *    Rt > R0 hay menos agua que poros y, de ser una arena limpia, hidrocarburo (quick-look de Archie, Asquith y
 *    Krygowski cap. 5: la separación Rt − R0 sobre la curva de R0 señala el hidrocarburo). R0 NO se recorta: crece
 *    sin cota cuando φ → 0 (la pista de resistividad la acota con su escala, 0,2–2000 Ω·m).
 *  - Simandoux con a = 0,81 y m = 2 reproduce, a menos de redondeo, la forma que presentan Asquith y Krygowski:
 *    Sw = (0,4·Rw/φ²)·[ √((Vsh/Rsh)² + 5·φ²/(Rw·Rt)) − Vsh/Rsh ], porque a/2 = 0,405 ≈ 0,4 y 4/a = 4,94 ≈ 5
 *    (diferencia numérica < 1 % en casos típicos). Con a = 1 y m = 2 es la forma "clásica" 0,5/4.
 *    Numéricamente se evalúa la forma equivalente estable  Sw = 2 / ( Rt · [ b + √(b² + 4·A/Rt) ] ),
 *    con A = φ^m/(a·Rw) y b = Vsh/Rsh, que evita la cancelación de la forma de libro cuando b es grande.
 *  - Con Vsh = 0, Simandoux (n = 2) e Indonesia (cualquier n) se reducen a Archie con el mismo n (Simandoux solo
 *    con n = 2). Indonesia con Vsh = 0 usa 0^1 = 0.
 *  - Con Vsh > 0 la arcilla aporta conductividad adicional, por lo que, para el mismo Rt, el agua necesaria para
 *    explicar la conductividad medida es MENOR: Sw(Simandoux) ≤ Sw(Archie, n = 2) y Sw(Indonesia) ≤ Sw(Archie)
 *    (Archie sobreestima Sw en arenas arcillosas). Se deduce de las ecuaciones: el término de arcilla es no
 *    negativo, así que el término de agua necesario para igualar la misma conductividad es menor; se verifica
 *    numéricamente en los tests. NO vale la desigualdad inversa (Sw ≥ Archie).
 *  - Sw decrece al subir Rt, con φ, Rw y demás parámetros fijos, en las tres ecuaciones.
 *
 * Referencias: Archie, G.E. (1942), Trans. AIME 146; Simandoux, P. (1963), Revue de l'Institut Français du Pétrole
 * (supl.); Poupon, A. y Leveaux, J. (1971), "Evaluation of water
 * saturation in shaly formations", The Log Analyst 12(4) (ecuación de Indonesia); Asquith y Krygowski (2004),
 * "Basic Well Log Analysis", AAPG Methods in Exploration 16 (Archie, Simandoux, Indonesia).
 */

import { clipPorosity } from './porosity';

/** Recorta a [0, 1]. Interno. */
function clip01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** x > 0 y finito (descarta NaN, ≤ 0 e Infinity). Interno. */
function isPositiveFinite(x: number): boolean {
  return x > 0 && x < Infinity;
}

// ---------------------------------------------------------------------------------------------------------------
// Archie
// ---------------------------------------------------------------------------------------------------------------

/**
 * Saturación de agua de Archie: Sw = (a·Rw / (φ^m · Rt))^(1/n), recortada a [0, 1].
 * @param rt  resistividad verdadera (Ω·m), > 0
 * @param phi porosidad (v/v), > 0
 * @param rw  resistividad del agua de formación (Ω·m), > 0
 * @param a   factor de tortuosidad (> 0)
 * @param m   exponente de cementación (> 0)
 * @param n   exponente de saturación (> 0)
 */
export function archieSw(rt: number, phi: number, rw: number, a: number, m: number, n: number): number {
  if (
    !isPositiveFinite(rt) ||
    !isPositiveFinite(phi) ||
    !isPositiveFinite(rw) ||
    !isPositiveFinite(a) ||
    !isPositiveFinite(m) ||
    !isPositiveFinite(n)
  ) {
    return NaN;
  }
  return clip01(Math.pow((a * rw) / (Math.pow(phi, m) * rt), 1 / n));
}

/**
 * Resistividad mojada (R0): la que tendría la roca con 100 % de agua, R0 = a·Rw / φ^m (Archie con Sw = 1). Contra Rt
 * en la pista de resistividad: Rt > R0 marca hidrocarburo (Sw = (R0/Rt)^(1/n), ver `archieSw`). Sin recortar.
 * @param phi porosidad (v/v), > 0
 * @param rw  resistividad del agua de formación (Ω·m), > 0
 * @param a   factor de tortuosidad (> 0)
 * @param m   exponente de cementación (> 0)
 * Referencias: Archie (1942), Trans. AIME 146; Asquith y Krygowski (2004), Basic Well Log Analysis, cap. 5.
 */
export function wetResistivity(phi: number, rw: number, a: number, m: number): number {
  if (!isPositiveFinite(phi) || !isPositiveFinite(rw) || !isPositiveFinite(a) || !isPositiveFinite(m)) return NaN;
  const r0 = (a * rw) / Math.pow(phi, m);
  return isPositiveFinite(r0) ? r0 : NaN; // φ muy chica desborda a Infinity: sin valor, no un número que la escala no puede dibujar
}

/** Variante por tramo [start, end) de `rt`, escrita en `out` (mismo índice). */
export function archieSwInto(
  rt: ArrayLike<number>,
  phi: ArrayLike<number>,
  out: Float64Array,
  rw: number,
  a: number,
  m: number,
  n: number,
  start = 0,
  end = rt.length,
): Float64Array {
  for (let i = start; i < end; i++) out[i] = archieSw(rt[i]!, phi[i]!, rw, a, m, n);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Simandoux
// ---------------------------------------------------------------------------------------------------------------

/**
 * Saturación de agua de Simandoux (n = 2): Sw = (a·Rw/(2·φ^m))·[√((Vsh/Rsh)² + 4·φ^m/(a·Rw·Rt)) − Vsh/Rsh],
 * recortada a [0, 1]. Con a = 0,81 y m = 2 equivale a la forma 0,4/5 de Asquith y Krygowski; con Vsh = 0 es Archie (n = 2).
 * @param rt  resistividad verdadera (Ω·m), > 0
 * @param phi porosidad (v/v), > 0
 * @param vsh volumen de arcilla (v/v); se recorta a [0, 1]
 * @param rw  resistividad del agua de formación (Ω·m), > 0
 * @param rsh resistividad de la lutita (Ω·m), > 0 si Vsh > 0 (se ignora con Vsh = 0)
 * @param a   factor de tortuosidad (> 0)
 * @param m   exponente de cementación (> 0)
 */
export function simandouxSw(
  rt: number,
  phi: number,
  vsh: number,
  rw: number,
  rsh: number,
  a: number,
  m: number,
): number {
  if (
    !isPositiveFinite(rt) ||
    !isPositiveFinite(phi) ||
    !Number.isFinite(vsh) ||
    !isPositiveFinite(rw) ||
    !isPositiveFinite(a) ||
    !isPositiveFinite(m)
  ) {
    return NaN;
  }
  const v = clip01(vsh);
  let b = 0;
  if (v > 0) {
    if (!isPositiveFinite(rsh)) return NaN;
    b = v / rsh;
  }
  const big = Math.pow(phi, m) / (a * rw); // A = φ^m / (a·Rw)
  return clip01(2 / (rt * (b + Math.sqrt(b * b + (4 * big) / rt))));
}

/** Variante por tramo [start, end) de `rt`, escrita en `out` (mismo índice). */
export function simandouxSwInto(
  rt: ArrayLike<number>,
  phi: ArrayLike<number>,
  vsh: ArrayLike<number>,
  out: Float64Array,
  rw: number,
  rsh: number,
  a: number,
  m: number,
  start = 0,
  end = rt.length,
): Float64Array {
  for (let i = start; i < end; i++) out[i] = simandouxSw(rt[i]!, phi[i]!, vsh[i]!, rw, rsh, a, m);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Indonesia
// ---------------------------------------------------------------------------------------------------------------

/**
 * Saturación de agua de Indonesia (Poupon–Leveaux):
 *   Sw = { (1/√Rt) / [ Vsh^(1 − Vsh/2)/√Rsh + φ^(m/2)/√(a·Rw) ] }^(2/n), recortada a [0, 1].
 * Con Vsh = 0 es Archie con el mismo n. Mismos parámetros que `simandouxSw` más el exponente de saturación `n`.
 * @param n exponente de saturación (> 0)
 */
export function indonesiaSw(
  rt: number,
  phi: number,
  vsh: number,
  rw: number,
  rsh: number,
  a: number,
  m: number,
  n: number,
): number {
  if (
    !isPositiveFinite(rt) ||
    !isPositiveFinite(phi) ||
    !Number.isFinite(vsh) ||
    !isPositiveFinite(rw) ||
    !isPositiveFinite(a) ||
    !isPositiveFinite(m) ||
    !isPositiveFinite(n)
  ) {
    return NaN;
  }
  const v = clip01(vsh);
  let shaleTerm = 0;
  if (v > 0) {
    if (!isPositiveFinite(rsh)) return NaN;
    shaleTerm = Math.pow(v, 1 - v / 2) / Math.sqrt(rsh);
  }
  const denom = shaleTerm + Math.pow(phi, m / 2) / Math.sqrt(a * rw);
  return clip01(Math.pow(1 / Math.sqrt(rt) / denom, 2 / n));
}

/** Variante por tramo [start, end) de `rt`, escrita en `out` (mismo índice). */
export function indonesiaSwInto(
  rt: ArrayLike<number>,
  phi: ArrayLike<number>,
  vsh: ArrayLike<number>,
  out: Float64Array,
  rw: number,
  rsh: number,
  a: number,
  m: number,
  n: number,
  start = 0,
  end = rt.length,
): Float64Array {
  for (let i = start; i < end; i++) out[i] = indonesiaSw(rt[i]!, phi[i]!, vsh[i]!, rw, rsh, a, m, n);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// BVW y saturación de hidrocarburos
// ---------------------------------------------------------------------------------------------------------------

/**
 * Volumen de agua a granel: BVW = φ · Sw (v/v). φ se recorta a [0, 0,5] y Sw a [0, 1]; NaN se propaga.
 * Es constante en una zona a saturación irreducible (criterio de Buckles).
 */
export function bulkVolumeWater(phi: number, sw: number): number {
  if (!Number.isFinite(phi) || !Number.isFinite(sw)) return NaN;
  return clipPorosity(phi) * clip01(sw);
}

/** Variante por tramo [start, end) de `phi`, escrita en `out` (mismo índice). */
export function bulkVolumeWaterInto(
  phi: ArrayLike<number>,
  sw: ArrayLike<number>,
  out: Float64Array,
  start = 0,
  end = phi.length,
): Float64Array {
  for (let i = start; i < end; i++) out[i] = bulkVolumeWater(phi[i]!, sw[i]!);
  return out;
}

/** Saturación de hidrocarburos Sh = 1 − Sw (v/v); Sw se recorta a [0, 1]; NaN se propaga. */
export function hydrocarbonSaturation(sw: number): number {
  if (!Number.isFinite(sw)) return NaN;
  return 1 - clip01(sw);
}

/** Variante por tramo [start, end) de `sw`, escrita en `out` (mismo índice). */
export function hydrocarbonSaturationInto(
  sw: ArrayLike<number>,
  out: Float64Array,
  start = 0,
  end = sw.length,
): Float64Array {
  for (let i = start; i < end; i++) out[i] = hydrocarbonSaturation(sw[i]!);
  return out;
}
