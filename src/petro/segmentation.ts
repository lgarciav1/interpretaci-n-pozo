/**
 * Segmentación de curvas por cambios de nivel y de tendencia. Motor común de dos funciones:
 *   L.     Zonas sugeridas: límites de zona propuestos a partir de los cambios del GR (y, opcionalmente, de otras curvas).
 *   Geo-1. Electrosecuencias: forma del GR de cada tramo (cilindro, embudo, campana, serrado, simétrico) y su
 *          interpretación depositacional. Clasifica EXACTAMENTE los tramos que produce la segmentación.
 *
 * Unidades: la profundidad en m (crece hacia abajo); la curva en su unidad (para el GR, gAPI). Las pendientes están en
 * «unidad de la curva por metro» (gAPI/m para el GR). Un NaN en la curva (o en la profundidad) es «sin dato».
 * La profundidad de cada muestra es el centro de su espesor: tope = prof − h/2 de la primera muestra del tramo y
 * base = prof + h/2 de la última (con muestreo uniforme; entre dos tramos contiguos el límite cae a mitad de camino
 * entre la última muestra de uno y la primera del otro). Es la misma convención que `wellReading.ts`.
 *
 * CONVENCIÓN DE SIGNOS (importante): pendiente = d(GR)/d(profundidad). Como la profundidad crece hacia abajo,
 *   pendiente > 0  el GR AUMENTA hacia abajo = DISMINUYE hacia arriba = engrosamiento hacia arriba (coarsening-up) → EMBUDO
 *   pendiente < 0  el GR DISMINUYE hacia abajo = AUMENTA hacia arriba = afinamiento hacia arriba (fining-up)     → CAMPANA
 * El contraste de un límite es GR(debajo) − GR(arriba) (positivo: el GR sube al cruzarlo hacia abajo).
 *
 * ALGORITMO (elegido y por qué)
 *  1. Muestras válidas: profundidad y curva(s) finitas. Los huecos de datos MÁS CORTOS que `maxGap` (3 m) se puentean
 *     (las muestras sin dato simplemente no cuentan; la regresión usa la profundidad real, así que el hueco no sesga el
 *     ajuste). Un hueco MÁS LARGO corta la curva en bloques independientes: no se propone ningún límite dentro de
 *     un hueco largo ni a través de él. Con curvas adicionales, una muestra con NaN en cualquiera de ellas se descarta.
 *  2. Suavizado: mediana móvil de `smoothWindow` (1 m ≈ 7 muestras de 0,15 m). La mediana quita picos y capas más finas
 *     que media ventana SIN redondear los escalones (conserva los bordes), que es lo que importa para ubicar límites.
 *     Complejidad O(n·w) con una ventana ordenada deslizante.
 *  3. Segmentación óptima por tramos con ajuste LINEAL (costo = suma de cuadrados residuales de la regresión lineal
 *     curva–profundidad del tramo, dividido por σ² del ruido), con penalización tipo BIC por cada límite
 *     β = `penalty`·(2·C+1)·ln(n)  (C = nº de curvas: por tramo dos parámetros de recta por curva más la posición del
 *     límite) y espesor mínimo de tramo `minThickness`. Se resuelve con PELT (Killick, Fearnhead y Eckley 2012):
 *     programación dinámica exacta con poda de candidatos. Se eligió un costo lineal (no de media constante) porque
 *     una rampa (embudo o campana) es UN tramo con tendencia, no una escalera de escalones; y PELT (no segmentación
 *     binaria) porque es óptimo: no depende del orden de los cortes y encuentra juntos un escalón y un cambio de
 *     pendiente. Las sumas acumuladas hacen que el costo de cualquier tramo sea O(1).
 *     COMPLEJIDAD: O(n) esperado cuando el nº de límites crece con n (la poda deja pocos candidatos), pero O(n²) en el
 *     peor caso: con pocos límites en una curva larga casi no se poda (con mínimos cuadrados dividir un tramo siempre
 *     baja el costo). Por eso en bloques de más de 1.500 muestras los límites se buscan en una grilla (≤ 1.500
 *     puntos, paso entre minSize/5 y minSize/2) y después se afinan a la muestra exacta (±paso, 2 pasadas). En el GR
 *     del TP (5.810 muestras) esto da 37 límites contra 38 de la programación dinámica completa (36 coinciden a ±1
 *     muestra) y tarda ~10 ms (la completa, ~330 ms); con 5.810 muestras de ruido blanco (peor caso) ~40 ms; con
 *     30.000, ~0,4 s. La poda con espesor mínimo no es estrictamente exacta (la de Killick supone que cualquier
 *     candidato puede cortar a continuación); en bloques cortos (sin grilla) coincidió con la programación dinámica
 *     sin poda en las pruebas.
 *  4. σ del ruido: estimación ROBUSTA (MAD) de las segundas diferencias de la curva suavizada con paso igual a la
 *     ventana (descorrelaciona la mediana móvil y elimina tendencias lineales): σ = 1,4826·MAD(Δ²)/√6. Se acota por abajo
 *     con `noiseFloor` (en la unidad de la curva) para que una curva sintética sin ruido o constante no divida por cero.
 *     El GR real NO es ruido blanco: es «ruido rojo» (variabilidad geológica a todas las escalas). En el GR del TP, el
 *     σ estimado con las segundas diferencias crudas es 1,6 gAPI a paso de 1 muestra (ruido de la herramienta), 5,0 a
 *     3 muestras, 8,4 a 7 y 12,4 a 26. Al medir σ a la escala de la ventana, la segmentación ignora lo que es del orden
 *     del ruido a esa escala; y como las muestras suavizadas están correlacionadas (n efectivo ≈ n/ventana), el BIC con
 *     ruido independiente sigue siendo permisivo: de ahí que el multiplicador `penalty` por defecto sea 8 y no 1.
 *     Con 1 el GR del TP queda en ~150 tramos; con 8, en ~40 (unos 22 m por tramo). Es un criterio práctico: el
 *     control de granularidad que se expone al usuario.
 *  5. Fusión de serrados: una racha de tramos delgados (≤ `thinBedMax`) cuyos niveles alternan (≥ `minReversals`
 *     cambios de sentido, cada salto ≥ `serrationAmplitude`) es UNA alternancia sin tendencia: se fusiona en un solo
 *     tramo para que no genere límites internos ni se lea como varios cuerpos.
 *
 * CLASIFICACIÓN DE FORMA (Geo-1; `ELECTROSEQUENCE_DEFAULTS`). Sobre el ajuste lineal de la curva suavizada del tramo
 * (pendiente b, variación total Δ = b·espesor, R², desvío residual s y nº de cruces de la recta con banda muerta):
 *   serrado     s ≥ `serrationStd` y cruces ≥ `minCrossings` (alternancias a ambos lados de la recta). Con tendencia
 *               clara (R² ≥ 0,5) se informa la forma de la tendencia y se marca `serrated` = true.
 *   simétrico   hay un extremo interior con tendencias opuestas a cada lado (cada mitad con |b| ≥ `slopeThreshold` y
 *               |Δ| ≥ `minTrendChange`) y el ajuste de dos rectas mejora claramente el de una (RSS ≤ 70 %). GR mínimo
 *               en el medio = embudo abajo + campana arriba («arena al centro»); GR máximo en el medio = campana abajo
 *               + embudo arriba («arcilla al centro»).
 *   embudo      |b| ≥ `slopeThreshold` y |Δ| ≥ `minTrendChange` con b > 0.
 *   campana     ídem con b < 0.
 *   cilindro    sin tendencia significativa y s < `serrationStd` (bloque liso). El nivel (bajo/medio/alto respecto
 *               de las líneas base de arena limpia y lutita: percentiles 10 y 90 de la curva, o `cleanLevel` /
 *               `shaleLevel`) distingue arena masiva de lutita homogénea.
 *   sin forma   menos de 5 muestras, o irregular sin patrón (s alto sin alternancia ni tendencia).
 * Confianza (alta / media / baja) por márgenes respecto de los umbrales (ver `confidenceOf`): R², cuánto supera la
 * tendencia a su umbral, espesor del tramo frente al mínimo y nº de cruces.
 *
 * Los umbrales son criterios prácticos, NO valores de libro: dependen de la curva, de la resolución vertical y del
 * criterio del intérprete (por eso son parámetros). Además la forma del GR NO es diagnóstica por sí sola (Rider 1990):
 * un embudo puede ser barra de desembocadura, frente deltaico, playa o lóbulo turbidítico; hay que confirmar con
 * testigos, buzamientos, otros perfiles y el contexto regional. Los textos de interpretación lo dicen.
 *
 * FUSIÓN SIMÉTRICA (Geo-1): un par contiguo campana/embudo (en cualquier orden) sin salto en la unión
 * (≤ `symmetricJunctionMax`), de espesores comparables (cociente entre 1/3 y 3) y con cada mitad de al menos
 * `symmetricMinHalf`, se reúne en un solo tramo si el conjunto pasa la prueba de simetría; si no, quedan dos tramos.
 *
 * ZONAS SUGERIDAS (L): los límites entre tramos se ordenan por «fuerza» = |contraste| de GR entre las ventanas
 * (`contrastWindow`) de cada lado; se van fusionando, de a uno y empezando por el más débil, los tramos cuyo contraste
 * es menor que `mergeContrast` (o hasta quedar `maxBoundaries`). Con curvas adicionales (p. ej. densidad, log10 de Rt)
 * también cuentan para ubicar y conservar límites (contraste relativo a su rango P10–P90 ≥ `mergeContrastRel`) y la
 * fuerza `strengthRel` es el máximo del contraste relativo de todas las curvas. Un límite solo por cambio de pendiente (sin salto de nivel)
 * se descarta: es una limitación conocida (un tope de zona se suele ver como salto de nivel).
 *
 * Referencias: Killick, R., Fearnhead, P. y Eckley, I. (2012), «Optimal detection of changepoints with a linear
 * computational cost», JASA 107(500), 1590–1598 (PELT); Schwarz, G. (1978), «Estimating the dimension of a model»,
 * Annals of Statistics 6(2), 461–464 (BIC); Rider, M. y Kennedy, M. (2011), «The Geological Interpretation of Well
 * Logs», 3.ª ed., Rider-French (formas del GR y electrofacies); Rider, M. (1990), «Gamma-ray log shape used as a facies
 * indicator: critical analysis of an oversimplified methodology», Geol. Soc. London Spec. Publ. 48, 27–37; Serra, O.
 * (1985), «Sedimentary Environments from Wireline Logs», Schlumberger; Cant, D. J. (1992), «Subsurface facies analysis»,
 * en Walker y James (eds.), Facies Models: Response to Sea Level Change, Geol. Assoc. Canada, 27–45.
 */

