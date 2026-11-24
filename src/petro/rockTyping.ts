/**
 * Tipos de roca (función P) a partir de k y φ de plugs, sin presión capilar medida: Winland R35, Pittman, RQI/FZI de
 * Amaefule (unidades de flujo), función J de Leverett, curvas Pc–Sw de ejemplo de libro y distribución de gargantas de
 * Washburn.
 *
 * Unidades: φ en v/v (fracción, NO %; las ecuaciones empíricas de Winland y Pittman usan φ en %, la función convierte
 * adentro), permeabilidad k en mD, radios de garganta en µm, presión capilar en psi (variantes SI en Pa), tensión
 * interfacial en dyn/cm (SI: N/m), ángulo de contacto en grados. Sin dato (NaN) o fuera de dominio (φ ∉ (0, 1), k ≤ 0)
 * → NaN. Las clases son enteros ≥ 0; "sin clase" es −1 en las funciones escalares y NaN en las `...Into` (que escriben
 * una curva Float64Array, donde NaN = sin dato, igual que las banderas de cutoffs.ts).
 *
 * Ecuaciones (repetidas junto a cada función):
 *   Winland (Kolodzie 1980)   log R35 = 0,732 + 0,588·log k − 0,864·log φ%                 (R35 en µm)
 *   Pittman (1992)            log Rx  = a + b·log k + c·log φ%     (x = 10, 15, … 75; tabla PITTMAN_COEFFICIENTS)
 *   RQI (Amaefule 1993)       RQI = 0,0314·√(k/φ)                                          (µm)
 *   φz                        φz = φ / (1 − φ)
 *   FZI                       FZI = RQI / φz = 0,0314·√(k/φ)·(1 − φ)/φ                     (µm)
 *   k desde FZI               k = φ³·FZI² / (0,0314²·(1 − φ)²) ≈ 1014·FZI²·φ³/(1 − φ)²    (mD)
 *   Leverett                  J = 0,2166·Pc·√(k/φ) / (σ·|cosθ|)    (Pc psi, k mD, σ dyn/cm);  SI: J = Pc·√(k/φ)/(σ·|cosθ|)
 *   Brooks–Corey              Pc = Pd·Sw*^(−1/λ),   Sw* = (Sw − Swirr)/(1 − Swirr)
 *   Washburn                  r = 2·σ·|cosθ| / Pc    (Hg–aire: σ = 480 dyn/cm, θ = 140° ⇒ r[µm] ≈ 106,7 / Pc[psi])
 *
 * Referencias: Winland, citado por Kolodzie, S. (1980), "Analysis of pore throat size and use of the Waxman–Smits
 * equation to determine OOIP in Spindle Field, Colorado", SPE 9382; Pittman, E.D. (1992), "Relationship of porosity and
 * permeability to various parameters derived from mercury injection–capillary pressure curves for sandstone", AAPG
 * Bulletin 76(2):191–198; Martin, A.J., Solomon, S.T. y Hartmann, D.J. (1997), "Characterization of petrophysical flow
 * units in carbonate reservoirs", AAPG Bulletin 81(5):734–759 (clases nano…mega); Amaefule, J.O., Altunbay, M., Tiab,
 * D., Kersey, D.G. y Keelan, D.K. (1993), "Enhanced reservoir description: using core and log data to identify hydraulic
 * (flow) units and predict permeability in uncored intervals/wells", SPE 26436; Leverett, M.C. (1941), "Capillary
 * behavior in porous solids", Trans. AIME 142:152–169; Brooks, R.H. y Corey, A.T. (1964), "Hydraulic properties of
 * porous media", Colorado State University Hydrology Paper 3; Washburn, E.W. (1921), Phys. Rev. 17:273; Tiab, D. y
 * Donaldson, E.C. (2015), "Petrophysics", 4.ª ed., caps. 3 y 5; Jenks, G.F. (1967), "The data model concept in
 * statistical mapping", International Yearbook of Cartography 7; Fisher, W.D. (1958), "On grouping for maximum
 * homogeneity", JASA 53:789–798 (optimalidad exacta de la partición 1D por programación dinámica).
 */

/** Factor de conversión usado más abajo para pasar φ de v/v a %. */
const PCT = 100;

/** x > 0 y finito. Interno. */
function isPos(x: number): boolean {
  return x > 0 && x < Infinity;
}

/** φ en (0, 1). Interno. */
function isPhi(x: number): boolean {
  return x > 0 && x < 1;
}

// ── Winland R35 y Pittman ───────────────────────────────────────────────────────────────────────────────────────

/** Coeficientes de log R = a + b·log k + c·log φ%  (k en mD, φ en %, R en µm). */
export interface ThroatCoefficients {
  a: number;
  b: number;
  c: number;
}

/** Winland R35 (Kolodzie, 1980): log R35 = 0,732 + 0,588·log k − 0,864·log φ%. Regresión sobre plugs de areniscas y carbonatos (Kolodzie: 82 muestras corregidas más unas 240 sin corregir). */
export const WINLAND_R35: ThroatCoefficients = { a: 0.732, b: 0.588, c: -0.864 };

/**
 * Pittman (1992), AAPG Bulletin 76(2):191–198, Table 1 (p. 196): log Rx = a + b·log k + c·log φ%, con Rx el radio de
 * garganta (µm) al x % de saturación de mercurio (x = 10…75), k en mD aire y φ en %. Regresión de 202 muestras de
 * areniscas (multiple regression, SAS). Coeficientes verificados fila por fila contra la tabla publicada. Para x = 10…35
 * el término de φ es estadísticamente insignificante según el paper (asterisco en la tabla); una regresión sin φ da
 * esencialmente lo mismo, pero se mantiene la ecuación completa tal como se publicó. R35 de Pittman (0,255; 0,565;
 * −0,523) difiere del de Winland porque se ajustó con otra muestra: no mezclarlos.
 */
