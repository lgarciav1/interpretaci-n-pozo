/**
 * Calibración del perfil con corona (función N): emparejamiento plug–perfil, estadística de calibración de φ,
 * densidad de matriz desde corona, densidad de matriz aparente y exponente de cementación.
 *
 * Unidades: φ y Sw en v/v (fracción, NO %); densidades en g/cc; resistividades en ohm·m; profundidades en m (misma
 * escala para plugs y perfil: la profundidad CORREGIDA de los plugs, ver `shiftedDepth` y docs/decisiones/0010).
 * Sin dato (NaN) → NaN; los pares con algún NaN o ±Infinity se ignoran en toda estadística y ajuste. Las funciones
 * `...Into(entrada, salida, …)` escriben en un Float64Array del mismo índice, igual que porosity.ts.
 *
 * Ecuaciones (cada una repetida junto a su función):
 *   Valor del perfil en el plug     L(z) interpolado linealmente, o promedio en ventana [z − h, z + h]
 *   Sesgo, RMSE, MAE                sesgo = mean(L − C);  RMSE = √mean((L − C)²);  MAE = mean|L − C|   (L perfil, C corona)
 *   Recta de calibración            C ≈ b0 + b1·L  por mínimos cuadrados (OLS) o por eje mayor reducido (RMA)
 *   Densidad de matriz aparente     ρmaa = (ρb − φ·ρf) / (1 − φ)
 *   ρma que reproduce φ corona      ρma = ρf + Σdᵢ² / Σ dᵢ(1 − φcᵢ),   dᵢ = ρbᵢ − ρf     (solución cerrada)
 *   Archie                          F = a / φ^m   ⇒   ln F = ln a − m·ln φ
 *   m por plug (zona acuífera)      m = ln(a·Rw / Rt) / ln φ
 *
 * Referencias: Asquith y Krygowski (2004), "Basic Well Log Analysis", AAPG Methods in Exploration 16, cap. 4
 * (porosidad densidad, ρmaa) y cap. 5 (Archie; valores de Humble a = 0,62, m = 2,15); Bateman, R.M. (1985),
 * "Openhole Log Analysis and Formation Evaluation" (calibración con corona); Archie, G.E. (1942), "The electrical
 * resistivity log as an aid in determining some reservoir characteristics", Trans. AIME 146; Ricker, W.E. (1973),
 * "Linear regressions in fishery research", J. Fisheries Research Board of Canada 30(3); Warton, D.I. et al. (2006),
 * "Bivariate line-fitting methods for allometry", Biological Reviews 81(2); Draper y Smith (1998), "Applied
 * Regression Analysis".
 */

import { interpolateAt } from './depthMatch';
import { quantileSorted } from './uncertainty';

// ── emparejamiento plug–perfil ─────────────────────────────────────────────────────────────────────────────────