// --------------------------------------------------------------------------------------------------------------
// Tipos y parámetros

export type SegmentShape = 'cylinder' | 'funnel' | 'bell' | 'serrated' | 'symmetric' | 'unclear';
export type SegmentConfidence = 'high' | 'medium' | 'low';
/** Nivel del tramo respecto de las líneas base de arena limpia y de lutita. */
export type SegmentLevel = 'low' | 'medium' | 'high';
/** Tipo de simetría: GR mínimo (arena) o máximo (arcilla) en el medio del tramo. */
export type SymmetryKind = 'sandCenter' | 'shaleCenter';

export interface SegmentationParams {
  /** Ventana de la mediana móvil (m). 0 = sin suavizado. */
  smoothWindow: number;
  /** Espesor mínimo de un tramo (m). */
  minThickness: number;
  /** Multiplicador de la penalización BIC por límite (adimensional; mayor = menos tramos). */
  penalty: number;
  /** Piso del desvío de ruido (unidad de la curva): evita dividir por cero en curvas sin ruido. */
  noiseFloor: number;
  /** Hueco de datos máximo que se puentea (m); uno mayor corta la curva en bloques. */
  maxGap: number;
  /** Fusiona las rachas de capas delgadas alternantes en un solo tramo serrado. */
  mergeSerrated: boolean;
  /** Espesor máximo de una capa «delgada» de una racha serrada (m). */
  thinBedMax: number;
  /** Salto mínimo de nivel entre capas delgadas contiguas de una racha serrada (unidad de la curva). */
  serrationAmplitude: number;
  /** Cambios de sentido mínimos de una racha serrada. */
  minReversals: number;
}

/**
 * Valores por defecto. `penalty` = 8 sale de calibrar sobre el pozo del TP (GR de 0,15 m): con 1 (BIC puro con ruido
 * independiente) el GR real, autocorrelado y con variabilidad geológica, se corta en ~150 tramos; con 8 quedan ~40 en
 * 885 m (ver el encabezado, regla 4). Con ruido gaussiano independiente no se propone ningún límite.
 */
export const SEGMENTATION_DEFAULTS: Readonly<SegmentationParams> = {
  smoothWindow: 1,
  minThickness: 1.5,
  penalty: 8,
  noiseFloor: 1,
  maxGap: 3,
  mergeSerrated: true,
  thinBedMax: 4,
  serrationAmplitude: 8,
  minReversals: 2,
};

export interface ElectrosequenceParams {
  /** |pendiente| mínima para embudo/campana (unidad de la curva por m; gAPI/m). */
  slopeThreshold: number;
  /** |variación total| mínima a lo largo del tramo para embudo/campana (unidad de la curva; gAPI). */
  minTrendChange: number;
  /** Desvío residual mínimo (unidad de la curva) para hablar de serrado. */
  serrationStd: number;
  /** Cruces mínimos de la recta de ajuste (con banda muerta) para hablar de serrado. */
  minCrossings: number;
  /** Línea base de arena limpia (unidad de la curva); NaN = percentil 10 de la curva. */
  cleanLevel: number;
  /** Línea base de lutita (unidad de la curva); NaN = percentil 90 de la curva. */
  shaleLevel: number;
  /** Fusiona un par campana/embudo contiguo y continuo en un solo tramo simétrico. */
  mergeSymmetric: boolean;
  /** Salto máximo en la unión de un par fusionado como simétrico (unidad de la curva). */
  symmetricJunctionMax: number;
  /** Espesor mínimo de cada mitad de un tramo simétrico (m): un pico delgado no es un ciclo completo. */
  symmetricMinHalf: number;
  /** Salto de nivel en el tope/base a partir del cual el contacto se llama «neto» (unidad de la curva). */
  sharpContrast: number;
  /** Unidad de la curva para los textos. */
  unit: string;
}

export const ELECTROSEQUENCE_DEFAULTS: Readonly<ElectrosequenceParams> = {
  slopeThreshold: 0.5,
  minTrendChange: 8,
  serrationStd: 8,
  minCrossings: 4,
  cleanLevel: NaN,
  shaleLevel: NaN,
  mergeSymmetric: true,
  symmetricJunctionMax: 5,
  symmetricMinHalf: 3,
  sharpContrast: 20,
  unit: 'gAPI',
};

export interface ZoneSuggestionParams {
  /** Contraste mínimo de la curva principal para conservar un límite (unidad de la curva; gAPI). */
  mergeContrast: number;
  /** Contraste mínimo de las curvas adicionales, relativo a su rango P10–P90, para conservar un límite. */
  mergeContrastRel: number;
  /** Ventana a cada lado del límite para medir el contraste (m); se acota a la mitad del tramo vecino. */
  contrastWindow: number;
  /** Máximo de límites devueltos (0 = sin tope): se conservan los más fuertes. */
  maxBoundaries: number;
}

export const ZONE_SUGGESTION_DEFAULTS: Readonly<ZoneSuggestionParams> = {
  mergeContrast: 10,
  mergeContrastRel: 0.25,
  contrastWindow: 2,
  maxBoundaries: 0,
};

/** Tramo con estadísticas (resultado de la segmentación, todavía sin clasificar). */
export interface CurveSegment {
  /** Orden de arriba hacia abajo (0 = el más somero). */
  index: number;
  /** m */
  top: number;
  base: number;
  thickness: number;
  /** Índices (inclusivos) de la primera y la última muestra VÁLIDA del tramo en los arreglos originales. */
  first: number;
  last: number;
  /** Muestras válidas del tramo. */
  samples: number;
  /** Media y desvío de la curva original (sin suavizar) en el tramo. */
  mean: number;
  std: number;
  /** Pendiente de la recta de ajuste de la curva suavizada (unidad/m; > 0: la curva aumenta hacia abajo). */
  slope: number;
  /** Valor de la recta de ajuste en el tope y en la base. */
  valueTop: number;
  valueBase: number;
  /** R² del ajuste lineal (0 si la curva es constante). */
  r2: number;
  /** Desvío residual del ajuste lineal (unidad de la curva). */
  residualStd: number;
  /** Cruces de la recta de ajuste (con banda muerta de ½ desvío residual): mide el serrado. */
  crossings: number;
  /** Bloque de datos al que pertenece (los huecos largos separan bloques). */
  block: number;
}

