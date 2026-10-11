/**
 * Perfil radial de invasión escalonada a partir de la inducción de arreglo (AT10, AT20, AT30, AT60, AT90).
 *
 * Unidades: resistividades en ohm·m; conductividades en S/m (σ = 1/R); distancias radiales, diámetros y
 * profundidades de investigación en pulgadas. Sin dato (NaN, ≤ 0, no finito) → sin dato. Las lecturas se suponen
 * ya corregidas por pozo y por capas adyacentes (como las entrega el procesamiento de la herramienta).
 *
 * ── Modelo ───────────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Perfil escalonado en conductividad: zona lavada (σxo) hasta el radio de invasión ri, formación virgen (σt) más
 * allá. La inducción responde en conductividad (las corrientes de Foucault de las capas cilíndricas se suman), así
 * que la lectura de la curva k es una mezcla lineal de las dos zonas ponderada por el factor geométrico radial
 * integrado J_k(ri):
 *
 *   σa_k = J_k(ri) · σxo + (1 − J_k(ri)) · σt             Ra_k = 1/σa_k
 *
 * con J_k(r) = fracción de la señal que viene de adentro del radio r (J(0) = 0, J(∞) = 1, monótona creciente).
 * La región r < ri incluye el pozo: se supone que la corrección por pozo ya se aplicó y el pozo no se modela. El
 * diámetro de invasión es di = 2·ri (convención de la industria y de las cartas «tornado»: diámetro, incluido el
 * pozo). Un di igual al diámetro del trépano significa «invasión nula».
 *
 * ── Factor geométrico radial J_k: APROXIMACIÓN PARAMÉTRICA, no la respuesta de Schlumberger ───────────────────
 *
 *   J(r) = 1 / (1 + (r50 / r)^p)                      (logística en ln r, con J(r50) = 0,5)
 *
 * r50 es la profundidad mediana de investigación radial (el radio que contiene la mitad de la señal): 10, 20, 30, 60
 * y 90 in para AT10…AT90. p = 1,5 (RADIAL_STEEPNESS) es común a las cinco curvas.
 *
 * NO tenemos las respuestas radiales del fabricante. La forma (y p) se obtuvo del factor geométrico radial integrado
 * de una sonda de dos bobinas en medio homogéneo sin efecto pelicular (Doll 1949; Moran y Kunz 1962):
 * g(ρ, z) ∝ ρ² / (ρT³ ρR³), con ρT y ρR las distancias del anillo (ρ, z) al transmisor y al receptor, integrada en z
 * y acumulada en ρ. Integrada numéricamente, esa J queda a menos de 0,04 (en J) de la logística con p = 1,5 en todo
 * el rango radial (error máximo 0,040; con p = 2 sube a 0,082). La cola real de J es 1 − J ∝ 1/ρ² (más lenta que
 * la logística). Las cinco curvas de la AIT se sintetizan por enfoque por software, así que sus respuestas radiales
 * reales difieren de las de una sonda simple de dos bobinas (se espera que sean más angostas; no se pudo verificar
 * sin las curvas del fabricante). Consecuencia: di y Rxo salen con un sesgo que no se puede acotar; los resultados
 * son una estimación de orden de magnitud con buena consistencia relativa, no una inversión calibrada.
 *
 * Convención de r50: la «profundidad de investigación» de 10, 20, 30, 60 y 90 in se toma como RADIO desde el eje
 * de la herramienta (así se rotulan las curvas de la AIT, con su mediana radial), no como diámetro. No se pudo
 * confirmar contra el manual del fabricante en el entorno de trabajo. Si fueran diámetros, los r50 reales serían la
 * mitad y el di estimado saldría ≈ 2 veces más grande (Rt y la forma del ajuste casi no cambian).
 *
 * ── Inversión por muestra (mínimos cuadrados separables) ─────────────────────────────────────────────────────
 *
 * Para ri fijo el modelo es lineal en (σxo, σt). Se resuelve el sistema normal 2×2 con σ acotada a
 * [1/100000, 100] S/m (R de 0,01 a 100 000 ohm·m; si la solución libre sale del rango se prueba cada cota y se
 * elige el mínimo, que es exacto porque el problema es convexo en 2D). El residuo es relativo, porque los errores
 * de una herramienta de inducción son proporcionales a la lectura:
 *
 *   r_k = (σa_k − σ_k) / max(σ_k, 0,05 · σmax)       misfit = √( Σ r_k² / n )
 *
 * σ_k = 1/R_k observada, σmax = mayor conductividad de la muestra. El piso del 5 % acota el peso de una lectura muy
 * resistiva aislada (σ_k → 0, p. ej. un pico de AT10 de 110 ohm·m): sin piso su peso sería 1/σ_k, cientos de veces el
 * de las demás. El pico NO se filtra: queda un misfit alto que lo delata (0,2-0,6 en las pruebas), pero con 4 curvas
 * y un pico queda un solo grado de libertad y el Rt de esa muestra se desvía 30-60 %: un misfit alto significa
 * «Rxo, di y Rt de esta muestra no son confiables». Con relaciones de resistividad de hasta 20 la ponderación es
 * exactamente proporcional.
 *
 * ri se busca sobre una grilla logarítmica (48 puntos entre el radio del trépano y 150 in) para no caer en un
 * mínimo local, y se refina con búsqueda de sección áurea en el intervalo vecino al mínimo de la grilla.
 *
 * Grados de libertad: 3 incógnitas (ri, σxo, σt). Con 3 curvas el ajuste puede ser casi exacto y el misfit no
 * informa; con 4 hay 1 grado de libertad y con 5, 2. El misfit mide cuánto se aparta el perfil escalonado de las
 * lecturas, no la incertidumbre de los parámetros.
 *
 * ── Casos borde ──────────────────────────────────────────────────────────────────────────────────────────────
 *  - Lecturas válidas (finitas y > 0) < 3 → status 'insufficient': Rxo, Rt, di y misfit sin dato.
 *  - Separación = Rmax/Rmin − 1 entre las lecturas válidas < umbral (por defecto 0,10) → status 'no-invasion': di es
 *    indeterminado (con lecturas iguales cualquier ri ajusta); Rt = lectura de la curva más profunda, Rxo, di y
 *    misfit sin dato.
 *  - Invasión resistiva (Rxo > Rt): las lecturas bajan con la profundidad. Conductiva (Rxo < Rt): suben.
 *  - Si el ri óptimo queda en una cota de la grilla, `atBound` lo indica ('min': di = trépano; 'max': di ≥ máximo,
 *    Rt poco determinada).
 *
 * Referencias:
 *  - Doll, H.G. (1949), «Introduction to induction logging and application to logging of wells drilled with oil
 *    base mud», Trans. AIME 186 (factor geométrico).
 *  - Moran, J.H. y Kunz, K.S. (1962), «Basic theory of induction logging and application to study of two-coil
 *    sondes», Geophysics 27(6) (respuesta radial de dos bobinas).
 *  - Barber, T.D. y Rosthal, R.A. (1991), «Using a multiarray induction tool to achieve high-resolution logs with
 *    minimum environmental effects», SPE 22725 (herramienta de arreglo con profundidades de 10 a 90 in).
 *  - Ellis, D.V. y Singer, J.M. (2007), «Well Logging for Earth Scientists», 2.ª ed., Springer (inducción, cap. 8).
 *  - Asquith, G. y Krygowski, D. (2004), «Basic Well Log Analysis», 2.ª ed., AAPG Methods in Exploration 16 (cartas
 *    «tornado» y diámetro de invasión).
 */

