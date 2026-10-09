/**
 * Resistividad del agua de formación (Rw): Rwa, SP y gráfico de Pickett.
 *
 * Unidades: resistividades en Ω·m, porosidad φ en v/v (fracción, NO %), temperatura en °F, SP en mV.
 * Sin dato (NaN) → NaN. Parámetros degenerados (resistividad ≤ 0, φ ≤ 0, a ≤ 0, m ≤ 0, etc.) → NaN.
 * Valores no finitos (±Infinity) se tratan como inválidos (→ NaN, o descartados en los ajustes de Pickett).
 *
 * Ecuaciones:
 *   Rwa (resistividad aparente del agua)   Rwa = Rt · φ^m / a
 *       En una zona 100 % agua Rwa = Rw; el mínimo de Rwa en una zona limpia con agua es una estimación de Rw.
 *   Coeficiente del SP                     K = 60 + 0,133 · T(°F)                     (mV por década)
 *   SP estático                            SSP = −K · log10(Rmfe / Rwe)
 *   Rw equivalente desde el SSP            Rwe = Rmfe · 10^(SSP / K)
 *   Rwe → Rw                               Rw ≈ Rwe  (APROXIMACIÓN, ver nota)
 *   Rmfe (equivalente del filtrado)        Rmf(75 °F) > 0,1 Ω·m:  Rmfe = 0,85 · Rmf(Tf);  si no, Rmfe ≈ Rmf(Tf)  (aprox.)
 *   Pickett (Sw = 1, n no interviene)      log10 Rt = −m · log10 φ + log10(a · Rw)
 *       Ajuste por mínimos cuadrados en log–log de y = log10 Rt contra x = log10 φ:
 *           pendiente s = −m,   intercepto b = log10(a · Rw)   →   m = −s,   Rw = 10^b / a
 *       Variante con m fijo:  b = media(y + m·x),   Rw = 10^b / a.
 *       R² = 1 − SSres/SStot (SStot respecto de la media de y); en el ajuste libre coincide con r².
 *
 * Notas:
 *  - K del SP: forma de Asquith y Krygowski (60 + 0,133·T °F). Otras fuentes usan 61 + 0,133·T °F (Schlumberger,
 *    equivalente a 65 + 0,24·T °C con redondeo); la diferencia es de ~1–1,5 % en K y se traslada al Rwe como un
 *    factor 10^(SSP·ΔK/K²) (≈ 1–3 % para |SSP| ≈ 80 mV).
 *  - Rwe → Rw: la conversión de Schlumberger (carta SP-2) es una correlación empírica que depende de la
 *    temperatura y que NO se implementa aquí (no se dispone de una expresión exacta verificada). Se devuelve
 *    Rw = Rwe, lo que es válido solo como aproximación cuando las sales son predominantemente NaCl y la salinidad
 *    es moderada a baja; en aguas dulces (Rwe > ~0,12 Ω·m a 75 °F) Rw difiere sensiblemente de Rwe.
 *    Rmfe debe darse a la temperatura de formación (si hay Rmf a 75 °F, corregirlo antes, p. ej. con Arps).
 *  - Pickett: los puntos con Rt ≤ 0, φ ≤ 0 o no finitos se descartan. El ajuste libre necesita ≥ 2 puntos válidos
 *    y dispersión en φ; si no → NaN. El m ajustado se devuelve tal cual (no se recorta): el llamador debe revisar
 *    que sea plausible (típicamente 1,5–2,5). El ajuste supone que todos los puntos están en zona 100 % agua y
 *    sin arcilla significativa; puntos con hidrocarburos (Rt alto) sesgan Rw y m.
 *  - El ajuste libre y el de m fijo usan el mismo tramo [start, end) de los vectores `rt` y `phi`.
 *
 * Referencias: Asquith y Krygowski (2004), "Basic Well Log Analysis", AAPG Methods in Exploration 16
 * (SP, ecuaciones de K y SSP; Rwa; método de Pickett); Pickett, G.R. (1966), "A review of current
 * techniques for determination of water saturation from logs", JPT 18(11); Schlumberger, "Log Interpretation
 * Charts" (SP-1, SP-2).
 */

/** Término constante del coeficiente K del SP (mV). */
export const SP_K_BASE = 60;
/** Pendiente del coeficiente K del SP respecto de T(°F) (mV/°F). */
export const SP_K_SLOPE = 0.133;

/** x > 0 y finito (descarta NaN, ≤ 0 e Infinity). Interno. */
function isPositiveFinite(x: number): boolean {
  return x > 0 && x < Infinity;
}

// ---------------------------------------------------------------------------------------------------------------
// Rwa
// ---------------------------------------------------------------------------------------------------------------

