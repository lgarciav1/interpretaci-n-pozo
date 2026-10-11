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
 * de una sonda de dos bobinas en medio homogéneo sin efecto pelicular (Doll 1949; Moran y Kunz 1962). El factor de
 * Doll es por unidad de volumen, g(ρ, z) = (L²/4) · ρ² / (ρT³ ρR³) hasta una constante, y el anillo de radio ρ y
 * espesor dρ·dz tiene volumen 2πρ dρ dz: el peso que se integra en z y se acumula en ρ es ρ³/(ρT³ρR³) (con ρT y ρR las
 * distancias del anillo al transmisor y al receptor; ∫∫ = 2/L² exacto). Integrada numéricamente, esa J tiene
 * r50 ≈ 1,035·L, una cola 1 − J ∝ 1/ρ y queda a menos de 0,041 (en J) de la logística con p = 1,5 en todo el rango
 * radial (el óptimo es p ≈ 1,54 con 0,036; p = 1 da 0,13 y p = 2, 0,087). La logística sobrestima J en la cola
 * (en 5,8·r50: 0,93 contra 0,90 de dos bobinas; cerca del pozo, en 0,31·r50: 0,15 contra 0,10). Las cinco curvas de la
 * AIT se sintetizan por enfoque por software (Barber y Rosthal 1991), así que sus respuestas radiales reales difieren de
 * las de una sonda simple de dos bobinas (se espera que sean más angostas; no se pudo verificar sin las curvas del
 * fabricante). Consecuencia: di y Rxo salen con un sesgo que no se puede acotar. Sensibilidad medida en el TP
 * (mediana de di por zona A-E): con p = 1, 16/82/60/19/25 in; con p = 1,5, 32/70/60/35/39; con p = 2, 40/66/60/42/45;
 * Rt cambia menos del 5 %. di es un orden de magnitud con buena consistencia relativa, no una inversión calibrada.
 *
 * Convención de r50: la «profundidad de investigación» de 10, 20, 30, 60 y 90 in (Hunka et al. 1990, SPE 20559) se toma
 * como RADIO desde el eje de la herramienta, no como diámetro (certeza estimada ≈ 75-80 %). Argumentos: el glosario de
 * SLB da para la inducción profunda ID un punto medio de la respuesta a 62 in de radio en altas resistividades (45 in a
 * 1 ohm·m) y 30 in de radio para la media, y AT90 es más profunda que la ID. Si fueran diámetros, los r50 reales
 * serían la mitad y el di estimado saldría ≈ 2 veces más grande (Rt y la forma del ajuste casi no cambian). Los r50 son
 * nominales: a baja resistividad el efecto pelicular los acorta (sensibilidad de di ≲ 5 %).
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
 * El misfit es el RMS sobre n lecturas (no sobre los grados de libertad n − 3): con 4 curvas y 3 incógnitas subestima
 * el ruido por curva en un factor √(4/1) = 2 (con 5 curvas, √(5/2) ≈ 1,6; con 3 es 0 y no informa). El umbral de
 * 0,15 corresponde entonces a ≈ 30 % de error por curva con 4 curvas: una incoherencia grosera (picos, curvas de otra
 * herramienta), no ruido normal de una inducción (unos pocos %).
 *
 * ri se busca sobre una grilla logarítmica (48 puntos entre el radio del trépano y 150 in) para no caer en un
 * mínimo local, y se refina con búsqueda de sección áurea en el intervalo vecino al mínimo de la grilla.
 *
 * ── Resolución de di y estados ───────────────────────────────────────────────────────────────────────────────
 *
 * Con contrastes débiles ri queda mal determinado aunque el misfit sea bajo. Por muestra se calcula el intervalo
 * de ri compatible con el ajuste: los ri con misfit(ri) ≤ √(misfit² + δ²), δ = 0,02 (DI_MISFIT_TOLERANCE: un 2 % de
 * desajuste relativo adicional, del orden de la repetibilidad de la herramienta), recorrido desde el óptimo hasta
 * el primer cruce (bisección) → diLow y diHigh. Estados (`InvasionStatus`):
 *   'ok'              di interior y diHigh/diLow ≤ 2.
 *   'poorly-resolved' diHigh/diLow > 2, o el intervalo toca un borde de la grilla. Rxo, di y Rt del ajuste se
 *                     devuelven (más diLow/diHigh) para que la vista muestre «di entre X y Y»; las curvas de salida
 *                     dejan Rxo y di sin dato y conservan Rt (entre ±5 y ±13 % en las pruebas).
 *   'unresolved'      el ri óptimo está en un borde de la grilla ('deep': di ≥ máximo; 'shallow': di = trépano) o σt
 *                     toca una cota de σ ('sigma'). Rxo y di sin dato y Rt = lectura más profunda, como en
 *                     'no-invasion': la Rt de un ajuste en el borde NO es confiable (la robustez de Rt vale solo
 *                     para ajustes interiores).
 * Además, si σxo toca una cota de σ (Rxo = 10⁵ ohm·m: el ajuste pide una zona lavada «infinitamente» resistiva, que
 * solo indica que las lecturas no la determinan) Rxo = NaN y `rxoAtBound` = true; di y Rt se mantienen.
 *
 * ── Casos borde ──────────────────────────────────────────────────────────────────────────────────────────────
 *  - Lecturas válidas (finitas y > 0) < 3 → status 'insufficient': Rxo, Rt, di y misfit sin dato.
 *  - Separación = Rmax/Rmin − 1 entre las lecturas válidas < umbral (por defecto 0,10) → status 'no-invasion': di es
 *    indeterminado (con lecturas iguales cualquier ri ajusta); Rt = lectura de la curva más profunda, Rxo, di y
 *    misfit sin dato.
 *  - Invasión resistiva (Rxo > Rt): las lecturas bajan con la profundidad. Conductiva (Rxo < Rt): suben.
 *
 * Referencias:
 *  - Doll, H.G. (1949), «Introduction to induction logging and application to logging of wells drilled with oil
 *    base mud», Trans. AIME 186 (factor geométrico).
 *  - Moran, J.H. y Kunz, K.S. (1962), «Basic theory of induction logging and application to study of two-coil
 *    sondes», Geophysics 27(6) (respuesta radial de dos bobinas).
 *  - Hunka, J.F. et al. (1990), «A New Resistivity Measurement System for
 *    Deep Formation Imaging and High-Resolution Formation Evaluation», SPE 20559 (profundidades de 10 a 90 in).
 *  - Barber, T.D. y Rosthal, R.A. (1991), «Using a multiarray induction tool to achieve high-resolution logs with
 *    minimum environmental effects», SPE 22725 (enfoque por software).
 *  - Ellis, D.V. y Singer, J.M. (2007), «Well Logging for Earth Scientists», 2.ª ed., Springer (inducción, cap. 8).
 *  - Asquith, G. y Krygowski, D. (2004), «Basic Well Log Analysis», 2.ª ed., AAPG Methods in Exploration 16 (cartas
 *    «tornado» y diámetro de invasión).
 *  - Schlumberger Oilfield Glossary, “depth of investigation” y “deep induction” (glossary.slb.com).
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
/** δ: desajuste relativo adicional que define el intervalo de ri compatible con el ajuste (ver «Resolución de di»). */
export const DI_MISFIT_TOLERANCE = 0.02;
/** Cociente diHigh/diLow por encima del cual el di se considera mal resuelto. */
export const MAX_DI_RATIO = 2;
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
  /**
   * Trépano por muestra (in), para `invertStepProfileInto`: donde la muestra tiene un valor finito > 0 reemplaza a
   * `bitSize`. Ignorado por `invertStepProfile` (una sola muestra).
   */
  bitSizes?: ArrayLike<number>;
  /** Separación relativa Rmax/Rmin − 1 por debajo de la cual no hay invasión visible. Por defecto 0,10. */
  minSeparation?: number;
  /** Diámetro máximo de invasión buscado (in). Por defecto 300. */
  maxDiameter?: number;
  /** Pendiente de J (por defecto RADIAL_STEEPNESS). */
  steepness?: number;
}

