/**
 * Resonancia magnética nuclear (RMN, p. ej. CMR): fluido libre y ligado, agua ligada a la arcilla y comparación de
 * la porosidad de RMN con la de densidad–neutrón.
 *
 * Unidades: todas las porosidades y volúmenes (PHIT_NMR, PHIE_NMR, BVI, PHIE, FFI, CBW, Δφ) en v/v (fracción, NO %).
 * Sin dato (NaN) → NaN. Política de dominio (la misma de permeability.ts): un volumen negativo, mayor que 1 o no
 * finito es un dato inválido y da NaN (un 20 en lugar de 0,20 delata una mezcla de unidades: NaN y no un resultado
 * absurdo). No se recorta a 0–0,5: el CMR del pozo del TP llega a 0,52 de porosidad total y el rango físico lo
 * decide el control de calidad, no este cálculo.
 *
 * Partición de la porosidad de RMN (convención de la herramienta CMR; Coates, Xiao y Prammer 1999):
 *
 *     PHIT_NMR  =  CBW  +  BVI  +  FFI           (porosidad total, todo el espectro T2)
 *     PHIE_NMR  =        BVI  +  FFI           (porosidad efectiva: T2 sobre el corte de arcilla, ≈ 3 ms)
 *
 *   BVI  volumen de fluido irreducible (agua capilar): T2 entre el corte de arcilla y el corte de BVI (≈ 33 ms en
 *        areniscas, ≈ 92 ms en carbonatos).
 *   FFI  fluido libre: T2 sobre el corte de BVI; es el fluido que puede producirse.
 *   CBW  agua ligada a la arcilla: T2 por debajo del corte de arcilla; la herramienta la ve en PHIT_NMR pero no en
 *        PHIE_NMR.
 *
 * Ecuaciones:
 *   FFI        = PHIE_NMR − BVI                      (≥ 0; si BVI > PHIE_NMR → 0, ruido o corte mal calibrado)
 *   CBW        = PHIT_NMR − PHIE_NMR                 (≥ 0; si PHIT_NMR < PHIE_NMR → 0)
 *   Swirr_NMR  = BVI / PHIE_NMR                      (0–1; fracción ligada de la porosidad efectiva; PHIE_NMR = 0 → NaN)
 *   Δφ         = PHIE_NMR − PHIE                     (RMN menos densidad–neutrón; negativo = RMN lee menos)
 *   Deficit    = 1 si Δφ < −tol, si no 0             (alerta de gas, crudo pesado o microporosidad)
 *
 * Interpretación del Δφ (PHIE_NMR − PHIE de densidad–neutrón):
 *  - La porosidad de RMN no depende de la matriz (litología): el hidrógeno de los fluidos del poro es lo único que
 *    se mide. Densidad y neutrón sí dependen de la matriz y de los fluidos. Con la matriz bien elegida y sin
 *    hidrocarburos livianos, ambas coinciden dentro de su incertidumbre (Δφ ≈ 0).
 *  - Δφ < 0 sostenido (RMN lee MENOS): firma clásica del gas y el petróleo liviano gaseoso. El gas tiene un índice de
 *    hidrógeno bajo (HI < 1) y un T1 largo, así que con tiempo de espera corto la polarización es incompleta;
 *    ambos efectos hacen que la RMN subestime la porosidad. El crudo muy viscoso también la subestima (T2 tan corto
 *    que cae bajo el eco más corto o bajo el corte de arcilla). La microporosidad con T2 < 3 ms (carbonatos,
 *    areniscas arcillosas) es el tercer motivo: está en PHIT_NMR y no en PHIE_NMR (Coates et al. 1999; Asquith y
 *    Krygowski 2004, sección de perfiles de resonancia magnética). El indicador es una ALERTA, no un diagnóstico: hay que contrastarlo con el
 *    crossover densidad–neutrón (`IND_GAS`) y con la resistividad.
 *  - Δφ > 0 (RMN lee MÁS): no se marca. Suele indicar una matriz mal elegida en densidad–neutrón (densidad de
 *    matriz demasiado alta, porosidad subestimada) o arcilla mal corregida, no un fluido.
 *  - El signo se define como RMN − densidad–neutrón (y no al revés) para que el «déficit de RMN» sea negativo y la
 *    bandera se dispare con Δφ < −tol, igual que se lee la curva en la pista.
 *  - Se compara PHIE_NMR con la porosidad EFECTIVA (PHIE) porque ambas excluyen el agua ligada a la arcilla; comparar
 *    PHIT_NMR con la efectiva sumaría el CBW al Δφ.
 *
 * Tolerancia por defecto (0,03 v/v): criterio práctico, NO un valor de libro. Combina la incertidumbre de la RMN
 * (del orden de ±1 p.u.) con la de densidad–neutrón (del orden de ±2 p.u., sobre todo por la matriz) en cuadratura,
 * ≈ 2–3 p.u., y coincide con el cruce mínimo del indicador de gas de densidad–neutrón (GAS_CROSSOVER_MIN). Se
 * ajusta por zona con el ruido real de las curvas.
 * Borde: Δφ = −tol NO marca (desigualdad estricta, como se pidió); para que no decida el redondeo binario
 * (0,24 − 0,27 = −0,030000000000000027) se compara contra −tol − 1e-9.
 *
 * Referencias: Coates, G.R., Xiao, L. y Prammer, M.G. (1999), «NMR Logging: Principles and Applications»,
 * Halliburton Energy Services (partición CBW/BVI/FFI, efecto del gas y del crudo pesado, cortes de T2);
 * Asquith, G. y Krygowski, D. (2004), «Basic Well Log Analysis», 2.ª ed., AAPG Methods in Exploration 16 (perfiles de
 * resonancia magnética); la herramienta CMR de Schlumberger reporta estas curvas como TCMR (total), CMRP_3MS/MPHI
 * (efectiva), MBVI (irreducible) y MFFI (libre).
 */