/** Profundidades medianas de investigación radial (in) de las curvas de la inducción de arreglo, por rol. */
export const ARRAY_INDUCTION_R50_IN: Readonly<Record<string, number>> = { RA10: 10, RA20: 20, RA30: 30, RM: 60, RT: 90 };

/** Pendiente p de la logística en ln r de J(r) (común a todas las curvas). Ver el encabezado. */
export const RADIAL_STEEPNESS = 1.5;

/** Diámetro de trépano por defecto (in): cota inferior del diámetro de invasión. */
export const DEFAULT_BIT_SIZE_IN = 8.5;
/** Diámetro máximo de invasión buscado (in). */
export const MAX_INVASION_DIAMETER_IN = 300;
/** Separación relativa Rmax/Rmin − 1 por debajo de la cual se considera «sin invasión». */
export const DEFAULT_MIN_SEPARATION = 0.1;
/** Desajuste RMS relativo por encima del cual el ajuste se considera pobre. */
export const DEFAULT_MAX_MISFIT = 0.15;
/** Piso del peso del residuo, como fracción de la mayor conductividad de la muestra. */
export const WEIGHT_FLOOR = 0.05;
/** Cotas de la conductividad ajustada (S/m): R de 100 000 a 0,01 ohm·m. */
export const SIGMA_MIN = 1e-5;
export const SIGMA_MAX = 100;