export interface Electrosequence extends CurveSegment {
  shape: SegmentShape;
  /** Nombre de la forma en español. */
  shapeLabel: string;
  confidence: SegmentConfidence;
  level: SegmentLevel;
  /** Tendencia (embudo/campana) con serrado superpuesto. */
  serrated: boolean;
  /** Solo en `shape` = 'symmetric'. */
  symmetry: SymmetryKind | null;
  /** Variación total del ajuste a lo largo del tramo, valueBase − valueTop (unidad de la curva). */
  trendChange: number;
  /** Contraste GR(debajo) − GR(arriba) en el tope y en la base del tramo; NaN en el borde de un bloque de datos. */
  topContrast: number;
  baseContrast: number;
  /** Qué se observa (forma, valores, pendiente), en español. */
  description: string;
  /** Interpretación depositacional posible, en español (con la advertencia de que la forma no es diagnóstica). */
  interpretation: string;
}

export interface SuggestedBoundary {
  /** m, profundidad del límite. */
  depth: number;
  /** Índice, en los arreglos originales, de la primera muestra válida por debajo del límite. */
  index: number;
  /** GR(debajo) − GR(arriba), con las medianas de las ventanas (unidad de la curva). */
  contrast: number;
  /** |contraste| de la curva principal: criterio de fuerza (unidad de la curva). */
  strength: number;
  /** Fuerza relativa: máx. sobre las curvas de |contraste| / rango P10–P90 de la curva. */
  strengthRel: number;
  /** Mediana de la curva principal en las ventanas de arriba y de abajo. */
  valueAbove: number;
  valueBelow: number;
  /** Contraste (debajo − arriba) de cada curva adicional, en el orden recibido. */
  contrastExtra: number[];
  /** Cambio de pendiente (debajo − arriba) de la recta de ajuste de la curva principal (unidad/m). */
  slopeChange: number;
  /** 1 = el más fuerte según `strengthRel` (con una sola curva equivale a ordenar por `strength`). */
  rank: number;
}

export interface SuggestedSection {
  top: number;
  base: number;
  thickness: number;
  /** Media de la curva principal (sin suavizar). */
  mean: number;
}

export interface ZoneSuggestion {
  /** Ordenados por profundidad. */
  boundaries: SuggestedBoundary[];
  /** Los intervalos resultantes (N límites → N+1 secciones por bloque de datos). */
  sections: SuggestedSection[];
}

// --------------------------------------------------------------------------------------------------------------
// Preparación: muestras válidas, bloques, suavizado

interface Prepared {
  /** muestras válidas */
  n: number;
  /** índice original de cada muestra válida */
  orig: Int32Array;
  d: Float64Array;
  /** curvas originales (principal primero) y suavizadas, sobre las muestras válidas */
  raw: Float64Array[];
  sm: Float64Array[];
  /** bloques [a, b) sobre las muestras válidas */
  blocks: [number, number][];
  /** bloque de cada muestra válida */
  blockOf: Int32Array;
  /** paso mediano de muestreo (m) */
  step: number;
  /** mitad de la ventana de suavizado, en muestras */
  half: number;
  /** desvío de ruido de cada curva suavizada */
  sigma: Float64Array;
  /** rango P10–P90 de cada curva original */
  spread: Float64Array;
  p10: Float64Array;
  p90: Float64Array;
}

function medianOfSorted(a: Float64Array, n: number): number {
  const m = n >> 1;
  return n % 2 ? a[m]! : 0.5 * (a[m - 1]! + a[m]!);
}