/** Primer índice i con depth[i] >= z (búsqueda binaria; depth creciente). Interno. */
function lowerBound(depth: ArrayLike<number>, n: number, z: number): number {
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (depth[mid]! < z) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Valor de una curva del perfil en cada plug.
 *
 *   halfWindow = 0   interpolación lineal en z (`interpolateAt`: NaN si z está fuera del perfil o un vecino no tiene dato).
 *   halfWindow = h>0 promedio simple de las muestras finitas con z − h ≤ profundidad ≤ z + h. Sirve para suavizar la
 *                    diferencia de resolución vertical: un plug (≈ 2,5–4 cm) ve una escala mucho menor que la
 *                    densidad/neutrón (≈ 0,4–0,6 m), así que comparar un plug contra una muestra puntual del perfil
 *                    mezcla escalas; el promedio del perfil en una ventana de ese orden (h ≈ 0,15–0,3 m) emula la
 *                    resolución de la herramienta y reduce la dispersión plug–perfil. Si la ventana no contiene ninguna
 *                    muestra finita se cae a la interpolación lineal.
 *
 * Un plug fuera del rango de profundidad del perfil (z < primera o z > última muestra) da NaN en ambos modos.
 *
 * @param plugDepth profundidad corregida de cada plug (m)
 * @param logDepth  profundidad del perfil (m, creciente)
 * @param logValues curva del perfil (NaN = sin dato)
 * @param halfWindow semiancho h de la ventana (m, ≥ 0; por defecto 0)
 */
export function matchLogToPlugs(
  plugDepth: ArrayLike<number>,
  logDepth: ArrayLike<number>,
  logValues: ArrayLike<number>,
  halfWindow = 0,
): Float64Array {
  const out = new Float64Array(plugDepth.length);
  const n = Math.min(logDepth.length, logValues.length);
  const h = halfWindow > 0 && Number.isFinite(halfWindow) ? halfWindow : 0;
  for (let p = 0; p < plugDepth.length; p++) {
    const z = plugDepth[p]!;
    if (n === 0 || !Number.isFinite(z) || z < logDepth[0]! || z > logDepth[n - 1]!) {
      out[p] = NaN;
      continue;
    }
    if (h === 0) {
      out[p] = interpolateAt(logDepth, logValues, z);
      continue;
    }
    let sum = 0;
    let cnt = 0;
    for (let i = lowerBound(logDepth, n, z - h); i < n && logDepth[i]! <= z + h; i++) {
      const v = logValues[i]!;
      if (Number.isFinite(v)) {
        sum += v;
        cnt++;
      }
    }
    out[p] = cnt > 0 ? sum / cnt : interpolateAt(logDepth, logValues, z);
  }
  return out;
}

// ── estadística de calibración φ perfil vs. φ corona ───────────────────────────────────────────────────────────

/** Recta y = intercept + slope·x. */
export interface LineFit {
  slope: number;
  intercept: number;
}

export interface CalibrationStats {
  /** Pares con ambos valores finitos. */
  n: number;
  /** Sesgo medio perfil − corona (unidad de la variable; > 0 = el perfil sobreestima). */
  bias: number;
  /** Desvío estándar muestral (n − 1) de las diferencias perfil − corona. */
  sdDiff: number;
  /** √mean((perfil − corona)²). Cumple RMSE² = sesgo² + sdDiff²·(n − 1)/n. */
  rmse: number;
  /** mean|perfil − corona|. */
  mae: number;
  /** Coeficiente de correlación de Pearson (NaN si alguna varianza es nula o n < 2). */
  r: number;
  /** r² (coeficiente de determinación de la regresión lineal; NO mide cuánto se acerca a la recta 1:1). */
  r2: number;
  /** Corona = intercept + slope·perfil por mínimos cuadrados ordinarios (null si n < 2 o perfil constante). */
  ols: LineFit | null;
  /** Corona = intercept + slope·perfil por eje mayor reducido (null si n < 2 o alguna variable es constante). */
  rma: LineFit | null;
}

/**
 * Estadística de calibración del perfil contra la corona (p. ej. φ del perfil vs. φ de corona en los plugs).
 *
 *   sesgo = mean(L − C)      RMSE = √mean((L − C)²)      MAE = mean|L − C|        (L perfil, C corona)
 *
 * Recta de calibración perfil → corona, C ≈ b0 + b1·L, con sxx = Σ(L − L̄)², syy = Σ(C − C̄)², sxy = Σ(L − L̄)(C − C̄):
 *   OLS   b1 = sxy / sxx                       b0 = C̄ − b1·L̄
 *   RMA   b1 = signo(sxy)·√(syy / sxx)         b0 = C̄ − b1·L̄        (eje mayor reducido, "standardised major axis")
 *
 * Por qué RMA además de OLS. OLS supone que la variable explicativa (L) no tiene error y solo C lo tiene. Acá ambas
 * tienen: el perfil por resolución vertical, ruido de herramienta, parámetros de matriz y fluido y efecto de pozo; la
 * corona por medición de laboratorio, presión de confinamiento y muestreo de un volumen minúsculo. Con error en la
 * variable explicativa, la pendiente de OLS se atenúa hacia 0 (dilución de la regresión) y además depende de cuál
 * variable se llame x: la recta de C sobre L y la de L sobre C NO son la misma. RMA trata a ambas simétricamente
 * (minimiza la suma de las áreas de los triángulos entre punto y recta): su pendiente es el cociente de desvíos
 * estándar, es invariante al cambio de unidades de cada eje y la recta invertida (L sobre C) es la misma recta. Su
 * precaución: la pendiente no depende de r, así que con correlación débil exagera la pendiente; usarla solo si r es
 * razonablemente alto (la estadística devuelve r para decidirlo). Si se va a PREDECIR C a partir de L con mínimo error
 * cuadrático, OLS es el estimador de menor error; RMA es el que preserva la dispersión (varianza) de la propiedad.
 *
 * Convención de NaN: se descartan los pares con algún valor no finito. n = 0 → todo NaN y ajustes null.
 *
 * @param core valores de corona (referencia), p. ej. φ en v/v en cada plug
 * @param log  valores del perfil en los mismos plugs (ver `matchLogToPlugs`); misma longitud (si no, la menor)
 */
export function calibrationStats(core: ArrayLike<number>, log: ArrayLike<number>): CalibrationStats {
  const len = Math.min(core.length, log.length);
  let n = 0;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < len; i++) {
    const c = core[i]!;
    const l = log[i]!;
    if (!Number.isFinite(c) || !Number.isFinite(l)) continue;
    n++;
    mx += l;
    my += c;
  }
  if (n === 0) {
    return { n: 0, bias: NaN, sdDiff: NaN, rmse: NaN, mae: NaN, r: NaN, r2: NaN, ols: null, rma: null };
  }
  mx /= n;
  my /= n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  let sumD = 0;
  let sumD2 = 0;
  let sumAbs = 0;
  let ssDiff = 0;
  const meanDiff = mx - my;
  for (let i = 0; i < len; i++) {
    const c = core[i]!;
    const l = log[i]!;
    if (!Number.isFinite(c) || !Number.isFinite(l)) continue;
    const dx = l - mx;
    const dy = c - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
    const d = l - c;
    sumD += d;
    sumD2 += d * d;
    sumAbs += Math.abs(d);
    ssDiff += (d - meanDiff) * (d - meanDiff);
  }
  const bias = sumD / n;
  const rmse = Math.sqrt(sumD2 / n);
  const mae = sumAbs / n;
  // Σ(d − d̄)² centrado en una segunda pasada: la forma Σd² − n·d̄² pierde todas las cifras cuando |sesgo| ≫ desvío.
  const varDiff = n > 1 ? ssDiff / (n - 1) : NaN;

  // Varianza nula con tolerancia relativa a la escala de los datos (una serie constante deja ruido de redondeo).
  const xOk = n >= 2 && sxx > 1e-20 * n * mx * mx;
  const yOk = n >= 2 && syy > 1e-20 * n * my * my;
  const r = xOk && yOk ? Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy))) : NaN;
  let ols: LineFit | null = null;
  let rma: LineFit | null = null;
  if (xOk) {
    const slope = sxy / sxx;
    ols = { slope, intercept: my - slope * mx };
  }
  if (xOk && yOk) {
    const slope = (sxy < 0 ? -1 : 1) * Math.sqrt(syy / sxx);
    rma = { slope, intercept: my - slope * mx };
  }
  return { n, bias, sdDiff: Math.sqrt(varDiff), rmse, mae, r, r2: r * r, ols, rma };
}