const GRID_POINTS = 48;
const GOLDEN_ITERATIONS = 40;
const BOUND_TOLERANCE = 1e-4; // en fracción del rango de ln ri

const isPositiveFinite = (x: number): boolean => x > 0 && x < Infinity;

// ── factor geométrico radial ─────────────────────────────────────────────────────────────────────────────────

/**
 * Factor geométrico radial integrado J(r) = 1 / (1 + (r50/r)^p): fracción de la señal que viene de r' < r.
 * J(0) = 0, J(∞) = 1, J(r50) = 0,5, monótona creciente. Aproximación paramétrica (ver encabezado).
 * @param r         distancia radial desde el eje de la herramienta (in), ≥ 0
 * @param r50       profundidad mediana de investigación (in), > 0
 * @param steepness pendiente p de la logística en ln r (por defecto RADIAL_STEEPNESS)
 */
export function radialGeometricFactor(r: number, r50: number, steepness: number = RADIAL_STEEPNESS): number {
  if (Number.isNaN(r) || !isPositiveFinite(r50) || !isPositiveFinite(steepness)) return NaN;
  if (r <= 0) return 0;
  if (r === Infinity) return 1;
  return 1 / (1 + Math.pow(r50 / r, steepness));
}

/** Muestras de J(r) para dibujar a qué escala lee una curva: r en una grilla logarítmica de `rMin` a `rMax` (in). */
export function radialResponseSamples(
  r50: number,
  rMin = 1,
  rMax = 300,
  n = 80,
  steepness: number = RADIAL_STEEPNESS,
): { r: Float64Array; j: Float64Array } {
  const r = new Float64Array(n);
  const j = new Float64Array(n);
  if (!isPositiveFinite(rMin) || !isPositiveFinite(rMax) || rMax <= rMin || n < 2) return { r: r.fill(NaN), j: j.fill(NaN) };
  const l0 = Math.log(rMin);
  const dl = (Math.log(rMax) - l0) / (n - 1);
  for (let i = 0; i < n; i++) {
    r[i] = Math.exp(l0 + i * dl);
    j[i] = radialGeometricFactor(r[i]!, r50, steepness);
  }
  return { r, j };
}

// ── modelo directo ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * Lectura modelada de una curva de profundidad mediana r50 sobre un perfil escalonado:
 * Ra = 1 / ( J(ri)/Rxo + (1 − J(ri))/Rt ), con ri = di/2. Resistividades en ohm·m, di en in.
 * di = 0 → Rt. Rxo o Rt ≤ 0 o no finitas, o di < 0 → NaN.
 */
export function stepProfileReading(di: number, rxo: number, rt: number, r50: number, steepness: number = RADIAL_STEEPNESS): number {
  if (!isPositiveFinite(rxo) || !isPositiveFinite(rt) || !(di >= 0) || di === Infinity) return NaN;
  const j = radialGeometricFactor(di / 2, r50, steepness);
  return 1 / (j / rxo + (1 - j) / rt);
}

/** Lecturas modeladas de varias curvas (una por cada r50) sobre el mismo perfil escalonado. */
export function forwardStepProfile(
  di: number,
  rxo: number,
  rt: number,
  r50s: ArrayLike<number>,
  steepness: number = RADIAL_STEEPNESS,
): Float64Array {
  const out = new Float64Array(r50s.length);
  for (let k = 0; k < r50s.length; k++) out[k] = stepProfileReading(di, rxo, rt, r50s[k]!, steepness);
  return out;
}

