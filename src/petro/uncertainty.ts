/**
 * Incertidumbre del volumen in situ: Monte Carlo sobre los parámetros + diagrama tornado.
 *
 * Unidades (SI): área en m², espesor en m, Vsh/φ/Sw y cutoffs en v/v (NO %), B en m³/m³, volumen en m³ de superficie.
 * Sin dato (NaN) en las curvas → la muestra no cuenta (mismas reglas que `netFlagsInto` y `summarizeRanges`).
 *
 * Modelo (por zona z y por iteración k):
 *   V_z = A_z · (h·φ·Sh)_z / B_z                         (ver volumetrics.ts: OOIP = A·hφSh/Bo, OGIP = A·hφSh/Bg)
 *   (h·φ·Sh)_z = Σ hᵢ · φ'ᵢ · (1 − Sw'ᵢ)   sobre las muestras que son PAY con los cutoffs perturbados
 *   φ'ᵢ  = clamp(φᵢ · mφ, 0, 0,5)          mφ  : multiplicador de porosidad (error sistemático de φ, p. ej. matriz)
 *   Sw'ᵢ = clamp(Swᵢ · mSw, 0, 1)          mSw : multiplicador de Sw (error de Rw, m, n, a)
 *   Vsh_max' = clamp(Vsh_max + ΔVsh, 0, 1);  φ_min' = clamp(φ_min + Δφ, 0, 0,5);  Sw_max' = clamp(Sw_max + ΔSw, 0, 1)
 *   pay: Vshᵢ ≤ Vsh_max'  y  φ'ᵢ ≥ φ_min'  y  Sw'ᵢ ≤ Sw_max'   (comparaciones inclusivas)
 * El recálculo es POR MUESTRA (no a nivel zona): mover un cutoff cambia qué muestras entran, como en el sumario.
 * Simplificación: la perturbación se aplica a la porosidad y a la Sw ya calculadas (multiplicadores); no se vuelve a
 * correr la cadena Rw → Sw con otros m, n, a (una Sw·mSw equivale a ese error en primera aproximación).
 *
 * Qué es común y qué es por zona: los multiplicadores y los corrimientos de cutoffs son GLOBALES (un sorteo por
 * iteración, igual para todas las zonas: error sistemático del método). Área y B tienen una distribución por zona;
 * `zoneCorrelation = 'full'` (defecto) usa el MISMO cuantil en todas las zonas (correlación perfecta: suma conservadora,
 * los percentiles del total son ≈ la suma de los de las zonas; exacta solo si un único parámetro varía) y `'independent'` un sorteo por zona (el total se
 * «diversifica»: P90 total > ΣP90 zonas y P10 total < ΣP10 zonas).
 *
 * Distribuciones: por parámetro, mínimo / más probable (moda) / máximo.
 *   uniforme      U(min, max); la «moda» solo define el caso base del tornado y el determinista
 *   triangular    T(min, moda, max):   F⁻¹(u) = min + √(u·(max−min)(moda−min))            si u < (moda−min)/(max−min)
 *                                      F⁻¹(u) = max − √((1−u)(max−min)(max−moda))         si no
 *   normal trunc. N(μ = moda, σ) truncada en [min, max], σ = sd ó (max − min)/6:
 *                                      F⁻¹(u) = μ + σ·Φ⁻¹(Φ(a) + u·(Φ(b) − Φ(a))),  a = (min−μ)/σ, b = (max−μ)/σ
 * Todas se muestrean por transformada inversa a partir de u ~ U[0,1): cada parámetro consume SIEMPRE un número del
 * PRNG por iteración (aunque su rango sea nulo), así que cambiar el rango de uno no altera la secuencia de los otros.
 *
 * PRNG: mulberry32 (Tommy Ettinger, 2017), semilla de 32 bits → resultados reproducibles.
 *
 * Percentiles — CONVENCIÓN DE LA INDUSTRIA (SPE-PRMS 2018; Murtha 1997): Pxx es el valor que se SUPERA con una
 * probabilidad de xx %. Por eso P90 es el valor BAJO y P10 el ALTO, con P90 ≤ P50 ≤ P10:
 *   P90 = cuantil 10 % de la distribución acumulada,  P50 = cuantil 50 %,  P10 = cuantil 90 %.
 * Cuantil de la muestra ordenada x₍₀₎ ≤ … ≤ x₍ₙ₋₁₎ por interpolación lineal (tipo 7 de Hyndman y Fan): con
 * h = p·(n−1), q(p) = x₍⌊h⌋₎ + (h − ⌊h⌋)·(x₍⌊h⌋+1₎ − x₍⌊h⌋₎).
 *
 * Tornado (uno a la vez): para cada parámetro incierto, V con ese parámetro en su valor «bajo» y en su «alto»
 * (cuantiles `tornadoQuantiles` de su distribución; por defecto 0 y 1 = mínimo y máximo) y los demás en el más probable.
 * Ordenado por amplitud |V_alto − V_bajo|, de mayor a menor. Para área y B, «un parámetro» mueve todas las zonas a la vez.
 * Correlación de rangos de Spearman: ρ = Pearson(rango(u_parámetro), rango(V)) sobre las corridas Monte Carlo (u es
 * monótona con el valor del parámetro, así que su rango es el del parámetro).
 *
 * Referencias: Murtha, J.A. (1997), "Monte Carlo simulation: its status and future", JPT 49(4), SPE 37932;
 * SPE/AAPG/WPC/SPEE/SEG/SPWLA/EAGE (2018), Petroleum Resources Management System (P90/P50/P10 = probabilidades de superar
 * 90/50/10 %); Capen, E.C. (1976), "The difficulty of assessing uncertainty", JPT 28(8); Ettinger, T. (2017),
 * mulberry32; Hyndman, R.J. y Fan, Y. (1996), "Sample quantiles in statistical packages", Am. Stat. 50(4);
 * Dake, L.P. (1978), Fundamentals of Reservoir Engineering (V = 7758·A·h·φ·Sh/B).
 */