function percentileSorted(a: Float64Array, n: number, q: number): number {
  if (n === 0) return NaN;
  const pos = q * (n - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(n - 1, lo + 1);
  return a[lo]! + (pos - lo) * (a[hi]! - a[lo]!);
}

/** Primer índice i en a[0..m) con a[i] ≥ v (a ordenado ascendente). */
function lowerBound(a: Float64Array, m: number, v: number): number {
  let lo = 0;
  let hi = m;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid]! < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Mediana móvil de ventana centrada [i−half, i+half] (acotada en los bordes del bloque [a, b)). O(n·half). */
function medianFilter(src: Float64Array, a: number, b: number, half: number, out: Float64Array): void {
  if (half <= 0) {
    for (let i = a; i < b; i++) out[i] = src[i]!;
    return;
  }
  const w = new Float64Array(2 * half + 1);
  let m = 0;
  let lo = a;
  let hi = a - 1;
  for (let i = a; i < b; i++) {
    const nhi = Math.min(b - 1, i + half);
    const nlo = Math.max(a, i - half);
    while (lo < nlo) {
      const pos = lowerBound(w, m, src[lo]!);
      w.copyWithin(pos, pos + 1, m);
      m--;
      lo++;
    }
    while (hi < nhi) {
      hi++;
      const v = src[hi]!;
      const pos = lowerBound(w, m, v);
      w.copyWithin(pos + 1, pos, m);
      w[pos] = v;
      m++;
    }
    out[i] = medianOfSorted(w, m);
  }
}

function sortedCopy(x: Float64Array, a: number, b: number): Float64Array {
  return x.slice(a, b).sort();
}

function prepare(
  depth: ArrayLike<number>,
  curves: readonly ArrayLike<number>[],
  p: Readonly<SegmentationParams>,
): Prepared {
  const N = depth.length;
  for (const c of curves) {
    if (c.length !== N) throw new RangeError('La profundidad y las curvas deben tener el mismo largo.');
  }
  const C = curves.length;
  const orig = new Int32Array(N);
  let n = 0;
  let prevD = -Infinity;
  for (let i = 0; i < N; i++) {
    const di = depth[i]!;
    let ok = Number.isFinite(di);
    for (let c = 0; ok && c < C; c++) ok = Number.isFinite(curves[c]![i]!);
    if (!ok) continue;
    if (!(di > prevD)) throw new RangeError('La profundidad debe ser estrictamente creciente (hacia abajo).');
    prevD = di;
    orig[n++] = i;
  }
  const d = new Float64Array(n);
  const raw = curves.map(() => new Float64Array(n));
  for (let k = 0; k < n; k++) {
    d[k] = depth[orig[k]!]!;
    for (let c = 0; c < C; c++) raw[c]![k] = curves[c]![orig[k]!]!;
  }

  // Bloques separados por huecos más largos que maxGap.
  const blocks: [number, number][] = [];
  const blockOf = new Int32Array(n);
  let start = 0;
  for (let k = 1; k <= n; k++) {
    if (k === n || d[k]! - d[k - 1]! > p.maxGap) {
      if (k > start) blocks.push([start, k]);
      for (let j = start; j < k; j++) blockOf[j] = blocks.length - 1;
      start = k;
    }
  }

  // Paso mediano.
  const dd = new Float64Array(Math.max(0, n - 1));
  let nd = 0;
  for (let k = 1; k < n; k++) {
    const g = d[k]! - d[k - 1]!;
    if (g <= p.maxGap) dd[nd++] = g;
  }
  const step = nd > 0 ? medianOfSorted(dd.subarray(0, nd).sort(), nd) : 1;

  const wSamples = p.smoothWindow > 0 ? Math.round(p.smoothWindow / step) : 1;
  const half = Math.max(0, (Math.max(1, wSamples) - 1) >> 1);
  const sm = raw.map((r) => {
    const out = new Float64Array(n);
    for (const [a, b] of blocks) medianFilter(r, a, b, half, out);
    return out;
  });

  // Ruido (MAD de las segundas diferencias con paso = ventana) y rangos P10–P90.
  const lag = 2 * half + 1;
  const sigma = new Float64Array(C);
  const spread = new Float64Array(C);
  const p10 = new Float64Array(C);
  const p90 = new Float64Array(C);
  for (let c = 0; c < C; c++) {
    const s = sm[c]!;
    const d2 = new Float64Array(n);
    let m = 0;
    for (const [a, b] of blocks) for (let i = a + lag; i < b - lag; i++) d2[m++] = s[i + lag]! - 2 * s[i]! + s[i - lag]!;
    let est = 0;
    if (m >= 10) {
      const sd = d2.subarray(0, m).sort();
      const med = medianOfSorted(sd, m);
      const dev = new Float64Array(m);
      for (let i = 0; i < m; i++) dev[i] = Math.abs(sd[i]! - med);
      est = (1.4826 * medianOfSorted(dev.sort(), m)) / Math.sqrt(6);
    }
    const sr = sortedCopy(raw[c]!, 0, n);
    p10[c] = percentileSorted(sr, n, 0.1);
    p90[c] = percentileSorted(sr, n, 0.9);
    spread[c] = p90[c]! - p10[c]!;
    // Piso: el de la curva principal es un parámetro; el de las demás es relativo a su rango.
    const floor = c === 0 ? p.noiseFloor : 1e-2 * spread[c]!;
    sigma[c] = Math.max(est, floor, 1e-12);
  }
  return { n, orig, d, raw, sm, blocks, blockOf, step, half, sigma, spread, p10, p90 };
}

// --------------------------------------------------------------------------------------------------------------
// Costo de regresión lineal con sumas acumuladas y PELT

interface Prefix {
  sx: Float64Array;
  sy: Float64Array;
  sxx: Float64Array;
  sxy: Float64Array;
  syy: Float64Array;
}

/** Sumas acumuladas de x = prof − prof de la primera muestra del bloque, y = curva suavizada − media del bloque. */
function buildPrefix(pr: Prepared, c: number, a: number, b: number): Prefix {
  const len = b - a;
  const sx = new Float64Array(len + 1);
  const sy = new Float64Array(len + 1);
  const sxx = new Float64Array(len + 1);
  const sxy = new Float64Array(len + 1);
  const syy = new Float64Array(len + 1);
  const x0 = pr.d[a]!;
  let mean = 0;
  for (let i = a; i < b; i++) mean += pr.sm[c]![i]!;
  mean /= len;
  for (let k = 0; k < len; k++) {
    const x = pr.d[a + k]! - x0;
    const y = pr.sm[c]![a + k]! - mean;
    sx[k + 1] = sx[k]! + x;
    sy[k + 1] = sy[k]! + y;
    sxx[k + 1] = sxx[k]! + x * x;
    sxy[k + 1] = sxy[k]! + x * y;
    syy[k + 1] = syy[k]! + y * y;
  }
  return { sx, sy, sxx, sxy, syy };
}

/** Suma de cuadrados residuales de la recta ajustada a las posiciones [s, t) del bloque. */
function rss(P: Prefix, s: number, t: number): number {
  const n = t - s;
  if (n < 3) return 0;
  const sx = P.sx[t]! - P.sx[s]!;
  const sy = P.sy[t]! - P.sy[s]!;
  const Sxx = P.sxx[t]! - P.sxx[s]! - (sx * sx) / n;
  const Sxy = P.sxy[t]! - P.sxy[s]! - (sx * sy) / n;
  const Syy = P.syy[t]! - P.syy[s]! - (sy * sy) / n;
  const r = Sxx > 1e-12 ? Syy - (Sxy * Sxy) / Sxx : Syy;
  return r > 0 ? r : 0;
}

/** Suma ponderada de los RSS de todas las curvas en [s, t). */
function totalCost(prefixes: readonly Prefix[], invVar: readonly number[], s: number, t: number): number {
  let c = 0;
  for (let q = 0; q < prefixes.length; q++) c += invVar[q]! * rss(prefixes[q]!, s, t);
  return c;
}

/**
 * Límites óptimos de un bloque de `len` posiciones (PELT). Devuelve las posiciones (0 < k < len) donde empieza un
 * tramo nuevo. Los límites solo pueden caer en múltiplos de `grid` (más el final): con `grid` > 1 la búsqueda es
 * O((len/grid)²) en el peor caso en vez de O(len²); después `refine` los ajusta a la muestra exacta. `prune` = false
 * desactiva la poda de candidatos (programación dinámica completa; solo para verificar).
 */
function pelt(
  prefixes: readonly Prefix[],
  invVar: readonly number[],
  len: number,
  minSize: number,
  beta: number,
  grid = 1,
  prune = true,
): number[] {
  if (len < 2 * minSize) return [];
  const K = Math.ceil(len / grid);
  const pos = new Int32Array(K + 1);
  for (let k = 0; k <= K; k++) pos[k] = Math.min(k * grid, len);
  const F = new Float64Array(K + 1).fill(Infinity);
  const last = new Int32Array(K + 1);
  F[0] = -beta;
  const cand = new Int32Array(K + 1);
  const cost = new Float64Array(K + 1);
  let nc = 0;
  let ptr = 0; // próximo candidato a evaluar para entrar
  for (let t = 1; t <= K; t++) {
    // Entran los candidatos s con pos[t] − pos[s] ≥ minSize (y alcanzables: F[s] finita).
    while (ptr < t && pos[t]! - pos[ptr]! >= minSize) {
      if (Number.isFinite(F[ptr]!)) cand[nc++] = ptr;
      ptr++;
    }
    if (nc === 0) continue;
    let best = Infinity;
    let arg = 0;
    for (let j = 0; j < nc; j++) {
      const s = cand[j]!;
      const c = totalCost(prefixes, invVar, pos[s]!, pos[t]!);
      cost[j] = c;
      const v = F[s]! + c + beta;
      if (v < best) {
        best = v;
        arg = s;
      }
    }
    F[t] = best;
    last[t] = arg;
    if (prune) {
      let m = 0;
      for (let j = 0; j < nc; j++) {
        const s = cand[j]!;
        if (F[s]! + cost[j]! < best) cand[m++] = s;
      }
      nc = m;
    }
  }
  const cuts: number[] = [];
  for (let t = last[K]!; t > 0; t = last[t]!) cuts.push(pos[t]!);
  cuts.reverse();
  return grid > 1 ? refine(prefixes, invVar, len, minSize, cuts, grid) : cuts;
}

/** Ajusta cada límite a la muestra exacta dentro de ±grid, respetando el espesor mínimo (2 pasadas). */
function refine(
  prefixes: readonly Prefix[],
  invVar: readonly number[],
  len: number,
  minSize: number,
  cuts: number[],
  grid: number,
): number[] {
  const out = cuts.slice();
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < out.length; i++) {
      const prev = i === 0 ? 0 : out[i - 1]!;
      const next = i === out.length - 1 ? len : out[i + 1]!;
      const lo = Math.max(prev + minSize, out[i]! - grid);
      const hi = Math.min(next - minSize, out[i]! + grid);
      let best = Infinity;
      let arg = out[i]!;
      for (let x = lo; x <= hi; x++) {
        const c = totalCost(prefixes, invVar, prev, x) + totalCost(prefixes, invVar, x, next);
        if (c < best) {
          best = c;
          arg = x;
        }
      }
      out[i] = arg;
    }
  }
  return out;
}

/** Con bloques de más de este nº de muestras la búsqueda usa una grilla de límites (ver `pelt`). */
const GRID_MIN_LEN = 1500;
/** Puntos de grilla deseados como máximo en un bloque (acota el peor caso O(K²) de PELT). */
const GRID_MAX_POINTS = 1500;

/**
 * Paso de la grilla: lo justo para que haya ≤ GRID_MAX_POINTS puntos, pero entre minSize/5 (afinar siempre) y minSize/2
 * (para que el espesor mínimo efectivo no pase de 1,5 veces el pedido).
 */
function gridStep(len: number, minSize: number): number {
  const lo = Math.max(1, Math.floor(minSize / 5));
  const hi = Math.max(lo, Math.floor(minSize / 2));
  return Math.min(hi, Math.max(lo, Math.ceil(len / GRID_MAX_POINTS)));
}

/** Tramos [a, b) sobre las muestras válidas (a lo largo de todos los bloques). */
function segmentRanges(pr: Prepared, p: Readonly<SegmentationParams>, prune = true): [number, number][] {
  const C = pr.raw.length;
  const minSize = Math.max(3, Math.ceil(p.minThickness / pr.step - 1e-9));
  const invVar = Array.from(pr.sigma, (s) => 1 / (s * s));
  const out: [number, number][] = [];
  for (const [a, b] of pr.blocks) {
    const len = b - a;
    const prefixes = Array.from({ length: C }, (_, c) => buildPrefix(pr, c, a, b));
    const beta = Math.max(0, p.penalty) * (2 * C + 1) * Math.log(Math.max(len, 3));
    const grid = len > GRID_MIN_LEN && prune ? gridStep(len, minSize) : 1;
    const cuts = pelt(prefixes, invVar, len, minSize, beta, grid, prune);
    let s = a;
    for (const k of cuts) {
      out.push([s, a + k]);
      s = a + k;
    }
    out.push([s, b]);
  }
  return out;
}