export type InvasionStatus = 'ok' | 'no-invasion' | 'insufficient' | 'unresolved' | 'poorly-resolved';
/** Motivo de 'unresolved': ri en el máximo de la búsqueda, ri en el trépano, o σt en una cota de σ. */
export type UnresolvedReason = 'deep' | 'shallow' | 'sigma';

export interface InvasionFit {
  status: InvasionStatus;
  /** Solo con status 'unresolved'. */
  reason: UnresolvedReason | null;
  /**
   * Resistividad de la zona lavada (ohm·m). Sin dato salvo 'ok' y 'poorly-resolved'; también NaN si σxo tocó una cota
   * de σ (`rxoAtBound`).
   */
  rxo: number;
  /**
   * Resistividad verdadera (ohm·m): la del ajuste ('ok', 'poorly-resolved'), la lectura más profunda ('no-invasion',
   * 'unresolved') o NaN ('insufficient').
   */
  rt: number;
  /** Diámetro de invasión 2·ri (in): 'ok' y 'poorly-resolved'. NaN en los demás estados. */
  di: number;
  /** Desajuste RMS relativo del ajuste (ver encabezado). NaN en 'insufficient' y 'no-invasion'. */
  misfit: number;
  /** Extremos (in) del di compatible con el ajuste (ver «Resolución de di»). NaN si no hubo ajuste. */
  diLow: number;
  diHigh: number;
  /** Rmax/Rmin − 1 de las lecturas válidas (NaN si hay menos de 2). */
  separation: number;
  /** Cantidad de lecturas válidas. */
  nCurves: number;
  /** El ri óptimo está en un borde de la búsqueda: 'min' (di = trépano), 'max' (di = máximo) o null. */
  atBound: 'min' | 'max' | null;
  /** σxo tocó una cota de σ: el ajuste no determina Rxo (queda NaN). */
  rxoAtBound: boolean;
}