/** Evalúa la recta de calibración en un valor del perfil, recortando a [min, max]. NaN si el valor no es finito. */
export function applyCalibration(value: number, line: LineFit, min = -Infinity, max = Infinity): number {
  if (!Number.isFinite(value) || !Number.isFinite(line.slope) || !Number.isFinite(line.intercept)) return NaN;
  const v = line.intercept + line.slope * value;
  return v < min ? min : v > max ? max : v;
}

/**
 * Corrección perfil → corona de una curva completa: out[i] = intercept + slope·values[i], recortada a [min, max]
 * (para φ pasar 0 y 0,5, el rango físico de porosity.ts; por defecto no recorta). Tramo [start, end).
 */
export function applyCalibrationInto(
  values: ArrayLike<number>,
  out: Float64Array,
  line: LineFit,
  min = -Infinity,
  max = Infinity,
  start = 0,
  end = values.length,
): Float64Array {
  for (let i = start; i < end; i++) out[i] = applyCalibration(values[i]!, line, min, max);
  return out;
}

// ── estadísticos de una muestra (densidad de grano, ρmaa por zona…) ─────────────────────────────────────────────

export interface ValueSummary {
  /** Valores finitos usados. */
  n: number;
  mean: number;
  median: number;
  /** Desvío estándar muestral (n − 1); NaN si n < 2. */
  sd: number;
  /** Percentil 10 y 90 de la distribución (P10 = valor bajo el cual está el 10 % de las muestras; NO es la convención de
   *  reservas, donde P10 es el valor alto). Interpolación lineal tipo 7, igual que `percentile` de stats.ts. */
  p10: number;
  p90: number;
  min: number;
  max: number;
}