export const PITTMAN_COEFFICIENTS: Readonly<Record<number, ThroatCoefficients>> = {
  10: { a: 0.459, b: 0.5, c: -0.385 },
  15: { a: 0.333, b: 0.509, c: -0.344 },
  20: { a: 0.218, b: 0.519, c: -0.303 },
  25: { a: 0.204, b: 0.531, c: -0.35 },
  30: { a: 0.215, b: 0.547, c: -0.42 },
  35: { a: 0.255, b: 0.565, c: -0.523 },
  40: { a: 0.36, b: 0.582, c: -0.68 },
  45: { a: 0.609, b: 0.608, c: -0.974 },
  50: { a: 0.778, b: 0.626, c: -1.205 },
  55: { a: 0.948, b: 0.632, c: -1.426 },
  60: { a: 1.096, b: 0.648, c: -1.666 },
  65: { a: 1.372, b: 0.643, c: -1.979 },
  70: { a: 1.664, b: 0.627, c: -2.314 },
  75: { a: 1.88, b: 0.609, c: -2.626 },
};

/** Percentiles de saturación de mercurio disponibles en `PITTMAN_COEFFICIENTS`. */
export const PITTMAN_PERCENTILES: readonly number[] = Object.keys(PITTMAN_COEFFICIENTS)
  .map(Number)
  .sort((x, y) => x - y);

/**
 * Radio de garganta (µm) con una regresión de la forma log R = a + b·log k + c·log φ%.
 * @param coef coeficientes (WINLAND_R35 o un elemento de PITTMAN_COEFFICIENTS)
 * @param phi  porosidad (v/v), en (0, 1)
 * @param k    permeabilidad al aire (mD), > 0
 */
export function throatRadius(coef: ThroatCoefficients, phi: number, k: number): number {
  if (!isPhi(phi) || !isPos(k)) return NaN;
  return Math.pow(10, coef.a + coef.b * Math.log10(k) + coef.c * Math.log10(PCT * phi));
}

/**
 * k (mD) que cumple una isolínea de radio R para una φ dada (para dibujar las isolíneas en el crossplot k–φ):
 *   log k = (log R − a − c·log φ%) / b.
 * NaN si φ ∉ (0, 1), R ≤ 0 o b = 0.
 */
export function permForThroatRadius(coef: ThroatCoefficients, radius: number, phi: number): number {
  if (!isPhi(phi) || !isPos(radius) || !(coef.b !== 0)) return NaN;
  return Math.pow(10, (Math.log10(radius) - coef.a - coef.c * Math.log10(PCT * phi)) / coef.b);
}

/** Winland R35 (µm): log R35 = 0,732 + 0,588·log k − 0,864·log φ%. Ver `throatRadius`. */
export function winlandR35(phi: number, k: number): number {
  return throatRadius(WINLAND_R35, phi, k);
}

/** Isolínea de Winland: k (mD) para un R35 (µm) y una φ (v/v). Ver `permForThroatRadius`. */
export function winlandPermForR35(r35: number, phi: number): number {
  return permForThroatRadius(WINLAND_R35, r35, phi);
}

/**
 * Radio de garganta de Pittman Rx (µm) para x ∈ PITTMAN_PERCENTILES (10, 15, … 75). NaN si x no está en la tabla.
 * Ver la advertencia sobre los coeficientes en `PITTMAN_COEFFICIENTS`.
 */
export function pittmanRadius(percentile: number, phi: number, k: number): number {
  const c = PITTMAN_COEFFICIENTS[percentile];
  return c ? throatRadius(c, phi, k) : NaN;
}

/** Isolínea de Pittman: k (mD) para un Rx (µm) y una φ (v/v). NaN si x no está en la tabla. */
export function pittmanPermForRadius(percentile: number, radius: number, phi: number): number {
  const c = PITTMAN_COEFFICIENTS[percentile];
  return c ? permForThroatRadius(c, radius, phi) : NaN;
}

/** Variante por tramo [start, end) de `winlandR35`, escrita en `out` (mismo índice). */
export function winlandR35Into(
  phi: ArrayLike<number>,
  k: ArrayLike<number>,
  out: Float64Array,
  start = 0,
  end = phi.length,
): Float64Array {
  for (let i = start; i < end; i++) out[i] = winlandR35(phi[i]!, k[i]!);
  return out;
}

/** Clase de tamaño de garganta (Martin et al., 1997). `max` es el límite superior (inclusivo). */
export interface PortClass {
  id: 'nano' | 'micro' | 'meso' | 'macro' | 'mega';
  label: string;
  /** Límite inferior (µm, exclusivo salvo en nano, que parte de 0). */
  min: number;
  /** Límite superior (µm, inclusivo; Infinity en mega). */
  max: number;
}

/** nano < 0,1; micro 0,1–0,5; meso 0,5–2; macro 2–10; mega > 10 µm (Martin et al., 1997). Índice de clase = posición. */
export const PORT_CLASSES: readonly PortClass[] = [
  { id: 'nano', label: 'Nano', min: 0, max: 0.1 },
  { id: 'micro', label: 'Micro', min: 0.1, max: 0.5 },
  { id: 'meso', label: 'Meso', min: 0.5, max: 2 },
  { id: 'macro', label: 'Macro', min: 2, max: 10 },
  { id: 'mega', label: 'Mega', min: 10, max: Infinity },
];

/**
 * Índice (0 = nano … 4 = mega) de `PORT_CLASSES` para un radio de garganta (µm). Los límites pertenecen a la clase
 * INFERIOR (r = 0,5 → micro; r = 10 → macro), de modo que "mega" es r > 10 como se enuncia. −1 si r no es > 0 y finito.
 */
