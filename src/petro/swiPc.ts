/**
 * Saturación de agua irreducible (Swi) a partir de datos SCAL de presión capilar (tarea 8 de la consigna del TP:
 * «analizar los datos de SCAL, para ajustar Swi y k»).
 *
 * Modelo (Buckles, 1965): la saturación de agua irreducible a una presión capilar dada se correlaciona con la
 * calidad de roca mediante una ley de potencia en el cociente permeabilidad/porosidad,
 *
 *   Swi = A · x^B / 100,    x = √(k / φ%)      (k en mD, φ% = 100·φ en PORCENTAJE; Swi resultante en fracción v/v)
 *
 * Cada nivel de presión capilar tiene sus propios (A, B). A mayor A, mayor Swi, o sea MENOR presión capilar:
 * el nivel 1 de la planilla de la cátedra es el de menor presión capilar y el 6 el de mayor. La planilla no trae la
 * presión de cada nivel en las celdas, pero sí las curvas MICP de las 8 muestras dentro de sus gráficos: con ellas se
 * reconstruye (`swiLevelFits`, `matchSwiLevel`) y queda en `pcKgCm2` (docs/decisiones/0087-micp-del-tp.md).
 *
 * Unidad de x: la planilla calcula √(k/φ) con φ en porcentaje. Es 1/10 de √(k/φ) con φ en fracción (la tabla de
 * presión de desplazamiento del mismo archivo usa esa otra convención: su «raíz» es 10 veces la de la tabla de
 * garganta poral). `rootKOverPhi` usa la de la planilla de Swi (φ en %); el ajuste de la presión de desplazamiento
 * es una regresión genérica en la x que se le pase (ver `fitDisplacementPressure`).
 *
 * Coeficientes (A, B) de la cátedra: provienen de las curvas de presión capilar de las 8 muestras de la hoja SCAL
 * (embebidas en `src/modules/rock-typing/tpMicp.ts`). Se toman como dato y valen en el rango de x de esas muestras
 * (`SWI_SCAL_ROOT_RANGE`); fuera de él la ley de potencia es una extrapolación.
 *
 * Decisión de rango: `swiPowerLaw` RECORTA a [0, 1] (una saturación no puede superar 1; con x → 0, es decir roca muy
 * cerrada, B < 0 hace crecer Swi sin límite y el recorte da el valor físico límite: toda el agua es irreducible).
 * Fuera de dominio (x ≤ 0, A ≤ 0, parámetros no finitos) devuelve NaN, no un valor recortado: no hay dato. Quien
 * necesite saber si hubo recorte usa `swiPowerLawRaw`.
 *
 * Referencias:
 *  - Buckles, R.S. (1965). Correlating and averaging connate water saturation data. Journal of Canadian Petroleum
 *    Technology 4(1): 42-52.
 *  - Planilla de la cátedra, hoja SCAL (TP de Interpretación de Perfiles, FIUBA): coeficientes (A, B) por nivel.
 *  - Draper, N.R. y Smith, H. (1998). Applied Regression Analysis, 3.ª ed., cap. 1 y 5 (regresión log–log).
 */

import { fitTrend } from './regression';
import { wettingSaturationAtPc } from './rockTyping';

// ---------------------------------------------------------------------------------------------------------------
// Variable de correlación

/**
 * √(k/φ) en la unidad de la planilla de la cátedra: k en mD y φ en PORCENTAJE.
 *
 *   x = √( k / (100·φ) )     (φ en fracción v/v)
 *
 * Ejemplo: k = 100 mD, φ = 0,20 ⇒ √(100/20) = 2,23607.
 *
 * @param kMd     permeabilidad (mD); debe ser > 0 y finita
 * @param phiFrac porosidad (v/v, fracción, NO %); debe estar en (0, 1]
 * @returns x, o NaN fuera de dominio (k ≤ 0, k o φ no finitos, φ ≤ 0 o φ > 1)
 */
export function rootKOverPhi(kMd: number, phiFrac: number): number {
  if (!(kMd > 0) || kMd === Infinity || !(phiFrac > 0) || !(phiFrac <= 1)) return NaN;
  return Math.sqrt(kMd / (100 * phiFrac));
}

// ---------------------------------------------------------------------------------------------------------------
// Ley de potencia de Swi