const EMPTY_SUMMARY: ValueSummary = {
  n: 0, mean: NaN, median: NaN, sd: NaN, p10: NaN, p90: NaN, min: NaN, max: NaN,
};

/**
 * Media, mediana, desvío, P10/P90, mínimo y máximo de los valores finitos de [start, end) que cumplen `include`
 * (todos si se omite; recibe el índice de la muestra, sirve de máscara: `(i) => netRes[i] === 1`). Vacío → n = 0 y NaN.
 * Con densidad de grano de plugs es la estadística de la densidad de matriz desde corona (grano ≈ matriz).
 */
export function summarizeValues(
  values: ArrayLike<number>,
  start = 0,
  end = values.length,
  include?: (i: number) => boolean,
): ValueSummary {
  const xs: number[] = [];
  const hi = Math.min(end, values.length);
  for (let i = Math.max(0, start); i < hi; i++) {
    const v = values[i]!;
    if (!Number.isFinite(v)) continue;
    if (include && !include(i)) continue;
    xs.push(v);
  }
  const n = xs.length;
  if (n === 0) return { ...EMPTY_SUMMARY };
  xs.sort((a, b) => a - b);
  let sum = 0;
  for (const v of xs) sum += v;
  const mean = sum / n;
  let ss = 0;
  for (const v of xs) ss += (v - mean) * (v - mean);
  return {
    n,
    mean,
    median: quantileSorted(xs, 0.5),
    sd: n > 1 ? Math.sqrt(ss / (n - 1)) : NaN,
    p10: quantileSorted(xs, 0.1),
    p90: quantileSorted(xs, 0.9),
    min: xs[0]!,
    max: xs[n - 1]!,
  };
}

/** `summarizeValues` por cada rango [start, end) (zonas), con la misma máscara opcional. Mismo orden que `ranges`. */
export function summarizeByRanges(
  values: ArrayLike<number>,
  ranges: readonly { start: number; end: number }[],
  include?: (i: number) => boolean,
): ValueSummary[] {
  return ranges.map((r) => summarizeValues(values, r.start, r.end, include));
}

// ── densidad de matriz aparente ρmaa ───────────────────────────────────────────────────────────────────────────

/**
 * Densidad de matriz aparente: ρmaa = (ρb − φ·ρf) / (1 − φ)  (g/cc).
 * Es la densidad de matriz que haría que la porosidad densidad coincidiera con la porosidad independiente φ elegida
 * (neutrón–densidad, PHIE o corona): se obtiene despejando ρma de φ = (ρma − ρb)/(ρma − ρf).
 * Solo es una densidad de matriz en zonas limpias y con el fluido supuesto en ρf (acuíferas: ρf = ρmf); en zonas con
 * hidrocarburo ligero, ρf real < ρf supuesto y ρmaa queda por debajo (o por encima, según el caso) de la matriz.
 *
 * Guardas: ρb, φ o ρf no finitos → NaN; φ < 0 o φ ≥ 1 → NaN (división por cero o φ no física).
 * @param rhoB densidad de formación (g/cc)
 * @param phi  porosidad independiente (v/v)
 * @param rhoF densidad de fluido (g/cc), > 0
 */