export function portClassIndex(radius: number): number {
  if (!isPos(radius)) return -1;
  for (let i = 0; i < PORT_CLASSES.length - 1; i++) if (radius <= PORT_CLASSES[i]!.max) return i;
  return PORT_CLASSES.length - 1;
}

/** Variante por tramo [start, end) de `portClassIndex` sobre un radio (µm); escribe el índice o NaN si no hay clase. */
export function portClassIndexInto(
  radius: ArrayLike<number>,
  out: Float64Array,
  start = 0,
  end = radius.length,
): Float64Array {
  for (let i = start; i < end; i++) {
    const c = portClassIndex(radius[i]!);
    out[i] = c < 0 ? NaN : c;
  }
  return out;
}

// ── RQI, FZI y unidades de flujo ───────────────────────────────────────────────────────────────────────────────

/**
 * Constante de RQI = 0,0314·√(k/φ): es √(1 mD en µm²) = √(9,869233·10⁻⁴) = 0,031414, redondeada a 0,0314 como en
 * Amaefule et al. (1993).
 */
export const RQI_CONSTANT = 0.0314;

/**
 * Constante de k = C·FZI²·φ³/(1 − φ)², igual a 1/0,0314² = 1014,2 (≈ 1014). Se define como el inverso exacto de
 * RQI_CONSTANT², de modo que `permFromFzi(flowZoneIndex(φ, k), φ) = k` sin error de redondeo.
 */
export const FZI_PERM_CONSTANT = 1 / (RQI_CONSTANT * RQI_CONSTANT);

/** Índice de calidad de reservorio RQI = 0,0314·√(k/φ) (µm). φ efectiva en v/v, k en mD. */
export function reservoirQualityIndex(phi: number, k: number): number {
  if (!isPhi(phi) || !isPos(k)) return NaN;
  return RQI_CONSTANT * Math.sqrt(k / phi);
}

/** Porosidad normalizada (relación volumen de poros/granos) φz = φ/(1 − φ). NaN si φ ∉ (0, 1). */
export function normalizedPorosity(phi: number): number {
  return isPhi(phi) ? phi / (1 - phi) : NaN;
}

/** Indicador de zona de flujo FZI = RQI/φz = 0,0314·√(k/φ)·(1 − φ)/φ (µm). NaN si φ ∉ (0, 1) o k ≤ 0. */
export function flowZoneIndex(phi: number, k: number): number {
  if (!isPhi(phi) || !isPos(k)) return NaN;
  return (RQI_CONSTANT * Math.sqrt(k / phi) * (1 - phi)) / phi;
}

/** Variante por tramo [start, end) de `flowZoneIndex`, escrita en `out` (mismo índice). */
export function flowZoneIndexInto(
  phi: ArrayLike<number>,
  k: ArrayLike<number>,
  out: Float64Array,
  start = 0,
  end = phi.length,
): Float64Array {
  for (let i = start; i < end; i++) out[i] = flowZoneIndex(phi[i]!, k[i]!);
  return out;
}

/**
 * Permeabilidad (mD) de una unidad de flujo de índice FZI a porosidad φ: k = 1014,2·FZI²·φ³/(1 − φ)². Es la inversa de
 * `flowZoneIndex` (curva k(φ) de la clase en el crossplot k–φ). NaN si φ ∉ (0, 1) o FZI ≤ 0.
 */
export function permFromFzi(fzi: number, phi: number): number {
  if (!isPhi(phi) || !isPos(fzi)) return NaN;
  const o = 1 - phi;
  return (FZI_PERM_CONSTANT * fzi * fzi * phi * phi * phi) / (o * o);
}

/**
 * Recta de una unidad de flujo en el gráfico log RQI vs log φz: RQI = FZI·φz, o sea log RQI = log FZI + log φz, recta de
 * pendiente 1 que corta φz = 1 en RQI = FZI. Devuelve el RQI (µm) para φz.
 */
export function rqiFromFzi(fzi: number, phiZ: number): number {
  return isPos(fzi) && isPos(phiZ) ? fzi * phiZ : NaN;
}

/**
 * Puntos (φ v/v, k mD) de la curva k(φ) de una unidad de flujo, con `n` φ equiespaciadas (≥ 2) entre phiMin y phiMax.
 */
export function fziPermCurve(
  fzi: number,
  phiMin: number,
  phiMax: number,
  n = 30,
): { phi: Float64Array; k: Float64Array } {
  const m = Math.max(2, Math.floor(n));
  const phi = new Float64Array(m);
  const k = new Float64Array(m);
  for (let i = 0; i < m; i++) {
    phi[i] = phiMin + ((phiMax - phiMin) * i) / (m - 1);
    k[i] = permFromFzi(fzi, phi[i]!);
  }
  return { phi, k };
}

/**
 * Clase de un valor según límites ascendentes: clase i si bounds[i−1] ≤ valor < bounds[i] (un valor igual al límite
 * pertenece a la clase SUPERIOR; clase 0 = valores más bajos). Con n límites hay n + 1 clases. −1 si el valor no es
 * finito. Los límites deben estar ordenados y ser finitos (los no finitos se ignoran).
 */
export function classifyByBounds(value: number, bounds: readonly number[]): number {
  if (!Number.isFinite(value)) return -1;
  let c = 0;
  for (const b of bounds) {
    if (!Number.isFinite(b)) continue;
    if (value >= b) c++;
    else break;
  }
  return c;
}

/**
 * Clasifica una curva (p. ej. FZI, R35) por límites del usuario: out[i] = clase, o NaN si el valor no es finito. Los
 * límites se ordenan antes de usarlos. Clase 0 = valores más bajos (para FZI, la peor calidad de roca).
 */