/** Tolerancia por defecto del indicador de déficit de RMN (v/v). */
export const NMR_DEFICIT_TOLERANCE_DEFAULT = 0.03;

/** Holgura numérica del borde estricto del indicador (v/v): decide la desigualdad, no el redondeo binario. */
const BORDER_EPS = 1e-9;

/** Volumen válido: finito y en [0, 1]. Interno. */
function isVolume(x: number): boolean {
  return x >= 0 && x <= 1;
}

/**
 * Fluido libre: FFI = PHIE_NMR − BVI, recortado a ≥ 0 (BVI > PHIE_NMR es ruido o un corte de BVI mal calibrado).
 * @param phieNmr  porosidad efectiva de RMN (v/v), 0–1
 * @param bvi      volumen de fluido irreducible (v/v), 0–1 (BVI = 0 es válido: todo el fluido es libre)
 */
export function freeFluidVolume(phieNmr: number, bvi: number): number {
  if (!isVolume(phieNmr) || !isVolume(bvi)) return NaN;
  return Math.max(0, phieNmr - bvi);
}

/** FFI por tramo [start, end), escrita en `out` (mismo índice). */
export function freeFluidVolumeInto(
  phieNmr: ArrayLike<number>,
  bvi: ArrayLike<number>,
  out: Float64Array,
  start = 0,
  end = phieNmr.length,
): Float64Array {
  for (let i = start; i < end; i++) out[i] = freeFluidVolume(phieNmr[i]!, bvi[i]!);
  return out;
}

/**
 * Agua ligada a la arcilla: CBW = PHIT_NMR − PHIE_NMR, recortada a ≥ 0 (PHIT_NMR < PHIE_NMR es ruido).
 * @param phitNmr  porosidad total de RMN (v/v), 0–1
 * @param phieNmr  porosidad efectiva de RMN (v/v), 0–1
 */