export function apparentMatrixDensity(rhoB: number, phi: number, rhoF: number): number {
  if (!Number.isFinite(rhoB) || !Number.isFinite(phi) || !Number.isFinite(rhoF)) return NaN;
  if (phi < 0 || phi >= 1) return NaN;
  return (rhoB - phi * rhoF) / (1 - phi);
}

/** Variante por tramo [start, end) de `apparentMatrixDensity`, escrita en `out` (mismo índice). ρf único del tramo. */
export function apparentMatrixDensityInto(
  rhoB: ArrayLike<number>,
  phi: ArrayLike<number>,
  out: Float64Array,
  rhoF: number,
  start = 0,
  end = rhoB.length,
): Float64Array {
  for (let i = start; i < end; i++) out[i] = apparentMatrixDensity(rhoB[i]!, phi[i]!, rhoF);
  return out;
}

// ── densidad de matriz que reproduce la porosidad de corona ────────────────────────────────────────────────────

export interface MatrixDensityFit {
  /** Densidad de matriz óptima (g/cc). */
  rhoMa: number;
  /** Plugs usados. */
  n: number;
  /** Sesgo medio de φD − φcorona con la ρma ajustada (v/v). */
  bias: number;
  /** √mean((φD − φcorona)²) con la ρma ajustada (v/v). */
  rmse: number;
  /** true si la solución cayó fuera de `bounds` y se recortó. */
  clamped: boolean;
}

/**
 * Densidad de matriz que hace que la porosidad densidad coincida, en mínimos cuadrados, con la porosidad de corona.
 *
 *   φD,i(ρma) = (ρma − ρb,i)/(ρma − ρf)       minimizar  S(ρma) = Σ (φD,i − φc,i)²
 *
 * SOLUCIÓN CERRADA (no hace falta búsqueda): con dᵢ = ρb,i − ρf y t = 1/(ρma − ρf) resulta φD,i = 1 − dᵢ·t, lineal en
 * t, de modo que S es cuadrática en t y su mínimo es
 *
 *   t* = Σ dᵢ(1 − φc,i) / Σ dᵢ²      ⇒      ρma = ρf + Σ dᵢ² / Σ dᵢ(1 − φc,i).
 *
 * Con datos exactos (φc,i = φD,i para una misma ρma) devuelve esa ρma; con un solo plug es ρmaa(φc) de ese plug. Se
 * minimiza el error en φ (que es lo que se compara con la corona), no en ρ: como ρma ≠ media de los ρmaa por plug, ambas
 * se informan por separado. No incluye el recorte a [0; 0,5] de `densityPorosity` (el ajuste ve los φD sin recortar).
 * Se descartan plugs con ρb o φc no finitos, φc fuera de [0, 1) o ρb ≤ ρf (densidad no física frente al fluido).
 * `bounds` (p. ej. [2,5; 3,0], rango de matrices de arenisca–caliza–dolomía) recorta la solución; si recorta,
 * `clamped = true` y el sesgo y el RMSE se calculan con la ρma recortada.
 *
 * @param rhoB    densidad del perfil en los plugs (g/cc), ver `matchLogToPlugs`
 * @param phiCore porosidad de corona de los plugs (v/v)
 * @param rhoF    densidad de fluido (g/cc), > 0
 * @returns null si no queda ningún par válido, ρf no es válida o la solución no es física (ρma ≤ ρf)
 */