// --------------------------------------------------------------------------------------------------------------
// Estadísticas de un tramo

interface RangeStats {
  mean: number;
  std: number;
  slope: number;
  intercept: number; // valor de la recta en x = xc
  xc: number;
  r2: number;
  residualStd: number;
  crossings: number;
  /** media de la curva suavizada */
  smoothMean: number;
}

function rangeStats(pr: Prepared, a: number, b: number): RangeStats {
  const n = b - a;
  const y = pr.sm[0]!;
  const r = pr.raw[0]!;
  let xc = 0;
  let ym = 0;
  let rm = 0;
  for (let i = a; i < b; i++) {
    xc += pr.d[i]!;
    ym += y[i]!;
    rm += r[i]!;
  }
  xc /= n;
  ym /= n;
  rm /= n;
  let Sxx = 0;
  let Sxy = 0;
  let Syy = 0;
  let Srr = 0;
  for (let i = a; i < b; i++) {
    const dx = pr.d[i]! - xc;
    const dy = y[i]! - ym;
    Sxx += dx * dx;
    Sxy += dx * dy;
    Syy += dy * dy;
    Srr += (r[i]! - rm) * (r[i]! - rm);
  }
  const slope = Sxx > 1e-12 ? Sxy / Sxx : 0;
  const rssLin = Math.max(0, Syy - slope * Sxy);
  const r2 = Syy > 1e-12 ? Math.max(0, 1 - rssLin / Syy) : 0;
  const residualStd = Math.sqrt(rssLin / n);
  // Cruces de la recta con banda muerta de ½ desvío residual.
  const dead = 0.5 * residualStd;
  let state = 0;
  let crossings = 0;
  if (dead > 1e-9) {
    for (let i = a; i < b; i++) {
      const res = y[i]! - (ym + slope * (pr.d[i]! - xc));
      const s = res > dead ? 1 : res < -dead ? -1 : 0;
      if (s === 0) continue;
      if (state !== 0 && s !== state) crossings++;
      state = s;
    }
  }
  return { mean: rm, std: Math.sqrt(Srr / n), slope, intercept: ym, xc, r2, residualStd, crossings, smoothMean: ym };
}

/** Tope y base (m) de las muestras válidas [a, b): a mitad de camino entre muestras vecinas del mismo bloque. */
function rangeEdges(pr: Prepared, a: number, b: number): { top: number; base: number } {
  const blk = pr.blockOf[a]!;
  const [ba, bb] = pr.blocks[blk]!;
  const top = a > ba ? 0.5 * (pr.d[a - 1]! + pr.d[a]!) : pr.d[a]! - 0.5 * (pr.d[Math.min(a + 1, bb - 1)]! - pr.d[a]!);
  const base =
    b < bb ? 0.5 * (pr.d[b - 1]! + pr.d[b]!) : pr.d[b - 1]! + 0.5 * (pr.d[b - 1]! - pr.d[Math.max(b - 2, ba)]!);
  return { top, base };
}

function toSegment(pr: Prepared, a: number, b: number, index: number): CurveSegment {
  const st = rangeStats(pr, a, b);
  const { top, base } = rangeEdges(pr, a, b);
  return {
    index,
    top,
    base,
    thickness: base - top,
    first: pr.orig[a]!,
    last: pr.orig[b - 1]!,
    samples: b - a,
    mean: st.mean,
    std: st.std,
    slope: st.slope,
    valueTop: st.intercept + st.slope * (top - st.xc),
    valueBase: st.intercept + st.slope * (base - st.xc),
    r2: st.r2,
    residualStd: st.residualStd,
    crossings: st.crossings,
    block: pr.blockOf[a]!,
  };
}

// --------------------------------------------------------------------------------------------------------------
// Fusión de rachas serradas

function mergeSerratedRuns(pr: Prepared, ranges: [number, number][], p: Readonly<SegmentationParams>): [number, number][] {
  const k = ranges.length;
  const lev = ranges.map(([a, b]) => {
    let m = 0;
    for (let i = a; i < b; i++) m += pr.sm[0]![i]!;
    return m / (b - a);
  });
  const thin = ranges.map(([a, b]) => {
    const { top, base } = rangeEdges(pr, a, b);
    return base - top <= p.thinBedMax + 1e-9;
  });
  const out: [number, number][] = [];
  let i = 0;
  while (i < k) {
    let j = i;
    if (thin[i]) {
      while (
        j + 1 < k &&
        thin[j + 1] &&
        pr.blockOf[ranges[j + 1]![0]]! === pr.blockOf[ranges[j]![0]]! &&
        Math.abs(lev[j + 1]! - lev[j]!) >= p.serrationAmplitude
      ) {
        j++;
      }
    }
    let reversals = 0;
    for (let q = i + 1; q < j; q++) if ((lev[q]! - lev[q - 1]!) * (lev[q + 1]! - lev[q]!) < 0) reversals++;
    if (j > i && reversals >= p.minReversals) {
      out.push([ranges[i]![0], ranges[j]![1]]);
      i = j + 1;
    } else {
      out.push(ranges[i]!);
      i++;
    }
  }
  return out;
}

// --------------------------------------------------------------------------------------------------------------
// API de segmentación

function resolve<T extends object>(defaults: Readonly<T>, partial: Partial<T> | undefined): T {
  return { ...defaults, ...(partial ?? {}) };
}

function finalRanges(pr: Prepared, p: Readonly<SegmentationParams>): [number, number][] {
  if (pr.n < 3) return [];
  const ranges = segmentRanges(pr, p);
  return p.mergeSerrated ? mergeSerratedRuns(pr, ranges, p) : ranges;
}

/**
 * Segmenta la curva en tramos por cambios de nivel y de tendencia (ver el encabezado). Función pura.
 * @param depth  profundidad (m), creciente hacia abajo; NaN = sin dato
 * @param curve  curva principal (gAPI para el GR); NaN = sin dato
 * @param params parámetros (ver `SEGMENTATION_DEFAULTS`)
 * @param extra  curvas adicionales opcionales que también aportan a la posición de los límites
 * @returns tramos de arriba hacia abajo (vacío si hay menos de 3 muestras válidas)
 */
export function segmentCurve(
  depth: ArrayLike<number>,
  curve: ArrayLike<number>,
  params?: Partial<SegmentationParams>,
  extra: readonly ArrayLike<number>[] = [],
): CurveSegment[] {
  const p = resolve(SEGMENTATION_DEFAULTS, params);
  const pr = prepare(depth, [curve, ...extra], p);
  return finalRanges(pr, p).map(([a, b], i) => toSegment(pr, a, b, i));
}

/**
 * Solo para pruebas: índices (en los arreglos originales) de la primera muestra de cada tramo salvo el primero, antes de
 * fusionar serrados. `exact` = true usa la programación dinámica completa (sin poda ni grilla, O(n²)); false, la rápida.
 */
export function segmentCurveBreakpoints(
  depth: ArrayLike<number>,
  curve: ArrayLike<number>,
  params: Partial<SegmentationParams> | undefined,
  exact: boolean,
): number[] {
  const p = resolve(SEGMENTATION_DEFAULTS, params);
  const pr = prepare(depth, [curve], p);
  if (pr.n < 3) return [];
  return segmentRanges(pr, p, !exact)
    .slice(1)
    .map(([a]) => pr.orig[a]!);
}

// --------------------------------------------------------------------------------------------------------------
// Contraste en un límite

interface Contrast {
  /** debajo − arriba, curva principal */
  diff: number;
  above: number;
  below: number;
  extra: number[];
  /** máx. sobre todas las curvas de |contraste| / rango P10–P90 */
  rel: number;
  /** ídem solo sobre las curvas adicionales (0 si no hay) */
  relExtra: number;
}

/** Mediana de la curva suavizada `c` en las muestras [a, b) cuya profundidad está dentro de `w` del extremo indicado. */
function windowMedian(pr: Prepared, c: number, a: number, b: number, w: number, fromEnd: boolean): number {
  const { top, base } = rangeEdges(pr, a, b);
  const limit = Math.min(w, 0.5 * (base - top));
  const buf = new Float64Array(b - a);
  let m = 0;
  for (let i = a; i < b; i++) {
    const inside = fromEnd ? pr.d[i]! >= base - limit : pr.d[i]! <= top + limit;
    if (inside) buf[m++] = pr.sm[c]![i]!;
  }
  if (m === 0) buf[m++] = pr.sm[c]![fromEnd ? b - 1 : a]!;
  return medianOfSorted(buf.subarray(0, m).sort(), m);
}