import type { Cutoffs } from './cutoffs';
import { inPlaceVolume, type FluidKind } from './volumetrics';

// ---------------------------------------------------------------------------------------------------------------
// PRNG

/** Generador mulberry32: devuelve u ∈ [0, 1) (resolución 2⁻³²). Misma semilla → misma secuencia. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Normal estándar

/** Φ(x): distribución normal estándar (Hart, algoritmo 5666, según West 2005; error relativo ~1e-15). */
export function normalCdf(x: number): number {
  if (Number.isNaN(x)) return NaN;
  const xa = Math.abs(x);
  let cum: number;
  if (xa > 37) cum = 0;
  else {
    const e = Math.exp(-xa * xa * 0.5);
    if (xa < 7.07106781186547) {
      let b = 0.0352624965998911 * xa + 0.700383064443688;
      b = b * xa + 6.37396220353165;
      b = b * xa + 33.912866078383;
      b = b * xa + 112.079291497871;
      b = b * xa + 221.213596169931;
      b = b * xa + 220.206867912376;
      cum = e * b;
      b = 0.0883883476483184 * xa + 1.75566716318264;
      b = b * xa + 16.064177579207;
      b = b * xa + 86.7807322029461;
      b = b * xa + 296.564248779674;
      b = b * xa + 637.333633378831;
      b = b * xa + 793.826512519948;
      b = b * xa + 440.413735824752;
      cum /= b;
    } else {
      let b = xa + 0.65;
      b = xa + 4 / b;
      b = xa + 3 / b;
      b = xa + 2 / b;
      b = xa + 1 / b;
      cum = e / b / 2.506628274631;
    }
  }
  return x > 0 ? 1 - cum : cum;
}

/**
 * Φ⁻¹(p): punto inicial de Abramowitz y Stegun 26.2.23 (error < 4,5e-4) y refinamiento de Halley sobre `normalCdf`.
 * p ∈ (0, 1); p ≤ 0 → −Infinity, p ≥ 1 → +Infinity.
 */
export function normalQuantile(p: number): number {
  if (Number.isNaN(p)) return NaN;
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const q = p < 0.5 ? p : 1 - p;
  const t = Math.sqrt(-2 * Math.log(q));
  let z = -(t - (2.515517 + 0.802853 * t + 0.010328 * t * t) / (1 + 1.432788 * t + 0.189269 * t * t + 0.001308 * t * t * t));
  if (p >= 0.5) z = -z;
  for (let it = 0; it < 6; it++) {
    const err = normalCdf(z) - p;
    const pdf = Math.exp(-0.5 * z * z) / 2.5066282746310002;
    if (pdf === 0) break;
    const u = err / pdf;
    const step = u / (1 + 0.5 * z * u); // Halley
    z -= step;
    if (Math.abs(step) < 1e-15 * Math.max(1, Math.abs(z))) break;
  }
  return z;
}

// ---------------------------------------------------------------------------------------------------------------
// Distribuciones

export type DistKind = 'uniform' | 'triangular' | 'normal';

/** Distribución de un parámetro incierto: mínimo / más probable / máximo (en las unidades del parámetro). */
export interface Dist {
  kind: DistKind;
  min: number;
  /** Más probable. Triangular: moda; normal: media; uniforme: solo el caso base (tornado, determinista). */
  mode: number;
  max: number;
  /** Solo normal: desvío (antes de truncar). Por defecto (max − min)/6. */
  sd?: number;
}