// ── inversión ────────────────────────────────────────────────────────────────────────────────────────────────

export interface InvasionReading {
  /** Etiqueta para la vista (p. ej. 'AT30'). */
  label?: string;
  /** Profundidad mediana de investigación radial (in). */
  r50: number;
  /** Resistividad leída (ohm·m). */
  resistivity: number;
}

export interface InvasionOptions {
  /** Diámetro del trépano (in): cota inferior de di. Por defecto 8,5. */
  bitSize?: number;
  /** Separación relativa Rmax/Rmin − 1 por debajo de la cual no hay invasión visible. Por defecto 0,10. */
  minSeparation?: number;
  /** Diámetro máximo de invasión buscado (in). Por defecto 300. */
  maxDiameter?: number;
  /** Pendiente de J (por defecto RADIAL_STEEPNESS). */
  steepness?: number;
}

export type InvasionStatus = 'ok' | 'no-invasion' | 'insufficient';

export interface InvasionFit {
  status: InvasionStatus;
  /** Resistividad de la zona lavada (ohm·m). NaN salvo status 'ok'. */
  rxo: number;
  /** Resistividad verdadera (ohm·m): ajustada ('ok'), lectura más profunda ('no-invasion') o NaN ('insufficient'). */
  rt: number;
  /** Diámetro de invasión 2·ri (in). NaN salvo status 'ok'. */
  di: number;
  /** Desajuste RMS relativo del ajuste (ver encabezado). NaN salvo status 'ok'. */
  misfit: number;
  /** Rmax/Rmin − 1 de las lecturas válidas (NaN si hay menos de 2). */
  separation: number;
  /** Cantidad de lecturas válidas. */
  nCurves: number;
  /** El ri óptimo está en una cota de la búsqueda: 'min' (di = trépano), 'max' (di ≥ máximo) o null. */
  atBound: 'min' | 'max' | null;
}

const EMPTY_FIT: InvasionFit = {
  status: 'insufficient',
  rxo: NaN,
  rt: NaN,
  di: NaN,
  misfit: NaN,
  separation: NaN,
  nCurves: 0,
  atBound: null,
};

/** Mínimos cuadrados 2×2 con cotas para ri fijo. j, s, w en el orden de las lecturas válidas. */
function solveAtRadius(j: Float64Array, s: Float64Array, w: Float64Array, n: number): { a: number; b: number; ssr: number } {
  let suu = 0;
  let suv = 0;
  let svv = 0;
  let suy = 0;
  let svy = 0;
  for (let k = 0; k < n; k++) {
    const u = w[k]! * j[k]!;
    const v = w[k]! * (1 - j[k]!);
    const y = w[k]! * s[k]!;
    suu += u * u;
    suv += u * v;
    svv += v * v;
    suy += u * y;
    svy += v * y;
  }
  const ssrOf = (a: number, b: number): number => {
    let acc = 0;
    for (let k = 0; k < n; k++) {
      const r = w[k]! * (j[k]! * a + (1 - j[k]!) * b - s[k]!);
      acc += r * r;
    }
    return acc;
  };
  const det = suu * svv - suv * suv;
  if (det > 1e-12 * suu * svv) {
    const a = (suy * svv - svy * suv) / det;
    const b = (svy * suu - suy * suv) / det;
    if (a >= SIGMA_MIN && a <= SIGMA_MAX && b >= SIGMA_MIN && b <= SIGMA_MAX) return { a, b, ssr: ssrOf(a, b) };
  }
  // La solución libre se sale de las cotas (o el sistema es casi singular): el óptimo está sobre el borde.
  const clamp = (x: number): number => Math.min(SIGMA_MAX, Math.max(SIGMA_MIN, x));
  let best = { a: SIGMA_MIN, b: SIGMA_MIN, ssr: Infinity };
  const consider = (a: number, b: number): void => {
    const ssr = ssrOf(a, b);
    if (ssr < best.ssr) best = { a, b, ssr };
  };
  for (const a of [SIGMA_MIN, SIGMA_MAX]) consider(a, svv > 0 ? clamp((svy - a * suv) / svv) : SIGMA_MIN);
  for (const b of [SIGMA_MIN, SIGMA_MAX]) consider(suu > 0 ? clamp((suy - b * suv) / suu) : SIGMA_MIN, b);
  return best;
}