export function classifyByBoundsInto(
  values: ArrayLike<number>,
  out: Float64Array,
  bounds: readonly number[],
  start = 0,
  end = values.length,
): Float64Array {
  const sorted = bounds.filter(Number.isFinite).sort((x, y) => x - y);
  for (let i = start; i < end; i++) {
    const c = classifyByBounds(values[i]!, sorted);
    out[i] = c < 0 ? NaN : c;
  }
  return out;
}

export interface FlowUnitClass {
  /** Índice de la clase (0 = FZI más bajo). */
  index: number;
  /** Límites de la clase en FZI (µm): −Infinity / Infinity en los extremos. */
  lower: number;
  upper: number;
  /** Muestras con FZI > 0 finito en la clase. */
  n: number;
  /** FZI medio de la clase: media geométrica (media de log10 FZI, que es la escala en que se agrupa). NaN si n = 0. */
  fziMean: number;
  /** Media aritmética del FZI de la clase. NaN si n = 0. */
  fziArithmeticMean: number;
  fziMin: number;
  fziMax: number;
}

export interface FlowUnitClassification {
  /** Límites entre clases (FZI, µm), ascendentes; hay clases.length − 1. */
  bounds: number[];
  classes: FlowUnitClass[];
  /** Clase de cada muestra de entrada, −1 si el FZI no es > 0 finito. */
  labels: Int32Array;
  /** Bondad del ajuste de la varianza en log10 FZI, 1 − SSW/SST ∈ [0, 1] (1 = clases sin dispersión interna). */
  gvf: number;
}

/**
 * Describe una clasificación de FZI por límites dados: clase de cada muestra, estadística por clase y GVF. Es la parte
 * común de la clasificación por bandas del usuario y de la automática.
 * @param fzi    FZI de cada muestra (µm); los no positivos o no finitos quedan con clase −1
 * @param bounds límites ascendentes entre clases (se ordenan)
 */
export function describeFlowUnits(fzi: ArrayLike<number>, bounds: readonly number[]): FlowUnitClassification {
  const b = bounds.filter(Number.isFinite).sort((x, y) => x - y);
  const nc = b.length + 1;
  const labels = new Int32Array(fzi.length);
  const cnt = new Float64Array(nc);
  const sumLog = new Float64Array(nc);
  const sumAr = new Float64Array(nc);
  const mn = new Float64Array(nc).fill(Infinity);
  const mx = new Float64Array(nc).fill(-Infinity);
  let nAll = 0;
  let sumAll = 0;
  for (let i = 0; i < fzi.length; i++) {
    const v = fzi[i]!;
    if (!isPos(v)) {
      labels[i] = -1;
      continue;
    }
    const c = classifyByBounds(v, b);
    labels[i] = c;
    const l = Math.log10(v);
    cnt[c]! += 1;
    sumLog[c]! += l;
    sumAr[c]! += v;
    if (v < mn[c]!) mn[c] = v;
    if (v > mx[c]!) mx[c] = v;
    nAll++;
    sumAll += l;
  }
  const meanLog = new Float64Array(nc);
  for (let c = 0; c < nc; c++) meanLog[c] = cnt[c]! > 0 ? sumLog[c]! / cnt[c]! : NaN;
  const meanAll = nAll > 0 ? sumAll / nAll : NaN;
  let ssw = 0;
  let sst = 0;
  for (let i = 0; i < fzi.length; i++) {
    if (labels[i]! < 0) continue;
    const l = Math.log10(fzi[i]!);
    ssw += (l - meanLog[labels[i]!]!) ** 2;
    sst += (l - meanAll) ** 2;
  }
  const classes: FlowUnitClass[] = [];
  for (let c = 0; c < nc; c++) {
    const n = cnt[c]!;
    classes.push({
      index: c,
      lower: c === 0 ? -Infinity : b[c - 1]!,
      upper: c === nc - 1 ? Infinity : b[c]!,
      n,
      fziMean: n > 0 ? Math.pow(10, meanLog[c]!) : NaN,
      fziArithmeticMean: n > 0 ? sumAr[c]! / n : NaN,
      fziMin: n > 0 ? mn[c]! : NaN,
      fziMax: n > 0 ? mx[c]! : NaN,
    });
  }
  return { bounds: b, classes, labels, gvf: nAll > 0 ? (sst > 0 ? 1 - ssw / sst : 1) : NaN };
}

/**
 * Agrupamiento AUTOMÁTICO de FZI en `nClasses` unidades de flujo por cortes naturales óptimos de log10 FZI.
 *
 * Método elegido: partición 1D óptima (Fisher, 1958; es el criterio de Jenks): minimiza la suma, sobre las clases, de la
 * suma de cuadrados de las desviaciones de log10 FZI respecto de la media de su clase, resuelta EXACTAMENTE por
 * programación dinámica,
 *   D[c][j] = min_{i ≤ j} ( D[c−1][i−1] + SSW(i..j) ),    SSW(i..j) = S2 − S1²/S0  (sumas ponderadas),
 * sobre los valores distintos ordenados con su multiplicidad (así un valor repetido nunca se parte). Se prefiere a
 * k-means 1D (Lloyd) porque: (1) es determinista y no depende de la inicialización; (2) encuentra el mínimo global del
 * mismo objetivo, mientras que Lloyd puede quedar en un mínimo local; (3) en 1D no cuesta más para el tamaño de un
 * conjunto de plugs. Costo O(K·m²) con m valores distintos (decenas a pocos miles).
 * Se agrupa en log10 FZI porque FZI se distribuye aprox. log-normal (Amaefule et al., 1993) y las unidades de flujo
 * son bandas en escala log. El límite entre dos clases vecinas es el punto medio GEOMÉTRICO entre el mayor valor de la
 * inferior y el menor de la superior.
 * Si hay menos valores distintos que clases se reduce el número de clases. Clase 0 = FZI más bajo.
 *
 * @param fzi      FZI de cada muestra (µm); no positivos o no finitos se ignoran (clase −1)
 * @param nClasses número de unidades de flujo deseado (entero ≥ 1)
 * @returns null si no hay ningún FZI válido o nClasses < 1
 */