/** Distribución degenerada (parámetro fijo en `value`). */
export function fixedDist(value: number): Dist {
  return { kind: 'uniform', min: value, mode: value, max: value };
}

/** Lanza RangeError si la distribución no es válida (finita y min ≤ moda ≤ max). */
export function checkDist(d: Dist, what = 'parámetro'): void {
  if (!['uniform', 'triangular', 'normal'].includes(d.kind)) throw new RangeError(`${what}: distribución desconocida '${String(d.kind)}'.`);
  if (![d.min, d.mode, d.max].every(Number.isFinite)) throw new RangeError(`${what}: mínimo, más probable y máximo deben ser finitos.`);
  if (!(d.min <= d.mode && d.mode <= d.max)) throw new RangeError(`${what}: se exige mínimo ≤ más probable ≤ máximo (recibió ${d.min}, ${d.mode}, ${d.max}).`);
  if (d.sd !== undefined && !(d.sd > 0 && Number.isFinite(d.sd))) throw new RangeError(`${what}: el desvío debe ser positivo.`);
}

/** true si la distribución no tiene dispersión (min = max). */
export const isDegenerate = (d: Dist): boolean => d.max === d.min;

/** Cuantil F⁻¹(u) de la distribución, u ∈ [0, 1]. */
export function distQuantile(d: Dist, u: number): number {
  const { min, mode, max } = d;
  if (max === min) return min;
  const w = max - min;
  switch (d.kind) {
    case 'uniform':
      return min + u * w;
    case 'triangular': {
      const fc = (mode - min) / w;
      const x = u < fc ? min + Math.sqrt(u * w * (mode - min)) : max - Math.sqrt((1 - u) * w * (max - mode));
      return Math.min(max, Math.max(min, x));
    }
    case 'normal': {
      const sd = d.sd ?? w / 6;
      const pa = normalCdf((min - mode) / sd);
      const pb = normalCdf((max - mode) / sd);
      if (!(pb - pa > 1e-12)) return min + u * w; // truncada en una cola lejana: sin masa numérica
      const x = mode + sd * normalQuantile(pa + u * (pb - pa));
      return Math.min(max, Math.max(min, x));
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Estadística de la muestra

/** Cuantil p ∈ [0,1] de una muestra YA ORDENADA, interpolación lineal (tipo 7). NaN si está vacía. */
export function quantileSorted(sorted: ArrayLike<number>, p: number): number {
  const n = sorted.length;
  if (n === 0 || Number.isNaN(p)) return NaN;
  const h = Math.min(1, Math.max(0, p)) * (n - 1);
  const lo = Math.floor(h);
  const hi = Math.min(n - 1, lo + 1);
  return sorted[lo]! + (h - lo) * (sorted[hi]! - sorted[lo]!);
}

/** Rangos 1…n con promedio en los empates. */
function ranks(x: ArrayLike<number>): Float64Array {
  const n = x.length;
  const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => x[a]! - x[b]!);
  const r = new Float64Array(n);
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && x[idx[j + 1]!]! === x[idx[i]!]!) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k]!] = avg;
    i = j + 1;
  }
  return r;
}

function pearson(x: ArrayLike<number>, y: ArrayLike<number>): number {
  const n = x.length;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += x[i]!;
    my += y[i]!;
  }
  mx /= n;
  my /= n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i]! - mx;
    const dy = y[i]! - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : NaN;
}

/** Correlación de rangos de Spearman (empates con rango medio). NaN si alguna serie es constante o n < 2. */
export function spearman(x: ArrayLike<number>, y: ArrayLike<number>): number {
  if (x.length !== y.length) throw new RangeError('Spearman: las series deben tener el mismo largo.');
  if (x.length < 2) return NaN;
  return pearson(ranks(x), ranks(y));
}

/** Histograma y curva acumulada listos para graficar. */
export interface DistributionStats {
  /** Cantidad de valores finitos. */
  n: number;
  mean: number;
  /** Desvío estándar muestral (n − 1). */
  sd: number;
  min: number;
  max: number;
  /** Valor bajo, superado con 90 % de probabilidad (cuantil 10 %). */
  p90: number;
  p50: number;
  /** Valor alto, superado con 10 % de probabilidad (cuantil 90 %). */
  p10: number;
  /** `bins` clases iguales entre min y max: edges tiene bins + 1 valores. Si min = max: una sola clase. */
  histogram: { edges: number[]; counts: number[] };
  /** Curva acumulada empírica en 101 puntos: prob[i] = i/100, value[i] = cuantil. P(V ≤ value) = prob. */
  curve: { prob: number[]; value: number[] };
}