/** Reutilizable entre muestras para no asignar memoria en cada una. */
interface Scratch {
  r50: Float64Array;
  /** Resistividad leída, tal cual (para devolver la lectura profunda sin pasar por 1/(1/R)). */
  res: Float64Array;
  sigma: Float64Array;
  w: Float64Array;
  j: Float64Array;
}
const makeScratch = (n: number): Scratch => ({
  r50: new Float64Array(n),
  res: new Float64Array(n),
  sigma: new Float64Array(n),
  w: new Float64Array(n),
  j: new Float64Array(n),
});

/** Ajusta una muestra ya cargada en `sc` (n lecturas válidas). Devuelve el ajuste. */
function fitSample(sc: Scratch, n: number, options: InvasionOptions): InvasionFit {
  const minSep = options.minSeparation ?? DEFAULT_MIN_SEPARATION;
  const p = options.steepness ?? RADIAL_STEEPNESS;
  let sMax = 0;
  let sMin = Infinity;
  let deepR50 = -Infinity;
  let deepRes = NaN;
  for (let k = 0; k < n; k++) {
    const s = sc.sigma[k]!;
    if (s > sMax) sMax = s;
    if (s < sMin) sMin = s;
    if (sc.r50[k]! > deepR50) {
      deepR50 = sc.r50[k]!;
      deepRes = sc.res[k]!;
    }
  }
  const separation = n >= 2 ? sMax / sMin - 1 : NaN;
  if (n < 3) return { ...EMPTY_FIT, separation, nCurves: n };
  if (separation < minSep) {
    return { status: 'no-invasion', rxo: NaN, rt: deepRes, di: NaN, misfit: NaN, separation, nCurves: n, atBound: null };
  }
  for (let k = 0; k < n; k++) sc.w[k] = 1 / Math.max(sc.sigma[k]!, WEIGHT_FLOOR * sMax);

  const bit = options.bitSize ?? DEFAULT_BIT_SIZE_IN;
  const rMin = Math.max(bit, 0.1) / 2;
  const rMax = Math.max((options.maxDiameter ?? MAX_INVASION_DIAMETER_IN) / 2, rMin * 1.5);
  const lMin = Math.log(rMin);
  const lMax = Math.log(rMax);
  let last = { a: NaN, b: NaN, ssr: NaN };
  const evaluate = (lr: number): number => {
    const r = Math.exp(lr);
    for (let k = 0; k < n; k++) sc.j[k] = radialGeometricFactor(r, sc.r50[k]!, p);
    last = solveAtRadius(sc.j, sc.sigma, sc.w, n);
    return last.ssr;
  };

  // 1) barrido de la grilla logarítmica
  const dl = (lMax - lMin) / (GRID_POINTS - 1);
  let bestI = 0;
  let bestS = Infinity;
  for (let i = 0; i < GRID_POINTS; i++) {
    const s = evaluate(lMin + i * dl);
    if (s < bestS) {
      bestS = s;
      bestI = i;
    }
  }
  // 2) refinamiento por sección áurea entre los vecinos del mínimo de la grilla
  let lo = lMin + Math.max(0, bestI - 1) * dl;
  let hi = lMin + Math.min(GRID_POINTS - 1, bestI + 1) * dl;
  const phi = (Math.sqrt(5) - 1) / 2;
  let x1 = hi - phi * (hi - lo);
  let x2 = lo + phi * (hi - lo);
  let f1 = evaluate(x1);
  let f2 = evaluate(x2);
  for (let it = 0; it < GOLDEN_ITERATIONS; it++) {
    if (f1 <= f2) {
      hi = x2;
      x2 = x1;
      f2 = f1;
      x1 = hi - phi * (hi - lo);
      f1 = evaluate(x1);
    } else {
      lo = x1;
      x1 = x2;
      f1 = f2;
      x2 = lo + phi * (hi - lo);
      f2 = evaluate(x2);
    }
  }
  let lBest = (lo + hi) / 2;
  let sBest = evaluate(lBest);
  // el punto de la grilla puede ser mejor si el mínimo está en una cota
  const lGrid = lMin + bestI * dl;
  if (bestS < sBest) {
    lBest = lGrid;
    sBest = evaluate(lBest);
  }
  const atBound = lBest - lMin < BOUND_TOLERANCE * (lMax - lMin) ? 'min' : lMax - lBest < BOUND_TOLERANCE * (lMax - lMin) ? 'max' : null;
  return {
    status: 'ok',
    rxo: 1 / last.a,
    rt: 1 / last.b,
    di: 2 * Math.exp(lBest),
    misfit: Math.sqrt(sBest / n),
    separation,
    nCurves: n,
    atBound,
  };
}