function contrastAt(pr: Prepared, up: [number, number], down: [number, number], w: number): Contrast {
  const C = pr.raw.length;
  const diffs: number[] = [];
  const vals: number[] = [];
  let rel = 0;
  let relExtra = 0;
  for (let c = 0; c < C; c++) {
    const above = windowMedian(pr, c, up[0], up[1], w, true);
    const below = windowMedian(pr, c, down[0], down[1], w, false);
    diffs.push(below - above);
    if (c === 0) vals.push(above, below);
    if (pr.spread[c]! > 1e-12) {
      const r = Math.abs(below - above) / pr.spread[c]!;
      rel = Math.max(rel, r);
      if (c > 0) relExtra = Math.max(relExtra, r);
    }
  }
  return { diff: diffs[0]!, above: vals[0]!, below: vals[1]!, extra: diffs.slice(1), rel, relExtra };
}

// --------------------------------------------------------------------------------------------------------------
// Zonas sugeridas (L)

/**
 * Propone límites de zona a partir de los cambios de la curva (GR). Segmenta (mismo motor que las electrosecuencias),
 * fusiona los tramos con contraste menor que `mergeContrast` y devuelve los límites restantes con su fuerza.
 * @param depth  profundidad (m)
 * @param curve  curva principal (GR, gAPI)
 * @param params parámetros de segmentación y de fusión (ver `SEGMENTATION_DEFAULTS`, `ZONE_SUGGESTION_DEFAULTS`)
 * @param extra  curvas adicionales opcionales (p. ej. densidad, resistividad en log10): aportan a la posición de los
 *               límites y a la fuerza relativa; un límite se conserva si el contraste del GR ≥ `mergeContrast` o el de
 *               alguna curva adicional ≥ `mergeContrastRel` de su rango P10–P90
 */
export function suggestZoneBoundaries(
  depth: ArrayLike<number>,
  curve: ArrayLike<number>,
  params?: Partial<SegmentationParams & ZoneSuggestionParams>,
  extra: readonly ArrayLike<number>[] = [],
): ZoneSuggestion {
  const sp = resolve(SEGMENTATION_DEFAULTS, params);
  const zp = resolve(ZONE_SUGGESTION_DEFAULTS, params);
  const pr = prepare(depth, [curve, ...extra], sp);
  const secs = finalRanges(pr, sp);
  const w = zp.contrastWindow;

  // Puntaje de cada límite (entre secciones contiguas del mismo bloque): ≥ 1 se conserva. Combina el contraste del
  // GR (relativo a `mergeContrast`) y, si hay curvas adicionales, el de ellas (relativo a `mergeContrastRel`).
  const scoreOf = (c: Contrast) =>
    Math.max(Math.abs(c.diff) / Math.max(zp.mergeContrast, 1e-12), extra.length > 0 ? c.relExtra / Math.max(zp.mergeContrastRel, 1e-12) : 0);
  const sameBlock = (i: number) => pr.blockOf[secs[i]![0]]! === pr.blockOf[secs[i + 1]![0]]!;
  const compute = (i: number) => contrastAt(pr, secs[i]!, secs[i + 1]!, w);

  // cs[i] = contraste del límite entre secs[i] y secs[i+1]; null si es el borde de un bloque (hueco largo).
  const cs: (Contrast | null)[] = secs.slice(0, -1).map((_, i) => (sameBlock(i) ? compute(i) : null));
  for (;;) {
    let weakest = -1;
    let ws = Infinity;
    let nb = 0;
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      if (!c) continue;
      nb++;
      const sc = scoreOf(c);
      if (sc < ws) {
        ws = sc;
        weakest = i;
      }
    }
    if (weakest < 0) break;
    const tooMany = zp.maxBoundaries > 0 && nb > zp.maxBoundaries;
    if (ws >= 1 && !tooMany) break;
    // Fusiona la sección `weakest` con la siguiente y recalcula los dos límites vecinos.
    secs.splice(weakest, 2, [secs[weakest]![0], secs[weakest + 1]![1]]);
    cs.splice(weakest, 1);
    if (weakest > 0 && cs[weakest - 1]) cs[weakest - 1] = compute(weakest - 1);
    if (weakest < cs.length && cs[weakest]) cs[weakest] = compute(weakest);
  }

  const boundaries: SuggestedBoundary[] = [];
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i];
    if (!c) continue;
    const [a, b] = secs[i + 1]!;
    const upStats = rangeStats(pr, secs[i]![0], secs[i]![1]);
    const downStats = rangeStats(pr, a, b);
    boundaries.push({
      depth: rangeEdges(pr, a, b).top,
      index: pr.orig[a]!,
      contrast: c.diff,
      strength: Math.abs(c.diff),
      strengthRel: c.rel,
      valueAbove: c.above,
      valueBelow: c.below,
      contrastExtra: c.extra,
      slopeChange: downStats.slope - upStats.slope,
      rank: 0,
    });
  }
  const order = boundaries
    .map((_, i) => i)
    .sort((i, j) => boundaries[j]!.strengthRel - boundaries[i]!.strengthRel || boundaries[i]!.depth - boundaries[j]!.depth);
  order.forEach((i, r) => (boundaries[i]!.rank = r + 1));

  const sections: SuggestedSection[] = secs.map(([a, b]) => {
    const { top, base } = rangeEdges(pr, a, b);
    let m = 0;
    for (let i = a; i < b; i++) m += pr.raw[0]![i]!;
    return { top, base, thickness: base - top, mean: m / (b - a) };
  });
  return { boundaries, sections };
}

// --------------------------------------------------------------------------------------------------------------
// Electrosecuencias (Geo-1)

const fmt = (x: number, dec = 1): string => {
  if (!Number.isFinite(x)) return 's/d';
  const s = Math.abs(x).toFixed(dec);
  const z = Number(s) === 0;
  return `${x < 0 && !z ? '-' : ''}${s.replace('.', ',')}`;
};
const fmtSigned = (x: number, dec = 1): string => {
  const s = fmt(x, dec);
  return x > 0 && s !== '0' && !s.startsWith('0,0') ? `+${s}` : s;
};

const SHAPE_LABEL: Record<SegmentShape, string> = {
  cylinder: 'Cilindro (bloque)',
  funnel: 'Embudo (engrosamiento hacia arriba)',
  bell: 'Campana (afinamiento hacia arriba)',
  serrated: 'Serrado',
  symmetric: 'Simétrico',
  unclear: 'Sin forma clara',
};

const CAVEAT = 'La forma del GR no es diagnóstica por sí sola (Rider 1990): confirmar con testigos, otros perfiles y el contexto regional.';

interface Baselines {
  clean: number;
  shale: number;
}

function levelOf(mean: number, bl: Baselines): SegmentLevel {
  const span = bl.shale - bl.clean;
  if (!(span > 1e-9)) return 'medium';
  const t = (mean - bl.clean) / span;
  return t < 1 / 3 ? 'low' : t > 2 / 3 ? 'high' : 'medium';
}

interface SymmetryResult {
  kind: SymmetryKind;
  upper: RangeStats;
  lower: RangeStats;
  /** RSS(dos rectas) / RSS(una recta) */
  rssRatio: number;
  hUpper: number;
  hLower: number;
}

/** RSS de la recta ajustada a la curva suavizada en [a, b). */
function linRss(pr: Prepared, a: number, b: number): number {
  const st = rangeStats(pr, a, b);
  return st.residualStd * st.residualStd * (b - a);
}