export function clayBoundWater(phitNmr: number, phieNmr: number): number {
  if (!isVolume(phitNmr) || !isVolume(phieNmr)) return NaN;
  return Math.max(0, phitNmr - phieNmr);
}

/** CBW por tramo [start, end), escrita en `out`. */
export function clayBoundWaterInto(
  phitNmr: ArrayLike<number>,
  phieNmr: ArrayLike<number>,
  out: Float64Array,
  start = 0,
  end = phitNmr.length,
): Float64Array {
  for (let i = start; i < end; i++) out[i] = clayBoundWater(phitNmr[i]!, phieNmr[i]!);
  return out;
}

/**
 * Fracción de fluido ligado (≈ Swirr de RMN): BVI / PHIE_NMR, en v/v, recortada a 1 (BVI > PHIE_NMR → 1, consistente
 * con FFI = 0). PHIE_NMR = 0 → NaN (0/0: no hay fluido que repartir).
 * @param bvi      volumen de fluido irreducible (v/v), 0–1
 * @param phieNmr  porosidad efectiva de RMN (v/v), 0–1, > 0
 */
export function boundFluidFraction(bvi: number, phieNmr: number): number {
  if (!isVolume(bvi) || !isVolume(phieNmr) || !(phieNmr > 0)) return NaN;
  return Math.min(1, bvi / phieNmr);
}

/** Fracción ligada por tramo [start, end), escrita en `out`. */
export function boundFluidFractionInto(
  bvi: ArrayLike<number>,
  phieNmr: ArrayLike<number>,
  out: Float64Array,
  start = 0,
  end = bvi.length,
): Float64Array {
  for (let i = start; i < end; i++) out[i] = boundFluidFraction(bvi[i]!, phieNmr[i]!);
  return out;
}

/**
 * Diferencia de porosidades: Δφ = PHIE_NMR − PHIE (v/v). Negativa = la RMN lee menos que densidad–neutrón.
 * @param phieNmr  porosidad efectiva de RMN (v/v), 0–1
 * @param phie     porosidad efectiva de densidad–neutrón (v/v), 0–1
 */
export function nmrPorosityDifference(phieNmr: number, phie: number): number {
  if (!isVolume(phieNmr) || !isVolume(phie)) return NaN;
  return phieNmr - phie;
}

/** Δφ por tramo [start, end), escrita en `out`. */
export function nmrPorosityDifferenceInto(
  phieNmr: ArrayLike<number>,
  phie: ArrayLike<number>,
  out: Float64Array,
  start = 0,
  end = phieNmr.length,
): Float64Array {
  for (let i = start; i < end; i++) out[i] = nmrPorosityDifference(phieNmr[i]!, phie[i]!);
  return out;
}

/**
 * Indicador de déficit de RMN: 1 si Δφ < −tolerancia (estricto), 0 si no, NaN si Δφ no tiene dato o la tolerancia
 * no es válida (< 0 o no finita). Alerta de gas, crudo pesado o microporosidad (ver cabecera).
 * @param dphi       Δφ = PHIE_NMR − PHIE (v/v)
 * @param tolerance  tolerancia (v/v), ≥ 0
 */
export function nmrDeficitFlag(dphi: number, tolerance: number): number {
  if (Number.isNaN(dphi) || !(tolerance >= 0) || tolerance === Infinity) return NaN;
  return dphi < -tolerance - BORDER_EPS ? 1 : 0;
}

/** Banderas de déficit de RMN por tramo [start, end), escritas en `out`. Tolerancia única del tramo. */
export function nmrDeficitFlagInto(
  dphi: ArrayLike<number>,
  out: Float64Array,
  tolerance: number,
  start = 0,
  end = dphi.length,
): Float64Array {
  for (let i = start; i < end; i++) out[i] = nmrDeficitFlag(dphi[i]!, tolerance);
  return out;
}