const EMPTY_FIT: InvasionFit = {
  status: 'insufficient',
  reason: null,
  rxo: NaN,
  rt: NaN,
  di: NaN,
  misfit: NaN,
  diLow: NaN,
  diHigh: NaN,
  separation: NaN,
  nCurves: 0,
  atBound: null,
  rxoAtBound: false,
};

interface RadiusSolution {
  a: number;
  b: number;
  ssr: number;
}

/** Mínimos cuadrados 2×2 con cotas para ri fijo. j, s, w en el orden de las lecturas válidas. */
function solveAtRadius(j: Float64Array, s: Float64Array, w: Float64Array, n: number): RadiusSolution {
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
  let best: RadiusSolution = { a: SIGMA_MIN, b: SIGMA_MIN, ssr: Infinity };
  const consider = (a: number, b: number): void => {
    const ssr = ssrOf(a, b);
    if (ssr < best.ssr) best = { a, b, ssr };
  };
  for (const a of [SIGMA_MIN, SIGMA_MAX]) consider(a, svv > 0 ? clamp((svy - a * suv) / svv) : SIGMA_MIN);
  for (const b of [SIGMA_MIN, SIGMA_MAX]) consider(suu > 0 ? clamp((suy - b * suv) / suu) : SIGMA_MIN, b);
  return best;
}

/** σ en una cota de la restricción (con tolerancia relativa de redondeo). */
const touchesSigmaBound = (x: number): boolean => x <= SIGMA_MIN * (1 + 1e-9) || x >= SIGMA_MAX * (1 - 1e-9);