/** Carga las lecturas válidas en `sc`; devuelve cuántas son. */
function loadReadings(sc: Scratch, readings: ArrayLike<InvasionReading>): number {
  let n = 0;
  for (let k = 0; k < readings.length; k++) {
    const rd = readings[k]!;
    if (!isPositiveFinite(rd.resistivity) || !isPositiveFinite(rd.r50)) continue;
    sc.r50[n] = rd.r50;
    sc.res[n] = rd.resistivity;
    sc.sigma[n] = 1 / rd.resistivity;
    n++;
  }
  return n;
}

/**
 * Inversión de una sola muestra: perfil escalonado (Rxo, di, Rt) que mejor reproduce las lecturas.
 * Ver el encabezado para el modelo, los casos borde y la ponderación.
 */
export function invertStepProfile(readings: ArrayLike<InvasionReading>, options: InvasionOptions = {}): InvasionFit {
  const sc = makeScratch(Math.max(readings.length, 1));
  const n = loadReadings(sc, readings);
  return fitSample(sc, n, options);
}

export interface InvasionCurveInput {
  /** Profundidad mediana de investigación radial (in). */
  r50: number;
  /** Resistividad (ohm·m), una por muestra. */
  data: ArrayLike<number>;
}

export interface InvasionOutputs {
  rxo: Float64Array;
  rt: Float64Array;
  di: Float64Array;
  misfit: Float64Array;
}

export interface InvasionCounts {
  /** Muestras con ajuste (status 'ok'). */
  ok: number;
  /** Muestras sin invasión visible. */
  noInvasion: number;
  /** Muestras con menos de 3 lecturas válidas. */
  insufficient: number;
  /** Muestras 'ok' con misfit mayor que `maxMisfit`. */
  highMisfit: number;
  /** Muestras 'ok' con di en el máximo buscado (Rt poco determinada). */
  atMaxDi: number;
  /** Muestras 'ok' con di en el mínimo (= trépano): invasión más somera de lo que resuelve la herramienta. */
  atMinDi: number;
}

/**
 * Inversión sobre el tramo [start, end) de varias curvas, escrita en `out` (mismo índice). Las opciones
 * (trépano, umbral de separación) son únicas del tramo. `maxMisfit` solo se usa para contar `highMisfit`.
 */
export function invertStepProfileInto(
  curves: readonly InvasionCurveInput[],
  out: InvasionOutputs,
  options: InvasionOptions = {},
  maxMisfit: number = DEFAULT_MAX_MISFIT,
  start = 0,
  end = out.rt.length,
): InvasionCounts {
  const counts: InvasionCounts = { ok: 0, noInvasion: 0, insufficient: 0, highMisfit: 0, atMaxDi: 0, atMinDi: 0 };
  const sc = makeScratch(Math.max(curves.length, 1));
  for (let i = start; i < end; i++) {
    let n = 0;
    for (const c of curves) {
      const v = c.data[i]!;
      if (!isPositiveFinite(v) || !isPositiveFinite(c.r50)) continue;
      sc.r50[n] = c.r50;
      sc.res[n] = v;
      sc.sigma[n] = 1 / v;
      n++;
    }
    const fit = fitSample(sc, n, options);
    out.rxo[i] = fit.rxo;
    out.rt[i] = fit.rt;
    out.di[i] = fit.di;
    out.misfit[i] = fit.misfit;
    if (fit.status === 'ok') {
      counts.ok++;
      if (fit.misfit > maxMisfit) counts.highMisfit++;
      if (fit.atBound === 'max') counts.atMaxDi++;
      else if (fit.atBound === 'min') counts.atMinDi++;
    } else if (fit.status === 'no-invasion') counts.noInvasion++;
    else counts.insufficient++;
  }
  return counts;
}