/** Prueba de simetría: extremo interior (mín. o máx. en el 20–80 % central) con tendencias opuestas significativas. */
function symmetryTest(pr: Prepared, a: number, b: number, ep: Readonly<ElectrosequenceParams>): SymmetryResult | null {
  const n = b - a;
  if (n < 12) return null;
  const y = pr.sm[0]!;
  const lo = a + Math.ceil(0.2 * n);
  const hi = a + Math.floor(0.8 * n);
  let imin = lo;
  let imax = lo;
  for (let i = lo; i <= hi; i++) {
    if (y[i]! < y[imin]!) imin = i;
    if (y[i]! > y[imax]!) imax = i;
  }
  const whole = linRss(pr, a, b);
  const tryApex = (apex: number, kind: SymmetryKind): SymmetryResult | null => {
    if (apex - a < 4 || b - apex < 4) return null;
    const up = rangeStats(pr, a, apex + 1);
    const lw = rangeStats(pr, apex, b);
    const hU = pr.d[apex]! - pr.d[a]!;
    const hL = pr.d[b - 1]! - pr.d[apex]!;
    if (Math.min(hU, hL) < ep.symmetricMinHalf) return null;
    const dU = up.slope * hU;
    const dL = lw.slope * hL;
    const sig =
      kind === 'sandCenter'
        ? up.slope <= -ep.slopeThreshold && lw.slope >= ep.slopeThreshold && dU <= -ep.minTrendChange && dL >= ep.minTrendChange
        : up.slope >= ep.slopeThreshold && lw.slope <= -ep.slopeThreshold && dU >= ep.minTrendChange && dL <= -ep.minTrendChange;
    if (!sig) return null;
    const two = linRss(pr, a, apex + 1) + linRss(pr, apex, b);
    const ratio = whole > 1e-12 ? two / whole : 1;
    if (ratio > 0.7) return null;
    return { kind, upper: up, lower: lw, rssRatio: ratio, hUpper: hU, hLower: hL };
  };
  return tryApex(imin, 'sandCenter') ?? tryApex(imax, 'shaleCenter');
}

interface Classified {
  shape: SegmentShape;
  confidence: SegmentConfidence;
  serrated: boolean;
  symmetry: SymmetryKind | null;
  level: SegmentLevel;
}

function confidenceOf(
  shape: SegmentShape,
  seg: CurveSegment,
  delta: number,
  sym: SymmetryResult | null,
  sp: Readonly<SegmentationParams>,
  ep: Readonly<ElectrosequenceParams>,
  serrated: boolean,
): SegmentConfidence {
  const H = seg.thickness;
  const aDelta = Math.abs(delta);
  const aSlope = Math.abs(seg.slope);
  switch (shape) {
    case 'funnel':
    case 'bell': {
      if (seg.r2 < 0.3 || aDelta < 1.25 * ep.minTrendChange || aSlope < 1.25 * ep.slopeThreshold || H < 1.5 * sp.minThickness) return 'low';
      if (seg.r2 >= 0.6 && aDelta >= 2 * ep.minTrendChange && aSlope >= 1.5 * ep.slopeThreshold && H >= 2 * sp.minThickness && !serrated) return 'high';
      return 'medium';
    }
    case 'cylinder': {
      if (aDelta >= 0.85 * ep.minTrendChange || seg.residualStd >= 0.85 * ep.serrationStd || H < 1.5 * sp.minThickness) return 'low';
      if (aDelta <= 0.5 * ep.minTrendChange && seg.residualStd <= 0.5 * ep.serrationStd && H >= 2 * sp.minThickness) return 'high';
      return 'medium';
    }
    case 'serrated': {
      if (seg.crossings < 1.25 * ep.minCrossings || seg.residualStd < 1.25 * ep.serrationStd) return 'low';
      if (seg.crossings >= 2 * ep.minCrossings && seg.residualStd >= 1.5 * ep.serrationStd) return 'high';
      return 'medium';
    }
    case 'symmetric': {
      if (!sym) return 'low';
      const dU = Math.abs(sym.upper.slope * sym.hUpper);
      const dL = Math.abs(sym.lower.slope * sym.hLower);
      return Math.min(dU, dL) >= 2 * ep.minTrendChange && sym.rssRatio <= 0.5 ? 'high' : 'medium';
    }
    default:
      return 'low';
  }
}

function classifyRange(
  pr: Prepared,
  a: number,
  b: number,
  index: number,
  sp: Readonly<SegmentationParams>,
  ep: Readonly<ElectrosequenceParams>,
  bl: Baselines,
): { seg: CurveSegment; cls: Classified; sym: SymmetryResult | null; delta: number } {
  const seg = toSegment(pr, a, b, index);
  const delta = seg.valueBase - seg.valueTop;
  const level = levelOf(seg.mean, bl);
  const trendSig = Math.abs(seg.slope) >= ep.slopeThreshold && Math.abs(delta) >= ep.minTrendChange;
  const rough = seg.residualStd >= ep.serrationStd && seg.crossings >= ep.minCrossings;
  const sym = seg.samples >= 5 ? symmetryTest(pr, a, b, ep) : null;

  let shape: SegmentShape;
  let serrated = false;
  let symmetry: SymmetryKind | null = null;
  if (seg.samples < 5) {
    shape = 'unclear';
  } else if (rough && !(trendSig && seg.r2 >= 0.5)) {
    shape = 'serrated';
  } else if (rough) {
    shape = seg.slope > 0 ? 'funnel' : 'bell';
    serrated = true;
  } else if (sym) {
    shape = 'symmetric';
    symmetry = sym.kind;
  } else if (trendSig) {
    shape = seg.slope > 0 ? 'funnel' : 'bell';
  } else if (seg.residualStd < ep.serrationStd) {
    shape = 'cylinder';
  } else {
    shape = 'unclear';
  }
  const confidence = confidenceOf(shape, seg, delta, sym, sp, ep, serrated);
  return { seg, cls: { shape, confidence, serrated, symmetry, level }, sym, delta };
}

function describe(seg: CurveSegment, cls: Classified, delta: number, ep: Readonly<ElectrosequenceParams>, topC: number, baseC: number): { description: string; interpretation: string } {
  const u = ep.unit;
  const range = `${fmt(seg.top, 1)}–${fmt(seg.base, 1)} m (${fmt(seg.thickness, 1)} m)`;
  const sharpTop = Number.isFinite(topC) && Math.abs(topC) >= ep.sharpContrast;
  const sharpBase = Number.isFinite(baseC) && Math.abs(baseC) >= ep.sharpContrast;
  const contacts: string[] = [];
  if (sharpTop) contacts.push('techo neto');
  if (sharpBase) contacts.push('base neta');
  const contactTxt = contacts.length ? `; ${contacts.join(' y ')}` : '';
  const stat = `pendiente ${fmtSigned(seg.slope, 2)} ${u}/m, R² ${fmt(seg.r2, 2)}`;
  const lv = cls.level === 'low' ? 'bajo' : cls.level === 'high' ? 'alto' : 'intermedio';
  const serTxt = cls.serrated ? ', con serrado superpuesto' : '';

  let description: string;
  let core: string;
  switch (cls.shape) {
    case 'funnel':
      description = `${range}: embudo${serTxt}; el GR disminuye hacia arriba de ${fmt(seg.valueBase, 0)} a ${fmt(seg.valueTop, 0)} ${u} (${stat})${contactTxt}.`;
      core =
        'Engrosamiento (y limpieza) hacia arriba: sucesión progradante, de aporte creciente de arena. Compatible con barra de desembocadura o frente deltaico, playa o shoreface, lóbulo de abanico submarino, abanico de rotura (crevasse splay) o relleno de lago somerizante (Rider y Kennedy 2011; Serra 1985; Cant 1992).';
      if (sharpTop && topC < 0) core += ' El techo neto (lutita encima) sugiere una superficie de inundación o de abandono sobre la barra.';
      break;
    case 'bell':
      description = `${range}: campana${serTxt}; el GR aumenta hacia arriba de ${fmt(seg.valueBase, 0)} a ${fmt(seg.valueTop, 0)} ${u} (${stat})${contactTxt}.`;
      core =
        'Afinamiento (y ensuciamiento) hacia arriba: energía decreciente. Compatible con relleno de canal fluvial o de marea (barra de meandro), relleno de canal turbidítico, o ciclo retrogradante/transgresivo (Rider y Kennedy 2011; Serra 1985; Cant 1992).';
      if (sharpBase && baseC > 0) core += ' La base neta (lutita debajo) es consistente con una superficie erosiva de canal.';
      break;
    case 'cylinder':
      if (cls.level === 'low') {
        description = `${range}: cilindro de GR bajo (media ${fmt(seg.mean, 0)} ${u}, nivel ${lv}), liso y sin tendencia (${stat})${contactTxt}.`;
        core =
          'Bloque limpio y homogéneo de arena, de apilamiento agradacional: aporte uniforme o apilamiento de canales amalgamados, barra o duna eólica masiva; también carbonato limpio. Los contactos netos indican cambios bruscos de energía (Rider y Kennedy 2011; Cant 1992).';
      } else if (cls.level === 'high') {
        description = `${range}: cilindro de GR alto (media ${fmt(seg.mean, 0)} ${u}, nivel ${lv}), liso y sin tendencia (${stat})${contactTxt}.`;
        core =
          'Bloque de lutita homogénea: sedimentación de baja energía y decantación continua (plataforma o prodelta, marino profundo, lago), sello potencial.';
      } else {
        description = `${range}: cilindro de GR intermedio (media ${fmt(seg.mean, 0)} ${u}, nivel ${lv}), liso y sin tendencia (${stat})${contactTxt}.`;
        core = 'Intervalo uniforme de litología mixta (arena arcillosa o limolita): sedimentación estable sin tendencia de energía definida.';
      }
      break;
    case 'serrated':
      description = `${range}: serrado; el GR alterna alrededor de ${fmt(seg.mean, 0)} ${u} sin tendencia neta (desvío ${fmt(seg.residualStd, 1)} ${u}, ${seg.crossings} cruces de la recta)${contactTxt}.`;
      core =
        'Alternancia de capas de arena y arcilla sin tendencia: llanura de inundación o de marea (heterolítico), turbiditas distales de bajo régimen, plataforma con tormentas, o intercalaciones de lóbulos y canales menores (Rider y Kennedy 2011; Cant 1992).';
      break;
    case 'symmetric':
      description =
        cls.symmetry === 'sandCenter'
          ? `${range}: simétrico con GR mínimo en el medio; leído de base a techo, baja hacia el centro y vuelve a subir hacia el techo (variación neta ${fmtSigned(delta, 0)} ${u})${contactTxt}.`
          : `${range}: simétrico con GR máximo en el medio; leído de base a techo, sube hacia el centro y vuelve a bajar hacia el techo (variación neta ${fmtSigned(delta, 0)} ${u})${contactTxt}.`;
      core =
        cls.symmetry === 'sandCenter'
          ? 'Embudo en la mitad inferior y campana en la superior: progradación seguida de retrogradación (ciclo regresivo–transgresivo completo), con la arena más limpia en el centro. Compatible con barra marina o de plataforma, lóbulo de abanico o delta con retrabajo (Rider y Kennedy 2011; Serra 1985).'
          : 'Campana en la mitad inferior y embudo en la superior: retrogradación seguida de progradación (ciclo transgresivo–regresivo), con el intervalo más arcilloso (condensado o máxima inundación) en el centro (Rider y Kennedy 2011; Cant 1992).';
      break;
    default:
      description = `${range}: sin forma clara (${stat}; desvío ${fmt(seg.residualStd, 1)} ${u}).`;
      core = seg.samples < 5 ? 'Tramo demasiado delgado para clasificar su forma.' : 'Variación irregular sin tendencia ni alternancia reconocible.';
  }
  return { description, interpretation: `${core} ${CAVEAT}` };
}