/** Reutilizable entre muestras para no asignar memoria en cada una. */
interface Scratch {
  r50: Float64Array;
  /** Resistividad leída, tal cual (para devolver la lectura profunda sin pasar por 1/(1/R)). */
  res: Float64Array;
  sigma: Float64Array;
  w: Float64Array;
  j: Float64Array;
  grid: Float64Array;
}
const makeScratch = (n: number): Scratch => ({
  r50: new Float64Array(n),
  res: new Float64Array(n),
  sigma: new Float64Array(n),
  w: new Float64Array(n),
  j: new Float64Array(n),
  grid: new Float64Array(GRID_POINTS),
});

/** Ajusta una muestra ya cargada en `sc` (n lecturas válidas). Devuelve el ajuste. */
function fitSample(sc: Scratch, n: number, options: InvasionOptions, bitOverride?: number): InvasionFit {
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
    return { ...EMPTY_FIT, status: 'no-invasion', rt: deepRes, separation, nCurves: n };
  }
  for (let k = 0; k < n; k++) sc.w[k] = 1 / Math.max(sc.sigma[k]!, WEIGHT_FLOOR * sMax);

  const bit = bitOverride !== undefined && bitOverride > 0 && bitOverride < Infinity ? bitOverride : (options.bitSize ?? DEFAULT_BIT_SIZE_IN);
  const rMin = Math.max(bit, 0.1) / 2;
  const rMax = Math.max((options.maxDiameter ?? MAX_INVASION_DIAMETER_IN) / 2, rMin * 1.5);
  const lMin = Math.log(rMin);
  const lMax = Math.log(rMax);
  const evaluate = (lr: number): RadiusSolution => {
    const r = Math.exp(lr);
    for (let k = 0; k < n; k++) sc.j[k] = radialGeometricFactor(r, sc.r50[k]!, p);
    return solveAtRadius(sc.j, sc.sigma, sc.w, n);
  };
  const ssrAt = (lr: number): number => evaluate(lr).ssr;

  // 1) barrido de la grilla logarítmica
  const dl = (lMax - lMin) / (GRID_POINTS - 1);
  let bestI = 0;
  let bestS = Infinity;
  for (let i = 0; i < GRID_POINTS; i++) {
    const sv = ssrAt(lMin + i * dl);
    sc.grid[i] = sv;
    if (sv < bestS) {
      bestS = sv;
      bestI = i;
    }
  }
  // 2) refinamiento por sección áurea entre los vecinos del mínimo de la grilla
  let lo = lMin + Math.max(0, bestI - 1) * dl;
  let hi = lMin + Math.min(GRID_POINTS - 1, bestI + 1) * dl;
  const phi = (Math.sqrt(5) - 1) / 2;
  let x1 = hi - phi * (hi - lo);
  let x2 = lo + phi * (hi - lo);
  let f1 = ssrAt(x1);
  let f2 = ssrAt(x2);
  for (let it = 0; it < GOLDEN_ITERATIONS; it++) {
    if (f1 <= f2) {
      hi = x2;
      x2 = x1;
      f2 = f1;
      x1 = hi - phi * (hi - lo);
      f1 = ssrAt(x1);
    } else {
      lo = x1;
      x1 = x2;
      f1 = f2;
      x2 = lo + phi * (hi - lo);
      f2 = ssrAt(x2);
    }
  }
  let lBest = (lo + hi) / 2;
  let best = evaluate(lBest);
  // el punto de la grilla puede ser mejor si el mínimo está en una cota
  if (bestS < best.ssr) {
    lBest = lMin + bestI * dl;
    best = evaluate(lBest);
  }
  const range = lMax - lMin;
  const atBound: 'min' | 'max' | null = lBest - lMin < BOUND_TOLERANCE * range ? 'min' : lMax - lBest < BOUND_TOLERANCE * range ? 'max' : null;

  // 3) intervalo de ri compatible: misfit(ri)² ≤ misfit² + δ²  ⇔  ssr(ri) ≤ ssr_min + n·δ²
  const threshold = best.ssr + n * DI_MISFIT_TOLERANCE * DI_MISFIT_TOLERANCE;
  const crossing = (inside: number, outside: number): number => {
    let a = inside;
    let b = outside;
    for (let it = 0; it < 30; it++) {
      const m = (a + b) / 2;
      if (ssrAt(m) <= threshold) a = m;
      else b = m;
    }
    return (a + b) / 2;
  };
  let lLow = lMin;
  let touchLow = true;
  {
    let inside = lBest;
    for (let i = Math.floor((lBest - lMin) / dl); i >= 0; i--) {
      const l = lMin + i * dl;
      if (l >= lBest) continue;
      if (sc.grid[i]! <= threshold) inside = l;
      else {
        lLow = crossing(inside, l);
        touchLow = false;
        break;
      }
    }
    if (touchLow) lLow = lMin;
  }
  let lHigh = lMax;
  let touchHigh = true;
  {
    let inside = lBest;
    for (let i = Math.floor((lBest - lMin) / dl) + 1; i < GRID_POINTS; i++) {
      const l = lMin + i * dl;
      if (l <= lBest) continue;
      if (sc.grid[i]! <= threshold) inside = l;
      else {
        lHigh = crossing(inside, l);
        touchHigh = false;
        break;
      }
    }
    if (touchHigh) lHigh = lMax;
  }
  const diLow = 2 * Math.exp(lLow);
  const diHigh = 2 * Math.exp(lHigh);

  const rxoAtBound = touchesSigmaBound(best.a);
  const tAtBound = touchesSigmaBound(best.b);
  const misfit = Math.sqrt(best.ssr / n);
  const common = { misfit, diLow, diHigh, separation, nCurves: n, atBound, rxoAtBound };
  if (atBound || tAtBound) {
    const reason: UnresolvedReason = atBound === 'max' ? 'deep' : atBound === 'min' ? 'shallow' : 'sigma';
    return { ...common, status: 'unresolved', reason, rxo: NaN, rt: deepRes, di: NaN };
  }
  const rxo = rxoAtBound ? NaN : 1 / best.a;
  const rt = 1 / best.b;
  const di = 2 * Math.exp(lBest);
  const poor = touchLow || touchHigh || diHigh / diLow > MAX_DI_RATIO;
  return { ...common, status: poor ? 'poorly-resolved' : 'ok', reason: null, rxo, rt, di };
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
 * Ver el encabezado para el modelo, los estados, los casos borde y la ponderación.
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
  /** Muestras 'ok'. */
  ok: number;
  /** Muestras sin invasión visible. */
  noInvasion: number;
  /** Muestras con menos de 3 lecturas válidas. */
  insufficient: number;
  /** Muestras 'poorly-resolved': el di no está acotado a un factor 2 (Rxo y di quedan sin dato). */
  poorlyResolved: number;
  /** 'unresolved' con el ri óptimo en el máximo de la búsqueda (di ≥ máximo). */
  unresolvedDeep: number;
  /** 'unresolved' con el ri óptimo en el trépano. */
  unresolvedShallow: number;
  /** 'unresolved' con σt en una cota de σ. */
  unresolvedSigma: number;
  /** Muestras 'ok' o 'poorly-resolved' con σxo en una cota de σ (Rxo queda sin dato). */
  rxoAtBound: number;
  /** Muestras con ajuste (ok, poorly-resolved, unresolved) y misfit mayor que `maxMisfit`. */
  highMisfit: number;
}