// ── para la vista a la profundidad del cursor ────────────────────────────────────────────────────────────────

export interface ProfileSegment {
  /** 'borehole' (pozo), 'flushed' (zona lavada = invadida en el modelo escalonado) o 'virgin' (formación virgen). */
  kind: 'borehole' | 'flushed' | 'virgin';
  /** Distancia radial inicial y final (in) desde el eje; `to` = Infinity en la formación virgen. */
  from: number;
  to: number;
  /** Resistividad de la zona (ohm·m); NaN en el pozo (no se modela) o si no hay dato. */
  resistivity: number;
}

export interface ModelledReading {
  label?: string;
  r50: number;
  /** Lectura observada (ohm·m). */
  observed: number;
  /** Lectura del modelo directo con el perfil ajustado (ohm·m); NaN si no hay ajuste. */
  modelled: number;
  /** (σ modelada − σ observada)/σ observada: error relativo en conductividad; NaN si no hay ajuste. */
  relativeError: number;
}

export interface InvasionProfileAtDepth {
  fit: InvasionFit;
  /** Radio del trépano (in) usado como borde pozo/formación. */
  holeRadius: number;
  /** Lecturas válidas ordenadas por r50, con su valor modelado. */
  readings: ModelledReading[];
  /** Corte radial: pozo / zona lavada / formación virgen. Sin invasión: pozo y formación virgen con Rt. */
  segments: ProfileSegment[];
}

/**
 * Perfil radial a UNA profundidad: ajusta las lecturas y devuelve el perfil escalonado, el modelo directo en cada
 * lectura y el corte radial (pozo / zona lavada / formación virgen) listo para dibujar. Para dibujar a qué escala
 * lee cada curva usar `radialResponseSamples(r50)` (J en función de la distancia).
 */
export function invasionProfileAtDepth(readings: readonly InvasionReading[], options: InvasionOptions = {}): InvasionProfileAtDepth {
  const fit = invertStepProfile(readings, options);
  const holeRadius = (options.bitSize ?? DEFAULT_BIT_SIZE_IN) / 2;
  const p = options.steepness ?? RADIAL_STEEPNESS;
  const valid = readings
    .filter((r) => isPositiveFinite(r.resistivity) && isPositiveFinite(r.r50))
    .slice()
    .sort((a, b) => a.r50 - b.r50);
  const modelledReadings: ModelledReading[] = valid.map((r) => {
    const modelled = fit.status === 'ok' ? stepProfileReading(fit.di, fit.rxo, fit.rt, r.r50, p) : NaN;
    return { label: r.label, r50: r.r50, observed: r.resistivity, modelled, relativeError: Number.isNaN(modelled) ? NaN : r.resistivity / modelled - 1 };
  });
  const segments: ProfileSegment[] = [{ kind: 'borehole', from: 0, to: holeRadius, resistivity: NaN }];
  if (fit.status === 'ok') {
    segments.push({ kind: 'flushed', from: holeRadius, to: fit.di / 2, resistivity: fit.rxo });
    segments.push({ kind: 'virgin', from: fit.di / 2, to: Infinity, resistivity: fit.rt });
  } else if (fit.status === 'no-invasion') {
    segments.push({ kind: 'virgin', from: holeRadius, to: Infinity, resistivity: fit.rt });
  }
  return { fit, holeRadius, readings: modelledReadings, segments };
}