/**
 * Swi sin recortar: A · x^B / 100 (fracción v/v).
 *
 * @param rootKPhi x = √(k/φ%) (ver `rootKOverPhi`); debe ser > 0 y finito
 * @param A        coeficiente de la planilla (en %: Swi% = A·x^B); debe ser > 0 y finito
 * @param B        exponente (adimensional, negativo: Swi baja al mejorar la roca); debe ser finito
 * @returns Swi en fracción, posiblemente > 1 si x es chico; NaN fuera de dominio
 */
export function swiPowerLawRaw(rootKPhi: number, A: number, B: number): number {
  if (!(rootKPhi > 0) || rootKPhi === Infinity || !(A > 0) || A === Infinity || !Number.isFinite(B)) return NaN;
  const v = (A * Math.pow(rootKPhi, B)) / 100;
  return Number.isFinite(v) ? v : v === Infinity ? Infinity : NaN;
}

/**
 * Swi = A · x^B / 100, en fracción v/v y recortada a [0, 1] (ver decisión de rango en la cabecera).
 *
 * @param rootKPhi x = √(k/φ%) con k en mD y φ en % (ver `rootKOverPhi`)
 * @param A        coeficiente A de la planilla (Swi% = A·x^B)
 * @param B        exponente B
 * @returns Swi (v/v) en [0, 1]; NaN si x ≤ 0, A ≤ 0 o algún parámetro no es finito
 */
export function swiPowerLaw(rootKPhi: number, A: number, B: number): number {
  const v = swiPowerLawRaw(rootKPhi, A, B);
  return v > 1 ? 1 : v;
}

/**
 * Swi por muestra a partir de PERM y PHIE, en el tramo [start, end) de `out`.
 * `swiPowerLaw(rootKOverPhi(k, φ), A, B)`; sin dato (NaN) o fuera de dominio → NaN.
 */