/** Estadísticos de una muestra (ignora no finitos). null si no queda ningún valor. */
export function describeSample(values: ArrayLike<number>, bins = 30): DistributionStats | null {
  const vals: number[] = [];
  for (let i = 0; i < values.length; i++) if (Number.isFinite(values[i]!)) vals.push(values[i]!);
  const n = vals.length;
  if (n === 0) return null;
  const sorted = Float64Array.from(vals).sort();
  // Welford: media y suma de cuadrados estables (una muestra constante da media exacta y desvío 0)
  let mean = 0;
  let m2 = 0;
  let k = 0;
  for (const v of sorted) {
    k++;
    const d = v - mean;
    mean += d / k;
    m2 += d * (v - mean);
  }
  const sd = n > 1 ? Math.sqrt(m2 / (n - 1)) : 0;
  const min = sorted[0]!;
  const max = sorted[n - 1]!;

  const nb = Math.max(1, Math.round(bins));
  let edges: number[];
  let counts: number[];
  if (max === min) {
    edges = [min, max];
    counts = [n];
  } else {
    edges = Array.from({ length: nb + 1 }, (_, i) => min + (i * (max - min)) / nb);
    edges[nb] = max;
    counts = new Array<number>(nb).fill(0);
    for (const v of sorted) counts[Math.min(nb - 1, Math.floor(((v - min) / (max - min)) * nb))]!++;
  }
  const prob: number[] = [];
  const value: number[] = [];
  for (let i = 0; i <= 100; i++) {
    prob.push(i / 100);
    value.push(quantileSorted(sorted, i / 100));
  }
  return {
    n,
    mean,
    sd,
    min,
    max,
    p90: quantileSorted(sorted, 0.1),
    p50: quantileSorted(sorted, 0.5),
    p10: quantileSorted(sorted, 0.9),
    histogram: { edges, counts },
    curve: { prob, value },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// h·φ·Sh perturbado

/** Factores a nivel muestra (globales): multiplicadores de φ y Sw y corrimientos aditivos de los cutoffs. */
export interface SampleFactors {
  phiMult: number;
  swMult: number;
  vshCutoffDelta: number;
  phiCutoffDelta: number;
  swCutoffDelta: number;
}

export const NEUTRAL_FACTORS: Readonly<SampleFactors> = { phiMult: 1, swMult: 1, vshCutoffDelta: 0, phiCutoffDelta: 0, swCutoffDelta: 0 };

const clamp = (x: number, lo: number, hi: number) => (x < lo ? lo : x > hi ? hi : x);

/**
 * Σ h·φ'·(1 − Sw') sobre el pay con cutoffs y curvas perturbados (ver cabecera). Mismas reglas de datos faltantes que
 * `summarizeRanges`: NaN si ninguna muestra queda clasificada o si hay reservorio pero ninguna muestra con Sw.
 * Con `NEUTRAL_FACTORS` es exactamente `hphiShPay` del sumario.
 * @param h       espesor por muestra (m)
 * @param vsh     Vsh (v/v)
 * @param phi     porosidad efectiva (v/v)
 * @param sw      Sw (v/v)
 * @param cutoffs cortes base (v/v)
 * @param f       factores perturbados
 */
export function perturbedHphiSh(
  h: ArrayLike<number>,
  vsh: ArrayLike<number>,
  phi: ArrayLike<number>,
  sw: ArrayLike<number>,
  cutoffs: Cutoffs,
  f: SampleFactors = NEUTRAL_FACTORS,
): number {
  const vshMax = clamp(cutoffs.vshMax + f.vshCutoffDelta, 0, 1);
  const phiMin = clamp(cutoffs.phiMin + f.phiCutoffDelta, 0, 0.5);
  const swMax = clamp(cutoffs.swMax + f.swCutoffDelta, 0, 1);
  const { phiMult, swMult } = f;
  const n = h.length;
  let nClassified = 0;
  let nRes = 0;
  let nPayKnown = 0;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = vsh[i]!;
    const p0 = phi[i]!;
    const p = p0 * phiMult > 0.5 ? 0.5 : p0 * phiMult; // NaN se propaga (la comparación es false)
    if (v > vshMax || p < phiMin) {
      nClassified++; // no reservorio (descarte por una curva conocida)
      continue;
    }
    if (Number.isNaN(v) || Number.isNaN(p)) continue; // sin dato
    nClassified++;
    nRes++;
    const w0 = sw[i]!;
    if (Number.isNaN(w0)) continue; // reservorio sin dato de pay
    nPayKnown++;
    const w = clamp(w0 * swMult, 0, 1); // NaN se propaga
    if (w <= swMax) sum += h[i]! * p * (1 - w);
  }
  if (nClassified === 0) return NaN;
  if (nRes > 0 && nPayKnown === 0) return NaN;
  return sum;
}

// ---------------------------------------------------------------------------------------------------------------
// Motor Monte Carlo + tornado

/** Parámetros inciertos. area/b son por zona (moverlos en el tornado mueve todas las zonas). */
export type UncertainParam = 'area' | 'b' | 'phiMult' | 'swMult' | 'vshCutoff' | 'phiCutoff' | 'swCutoff';

export const UNCERTAIN_PARAM_LABELS: Readonly<Record<UncertainParam, string>> = {
  area: 'Área',
  b: 'Factor de volumen (Bo/Bg)',
  phiMult: 'Porosidad (multiplicador)',
  swMult: 'Sw (multiplicador)',
  vshCutoff: 'Cutoff de Vsh',
  phiCutoff: 'Cutoff de porosidad',
  swCutoff: 'Cutoff de Sw',
};

const SAMPLE_KEYS = ['phiMult', 'swMult', 'vshCutoff', 'phiCutoff', 'swCutoff'] as const;
type SampleKey = (typeof SAMPLE_KEYS)[number];
const FACTOR_FIELD: Record<SampleKey, keyof SampleFactors> = {
  phiMult: 'phiMult',
  swMult: 'swMult',
  vshCutoff: 'vshCutoffDelta',
  phiCutoff: 'phiCutoffDelta',
  swCutoff: 'swCutoffDelta',
};

/** Zona del cálculo. `fluid = 'none'` (o sello) no aporta volumen y no es objetivo. */
export interface UncertainZone {
  id: string;
  name: string;
  fluid: FluidKind;
  /** Muestras de la zona (mismo largo): espesor (m), Vsh, φ y Sw (v/v). */
  h: ArrayLike<number>;
  vsh: ArrayLike<number>;
  phi: ArrayLike<number>;
  sw: ArrayLike<number>;
  /** Cutoffs base de la zona (v/v). */
  cutoffs: Cutoffs;
  /** Área (m²). */
  area: Dist;
  /** Factor de volumen de formación del fluido de la zona (m³/m³): Bo para petróleo, Bg para gas. */
  b: Dist;
}

/** Distribuciones de los factores globales. Lo ausente queda fijo en el valor neutro (mult 1, corrimiento 0). */
export interface SampleFactorDists {
  /** Multiplicador de φ (adim., moda 1). */
  phiMult?: Dist;
  /** Multiplicador de Sw (adim., moda 1). */
  swMult?: Dist;
  /** Corrimiento aditivo del cutoff de Vsh (v/v, moda 0). */
  vshCutoff?: Dist;
  /** Corrimiento aditivo del cutoff de φ (v/v, moda 0). */
  phiCutoff?: Dist;
  /** Corrimiento aditivo del cutoff de Sw (v/v, moda 0). */
  swCutoff?: Dist;
}

export interface UncertaintyConfig {
  zones: readonly UncertainZone[];
  factors?: SampleFactorDists;
  /** Iteraciones Monte Carlo (defecto 5000). */
  iterations?: number;
  /** Semilla del PRNG (defecto 42). */
  seed?: number;
  /** 'full' (defecto): mismo cuantil de área y B en todas las zonas; 'independent': un sorteo por zona. */
  zoneCorrelation?: 'full' | 'independent';
  /** Clases del histograma (defecto 30). */
  bins?: number;
  /** Cuantiles bajo/alto del tornado (defecto [0, 1] = mínimo y máximo de cada parámetro). */
  tornadoQuantiles?: readonly [number, number];
}

export interface TornadoRow {
  param: UncertainParam;
  label: string;
  /** Valor del parámetro en el extremo bajo/alto (área m², B, multiplicador, cutoff absoluto v/v). NaN si difiere entre zonas del total. */
  low: number;
  high: number;
  /** Volumen (m³) con el parámetro en el extremo bajo / alto. */
  vLow: number;
  vHigh: number;
  /** Volumen del caso base (todo en el más probable). */
  base: number;
  /** |vHigh − vLow|. */
  swing: number;
}

export interface SpearmanRow {
  param: UncertainParam;
  label: string;
  /** Zona del sorteo (solo con `zoneCorrelation = 'independent'` para área y B); null = parámetro único. */
  zoneId: string | null;
  rho: number;
}

/** Resultado para una zona o para el total de un fluido. */
export interface UncertaintyTarget {
  /** Id de la zona, o 'TOTAL_OIL' / 'TOTAL_GAS'. */
  key: string;
  name: string;
  kind: 'zone' | 'total';
  fluid: 'oil' | 'gas';
  /** Volumen del caso base (todo en el más probable), m³. */
  deterministic: number;
  stats: DistributionStats;
  /** Ordenado por amplitud descendente. */
  tornado: TornadoRow[];
  /** Ordenado por |ρ| descendente. */
  spearman: SpearmanRow[];
  /** Zonas incluidas (total) o la propia zona. */
  zoneIds: string[];
}

export interface UncertaintyResult {
  iterations: number;
  seed: number;
  zoneCorrelation: 'full' | 'independent';
  /** Zonas con volumen (en orden), luego TOTAL_OIL y TOTAL_GAS si corresponden. */
  targets: UncertaintyTarget[];
  /** Zonas sin objetivo y por qué (sin dato, sin hidrocarburo). */
  skipped: { id: string; name: string; reason: 'no-data' | 'no-fluid' }[];
}

interface Var {
  param: UncertainParam;
  zone: number; // índice en `active`, -1 = global
  dist: Dist;
  /** false si el parámetro no varía en ninguna zona (no entra en Spearman). */
  informative: boolean;
}

/**
 * Corre el Monte Carlo y el tornado. Ver la cabecera para el modelo y la convención de percentiles.
 * @throws RangeError ante distribuciones o configuración inválidas.
 */
export function runUncertainty(config: UncertaintyConfig): UncertaintyResult {
  const iterations = config.iterations ?? 5000;
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > 1_000_000) {
    throw new RangeError(`Las iteraciones deben ser un entero entre 1 y 1 000 000 (recibió ${iterations}).`);
  }
  const seed = config.seed ?? 42;
  if (!Number.isFinite(seed)) throw new RangeError('La semilla debe ser un número finito.');
  const correlation = config.zoneCorrelation ?? 'full';
  const bins = config.bins ?? 30;
  const [qLow, qHigh] = config.tornadoQuantiles ?? [0, 1];
  if (!(qLow >= 0 && qHigh <= 1 && qLow <= qHigh)) throw new RangeError('Los cuantiles del tornado deben cumplir 0 ≤ bajo ≤ alto ≤ 1.');

  // --- zonas activas y distribuciones -------------------------------------------------------------------------
  const skipped: UncertaintyResult['skipped'] = [];
  const active: UncertainZone[] = [];
  for (const z of config.zones) {
    if (z.fluid === 'none') {
      skipped.push({ id: z.id, name: z.name, reason: 'no-fluid' });
      continue;
    }
    checkDist(z.area, `Área de ${z.name}`);
    checkDist(z.b, `Factor de volumen de ${z.name}`);
    if (!(z.area.min >= 0)) throw new RangeError(`Área de ${z.name}: el mínimo no puede ser negativo.`);
    if (!(z.b.min > 0)) throw new RangeError(`Factor de volumen de ${z.name}: el mínimo debe ser positivo.`);
    const h0 = perturbedHphiSh(z.h, z.vsh, z.phi, z.sw, z.cutoffs, NEUTRAL_FACTORS);
    if (Number.isNaN(h0)) {
      skipped.push({ id: z.id, name: z.name, reason: 'no-data' });
      continue;
    }
    active.push(z);
  }
  const factorDists: Partial<Record<SampleKey, Dist>> = {};
  for (const k of SAMPLE_KEYS) {
    const d = config.factors?.[k];
    if (d) {
      checkDist(d, UNCERTAIN_PARAM_LABELS[k]);
      factorDists[k] = d;
    }
  }
  const neutralOf = (k: SampleKey): number => NEUTRAL_FACTORS[FACTOR_FIELD[k]];
  const modeOf = (k: SampleKey): number => factorDists[k]?.mode ?? neutralOf(k);

  const nz = active.length;
  const baseFactors: SampleFactors = { ...NEUTRAL_FACTORS };
  for (const k of SAMPLE_KEYS) baseFactors[FACTOR_FIELD[k]] = modeOf(k);

  // Variables sorteadas, en orden fijo: factores globales, luego área, luego B.
  const vars: Var[] = [];
  for (const k of SAMPLE_KEYS) if (factorDists[k]) vars.push({ param: k, zone: -1, dist: factorDists[k]!, informative: !isDegenerate(factorDists[k]!) });
  if (nz > 0) {
    if (correlation === 'full') {
      // un único sorteo compartido: informativo si varía en ALGUNA zona (la de referencia puede ser fija y otra no)
      vars.push({ param: 'area', zone: -1, dist: active[0]!.area, informative: active.some((z) => !isDegenerate(z.area)) });
      vars.push({ param: 'b', zone: -1, dist: active[0]!.b, informative: active.some((z) => !isDegenerate(z.b)) });
    } else {
      active.forEach((z, zi) => vars.push({ param: 'area', zone: zi, dist: z.area, informative: !isDegenerate(z.area) }));
      active.forEach((z, zi) => vars.push({ param: 'b', zone: zi, dist: z.b, informative: !isDegenerate(z.b) }));
    }
  }

  // --- evaluación de un punto (valores de todos los parámetros) --------------------------------------------------
  const areaOf = (zi: number, q: number) => distQuantile(active[zi]!.area, q);
  const bOf = (zi: number, q: number) => distQuantile(active[zi]!.b, q);

  const hphiOf = (zi: number, f: SampleFactors): number => {
    const z = active[zi]!;
    return perturbedHphiSh(z.h, z.vsh, z.phi, z.sw, z.cutoffs, f);
  };

  // --- objetivos -------------------------------------------------------------------------------------------------
  const oilZones: number[] = [];
  const gasZones: number[] = [];
  active.forEach((z, zi) => (z.fluid === 'oil' ? oilZones : gasZones).push(zi));
  interface TargetDef {
    key: string;
    name: string;
    kind: 'zone' | 'total';
    fluid: 'oil' | 'gas';
    zones: number[];
  }
  const defs: TargetDef[] = active.map((z, zi) => ({ key: z.id, name: z.name, kind: 'zone', fluid: z.fluid as 'oil' | 'gas', zones: [zi] }));
  if (oilZones.length > 0) defs.push({ key: 'TOTAL_OIL', name: 'Total petróleo', kind: 'total', fluid: 'oil', zones: oilZones });
  if (gasZones.length > 0) defs.push({ key: 'TOTAL_GAS', name: 'Total gas', kind: 'total', fluid: 'gas', zones: gasZones });
  const sumTargets = (zoneVols: ArrayLike<number>): number[] => defs.map((d) => d.zones.reduce((s, zi) => s + zoneVols[zi]!, 0));

  // --- caso base y tornado -----------------------------------------------------------------------------------------
  const volumesAt = (area: (zi: number) => number, b: (zi: number) => number, f: SampleFactors, hphiCache?: Float64Array): Float64Array => {
    const out = new Float64Array(nz);
    for (let zi = 0; zi < nz; zi++) {
      const hphi = hphiCache ? hphiCache[zi]! : hphiOf(zi, f);
      out[zi] = inPlaceVolume(area(zi), Number.isNaN(hphi) ? 0 : hphi, b(zi));
    }
    return out;
  };
  const baseHphiArr = new Float64Array(nz);
  for (let zi = 0; zi < nz; zi++) baseHphiArr[zi] = hphiOf(zi, baseFactors);
  const baseVols = volumesAt((zi) => active[zi]!.area.mode, (zi) => active[zi]!.b.mode, baseFactors, baseHphiArr);
  const baseTargets = sumTargets(baseVols);

  const tornado: TornadoRow[][] = defs.map(() => []);
  const tornadoParams: UncertainParam[] = [];
  for (const k of SAMPLE_KEYS) if (factorDists[k] && !isDegenerate(factorDists[k]!)) tornadoParams.push(k);
  if (nz > 0 && active.some((z) => !isDegenerate(z.area))) tornadoParams.push('area');
  if (nz > 0 && active.some((z) => !isDegenerate(z.b))) tornadoParams.push('b');
  for (const param of tornadoParams) {
    const at = (q: number): { vols: Float64Array; values: number[] } => {
      const f: SampleFactors = { ...baseFactors };
      let area = (zi: number) => active[zi]!.area.mode;
      let b = (zi: number) => active[zi]!.b.mode;
      const values: number[] = new Array<number>(nz);
      if (param === 'area') {
        area = (zi) => areaOf(zi, q);
        for (let zi = 0; zi < nz; zi++) values[zi] = area(zi);
      } else if (param === 'b') {
        b = (zi) => bOf(zi, q);
        for (let zi = 0; zi < nz; zi++) values[zi] = b(zi);
      } else {
        const k = param as SampleKey;
        const delta = distQuantile(factorDists[k]!, q);
        f[FACTOR_FIELD[k]] = delta;
        for (let zi = 0; zi < nz; zi++) {
          const c = active[zi]!.cutoffs;
          values[zi] = k === 'vshCutoff' ? clamp(c.vshMax + delta, 0, 1) : k === 'phiCutoff' ? clamp(c.phiMin + delta, 0, 0.5) : k === 'swCutoff' ? clamp(c.swMax + delta, 0, 1) : delta;
        }
      }
      return { vols: volumesAt(area, b, f), values };
    };
    const lo = at(qLow);
    const hi = at(qHigh);
    const vLow = sumTargets(lo.vols);
    const vHigh = sumTargets(hi.vols);
    defs.forEach((d, ti) => {
      const same = (vals: number[]) => (d.zones.every((zi) => vals[zi] === vals[d.zones[0]!]) ? vals[d.zones[0]!]! : NaN);
      tornado[ti]!.push({
        param,
        label: UNCERTAIN_PARAM_LABELS[param],
        low: same(lo.values),
        high: same(hi.values),
        vLow: vLow[ti]!,
        vHigh: vHigh[ti]!,
        base: baseTargets[ti]!,
        swing: Math.abs(vHigh[ti]! - vLow[ti]!),
      });
    });
  }
  const order = new Map(tornadoParams.map((p, i) => [p, i]));
  for (const rows of tornado) rows.sort((a, b) => b.swing - a.swing || order.get(a.param)! - order.get(b.param)!);

  // --- Monte Carlo ----------------------------------------------------------------------------------------------------
  const rng = mulberry32(seed);
  const nv = vars.length;
  const U = nv > 0 ? Array.from({ length: nv }, () => new Float64Array(iterations)) : [];
  const results = defs.map(() => new Float64Array(iterations));
  const sampleLevel = SAMPLE_KEYS.some((k) => factorDists[k] && !isDegenerate(factorDists[k]!));
  const factors: SampleFactors = { ...baseFactors };
  const zoneVols = new Float64Array(nz);
  const hphiNow = new Float64Array(nz);
  hphiNow.set(baseHphiArr);
  const uvals = new Float64Array(nv);
  const qa = new Float64Array(nz);
  const qb = new Float64Array(nz);
  for (let it = 0; it < iterations; it++) {
    for (let v = 0; v < nv; v++) {
      const u = rng();
      uvals[v] = u;
      U[v]![it] = u;
    }
    let vi = 0;
    for (const k of SAMPLE_KEYS) {
      if (!factorDists[k]) continue;
      factors[FACTOR_FIELD[k]] = distQuantile(factorDists[k]!, uvals[vi++]!);
    }
    if (nz > 0) {
      if (correlation === 'full') {
        qa.fill(uvals[vi++]!);
        qb.fill(uvals[vi++]!);
      } else {
        for (let zi = 0; zi < nz; zi++) qa[zi] = uvals[vi++]!;
        for (let zi = 0; zi < nz; zi++) qb[zi] = uvals[vi++]!;
      }
    }
    if (sampleLevel) for (let zi = 0; zi < nz; zi++) hphiNow[zi] = hphiOf(zi, factors);
    for (let zi = 0; zi < nz; zi++) {
      const z = active[zi]!;
      const hphi = hphiNow[zi]!;
      zoneVols[zi] = inPlaceVolume(distQuantile(z.area, qa[zi]!), Number.isNaN(hphi) ? 0 : hphi, distQuantile(z.b, qb[zi]!));
    }
    const t = sumTargets(zoneVols);
    for (let ti = 0; ti < defs.length; ti++) results[ti]![it] = t[ti]!;
  }

  // --- resumen ---------------------------------------------------------------------------------------------------------
  const informative = vars.map((v) => v.informative);
  const uRanks = U.map((u, v) => (informative[v] ? ranks(u) : null));
  const targets: UncertaintyTarget[] = defs.map((d, ti) => {
    const stats = describeSample(results[ti]!, bins)!;
    const yRanks = ranks(results[ti]!);
    const rows: SpearmanRow[] = [];
    vars.forEach((v, vi) => {
      if (!informative[vi]) return;
      if (v.zone >= 0 && !d.zones.includes(v.zone)) return; // sorteo de otra zona
      const rho = pearson(uRanks[vi]!, yRanks);
      rows.push({ param: v.param, label: UNCERTAIN_PARAM_LABELS[v.param], zoneId: v.zone >= 0 ? active[v.zone]!.id : null, rho: Number.isNaN(rho) ? 0 : rho });
    });
    rows.sort((a, b) => Math.abs(b.rho) - Math.abs(a.rho));
    return {
      key: d.key,
      name: d.name,
      kind: d.kind,
      fluid: d.fluid,
      deterministic: baseTargets[ti]!,
      stats,
      tornado: tornado[ti]!,
      spearman: rows,
      zoneIds: d.zones.map((zi) => active[zi]!.id),
    };
  });
  return { iterations, seed, zoneCorrelation: correlation, targets, skipped };
}