export function matrixDensityMatchingCore(
  rhoB: ArrayLike<number>,
  phiCore: ArrayLike<number>,
  rhoF: number,
  bounds?: readonly [number, number],
): MatrixDensityFit | null {
  if (!Number.isFinite(rhoF) || !(rhoF > 0)) return null;
  const len = Math.min(rhoB.length, phiCore.length);
  let sdd = 0;
  let sdp = 0;
  let n = 0;
  for (let i = 0; i < len; i++) {
    const d = rhoB[i]! - rhoF;
    const p = phiCore[i]!;
    if (!Number.isFinite(d) || !Number.isFinite(p) || p < 0 || p >= 1 || !(d > 0)) continue;
    sdd += d * d;
    sdp += d * (1 - p);
    n++;
  }
  if (n === 0 || !(sdp > 0)) return null;
  let rhoMa = rhoF + sdd / sdp;
  let clamped = false;
  if (bounds) {
    const lo = Math.min(bounds[0], bounds[1]);
    const hi = Math.max(bounds[0], bounds[1]);
    if (rhoMa < lo) {
      rhoMa = lo;
      clamped = true;
    } else if (rhoMa > hi) {
      rhoMa = hi;
      clamped = true;
    }
  }
  const u = rhoMa - rhoF;
  if (!(u > 0)) return null;
  let sumE = 0;
  let sumE2 = 0;
  for (let i = 0; i < len; i++) {
    const d = rhoB[i]! - rhoF;
    const p = phiCore[i]!;
    if (!Number.isFinite(d) || !Number.isFinite(p) || p < 0 || p >= 1 || !(d > 0)) continue;
    const e = 1 - d / u - p;
    sumE += e;
    sumE2 += e * e;
  }
  return { rhoMa, n, bias: sumE / n, rmse: Math.sqrt(sumE2 / n), clamped };
}

// ── exponente de cementación m ─────────────────────────────────────────────────────────────────────────────────

/** Factor de formación F = Ro / Rw (Ro: resistividad de la roca 100 % saturada de agua, Rw: del agua; mismas unidades). */
export function formationFactor(ro: number, rw: number): number {
  if (!(ro > 0) || !(rw > 0) || ro === Infinity || rw === Infinity) return NaN;
  return ro / rw;
}

export interface CementationFit {
  /** Exponente de cementación. */
  m: number;
  /** Factor de tortuosidad (el fijado, o el ajustado en el caso a libre). */
  a: number;
  /** 1 − SSE/SST de ln F (SST centrada). Con a fijo puede ser negativo: la recta no tiene libre la ordenada. */
  r2: number;
  /** Raíz del error cuadrático medio de log10 F (factor multiplicativo del residuo: 10^rmse). */
  rmseLog10F: number;
  n: number;
}

export interface CementationResult {
  /** Plugs con φ ∈ (0, 1) y F > 0 finitos. */
  n: number;
  /** Con `a` fijo (por defecto 1): ln(F/a) = −m·ln φ, regresión por el origen. null si n < 1. */
  fixedA: CementationFit | null;
  /** Con a libre: ln F = ln a − m·ln φ, regresión lineal con ordenada. null si n < 3 o ln φ constante. */
  freeA: CementationFit | null;
}

/**
 * Exponente de cementación m desde el factor de formación F medido en plugs (ensayo de resistividad eléctrica).
 *
 * Archie:  F = a / φ^m   ⇒   ln F = ln a − m·ln φ.
 *   a fijo   (típico a = 1, o el de Humble 0,62):  ln(F/a) = −m·ln φ es una recta POR EL ORIGEN:
 *            m = − Σ xᵢyᵢ / Σ xᵢ²,   xᵢ = ln φᵢ,   yᵢ = ln(Fᵢ/a)
 *   a libre: recta con ordenada,  m = −Sxy/Sxx,   ln a = ȳ + m·x̄      (con n ≥ 3; con 2 puntos pasa exacto)
 * Como m y a están correlacionados (varias parejas dan ajustes casi iguales en el rango de φ de los plugs), el m con a
 * libre es poco robusto con pocos plugs o un rango estrecho de φ: preferir a fijo salvo que haya muchos plugs y amplio
 * rango de φ. Los resultados (ln o log10) son iguales: el logaritmo solo escala F.
 *
 * @param phi plugs: porosidad (v/v), se usan los φ ∈ (0, 1)
 * @param F   factor de formación de cada plug (> 0), p. ej. de `formationFactor`
 * @param a   factor de tortuosidad para el caso de a fijo (por defecto 1)
 */