export function autoFlowUnits(fzi: ArrayLike<number>, nClasses: number): FlowUnitClassification | null {
  const k = Math.floor(nClasses);
  if (!(k >= 1)) return null;
  const raw: number[] = [];
  for (let i = 0; i < fzi.length; i++) {
    const v = fzi[i]!;
    if (isPos(v)) raw.push(v);
  }
  if (raw.length === 0) return null;
  raw.sort((x, y) => x - y); // log10 es monótona: log10 FZI queda también ordenado
  // Valores distintos (en log10 centrado) con multiplicidad, centrados (evita cancelación en S2 − S1²/S0). Se guarda el
  // menor y el mayor FZI ORIGINAL de cada grupo: dos FZI distintos pueden dar el mismo log10 centrado por redondeo.
  const center = Math.log10(raw[Math.floor(raw.length / 2)]!);
  const xs: number[] = [];
  const ws: number[] = [];
  const gMin: number[] = [];
  const gMax: number[] = [];
  for (const v of raw) {
    const x = Math.log10(v) - center;
    if (xs.length > 0 && xs[xs.length - 1] === x) {
      ws[ws.length - 1]! += 1;
      gMax[gMax.length - 1] = v;
    } else {
      xs.push(x);
      ws.push(1);
      gMin.push(v);
      gMax.push(v);
    }
  }
  const m = xs.length;
  const kk = Math.min(k, m);
  if (kk === 1) return describeFlowUnits(fzi, []);

  const p0 = new Float64Array(m + 1);
  const p1 = new Float64Array(m + 1);
  const p2 = new Float64Array(m + 1);
  for (let i = 0; i < m; i++) {
    p0[i + 1] = p0[i]! + ws[i]!;
    p1[i + 1] = p1[i]! + ws[i]! * xs[i]!;
    p2[i + 1] = p2[i]! + ws[i]! * xs[i]! * xs[i]!;
  }
  // Costo de agrupar los valores distintos i..j (inclusive, 0-based).
  const cost = (i: number, j: number): number => {
    const s0 = p0[j + 1]! - p0[i]!;
    const s1 = p1[j + 1]! - p1[i]!;
    const s2 = p2[j + 1]! - p2[i]!;
    return Math.max(0, s2 - (s1 * s1) / s0);
  };
  // D[c][j]: mejor costo de partir los primeros j+1 valores distintos en c+1 clases; back[c][j]: inicio de la última.
  const D: Float64Array[] = [];
  const back: Int32Array[] = [];
  for (let c = 0; c < kk; c++) {
    D.push(new Float64Array(m).fill(Infinity));
    back.push(new Int32Array(m));
  }
  for (let j = 0; j < m; j++) D[0]![j] = cost(0, j);
  for (let c = 1; c < kk; c++) {
    for (let j = c; j < m; j++) {
      let best = Infinity;
      let arg = c;
      for (let i = c; i <= j; i++) {
        const v = D[c - 1]![i - 1]! + cost(i, j);
        if (v < best) {
          best = v;
          arg = i;
        }
      }
      D[c]![j] = best;
      back[c]![j] = arg;
    }
  }
  // Recuperar los inicios de clase.
  const starts: number[] = [];
  let j = m - 1;
  for (let c = kk - 1; c >= 1; c--) {
    const s = back[c]![j]!;
    starts.push(s);
    j = s - 1;
  }
  starts.reverse();
  // Límite = media geométrica de los FZI originales a ambos lados del corte, forzado a (lo, hi]: con valores casi
  // iguales (a pocos ulp) el punto medio redondeado podía caer sobre `lo` o fuera de la brecha, y `describeFlowUnits`
  // reclasificaba la muestra en otra clase (clases vacías o etiquetas distintas de la partición óptima).
  const bounds = starts.map((s) => {
    const lo = gMax[s - 1]!;
    const hi = gMin[s]!;
    const g = Math.sqrt(lo) * Math.sqrt(hi);
    return g > lo && g <= hi ? g : hi;
  });
  return describeFlowUnits(fzi, bounds);
}

// ── función J de Leverett ──────────────────────────────────────────────────────────────────────────────────────

/** 1 psi en dyn/cm² (6894,757·10⁴ dyn/cm² por MPa → 1 psi = 6894,757293 Pa = 68 947,57293 dyn/cm²). */
export const PSI_TO_DYN_PER_CM2 = 68947.57293;

/** 1 mD en cm² (1 darcy = 9,869233·10⁻⁹ cm²). */
export const MD_TO_CM2 = 9.869233e-12;

/**
 * Constante de la función J en unidades de campo: J = C·Pc[psi]·√(k[mD]/φ)/(σ[dyn/cm]·|cosθ|). Resulta de convertir
 * Pc de psi a dyn/cm² y √k de mD a cm: C = 68 947,57·√(9,869233·10⁻¹²) = 0,21660 ≈ 0,2166 (se calcula, no se tipea).
 */
export const LEVERETT_J_FIELD = PSI_TO_DYN_PER_CM2 * Math.sqrt(MD_TO_CM2);

/** |cosθ| con θ en grados; 0 si θ no es finito. Interno. */
function absCos(thetaDeg: number): number {
  return Number.isFinite(thetaDeg) ? Math.abs(Math.cos((thetaDeg * Math.PI) / 180)) : 0;
}

