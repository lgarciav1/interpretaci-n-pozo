/**
 * Permeabilidad empírica: Timur y Timur–Coates (RMN).
 *
 * Unidades: φ, Swirr, BVI y FFI en v/v (fracción, NO %); permeabilidad k en mD. Sin dato (NaN) → NaN.
 * Decisión de dominio: φ ≤ 0, Swirr ≤ 0, BVI ≤ 0, C ≤ 0 (o no finitos) → NaN. BVI = 0 daría k infinito (FFI/BVI → ∞),
 * por eso se trata como dato inválido y no como permeabilidad muy alta. La salida es siempre k ≥ 0.
 * Son correlaciones empíricas: dan órdenes de magnitud y deben calibrarse con corona (módulo de corona).
 *
 * Ecuaciones:
 *   Timur           √k = 100 · φ^2,25 / Swirr          →   k = ( 100 · φ^2,25 / Swirr )²
 *                   (φ y Swirr en fracción, k en mD; Swirr = saturación de agua irreducible)
 *   Timur–Coates    k = (φ_% / C)^4 · (FFI / BVI)²,     FFI = φ − BVI     (RMN, p. ej. CMR)
 *                   φ_% = 100·φ es la porosidad en unidades de porosidad (p.u.): la constante C = 10 por
 *                   defecto está definida para φ en p.u.; la función recibe φ en v/v y convierte internamente.
 *                   FFI = fluido libre (v/v), BVI = fluido irreducible (v/v). Si BVI ≥ φ, FFI se lleva a 0 y k = 0.
 *
 * Notas:
 *  - La forma de Timur usada coincide, a pocos % en el rango usual (φ 0,1–0,25, Swirr 0,2–0,5), con la original de
 *    Timur (1968) k = 0,136·φ_%^4,4 / Swirr_%² (φ y Swirr en %): p. ej. φ = 0,20 y Swirr = 0,25 dan 114,5 mD con
 *    la forma de √k y 115,4 mD con la original.
 *  - En Timur–Coates, C es el parámetro de calibración (10 por defecto, valor "de fábrica" para areniscas); el
 *    exponente sobre φ es 4 y sobre FFI/BVI es 2. Se calibra con corona, ajustando C para que k RMN reproduzca
 *    la permeabilidad de plugs en profundidad.
 *  - Entradas esperadas: φ efectiva (PHIE) y BVI de la curva de RMN (PHI_BVI); ambas deben ser coherentes (BVI ≤ φ).
 *
 * Referencias: Asquith y Krygowski (2004), "Basic Well Log Analysis", AAPG Methods in Exploration 16 (Timur);
 * Timur, A. (1968), "An investigation of permeability, porosity and residual water saturation relationships for
 * sandstone reservoirs", The Log Analyst 9(4); Coates, G.R. y Dumanoir, J.L. (1974), "A new approach to improved
 * log-derived permeability", The Log Analyst 15(1) (forma FFI/BVI, base de Timur–Coates).
 */

/** Constante C por defecto de Timur–Coates (φ en p.u.). */
export const TIMUR_COATES_C_DEFAULT = 10;

/** x > 0 y finito (descarta NaN, ≤ 0 e Infinity). Interno. */
function isPositiveFinite(x: number): boolean {
  return x > 0 && x < Infinity;
}

/**
 * Permeabilidad de Timur: k = (100 · φ^2,25 / Swirr)² (mD).
 * @param phi    porosidad (v/v), > 0
 * @param swirr  saturación de agua irreducible (v/v), > 0
 */
export function timurPermeability(phi: number, swirr: number): number {
  if (!isPositiveFinite(phi) || !isPositiveFinite(swirr)) return NaN;
  const r = (100 * Math.pow(phi, 2.25)) / swirr;
  return r * r;
}

/** Variante por tramo [start, end) de `phi`, escrita en `out` (mismo índice). Swirr única del tramo. */
export function timurPermeabilityInto(
  phi: ArrayLike<number>,
  out: Float64Array,
  swirr: number,
  start = 0,
  end = phi.length,
): Float64Array {
  for (let i = start; i < end; i++) out[i] = timurPermeability(phi[i]!, swirr);
  return out;
}

/**
 * Permeabilidad de Timur–Coates: k = (φ_%/C)^4 · (FFI/BVI)², con FFI = φ − BVI (mD).
 * @param phi  porosidad efectiva (v/v), > 0
 * @param bvi  fluido irreducible (v/v), > 0 (BVI = 0 → NaN)
 * @param c    constante de calibración (p.u.), > 0; por defecto 10
 */
export function timurCoatesPermeability(phi: number, bvi: number, c = TIMUR_COATES_C_DEFAULT): number {
  if (!isPositiveFinite(phi) || !isPositiveFinite(bvi) || !isPositiveFinite(c)) return NaN;
  const ffi = phi - bvi;
  if (!(ffi > 0)) return 0;
  const p = (100 * phi) / c;
  const ratio = ffi / bvi;
  return p * p * p * p * ratio * ratio;
}

/** Variante por tramo [start, end) de `phi`, escrita en `out` (mismo índice). C único del tramo. */
export function timurCoatesPermeabilityInto(
  phi: ArrayLike<number>,
  bvi: ArrayLike<number>,
  out: Float64Array,
  c = TIMUR_COATES_C_DEFAULT,
  start = 0,
  end = phi.length,
): Float64Array {
  for (let i = start; i < end; i++) out[i] = timurCoatesPermeability(phi[i]!, bvi[i]!, c);
  return out;
}