export function fitCementationExponent(phi: ArrayLike<number>, F: ArrayLike<number>, a = 1): CementationResult {
  const len = Math.min(phi.length, F.length);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < len; i++) {
    const p = phi[i]!;
    const f = F[i]!;
    if (!(p > 0 && p < 1) || !(f > 0) || f === Infinity) continue;
    xs.push(Math.log(p));
    ys.push(Math.log(f));
  }
  const n = xs.length;
  if (n === 0) return { n: 0, fixedA: null, freeA: null };

  const finish = (m: number, lnA: number): CementationFit => {
    let my = 0;
    for (const y of ys) my += y;
    my /= n;
    let sse = 0;
    let sst = 0;
    for (let i = 0; i < n; i++) {
      const e = ys[i]! - (lnA - m * xs[i]!);
      sse += e * e;
      sst += (ys[i]! - my) * (ys[i]! - my);
    }
    return {
      m,
      a: Math.exp(lnA),
      r2: sst > 0 ? 1 - sse / sst : NaN,
      rmseLog10F: Math.sqrt(sse / n) / Math.LN10,
      n,
    };
  };

  let fixedA: CementationFit | null = null;
  if (a > 0 && a < Infinity) {
    const lnA = Math.log(a);
    let sxy = 0;
    let sxx = 0;
    for (let i = 0; i < n; i++) {
      sxy += xs[i]! * (ys[i]! - lnA);
      sxx += xs[i]! * xs[i]!;
    }
    if (sxx > 0) fixedA = finish(-sxy / sxx, lnA);
  }

  let freeA: CementationFit | null = null;
  if (n >= 3) {
    let mx = 0;
    let my = 0;
    for (let i = 0; i < n; i++) {
      mx += xs[i]!;
      my += ys[i]!;
    }
    mx /= n;
    my /= n;
    let sxx = 0;
    let sxy = 0;
    for (let i = 0; i < n; i++) {
      sxx += (xs[i]! - mx) * (xs[i]! - mx);
      sxy += (xs[i]! - mx) * (ys[i]! - my);
    }
    if (sxx > 1e-20 * n * mx * mx && sxx > 0) {
      const m = -sxy / sxx;
      freeA = finish(m, my + m * mx);
    }
  }
  return { n, fixedA, freeA };
}

/**
 * Exponente de cementación de un plug en zona acuífera (Sw = 1 ⇒ Rt = Ro = F·Rw).
 *
 *   F = Rt/Rw = a/φ^m   ⇒   φ^m = a·Rw/Rt   ⇒   m = ln(a·Rw / Rt) / ln φ  = ln(Rt/(a·Rw)) / ln(1/φ)
 *
 * Es un valor por plug: ruidoso (el error de Rt, Rw y φ se amplifica por 1/ln φ); usar la mediana de la zona o
 * `fitCementationExponent` con F = Rt/Rw. Solo vale en intervalos 100 % acuíferos, sin arcilla conductiva y con Rw bien
 * conocida. Resultados fuera de ~1,3–3 indican datos o hipótesis (zona no acuífera, arcilla) dudosos: no se recortan.
 *
 * Guardas: φ ∉ (0, 1), Rt ≤ 0, Rw ≤ 0, a ≤ 0 o cualquier entrada no finita → NaN.
 * @param phi φ de corona o del perfil (v/v)
 * @param rt  resistividad verdadera en la zona acuífera (ohm·m)
 * @param rw  resistividad del agua de formación (ohm·m)
 * @param a   factor de tortuosidad (por defecto 1)
 */
export function cementationExponentFromRt(phi: number, rt: number, rw: number, a = 1): number {
  if (!(phi > 0 && phi < 1) || !(rt > 0 && rt < Infinity) || !(rw > 0 && rw < Infinity) || !(a > 0 && a < Infinity)) {
    return NaN;
  }
  return Math.log((a * rw) / rt) / Math.log(phi);
}

/** Variante por tramo [start, end) de `cementationExponentFromRt`, escrita en `out`. Rw y a únicos del tramo. */
export function cementationExponentFromRtInto(
  phi: ArrayLike<number>,
  rt: ArrayLike<number>,
  out: Float64Array,
  rw: number,
  a = 1,
  start = 0,
  end = phi.length,
): Float64Array {
  for (let i = start; i < end; i++) out[i] = cementationExponentFromRt(phi[i]!, rt[i]!, rw, a);
  return out;
}