/**
 * Función J de Leverett en unidades de campo (adimensional):
 *   J = 0,2166·Pc·√(k/φ) / (σ·|cosθ|)      (Pc en psi, k en mD, φ en v/v, σ en dyn/cm, θ en grados)
 * Se usa |cosθ| porque en mercurio–aire (θ = 140°, cosθ < 0) la presión de inyección Pc es positiva. Reescala curvas
 * Pc de laboratorio a condiciones de reservorio (misma J) y de plugs de distinta k y φ a una curva común.
 * NaN si Pc < 0, k ≤ 0, φ ∉ (0, 1], σ ≤ 0 o cosθ ≈ 0.
 */
export function leverettJ(pcPsi: number, k: number, phi: number, sigma: number, thetaDeg: number): number {
  const sc = sigma * absCos(thetaDeg);
  if (!(pcPsi >= 0) || pcPsi === Infinity || !isPos(k) || !(phi > 0 && phi <= 1) || !isPos(sigma) || !(sc > 1e-9)) {
    return NaN;
  }
  return (LEVERETT_J_FIELD * pcPsi * Math.sqrt(k / phi)) / sc;
}

/** Inversa de `leverettJ`: Pc (psi) = J·σ·|cosθ| / (0,2166·√(k/φ)). */
export function leverettPcFromJ(j: number, k: number, phi: number, sigma: number, thetaDeg: number): number {
  const sc = sigma * absCos(thetaDeg);
  if (!(j >= 0) || j === Infinity || !isPos(k) || !(phi > 0 && phi <= 1) || !isPos(sigma) || !(sc > 1e-9)) return NaN;
  return (j * sc) / (LEVERETT_J_FIELD * Math.sqrt(k / phi));
}

/**
 * Función J de Leverett en SI: J = Pc·√(k/φ)/(σ·|cosθ|), con Pc en Pa, k en m², σ en N/m. Es la misma J que
 * `leverettJ` (sin constante porque las unidades son coherentes).
 */
export function leverettJSI(pcPa: number, kM2: number, phi: number, sigmaNPerM: number, thetaDeg: number): number {
  const sc = sigmaNPerM * absCos(thetaDeg);
  if (!(pcPa >= 0) || pcPa === Infinity || !isPos(kM2) || !(phi > 0 && phi <= 1) || !isPos(sigmaNPerM) || !(sc > 1e-9)) {
    return NaN;
  }
  return (pcPa * Math.sqrt(kM2 / phi)) / sc;
}

/** Inversa de `leverettJSI`: Pc (Pa) = J·σ·|cosθ|/√(k/φ). */
export function leverettPcFromJSI(j: number, kM2: number, phi: number, sigmaNPerM: number, thetaDeg: number): number {
  const sc = sigmaNPerM * absCos(thetaDeg);
  if (!(j >= 0) || j === Infinity || !isPos(kM2) || !(phi > 0 && phi <= 1) || !isPos(sigmaNPerM) || !(sc > 1e-9)) {
    return NaN;
  }
  return (j * sc) / Math.sqrt(kM2 / phi);
}

// ── Brooks–Corey y curvas de EJEMPLO DE LIBRO ──────────────────────────────────────────────────────────────────

/**
 * Presión capilar de Brooks y Corey (1964): Pc = Pd·Sw*^(−1/λ), con Sw* = (Sw − Swirr)/(1 − Swirr).
 * Pd = presión de desplazamiento (entrada), λ = índice de distribución de tamaño de poros (λ grande = distribución
 * estrecha; λ pequeño = amplia), Swirr = saturación de agua irreducible (v/v). Devuelve Pd en Sw = 1, +Infinity en
 * Sw = Swirr y NaN si Sw ∉ [Swirr, 1] o los parámetros no son válidos. La unidad de Pc es la de Pd.
 */
export function brooksCoreyPc(sw: number, pd: number, lambda: number, swirr: number): number {
  if (!isPos(pd) || !isPos(lambda) || !(swirr >= 0 && swirr < 1) || !(sw >= swirr && sw <= 1)) return NaN;
  const swStar = (sw - swirr) / (1 - swirr);
  return swStar === 0 ? Infinity : pd * Math.pow(swStar, -1 / lambda);
}

/** Inversa de `brooksCoreyPc`: Sw = Swirr + (1 − Swirr)·(Pd/Pc)^λ para Pc ≥ Pd (Sw = 1 si Pc < Pd). */
export function brooksCoreySw(pc: number, pd: number, lambda: number, swirr: number): number {
  if (!isPos(pd) || !isPos(lambda) || !(swirr >= 0 && swirr < 1) || !(pc >= 0) || Number.isNaN(pc)) return NaN;
  if (pc < pd) return 1;
  if (pc === Infinity) return swirr;
  return swirr + (1 - swirr) * Math.pow(pd / pc, lambda);
}

/**
 * Puntos (Sw, Pc) de una curva de Brooks–Corey con `n` valores de Sw* equiespaciados desde 1 (Pc = Pd) hasta `swStarMin`
 * (0 < swStarMin < 1; por defecto 0,05, para no llegar a Pc → ∞). Sw decrece, Pc crece.
 */
export function brooksCoreyCurve(
  pd: number,
  lambda: number,
  swirr: number,
  n = 40,
  swStarMin = 0.05,
): { sw: Float64Array; pc: Float64Array } {
  const m = Math.max(2, Math.floor(n));
  const sw = new Float64Array(m);
  const pc = new Float64Array(m);
  const lo = swStarMin > 0 && swStarMin < 1 ? swStarMin : 0.05;
  for (let i = 0; i < m; i++) {
    const star = 1 - ((1 - lo) * i) / (m - 1);
    sw[i] = swirr + (1 - swirr) * star;
    pc[i] = brooksCoreyPc(sw[i]!, pd, lambda, swirr);
  }
  return { sw, pc };
}