/**
 * Resistividad aparente del agua: Rwa = Rt · φ^m / a.
 * @param rt  resistividad verdadera de la formación (Ω·m), > 0
 * @param phi porosidad (v/v), > 0
 * @param a   factor de tortuosidad (> 0)
 * @param m   exponente de cementación (> 0)
 */
export function apparentWaterResistivity(rt: number, phi: number, a: number, m: number): number {
  if (!isPositiveFinite(rt) || !isPositiveFinite(phi) || !isPositiveFinite(a) || !isPositiveFinite(m)) return NaN;
  return (rt * Math.pow(phi, m)) / a;
}

/** Variante por tramo [start, end) de `rt`, escrita en `out` (mismo índice). */
export function apparentWaterResistivityInto(
  rt: ArrayLike<number>,
  phi: ArrayLike<number>,
  out: Float64Array,
  a: number,
  m: number,
  start = 0,
  end = rt.length,
): Float64Array {
  for (let i = start; i < end; i++) out[i] = apparentWaterResistivity(rt[i]!, phi[i]!, a, m);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// SP
// ---------------------------------------------------------------------------------------------------------------

/** Coeficiente del SP: K = 60 + 0,133·T (mV por década; T en °F). */
export function spCoefficient(tF: number): number {
  const k = SP_K_BASE + SP_K_SLOPE * tF;
  return isPositiveFinite(k) ? k : NaN;
}

/**
 * Resistividad equivalente del agua desde el SP estático: Rwe = Rmfe · 10^(SSP/K), con K = 60 + 0,133·T.
 * Un SSP negativo (deflexión hacia la izquierda) da Rwe < Rmfe; SSP = 0 da Rwe = Rmfe.
 * @param ssp  SP estático (mV) respecto de la línea base de lutitas
 * @param rmfe resistividad equivalente del filtrado de lodo a temperatura de formación (Ω·m), > 0
 * @param tF   temperatura de formación (°F)
 */
export function equivalentWaterResistivityFromSp(ssp: number, rmfe: number, tF: number): number {
  const k = spCoefficient(tF);
  if (!Number.isFinite(ssp) || !isPositiveFinite(rmfe) || Number.isNaN(k)) return NaN;
  return rmfe * Math.pow(10, ssp / k);
}

/**
 * Rw desde el SP: aproximación Rw ≈ Rwe. NO aplica la conversión Rwe → Rw de la carta SP-2: en agua dulce
 * (Rwe > ~0,12 Ω·m a 75 °F) subestima Rw; ver nota de cabecera. Mismos parámetros y unidades que `equivalentWaterResistivityFromSp`.
 */
export function waterResistivityFromSp(ssp: number, rmfe: number, tF: number): number {
  return equivalentWaterResistivityFromSp(ssp, rmfe, tF);
}

/** Variante por tramo [start, end) de `ssp`, escrita en `out` (mismo índice). Rmfe y T únicos del tramo. */
export function waterResistivityFromSpInto(
  ssp: ArrayLike<number>,
  out: Float64Array,
  rmfe: number,
  tF: number,
  start = 0,
  end = ssp.length,
): Float64Array {
  for (let i = start; i < end; i++) out[i] = waterResistivityFromSp(ssp[i]!, rmfe, tF);
  return out;
}

/** Umbral de Rmf a 75 °F (Ω·m) por encima del cual Rmfe = 0,85·Rmf. */
export const RMFE_THRESHOLD_75F = 0.1;
/** Factor Rmfe/Rmf para Rmf(75 °F) > 0,1 Ω·m. */
export const RMFE_FACTOR = 0.85;

/**
 * Rmfe desde Rmf a temperatura de formación (Asquith y Krygowski 2004, cap. SP): si Rmf a 75 °F > 0,1 Ω·m,
 * Rmfe = 0,85·Rmf(Tf); si no, Rmfe ≈ Rmf(Tf) (la carta SP-2 no está implementada: aproximación, el módulo avisa).
 * Rmf ≤ 0 o no finito → NaN.
 * @param rmfAtTf  Rmf corregida a la temperatura de formación (Ω·m), > 0
 * @param rmfAt75F Rmf corregida a 75 °F (Ω·m); solo decide la rama (umbral 0,1 Ω·m). NaN → NaN
 */
export function equivalentMudFiltrateResistivity(rmfAtTf: number, rmfAt75F: number): number {
  if (!isPositiveFinite(rmfAtTf) || !isPositiveFinite(rmfAt75F)) return NaN;
  return rmfAt75F > RMFE_THRESHOLD_75F ? RMFE_FACTOR * rmfAtTf : rmfAtTf;
}

// ---------------------------------------------------------------------------------------------------------------
// Pickett
// ---------------------------------------------------------------------------------------------------------------

/** Resultado del ajuste de Pickett. `count` = puntos válidos usados. */
export interface PickettFit {
  /** Exponente de cementación (de la pendiente; en el ajuste con m fijo es el m dado). */
  m: number;
  /** Resistividad del agua (Ω·m). */
  rw: number;
  /** Coeficiente de determinación del ajuste log–log. */
  r2: number;
  /** Cantidad de puntos válidos usados. */
  count: number;
}

const PICKETT_MIN_SPREAD = 1e-6;

const PICKETT_NAN = (count: number): PickettFit => ({ m: NaN, rw: NaN, r2: NaN, count });

/**
 * Ajuste de Pickett libre: mínimos cuadrados de log10 Rt = −m·log10 φ + log10(a·Rw) → { m, rw, r2, count }.
 * Descarta puntos con NaN, Rt ≤ 0 o φ ≤ 0. Devuelve NaN en m, rw y r2 con < 2 puntos válidos, sin dispersión en
 * log φ, o a ≤ 0. Si Rt es constante (sin dispersión en log Rt) el ajuste da m = 0 y r2 = NaN.
 * @param rt    resistividad verdadera (Ω·m) de los puntos de la zona 100 % agua
 * @param phi   porosidad (v/v), mismo largo/índice que `rt`
 * @param a     factor de tortuosidad usado para despejar Rw (> 0)
 * @param start primer índice del tramo (incl.)
 * @param end   último índice del tramo (excl.)
 */
export function pickettFit(
  rt: ArrayLike<number>,
  phi: ArrayLike<number>,
  a: number,
  start = 0,
  end = Math.min(rt.length, phi.length),
): PickettFit {
  // Primera pasada: conteo, medias y rango de x e y (sin alocar vectores intermedios).
  let n = 0;
  let sx = 0;
  let sy = 0;
  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (let i = start; i < end; i++) {
    const r = rt[i]!;
    const p = phi[i]!;
    if (!isPositiveFinite(r) || !isPositiveFinite(p)) continue;
    const x = Math.log10(p);
    const y = Math.log10(r);
    n++;
    sx += x;
    sy += y;
    if (x < xMin) xMin = x;
    if (x > xMax) xMax = x;
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
  }
  if (!isPositiveFinite(a) || n < 2 || xMax - xMin < PICKETT_MIN_SPREAD) return PICKETT_NAN(n);
  const mx = sx / n;
  const my = sy / n;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (let i = start; i < end; i++) {
    const r = rt[i]!;
    const p = phi[i]!;
    if (!isPositiveFinite(r) || !isPositiveFinite(p)) continue;
    const dx = Math.log10(p) - mx;
    const dy = Math.log10(r) - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const r2 = yMax - yMin < PICKETT_MIN_SPREAD ? NaN : (sxy * sxy) / (sxx * syy);
  return { m: -slope, rw: Math.pow(10, intercept) / a, r2, count: n };
}

/**
 * Pickett con m fijo: Rw = 10^media(log10 Rt + m·log10 φ) / a. Estima solo Rw (el resultado trae `m` = el dado).
 * Descarta puntos con NaN, Rt ≤ 0 o φ ≤ 0; con ≥ 1 punto válido da Rw. r2 = 1 − SSres/SStot respecto de la media
 * de log Rt (puede ser negativo si m fijo ajusta peor que una constante); es NaN con < 2 puntos o sin dispersión
 * en log Rt. a ≤ 0 o m ≤ 0 → todo NaN.
 */
export function pickettFitFixedM(
  rt: ArrayLike<number>,
  phi: ArrayLike<number>,
  a: number,
  m: number,
  start = 0,
  end = Math.min(rt.length, phi.length),
): PickettFit {
  let n = 0;
  let sb = 0;
  let sy = 0;
  let yMin = Infinity;
  let yMax = -Infinity;
  const valid = isPositiveFinite(a) && isPositiveFinite(m);
  for (let i = start; i < end; i++) {
    const r = rt[i]!;
    const p = phi[i]!;
    if (!isPositiveFinite(r) || !isPositiveFinite(p)) continue;
    const y = Math.log10(r);
    n++;
    sb += y + m * Math.log10(p);
    sy += y;
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
  }
  if (!valid || n < 1) return PICKETT_NAN(n);
  const b = sb / n;
  const my = sy / n;
  let ssRes = 0;
  let ssTot = 0;
  for (let i = start; i < end; i++) {
    const r = rt[i]!;
    const p = phi[i]!;
    if (!isPositiveFinite(r) || !isPositiveFinite(p)) continue;
    const y = Math.log10(r);
    const e = y - (b - m * Math.log10(p));
    ssRes += e * e;
    ssTot += (y - my) * (y - my);
  }
  const r2 = n < 2 || yMax - yMin < PICKETT_MIN_SPREAD ? NaN : 1 - ssRes / ssTot;
  return { m, rw: Math.pow(10, b) / a, r2, count: n };
}