function baselinesOf(pr: Prepared, ep: Readonly<ElectrosequenceParams>): Baselines {
  return {
    clean: Number.isFinite(ep.cleanLevel) ? ep.cleanLevel : pr.p10[0]!,
    shale: Number.isFinite(ep.shaleLevel) ? ep.shaleLevel : pr.p90[0]!,
  };
}

/** Contraste de nivel en el límite entre dos tramos contiguos del mismo bloque (NaN si no los hay). */
function edgeContrast(pr: Prepared, up: [number, number] | undefined, down: [number, number] | undefined): number {
  if (!up || !down || pr.blockOf[up[0]]! !== pr.blockOf[down[0]]!) return NaN;
  return contrastAt(pr, up, down, ZONE_SUGGESTION_DEFAULTS.contrastWindow).diff;
}

function buildElectrosequence(
  pr: Prepared,
  ranges: [number, number][],
  i: number,
  sp: Readonly<SegmentationParams>,
  ep: Readonly<ElectrosequenceParams>,
  bl: Baselines,
): Electrosequence {
  const [a, b] = ranges[i]!;
  const { seg, cls, delta } = classifyRange(pr, a, b, i, sp, ep, bl);
  const topContrast = edgeContrast(pr, ranges[i - 1], ranges[i]);
  const baseContrast = edgeContrast(pr, ranges[i], ranges[i + 1]);
  const { description, interpretation } = describe(seg, cls, delta, ep, topContrast, baseContrast);
  return {
    ...seg,
    shape: cls.shape,
    shapeLabel: SHAPE_LABEL[cls.shape],
    confidence: cls.confidence,
    level: cls.level,
    serrated: cls.serrated,
    symmetry: cls.symmetry,
    trendChange: delta,
    topContrast,
    baseContrast,
    description,
    interpretation,
  };
}

/**
 * Electrosecuencias: segmenta el GR y clasifica la forma de cada tramo. Con `mergeSymmetric`, un par contiguo
 * campana (arriba) + embudo (abajo), o embudo + campana, sin salto en la unión y de espesores comparables, se
 * fusiona en un tramo «simétrico» si el conjunto pasa la prueba de simetría.
 * @param depth  profundidad (m), creciente hacia abajo
 * @param curve  GR (gAPI); NaN = sin dato
 * @param params parámetros de segmentación y clasificación (ver `SEGMENTATION_DEFAULTS`, `ELECTROSEQUENCE_DEFAULTS`)
 */
export function analyzeElectrosequences(
  depth: ArrayLike<number>,
  curve: ArrayLike<number>,
  params?: Partial<SegmentationParams & ElectrosequenceParams>,
): Electrosequence[] {
  const sp = resolve(SEGMENTATION_DEFAULTS, params);
  const ep = resolve(ELECTROSEQUENCE_DEFAULTS, params);
  const pr = prepare(depth, [curve], sp);
  let ranges = finalRanges(pr, sp);
  const bl = baselinesOf(pr, ep);

  if (ep.mergeSymmetric && ranges.length >= 2) {
    const merged: [number, number][] = [];
    let i = 0;
    while (i < ranges.length) {
      const cur = ranges[i]!;
      const nxt = ranges[i + 1];
      if (nxt && pr.blockOf[cur[0]]! === pr.blockOf[nxt[0]]!) {
        const c1 = classifyRange(pr, cur[0], cur[1], 0, sp, ep, bl);
        const c2 = classifyRange(pr, nxt[0], nxt[1], 0, sp, ep, bl);
        const opposite =
          (c1.cls.shape === 'bell' && c2.cls.shape === 'funnel') || (c1.cls.shape === 'funnel' && c2.cls.shape === 'bell');
        if (opposite) {
          const ratio = c1.seg.thickness / c2.seg.thickness;
          const junction = Math.abs(contrastAt(pr, cur, nxt, ZONE_SUGGESTION_DEFAULTS.contrastWindow).diff);
          if (ratio >= 1 / 3 && ratio <= 3 && junction <= ep.symmetricJunctionMax) {
            const u = classifyRange(pr, cur[0], nxt[1], 0, sp, ep, bl);
            if (u.cls.shape === 'symmetric') {
              merged.push([cur[0], nxt[1]]);
              i += 2;
              continue;
            }
          }
        }
      }
      merged.push(cur);
      i++;
    }
    ranges = merged;
  }
  return ranges.map((_, i) => buildElectrosequence(pr, ranges, i, sp, ep, bl));
}

/**
 * Clasifica la forma del GR de un intervalo arbitrario [top, base] (m), p. ej. una zona definida por el usuario.
 * Devuelve null si el intervalo tiene menos de 3 muestras válidas. Los contrastes de tope y base quedan en NaN.
 */
export function classifyInterval(
  depth: ArrayLike<number>,
  curve: ArrayLike<number>,
  top: number,
  base: number,
  params?: Partial<SegmentationParams & ElectrosequenceParams>,
): Electrosequence | null {
  const sp = resolve(SEGMENTATION_DEFAULTS, params);
  const ep = resolve(ELECTROSEQUENCE_DEFAULTS, params);
  const pr = prepare(depth, [curve], sp);
  let a = 0;
  while (a < pr.n && pr.d[a]! < top) a++;
  let b = a;
  while (b < pr.n && pr.d[b]! < base) b++;
  if (b - a < 3) return null;
  const bl = baselinesOf(pr, ep);
  const { seg, cls, delta } = classifyRange(pr, a, b, 0, sp, ep, bl);
  const { description, interpretation } = describe(seg, cls, delta, ep, NaN, NaN);
  return {
    ...seg,
    shape: cls.shape,
    shapeLabel: SHAPE_LABEL[cls.shape],
    confidence: cls.confidence,
    level: cls.level,
    serrated: cls.serrated,
    symmetry: cls.symmetry,
    trendChange: delta,
    topContrast: NaN,
    baseContrast: NaN,
    description,
    interpretation,
  };
}