export function swiFromPermPhiInto(
  k: ArrayLike<number>,
  phi: ArrayLike<number>,
  out: Float64Array,
  A: number,
  B: number,
  start = 0,
  end = Math.min(k.length, phi.length),
): Float64Array {
  for (let i = start; i < end; i++) out[i] = swiPowerLaw(rootKOverPhi(k[i]!, phi[i]!), A, B);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Presets de la cátedra

export interface SwiPreset {
  /** Id estable del nivel (`level1` … `level6`). */
  id: string;
  /** Rótulo para la interfaz; el orden es el de presión capilar creciente, sin inventar las presiones. */
  label: string;
  /** Coeficiente A (Swi% = A·x^B). */
  A: number;
  /** Exponente B. */
  B: number;
  /**
   * Presión capilar mercurio–aire del nivel (kg/cm²), reconstruida de las curvas MICP del TP: el escalón del ensayo
   * cuyo ajuste reproduce mejor el (A, B) de la cátedra (`matchSwiLevel`, docs/decisiones/0087-micp-del-tp.md).
   * Ausente en presets que no salen de esas curvas.
   */
  pcKgCm2?: number;
}

/**
 * Los seis (A, B) de la planilla de la cátedra, hoja SCAL, en el orden de la planilla: del nivel de MENOR presión
 * capilar (mayor Swi) al de MAYOR. Swi = A·(√(k/φ%))^B/100. Los coeficientes se toman como dato. La presión de cada
 * nivel (`pcKgCm2`) se reconstruyó con las curvas MICP del TP, que guardan los gráficos de la hoja: cada (A, B)
 * coincide con el ajuste de las muestras a uno de los escalones del ensayo (test en tests/petro-micp.test.ts).
 */
export const SWI_CATEDRA_LEVELS: readonly SwiPreset[] = [
  { id: 'level1', label: 'Nivel 1 · Pc ≈ 28 kg/cm² (menor)', A: 28.93, B: -0.333, pcKgCm2: 28.215 },
  { id: 'level2', label: 'Nivel 2 · Pc ≈ 70 kg/cm²', A: 21.155, B: -0.322, pcKgCm2: 69.97 },
  { id: 'level3', label: 'Nivel 3 · Pc ≈ 123 kg/cm²', A: 15.102, B: -0.403, pcKgCm2: 122.56 },
  { id: 'level4', label: 'Nivel 4 · Pc ≈ 246 kg/cm²', A: 8.8036, B: -0.442, pcKgCm2: 245.679 },
  { id: 'level5', label: 'Nivel 5 · Pc ≈ 352 kg/cm²', A: 6.3007, B: -0.463, pcKgCm2: 351.916 },
  { id: 'level6', label: 'Nivel 6 · Pc ≈ 700 kg/cm² (mayor)', A: 2.7807, B: -0.582, pcKgCm2: 700.449 },
];

/** Busca un preset por id; undefined si no existe (p. ej. «manual»). */
export function swiPresetById(id: string): SwiPreset | undefined {
  return SWI_CATEDRA_LEVELS.find((p) => p.id === id);
}

/**
 * Rango de x = √(k/φ%) de las 8 muestras de la cátedra (tabla de diámetros de garganta poral: de 0,366 a 1,9955).
 * Es el rango en el que los coeficientes de la cátedra están respaldados por datos; fuera es extrapolación.
 */
export const SWI_SCAL_ROOT_RANGE: Readonly<{ min: number; max: number }> = { min: 0.366, max: 1.9955 };

// ---------------------------------------------------------------------------------------------------------------
// Ajuste de la ley de potencia

export interface PowerLawFit {
  /** Coeficiente multiplicativo (ver cada función por su unidad). */
  A: number;
  /** Exponente. */
  B: number;
  /** R² en el espacio log–log (convención de Excel). */
  r2: number;
  /** Puntos usados. */
  n: number;
  /** Raíz del error cuadrático medio en el espacio original del dato ajustado (Swi en fracción, Pd en kg/cm²). */
  rmse: number;
}

/**
 * Ajusta Swi = A · x^B / 100 por regresión lineal en log–log: ln Swi = ln(A/100) + B·ln x (mínimos cuadrados
 * ordinarios, el mismo criterio que la línea de tendencia potencial de Excel; reutiliza `fitTrend`).
 *
 * @param rootKPhi x = √(k/φ%) de cada muestra (ver `rootKOverPhi`)
 * @param swi      Swi de cada muestra en fracción v/v (> 0); misma longitud (si no, se usa la menor)
 * @returns A en la convención de la planilla (Swi% = A·x^B, o sea 100 × el coeficiente de Swi en fracción), B, R² log–log,
 *          n y rmse de Swi en fracción en el espacio original; `null` si hay menos de 3 puntos válidos
 *          (x > 0, Swi > 0, ambos finitos) o x es constante (varianza cero).
 */
export function fitSwiPowerLaw(rootKPhi: ArrayLike<number>, swi: ArrayLike<number>): PowerLawFit | null {
  const f = fitPower(rootKPhi, swi);
  if (!f) return null;
  return { A: 100 * f.a, B: f.b, r2: f.r2, n: f.n, rmse: f.rmse };
}

export interface DisplacementFit {
  /** Coeficiente c de Pd = c·x^(−d), en kg/cm² para x = 1. */
  c: number;
  /** Exponente d (positivo: la presión de desplazamiento baja al mejorar la roca). */
  d: number;
  r2: number;
  n: number;
  /** RMSE de Pd en kg/cm², en el espacio original. */
  rmse: number;
}

/**
 * Ajusta la presión de desplazamiento contra √(k/φ): Pd = c · x^(−d), regresión log–log (ln Pd = ln c − d·ln x).
 * Es la misma regresión que `fitSwiPowerLaw` aplicada a otra variable. La unidad de x es la de quien llama: la
 * tabla de presión de desplazamiento del archivo de la cátedra trae x = √(k/φ) con φ en FRACCIÓN (10 veces la de la
 * planilla de Swi), por lo que c depende de esa convención y no es comparable con A.
 *
 * @param rootKPhi √(k/φ) de cada muestra
 * @param pd       presión de desplazamiento (kg/cm², > 0)
 * @returns c, d, R² log–log, n y rmse de Pd; `null` si hay menos de 3 puntos válidos o x es constante.
 */
export function fitDisplacementPressure(rootKPhi: ArrayLike<number>, pd: ArrayLike<number>): DisplacementFit | null {
  const f = fitPower(rootKPhi, pd);
  if (!f) return null;
  return { c: f.a, d: -f.b, r2: f.r2, n: f.n, rmse: f.rmse };
}

// ---------------------------------------------------------------------------------------------------------------
// Niveles de Swi desde curvas de presión capilar medidas

/** Curva de presión capilar de una muestra con su √(k/φ%) (k en mD, φ en %). Pc en cualquier unidad, creciente. */
export interface SwiPcSample {
  rootKPhi: number;
  pc: ArrayLike<number>;
  /** Saturación mojante (v/v), no creciente. */
  sw: ArrayLike<number>;
}

export interface SwiLevelFit {
  /** Presión capilar del escalón, en la unidad de las curvas. */
  pc: number;
  /** Ajuste Swi = A·x^B/100 de las muestras a esa presión; null con menos de 3 muestras válidas. */
  fit: PowerLawFit | null;
}

/**
 * Ley de potencia de Swi a cada presión de `pcLevels`: la Sw de cada muestra a esa presión (`wettingSaturationAtPc`, sin
 * extrapolar) contra su √(k/φ%), ajustada con `fitSwiPowerLaw`. Entran solo las muestras ya invadidas y sin saturar:
 * 0 < Sw < 1 (con Sw = 1 el mercurio todavía no entró a esa roca y la ley de potencia no la describe).
 */
export function swiLevelFits(samples: readonly SwiPcSample[], pcLevels: ArrayLike<number>): SwiLevelFit[] {
  const out: SwiLevelFit[] = [];
  for (let j = 0; j < pcLevels.length; j++) {
    const pc = pcLevels[j]!;
    const x: number[] = [];
    const y: number[] = [];
    for (const s of samples) {
      const sw = wettingSaturationAtPc(s.pc, s.sw, pc);
      if (!(sw > 0 && sw < 1) || !(s.rootKPhi > 0)) continue;
      x.push(s.rootKPhi);
      y.push(sw);
    }
    out.push({ pc, fit: fitSwiPowerLaw(x, y) });
  }
  return out;
}

export interface SwiLevelMatch {
  /** Índice en `fits` del escalón que mejor reproduce el nivel; −1 si ningún ajuste es válido. */
  index: number;
  pc: number;
  /** Diferencia RMS de Swi (v/v) entre el nivel y ese ajuste, en el rango de x dado. */
  rmsSwi: number;
}

/**
 * Escalón cuyo ajuste reproduce mejor un nivel (A, B): menor diferencia RMS de Swi (v/v) en 32 puntos equiespaciados en
 * log dentro de `range` (por defecto, el de las muestras de la cátedra). Compara las curvas, no los coeficientes: A y B
 * se compensan entre sí y la distancia entre pares no tiene unidad.
 */
export function matchSwiLevel(level: Pick<SwiPreset, 'A' | 'B'>, fits: readonly SwiLevelFit[], range = SWI_SCAL_ROOT_RANGE): SwiLevelMatch {
  const N = 32;
  const lo = Math.log(range.min);
  const hi = Math.log(range.max);
  let best: SwiLevelMatch = { index: -1, pc: NaN, rmsSwi: NaN };
  fits.forEach((f, idx) => {
    if (!f.fit) return;
    let sum = 0;
    for (let i = 0; i < N; i++) {
      const x = Math.exp(lo + ((hi - lo) * i) / (N - 1));
      const d = swiPowerLawRaw(x, level.A, level.B) - swiPowerLawRaw(x, f.fit.A, f.fit.B);
      sum += d * d;
    }
    const rms = Math.sqrt(sum / N);
    if (!(rms >= best.rmsSwi)) best = { index: idx, pc: f.pc, rmsSwi: rms };
  });
  return best;
}

/** y = a·x^b log–log con al menos 3 puntos válidos. Interno. */
function fitPower(x: ArrayLike<number>, y: ArrayLike<number>) {
  const f = fitTrend(x, y, 'power');
  if (!f || f.n < 3) return null;
  return f;
}

// ---------------------------------------------------------------------------------------------------------------
// Comparación con Sw

/** Tolerancia por defecto (v/v) para marcar Sw < Swi: del orden de la incertidumbre de Sw (±0,02 a 0,05) y del RMSE de las leyes. */
export const SW_BELOW_SWI_TOLERANCE = 0.02;

/**
 * Bandera «agua por debajo de la irreducible»: 1 si Sw < Swi − tol, 0 si no, NaN si falta Sw o Swi.
 * Físicamente sospechoso: el agua móvil no puede ser negativa, así que Sw ≥ Swi (salvo error de Sw, de Swi o roca fuera
 * de la correlación). La tolerancia evita marcar diferencias dentro de la incertidumbre.
 */
export function swBelowSwiFlag(sw: number, swi: number, tolerance = SW_BELOW_SWI_TOLERANCE): number {
  if (!Number.isFinite(sw) || !Number.isFinite(swi)) return NaN;
  return sw < swi - Math.max(0, tolerance || 0) ? 1 : 0;
}