/** Clase de roca de EJEMPLO con su curva Pc–Sw tipo Brooks–Corey (mercurio–aire). NO son datos del pozo. */
export interface ExamplePcClass {
  id: string;
  label: string;
  /** Siempre true: marca de que es un ejemplo ilustrativo, no una medición ni un dato del pozo. */
  bookExample: true;
  /** k (mD) y φ (v/v) representativas de la clase. */
  k: number;
  phi: number;
  /** Índice de distribución de tamaño de poros y Sw irreducible (v/v). */
  lambda: number;
  swirr: number;
  /** Presión de desplazamiento mercurio–aire (psi), por Leverett: Pd = Jd·σ·|cosθ|/(0,2166·√(k/φ)). */
  pd: number;
}

/** Valores mercurio–aire del laboratorio: σ = 480 dyn/cm, θ = 140°. */
export const HG_AIR_SIGMA = 480;
export const HG_AIR_THETA_DEG = 140;

/**
 * J de desplazamiento (J en Sw* = 1) de las curvas de ejemplo: Jd = 0,2 (orden de magnitud típico de la J de entrada
 * para areniscas en mercurio–aire; ilustrativo).
 */
export const EXAMPLE_J_DISPLACEMENT = 0.2;

/** Fuente del conjunto de ejemplo, para mostrar junto a las curvas. */
export const EXAMPLE_PC_SOURCE =
  'EJEMPLO DE LIBRO, no son datos del pozo. Forma de Brooks y Corey (1964), Hydraulic properties of porous media; ' +
  'escalado de Pd por la función J de Leverett (1941); parámetros k, φ, λ y Swirr ilustrativos del orden de magnitud de ' +
  'areniscas de buena a mala calidad (ver Tiab y Donaldson, 2015, Petrophysics, cap. 5).';

/** (id, rótulo, k, φ, λ, Swirr) de las cinco clases de ejemplo, de mejor a peor calidad de roca. */
const EXAMPLE_CLASS_DEFS: readonly [string, string, number, number, number, number][] = [
  ['A', 'Ejemplo A · muy buena', 1000, 0.25, 3.0, 0.08],
  ['B', 'Ejemplo B · buena', 100, 0.2, 2.2, 0.12],
  ['C', 'Ejemplo C · regular', 10, 0.15, 1.5, 0.2],
  ['D', 'Ejemplo D · pobre', 1, 0.1, 1.0, 0.3],
  ['E', 'Ejemplo E · muy pobre', 0.1, 0.06, 0.7, 0.4],
];

/**
 * Conjunto de curvas Pc–Sw de EJEMPLO DE LIBRO (mercurio–aire), una por clase, para ilustrar el rock typing sin datos de
 * MICP. Cada Pd sale de la J de Leverett con la J de desplazamiento común `EXAMPLE_J_DISPLACEMENT`; la curva completa
 * se obtiene con `brooksCoreyCurve(pd, lambda, swirr)`. Marcado `bookExample: true`: la interfaz debe rotularlo.
 */
export const EXAMPLE_PC_CLASSES: readonly ExamplePcClass[] = EXAMPLE_CLASS_DEFS.map(
  ([id, label, k, phi, lambda, swirr]) => ({
    id,
    label,
    bookExample: true as const,
    k,
    phi,
    lambda,
    swirr,
    pd: leverettPcFromJ(EXAMPLE_J_DISPLACEMENT, k, phi, HG_AIR_SIGMA, HG_AIR_THETA_DEG),
  }),
);

// ── Washburn: distribución de tamaño de gargantas ──────────────────────────────────────────────────────────────

/**
 * Radio de garganta de Washburn (µm) para una presión de inyección Pc (psi): r = 2·σ·|cosθ| / Pc. Por defecto
 * mercurio–aire (σ = 480 dyn/cm, θ = 140°), que da r[µm] = 106,66 / Pc[psi] (no 107,6: 2·480·|cos 140°|·10⁴ /
 * 68 947,57 = 106,66). Con otros valores usuales (σ = 485, θ = 130°) da 90,4/Pc. NaN si Pc ≤ 0 o σ ≤ 0.
 */
export function washburnRadius(pcPsi: number, sigma = HG_AIR_SIGMA, thetaDeg = HG_AIR_THETA_DEG): number {
  const sc = sigma * absCos(thetaDeg);
  if (!isPos(pcPsi) || !isPos(sigma) || !(sc > 1e-9)) return NaN;
  return ((2 * sc) / (pcPsi * PSI_TO_DYN_PER_CM2)) * 1e4;
}

/** Inversa de `washburnRadius`: Pc (psi) = 2·σ·|cosθ| / r, con r en µm. */
export function washburnPressure(radiusUm: number, sigma = HG_AIR_SIGMA, thetaDeg = HG_AIR_THETA_DEG): number {
  const sc = sigma * absCos(thetaDeg);
  if (!isPos(radiusUm) || !isPos(sigma) || !(sc > 1e-9)) return NaN;
  return ((2 * sc) / (radiusUm * 1e-4)) / PSI_TO_DYN_PER_CM2;
}

export interface ThroatSizeDistribution {
  /** Radio representativo de cada intervalo (µm): media geométrica de los radios de sus dos extremos. */
  radius: Float64Array;
  /** Fracción del volumen poral que ocupa el intervalo (ΔSHg, v/v del volumen poral). */
  deltaS: Float64Array;
  /** Densidad ΔSHg / Δlog10 r (por década de radio): la distribución para graficar contra log r. */
  dSdLogR: Float64Array;
}

/**
 * Distribución de tamaño de gargantas desde una curva de inyección de mercurio (o una curva Pc–Sw equivalente), por
 * Washburn: el intervalo entre dos presiones consecutivas Pcᵢ < Pcᵢ₊₁ invade las gargantas de radio entre rᵢ₊₁ y rᵢ, y
 * el volumen que entra es ΔSHg = SHgᵢ₊₁ − SHgᵢ. Para una curva Pc–Sw del agua (mojante) SHg = 1 − Sw.
 * Los puntos deben venir con presión creciente; se omiten los intervalos con ΔSHg ≤ 0, presiones no crecientes o datos
 * no finitos. Devuelve arreglos de longitud ≤ n − 1.
 * @param pcPsi presión de inyección (psi), creciente, > 0
 * @param sHg   saturación de mercurio (v/v), no decreciente
 */
