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

// ── modelo k–φ de corona (log-lineal) ────────────────────────────────────────────────────────────────────────────
//
//   log10 k = a + b·φ          (k en mD, φ en v/v)        ⇔        k = 10^(a + b·φ)
//
// Es la regresión clásica de plugs de corona: log k lineal en φ (Nelson 1994; Tiab y Donaldson 2015, cap. 3). Se
// ajusta en el crossplot k–φ con el modelo EXPONENCIAL de las tendencias, k = A·e^(B·φ), que es la misma recta en
// ln k: ln k = ln A + B·φ. Conversión exacta (ln ↔ log10, con ln 10 ≈ 2,302585):
//
//   a = log10 A = ln A / ln 10          b = B / ln 10          (y a la inversa: A = 10^a, B = b·ln 10)
//
// Como log10 y ln difieren en una constante, el ajuste por mínimos cuadrados en ln k da EXACTAMENTE los mismos a y b
// que ajustar log10 k (misma recta, mismo R²). Fuera del rango de φ de los plugs la exponencial extrapola mal: el
// módulo recorta a [kMin, kMax].
//
// Referencias: Nelson, P.H. (1994), "Permeability-porosity relationships in sedimentary rocks", The Log Analyst
// 35(3); Tiab, D. y Donaldson, E.C. (2015), "Petrophysics", 4.ª ed., cap. 3; Asquith y Krygowski (2004).

/** Coeficientes de log10 k = a + b·φ. */
export interface LogLinearPermModel {
  a: number;
  b: number;
}

/** Exponencial k = A·e^(B·φ) (tendencia 'exp') → log10 k = a + b·φ. null si A ≤ 0 o algo no es finito. */
export function expTrendToLogLinear(A: number, B: number): LogLinearPermModel | null {
  if (!(A > 0) || !Number.isFinite(A) || !Number.isFinite(B)) return null;
  return { a: Math.log10(A), b: B / Math.LN10 };
}

/** log10 k = a + b·φ → exponencial k = A·e^(B·φ). */
export function logLinearToExpTrend(a: number, b: number): { A: number; B: number } {
  return { A: Math.pow(10, a), B: b * Math.LN10 };
}

/**
 * Permeabilidad del modelo k–φ de corona: k = 10^(a + b·φ) (mD), recortada a [kMin, kMax].
 * φ < 0 o no finito → NaN (sin dato). φ = 0 es válido (k = 10^a, recortado).
 */
export function logLinearPermeability(phi: number, a: number, b: number, kMin = 0, kMax = Infinity): number {
  if (!Number.isFinite(phi) || phi < 0 || !Number.isFinite(a) || !Number.isFinite(b)) return NaN;
  const k = Math.pow(10, a + b * phi);
  if (!Number.isFinite(k)) return k > 0 ? kMax : NaN;
  return Math.min(kMax, Math.max(kMin, k));
}

/** Variante por tramo [start, end) de `phi`, escrita en `out`. a, b, kMin y kMax únicos del tramo. */
export function logLinearPermeabilityInto(
  phi: ArrayLike<number>,
  out: Float64Array,
  a: number,
  b: number,
  kMin = 0,
  kMax = Infinity,
  start = 0,
  end = phi.length,
): Float64Array {
  for (let i = start; i < end; i++) out[i] = logLinearPermeability(phi[i]!, a, b, kMin, kMax);
  return out;
}

/** Coeficientes de k = A·φᵇ guardados como a = log10(A), con φ en v/v. */
export interface PowerPermModel {
  method: 'power';
  a: number;
  b: number;
  /** Rango de φ observado en los plugs. */
  phiMin?: number;
  phiMax?: number;
}

export type CorePermModel = LogLinearPermModel | PowerPermModel;

export function isPowerPermModel(model: CorePermModel): model is PowerPermModel {
  return 'method' in model && model.method === 'power';
}

/**
 * Ley potencial de corona k = A·φᵇ en mD. Se evalúa como log10(k) = log10(A) + b·log10(φ),
 * con φ efectiva en v/v y recorte a [kMin, kMax]. φ ausente o no positiva queda sin estimación.
 * Referencia: Nelson (1994), "Permeability-porosity relationships in sedimentary rocks", The Log Analyst 35(3).
 */
export function powerPermeability(phi: number, logA: number, b: number, kMin = 0, kMax = Infinity): number {
  if (!isPositiveFinite(phi) || !Number.isFinite(logA) || !Number.isFinite(b)) return NaN;
  const k = 10 ** (logA + b * Math.log10(phi));
  return Math.min(kMax, Math.max(kMin, k));
}

/** Variante por tramo [start, end). Devuelve cuántas muestras estimadas extrapolan el rango de los plugs. */
export function powerPermeabilityInto(
  phi: ArrayLike<number>,
  out: Float64Array,
  model: PowerPermModel,
  kMin: number,
  kMax: number,
  start: number,
  end: number,
): number {
  let extrapolated = 0;
  for (let i = start; i < end; i++) {
    const porosity = phi[i]!;
    out[i] = powerPermeability(porosity, model.a, model.b, kMin, kMax);
    if (Number.isFinite(out[i]) && model.phiMin !== undefined && model.phiMax !== undefined && (porosity < model.phiMin || porosity > model.phiMax)) {
      extrapolated++;
    }
  }
  return extrapolated;
}