export const emptyCounts = (): InvasionCounts => ({
  ok: 0,
  noInvasion: 0,
  insufficient: 0,
  poorlyResolved: 0,
  unresolvedDeep: 0,
  unresolvedShallow: 0,
  unresolvedSigma: 0,
  rxoAtBound: 0,
  highMisfit: 0,
});

/**
 * Inversión sobre el tramo [start, end) de varias curvas, escrita en `out` (mismo índice). Las opciones
 * (trépano, umbral de separación) son únicas del tramo (`options.bitSizes`, si está, da el trépano por muestra).
 * `maxMisfit` solo se usa para contar `highMisfit`.
 *
 * Salidas por estado: 'ok' → Rxo, Rt, di y misfit del ajuste (Rxo sin dato si `rxoAtBound`); 'poorly-resolved' →
 * Rxo y di sin dato, Rt y misfit del ajuste; 'unresolved' → Rxo y di sin dato, Rt = lectura más profunda, misfit del
 * ajuste; 'no-invasion' → Rt = lectura más profunda, el resto sin dato; 'insufficient' → todo sin dato.
 */
export function invertStepProfileInto(
  curves: readonly InvasionCurveInput[],
  out: InvasionOutputs,
  options: InvasionOptions = {},
  maxMisfit: number = DEFAULT_MAX_MISFIT,
  start = 0,
  end = out.rt.length,
): InvasionCounts {
  const counts = emptyCounts();
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
    const fit = fitSample(sc, n, options, options.bitSizes ? options.bitSizes[i] : undefined);
    const keepFit = fit.status === 'ok';
    out.rxo[i] = keepFit ? fit.rxo : NaN;
    out.di[i] = keepFit ? fit.di : NaN;
    out.rt[i] = fit.rt;
    out.misfit[i] = fit.misfit;
    switch (fit.status) {
      case 'ok':
        counts.ok++;
        break;
      case 'poorly-resolved':
        counts.poorlyResolved++;
        break;
      case 'unresolved':
        if (fit.reason === 'deep') counts.unresolvedDeep++;
        else if (fit.reason === 'shallow') counts.unresolvedShallow++;
        else counts.unresolvedSigma++;
        break;
      case 'no-invasion':
        counts.noInvasion++;
        break;
      default:
        counts.insufficient++;
    }
    if (fit.status === 'ok' || fit.status === 'poorly-resolved') {
      if (fit.rxoAtBound) counts.rxoAtBound++;
    }
    if (Number.isFinite(fit.misfit) && fit.misfit > maxMisfit) counts.highMisfit++;
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
  /** Corte radial: pozo / zona lavada / formación virgen. Sin perfil (sin invasión, sin resolver): pozo y formación virgen con Rt. */
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
  // 'ok' y 'poorly-resolved' traen el perfil del ajuste (en el segundo, di es uno entre varios compatibles: ver diLow/diHigh)
  const hasProfile = (fit.status === 'ok' || fit.status === 'poorly-resolved') && Number.isFinite(fit.rxo) && Number.isFinite(fit.di);
  const modelledReadings: ModelledReading[] = valid.map((r) => {
    const modelled = hasProfile ? stepProfileReading(fit.di, fit.rxo, fit.rt, r.r50, p) : NaN;
    return { label: r.label, r50: r.r50, observed: r.resistivity, modelled, relativeError: Number.isNaN(modelled) ? NaN : r.resistivity / modelled - 1 };
  });
  const segments: ProfileSegment[] = [{ kind: 'borehole', from: 0, to: holeRadius, resistivity: NaN }];
  if (hasProfile) {
    segments.push({ kind: 'flushed', from: holeRadius, to: fit.di / 2, resistivity: fit.rxo });
    segments.push({ kind: 'virgin', from: fit.di / 2, to: Infinity, resistivity: fit.rt });
  } else if (Number.isFinite(fit.rt)) {
    // sin invasión visible o sin resolver: solo se sabe Rt (lectura más profunda; o la del ajuste si quedó sin Rxo)
    segments.push({ kind: 'virgin', from: holeRadius, to: Infinity, resistivity: fit.rt });
  }
  return { fit, holeRadius, readings: modelledReadings, segments };
}