export function throatSizeDistribution(
  pcPsi: ArrayLike<number>,
  sHg: ArrayLike<number>,
  sigma = HG_AIR_SIGMA,
  thetaDeg = HG_AIR_THETA_DEG,
): ThroatSizeDistribution {
  const n = Math.min(pcPsi.length, sHg.length);
  const r: number[] = [];
  const ds: number[] = [];
  const dd: number[] = [];
  for (let i = 0; i + 1 < n; i++) {
    const p0 = pcPsi[i]!;
    const p1 = pcPsi[i + 1]!;
    const d = sHg[i + 1]! - sHg[i]!;
    if (!(p1 > p0) || !(d > 0) || !isPos(p0) || !isPos(p1)) continue;
    const r0 = washburnRadius(p0, sigma, thetaDeg);
    const r1 = washburnRadius(p1, sigma, thetaDeg);
    if (!isPos(r0) || !isPos(r1)) continue;
    r.push(Math.sqrt(r0 * r1));
    ds.push(d);
    dd.push(d / (Math.log10(r0) - Math.log10(r1)));
  }
  return { radius: Float64Array.from(r), deltaS: Float64Array.from(ds), dSdLogR: Float64Array.from(dd) };
}

// ── curvas MICP medidas: interpolación y R35 medido ────────────────────────────────────────────────────────────

/** psi por kg/cm² (kilogramo fuerza): 98,0665 kPa / 6,894757293 kPa. */
export const KGF_CM2_TO_PSI = 98.0665 / 6.894757293;

/**
 * Saturación de la fase mojante a una presión capilar dada, interpolando una curva medida (Pc creciente, Sw no
 * creciente) LINEAL en Sw y LOGARÍTMICA en Pc, que es como se grafican y como se espacian los escalones de un ensayo
 * de inyección. Sin extrapolar: NaN si Pc cae fuera de [Pc₁, Pcₙ], si no es > 0 o si la curva tiene menos de 2 puntos.
 * Los intervalos con Pc no creciente o sin dato se saltean (no se avisa): la curva debe venir ordenada y limpia.
 * La unidad de Sw es la de la curva (v/v o %); la de Pc, cualquiera, con tal de que sea la misma en `pc` y `pcTarget`.
 */
export function wettingSaturationAtPc(pc: ArrayLike<number>, sw: ArrayLike<number>, pcTarget: number): number {
  const n = Math.min(pc.length, sw.length);
  if (n < 2 || !isPos(pcTarget)) return NaN;
  // En un nodo, su valor exacto (sin el redondeo de interpolar con t = 1 ni depender de un vecino sin dato).
  for (let i = 0; i < n; i++) if (pc[i] === pcTarget && Number.isFinite(sw[i]!)) return sw[i]!;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pc[i]!;
    const p1 = pc[i + 1]!;
    if (!isPos(p0) || !isPos(p1) || !(p1 > p0)) continue;
    if (pcTarget < p0 || pcTarget > p1) continue;
    const s0 = sw[i]!;
    const s1 = sw[i + 1]!;
    if (!Number.isFinite(s0) || !Number.isFinite(s1)) return NaN;
    const t = Math.log(pcTarget / p0) / Math.log(p1 / p0);
    return s0 + t * (s1 - s0);
  }
  return NaN;
}

/**
 * Presión capilar a la que la curva medida llega a una saturación mojante dada (inversa de `wettingSaturationAtPc`,
 * misma interpolación: lineal en Sw, logarítmica en Pc). Toma el PRIMER cruce con Pc creciente; en una meseta con
 * Sw igual al objetivo devuelve la menor presión. NaN si la curva no alcanza esa saturación (sin extrapolar).
 */
export function pcAtWettingSaturation(pc: ArrayLike<number>, sw: ArrayLike<number>, swTarget: number): number {
  const n = Math.min(pc.length, sw.length);
  if (n < 2 || !Number.isFinite(swTarget)) return NaN;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pc[i]!;
    const p1 = pc[i + 1]!;
    const s0 = sw[i]!;
    const s1 = sw[i + 1]!;
    if (!isPos(p0) || !isPos(p1) || !(p1 > p0) || !Number.isFinite(s0) || !Number.isFinite(s1)) continue;
    if (s0 === swTarget) return p0;
    if (!(s0 > swTarget && swTarget >= s1)) continue;
    const t = (s0 - swTarget) / (s0 - s1);
    return p0 * (p1 / p0) ** t;
  }
  return NaN;
}

/**
 * R35 MEDIDO (µm): radio de Washburn a la presión a la que el mercurio ocupa el 35 % del volumen poral (SHg = 0,35,
 * o sea Sw mojante = 0,65), leído de la curva de inyección. Es la magnitud que la ecuación de Winland estima desde
 * k y φ (Kolodzie, 1980). Mercurio–aire por defecto (σ = 480 dyn/cm, θ = 140°). NaN si la curva no llega a SHg = 0,35.
 * @param pcPsi presión de inyección (psi), creciente
 * @param swFrac saturación mojante (v/v), no creciente
 */
export function measuredR35(pcPsi: ArrayLike<number>, swFrac: ArrayLike<number>, sigma = HG_AIR_SIGMA, thetaDeg = HG_AIR_THETA_DEG): number {
  return washburnRadius(pcAtWettingSaturation(pcPsi, swFrac, 0.65), sigma, thetaDeg);
}
