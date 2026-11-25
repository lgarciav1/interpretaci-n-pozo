/**
 * Capacidad de almacenaje y de flujo (función S) y curvas de Lorenz (estratigráfica y ordenada).
 *
 * Unidades: espesores en m, φ en v/v (fracción, NO %), permeabilidad en mD. Capacidad de almacenaje φ·h en m,
 * capacidad de flujo k·h en mD·m. Las fracciones (porcentajes y acumulados normalizados) se devuelven en 0–1 (v/v);
 * la interfaz las multiplica por 100 si quiere mostrar %.
 *
 * Definiciones. Se recorre el reservorio de arriba hacia abajo en tramos i = 1…N (cada tramo es una muestra, o un
 * grupo de muestras consecutivas), con espesor hᵢ, porosidad φᵢ y permeabilidad kᵢ:
 *   Almacenaje          (φh)ᵢ = φᵢ·hᵢ          Σφh = Σ (φh)ᵢ
 *   Flujo               (kh)ᵢ = kᵢ·hᵢ          Σkh = Σ (kh)ᵢ
 *   Porcentajes         pφᵢ = (φh)ᵢ / Σφh     pkᵢ = (kh)ᵢ / Σkh
 *   Acumulados          F_φh,i = Σ_{j≤i} (φh)ⱼ / Σφh      F_kh,i = Σ_{j≤i} (kh)ⱼ / Σkh      (F = 0 antes del tope, 1 en la base)
 *   Tramo agrupado      h = Σ hₛ,  φ = Σ φₛhₛ / h,  k = Σ kₛhₛ / h   (promedio ponderado por espesor: capas en paralelo)
 *
 * Lorenz ESTRATIGRÁFICO (modified Lorenz plot de Gunter et al., 1997): la curva (F_φh,i ; F_kh,i) con los tramos en
 * ORDEN DE PROFUNDIDAD, de (0,0) a (1,1). Conserva la posición de cada tramo: una pendiente mayor que 1 (curva sobre
 * la diagonal) marca un tramo más permeable que la media por unidad de almacenaje («unidad de flujo rápida»), una
 * pendiente menor que 1 una barrera o deflector. La pendiente de cada segmento es (kh)ᵢ/Σkh ÷ (φh)ᵢ/Σφh = (kᵢ/φᵢ)/(k̄/φ̄).
 *
 * Lorenz ORDENADO (clásico, Lake y Jensen, 1991): los mismos tramos pero reordenados por kᵢ/φᵢ DECRECIENTE (el más
 * productivo primero); la curva es cóncava y siempre queda por encima de la diagonal. Pierde la posición pero mide la
 * heterogeneidad máxima del conjunto. La curva estratigráfica nunca queda por encima de la ordenada (misma
 * población de tramos; el orden por k/φ decreciente maximiza el área).
 *
 * Coeficiente de Lorenz (Lake y Jensen, 1991):   Lc = 2·(A − 1/2),   A = área bajo la curva ORDENADA
 * (regla del trapecio sobre los vértices; la curva es lineal a tramos). Lc = 0 si el reservorio es homogéneo
 * (kᵢ/φᵢ constante, la curva es la diagonal) y Lc → 1 cuando todo el flujo está en una fracción mínima del
 * almacenaje. Con N tramos de igual φh y todo el kh en uno solo, Lc = 1 − 1/N (cota máxima discreta): Lc depende de la
 * resolución (cantidad de tramos), por eso se informa también el número de tramos.
 *
 * Tratamiento de datos:
 *   - Una muestra se usa solo si su espesor es finito y > 0, φ es finita y está en [0, 1], y k es finita (no NaN ni
 *     ±∞). El resto se descarta y se cuenta en `noData`. Un tramo agrupado usa solo las muestras válidas.
 *   - k ≤ 0 (valores no físicos, p. ej. un modelo que extrapola por debajo de cero) NO se descarta: aporta 0 al flujo
 *     (kh = 0) y su φh sí cuenta en el almacenaje.
 *   - Filtro opcional `include` (banderas NET_RES o NET_PAY de cutoffs.ts): solo entran las muestras con bandera
 *     exactamente 1; 0 y NaN (sin dato) quedan fuera y no se cuentan en `noData`.
 *   - Si Σφh = 0 o Σkh = 0 no se pueden normalizar: las fracciones, las curvas y Lc quedan en NaN / vacías.
 *
 * Referencias: Gunter, G.W., Finneran, J.M., Hartmann, D.J. y Miller, J.D. (1997), "Early determination of reservoir
 * flow units using an integrated petrophysical method", SPE 38679 (modified Lorenz plot estratigráfico);
 * Lake, L.W. y Jensen, J.L. (1991), "A review of heterogeneity measures used in reservoir characterization",
 * In Situ 15(4) (curva de Lorenz y coeficiente Lc). La consigna del TP llama a esta herramienta «función S de Scribner
 * & Engineer»; esa fuente no se pudo verificar aquí y no se cita como referencia de las ecuaciones.
 */

/** Rango de índices de muestra [start, end). */
export interface SampleRange {
  start: number;
  end: number;
}

/** Curvas muestreadas (mismo índice). */
export interface FlowSamples {
  /** m, profundidad de cada muestra (solo para el tope y la base de los tramos). */
  depth: ArrayLike<number>;
  /** m por muestra. */
  thickness: ArrayLike<number>;
  /** v/v */
  phi: ArrayLike<number>;
  /** mD */
  k: ArrayLike<number>;
  /** Banderas 0/1/NaN (NET_RES o NET_PAY): si se da, solo entran las muestras con bandera 1. */
  include?: ArrayLike<number>;
}

/** Tramo antes de normalizar. */
export interface RawFlowUnit {
  /** m, profundidad de la primera muestra del tramo. */
  top: number;
  /** m, profundidad de la última muestra del tramo. */
  base: number;
  /** m */
  h: number;
  /** v/v, ponderada por espesor */
  phi: number;
  /** mD, ponderada por espesor (k ≤ 0 aportó 0) */
  k: number;
  /** m */
  phiH: number;
  /** mD·m */
  kH: number;
}

export interface FlowUnit extends RawFlowUnit {
  /** Posición del tramo (1 = el más somero). */
  index: number;
  /** k/φ en mD (v/v): NaN si φh = 0. */
  kOverPhi: number;
  /** Fracción del almacenaje total (0–1). */
  phiHFrac: number;
  /** Fracción del flujo total (0–1). */
  kHFrac: number;
  /** F_φh acumulado hasta la base del tramo (0–1). */
  cumPhiH: number;
  /** F_kh acumulado hasta la base del tramo (0–1). */
  cumKH: number;
}

/** Punto de una curva de Lorenz (ambos 0–1). x = F_φh, y = F_kh. */
export interface LorenzPoint {
  x: number;
  y: number;
}

export interface BuiltUnits {
  units: RawFlowUnit[];
  /** Muestras usadas. */
  used: number;
  /** Muestras que pasaban el filtro pero no tenían espesor, φ o k válidos. */
  noData: number;
}

/**
 * Arma los tramos recorriendo los rangos de arriba hacia abajo. Cada tramo reúne `groupSize` muestras VÁLIDAS
 * consecutivas (el último puede tener menos); los rangos se concatenan en el orden dado y el agrupamiento puede
 * cruzar muestras descartadas (el tramo suma solo las válidas).
 * @param samples   curvas muestreadas
 * @param ranges    rangos de índices [start, end) en orden de profundidad (por defecto, todas las muestras)
 * @param groupSize muestras válidas por tramo (entero ≥ 1; 1 = un tramo por muestra)
 */
export function buildFlowUnits(
  samples: FlowSamples,
  ranges: readonly SampleRange[] = [{ start: 0, end: samples.thickness.length }],
  groupSize = 1,
): BuiltUnits {
  const size = Math.max(1, Math.floor(Number.isFinite(groupSize) ? groupSize : 1));
  const units: RawFlowUnit[] = [];
  let used = 0;
  let noData = 0;

  let count = 0;
  let top = NaN;
  let base = NaN;
  let h = 0;
  let phiH = 0;
  let kH = 0;
  const flush = () => {
    if (count === 0) return;
    units.push({ top, base, h, phi: phiH / h, k: kH / h, phiH, kH });
    count = 0;
    h = 0;
    phiH = 0;
    kH = 0;
  };

  for (const { start, end } of ranges) {
    for (let i = start; i < end; i++) {
      if (samples.include && samples.include[i] !== 1) continue;
      const hi = samples.thickness[i]!;
      const phi = samples.phi[i]!;
      const k = samples.k[i]!;
      if (!(hi > 0) || hi === Infinity || !(phi >= 0 && phi <= 1) || !Number.isFinite(k)) {
        noData++;
        continue;
      }
      used++;
      if (count === 0) top = samples.depth[i]!;
      base = samples.depth[i]!;
      h += hi;
      phiH += phi * hi;
      kH += (k > 0 ? k : 0) * hi;
      count++;
      if (count === size) flush();
    }
  }
  flush();
  return { units, used, noData };
}

/**
 * Curva de Lorenz ESTRATIGRÁFICA: (0,0) y luego (F_φh, F_kh) acumulados en la base de cada tramo, en el orden dado.
 * Devuelve [] si Σφh = 0, Σkh = 0 o algún total no es finito (no normalizable). Valores no finitos o ≤ 0 de φh/kh se
 * tratan como 0 para mantener coherencia con `smlpSubUnits`. El último punto es exactamente (1,1).
 */
export function lorenzStratigraphic(units: readonly RawFlowUnit[]): LorenzPoint[] {
  const pos = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0);
  let sPhi = 0;
  let sK = 0;
  for (const u of units) {
    sPhi += pos(u.phiH);
    sK += pos(u.kH);
  }
  if (units.length === 0 || !(sPhi > 0) || !(sK > 0) || !Number.isFinite(sPhi) || !Number.isFinite(sK)) return [];
  const pts: LorenzPoint[] = [{ x: 0, y: 0 }];
  let cPhi = 0;
  let cK = 0;
  for (const u of units) {
    cPhi += pos(u.phiH);
    cK += pos(u.kH);
    pts.push({ x: cPhi / sPhi, y: cK / sK });
  }
  pts[pts.length - 1] = { x: 1, y: 1 };
  return pts;
}

/**
 * Curva de Lorenz ORDENADA (clásica): los tramos por k/φ decreciente (más productivo primero), acumulando φh y kh.
 * Los tramos sin φh ni kh no aportan y se omiten; los de φh = 0 con kh > 0 (k/φ infinito) van primero (segmento
 * vertical). Orden estable (empates en el orden estratigráfico). [] si no es normalizable.
 */
export function lorenzOrdered(units: readonly RawFlowUnit[]): LorenzPoint[] {
  const useful = units.filter((u) => u.phiH > 0 || u.kH > 0);
  // a antes que b si kH_a/φH_a > kH_b/φH_b  ⇔  kH_a·φH_b > kH_b·φH_a  (φH ≥ 0; evita dividir por 0)
  const sorted = useful
    .map((u, i) => ({ u, i }))
    .sort((a, b) => {
      const l = a.u.kH * b.u.phiH;
      const r = b.u.kH * a.u.phiH;
      return l > r ? -1 : l < r ? 1 : a.i - b.i;
    })
    .map((e) => e.u);
  return lorenzStratigraphic(sorted);
}

/**
 * Coeficiente de Lorenz Lc = 2·(A − 1/2) con A el área bajo la curva (regla del trapecio). Se usa sobre la curva
 * ORDENADA. NaN si la curva está vacía. Los redondeos negativos ínfimos (curva = diagonal) se llevan a 0.
 */
export function lorenzCoefficient(curve: readonly LorenzPoint[]): number {
  if (curve.length < 2) return NaN;
  let area = 0;
  for (let i = 1; i < curve.length; i++) {
    area += ((curve[i]!.x - curve[i - 1]!.x) * (curve[i]!.y + curve[i - 1]!.y)) / 2;
  }
  return Math.max(0, 2 * (area - 0.5));
}

export interface FlowCapacity {
  /** Tramos en orden de profundidad, con porcentajes y acumulados normalizados. */
  units: FlowUnit[];
  /** m */
  h: number;
  /** m, Σφh */
  phiH: number;
  /** mD·m, Σkh */
  kH: number;
  /** v/v, Σφh/Σh (NaN sin tramos) */
  phiMean: number;
  /** mD, Σkh/Σh (NaN sin tramos) */
  kMean: number;
  lorenzStrat: LorenzPoint[];
  lorenzOrdered: LorenzPoint[];
  /** Coeficiente de Lorenz (0–1); NaN si no es normalizable. */
  lc: number;
  /** Muestras usadas / descartadas por dato inválido (ver buildFlowUnits). */
  used: number;
  noData: number;
}

/** Normaliza los tramos y arma las curvas y Lc. */
export function flowCapacityFromUnits(raw: readonly RawFlowUnit[], used = NaN, noData = 0): FlowCapacity {
  let h = 0;
  let phiH = 0;
  let kH = 0;
  for (const u of raw) {
    h += u.h;
    phiH += u.phiH;
    kH += u.kH;
  }
  const units: FlowUnit[] = [];
  let cPhi = 0;
  let cK = 0;
  raw.forEach((u, i) => {
    cPhi += u.phiH;
    cK += u.kH;
    units.push({
      ...u,
      index: i + 1,
      kOverPhi: u.phiH > 0 ? u.kH / u.phiH : NaN,
      phiHFrac: phiH > 0 ? u.phiH / phiH : NaN,
      kHFrac: kH > 0 ? u.kH / kH : NaN,
      cumPhiH: phiH > 0 ? cPhi / phiH : NaN,
      cumKH: kH > 0 ? cK / kH : NaN,
    });
  });
  const ordered = lorenzOrdered(raw);
  return {
    units,
    h,
    phiH,
    kH,
    phiMean: h > 0 ? phiH / h : NaN,
    kMean: h > 0 ? kH / h : NaN,
    lorenzStrat: lorenzStratigraphic(raw),
    lorenzOrdered: ordered,
    lc: lorenzCoefficient(ordered),
    used: Number.isNaN(used) ? raw.length : used,
    noData,
  };
}

/**
 * Función S completa sobre uno o varios rangos: tramos, almacenaje/flujo, curvas de Lorenz y Lc.
 * @param samples   curvas muestreadas (y filtro opcional)
 * @param ranges    rangos [start, end) en orden de profundidad (varias zonas se concatenan)
 * @param groupSize muestras válidas por tramo (≥ 1)
 */
export function flowCapacity(
  samples: FlowSamples,
  ranges: readonly SampleRange[] = [{ start: 0, end: samples.thickness.length }],
  groupSize = 1,
): FlowCapacity {
  const { units, used, noData } = buildFlowUnits(samples, ranges, groupSize);
  return flowCapacityFromUnits(units, used, noData);
}

// ===============================================================================================================
// Zonación hidráulica SMLP (Stratigraphic Modified Lorenz Plot, Gunter et al., 1997, SPE 38679)
// ===============================================================================================================

/**
 * Carácter hidráulico operativo de una sub-unidad SMLP según su pendiente m = (% k·h) / (% φ·h) = ΔF_kh / ΔF_φh.
 * Nota científica: los umbrales (> 1,3; 0,7–1,3; 0,3–0,7; < 0,3) son rótulos operativos de lectura en el SMLP,
 * no leyes físicas universales (en Gunter et al., 1997 la distinción es conceptual: pendiente > 1 = unidad de flujo
 * rápida / conducto, ≈ 1 = homogénea, ≪ 1 = barrera o deflector).
 */
export type SmlpCharacter = 'conduit' | 'homogeneous' | 'subordinate' | 'barrier';

/** Umbrales operativos de pendiente (% k·h) / (% φ·h) para rotular sub-unidades SMLP. */
export const SMLP_SLOPE_THRESHOLDS = {
  conduit: 1.3,
  homogeneousMin: 0.7,
  homogeneousMax: 1.3,
  barrier: 0.3,
} as const;

/**
 * Clasifica una sub-unidad SMLP según su índice de flujo relativo m = (% k·h) / (% φ·h).
 *   m > 1,3        → 'conduit'     (Conducto; incluye +∞ cuando φ·h = 0 y k·h > 0)
 *   0,7 ≤ m ≤ 1,3  → 'homogeneous' (Homogéneo)
 *   0,3 ≤ m < 0,7  → 'subordinate' (Subordinado)
 *   m < 0,3        → 'barrier'     (Barrera / Sello parcial; incluye 0)
 * Devuelve null si m es NaN (sin aporte o curva no normalizable).
 */
export function classifySmlpSlope(slope: number): SmlpCharacter | null {
  if (Number.isNaN(slope) || slope < 0) return null;
  if (slope > SMLP_SLOPE_THRESHOLDS.conduit) return 'conduit';
  if (slope >= SMLP_SLOPE_THRESHOLDS.homogeneousMin) return 'homogeneous';
  if (slope < SMLP_SLOPE_THRESHOLDS.barrier) return 'barrier';
  return 'subordinate';
}

/** Sub-unidad hidráulica SMLP (en orden estratigráfico, de arriba hacia abajo). */
export interface SmlpSubUnit {
  /** Posición estratigráfica (1 = S1, la más somera). */
  index: number;
  /** Etiqueta estándar («S1», «S2»…). */
  label: string;
  /** Rango de índices [startIndex, endIndex) dentro del arreglo de tramos. */
  startIndex: number;
  endIndex: number;
  /** Cantidad de tramos incluidos. */
  unitCount: number;
  /** m, profundidad de tope del primer tramo. */
  top: number;
  /** m, profundidad de base del último tramo. */
  base: number;
  /** m, espesor acumulado Σ h_i. */
  h: number;
  /** m, capacidad de almacenaje acumulada Σ (φ·h)_i. */
  phiH: number;
  /** mD·m, capacidad de flujo acumulada Σ (k·h)_i. */
  kH: number;
  /** v/v, porosidad promedio ponderada por espesor. */
  phiMean: number;
  /** mD, permeabilidad promedio ponderada por espesor. */
  kMean: number;
  /** Fracción del almacenaje total (0–1); suma 1 entre todas las sub-unidades cuando Σφ·h > 0. */
  phiHFrac: number;
  /** Fracción del flujo total (0–1); suma 1 entre todas las sub-unidades cuando Σk·h > 0. */
  kHFrac: number;
  /** F_φh acumulado en el tope y en la base de la sub-unidad (0–1). */
  startPhiH: number;
  endPhiH: number;
  /** F_kh acumulado en el tope y en la base de la sub-unidad (0–1). */
  startKH: number;
  endKH: number;
  /** Pendiente (% k·h) / (% φ·h) = kHFrac / phiHFrac (Infinity si φ·h = 0 y k·h > 0; NaN si 0/0 o no normalizable). */
  slope: number;
  /** Carácter hidráulico operativo (null si la pendiente no es calculable). */
  character: SmlpCharacter | null;
}

export interface SmlpSuggestOptions {
  /** Cantidad máxima de sub-unidades (segmentos lineales; entero ≥ 1, por defecto 5). */
  maxSegments?: number;
  /** Desvío perpendicular máximo tolerado en coordenadas normalizadas [0, 1] (por defecto 0,02 = 2 %). */
  tolerance?: number;
}

export interface SmlpSuggestion {
  /** Índices de quiebre interiores ordenados (1 ≤ b < units.length). */
  breaks: number[];
  /** Desvío perpendicular máximo (en [0, 1]) respecto de la polilínea ajustada; NaN si no es normalizable. */
  maxError: number;
  /** Error cuadrático medio perpendicular (ponderado por longitud de arco, en [0, 1]); NaN si no es normalizable. */
  rmsError: number;
}

/** Sanea índices de quiebre interiores: enteros finitos en (0, n), únicos y ordenados ascendentemente. */
export function sanitizeSmlpBreaks(breaks: readonly number[], unitCount: number): number[] {
  if (unitCount <= 1 || breaks.length === 0) return [];
  const valid = new Set<number>();
  for (const raw of breaks) {
    if (!Number.isInteger(raw)) continue;
    if (raw > 0 && raw < unitCount) valid.add(raw);
  }
  return [...valid].sort((a, b) => a - b);
}

/**
 * Construye las sub-unidades hidráulicas SMLP (`S1`, `S2`…) a partir de los tramos en orden de profundidad y los
 * índices de quiebre interiores `breaks`. Sin quiebres devuelve una única sub-unidad `S1` cubriendo todos los tramos.
 * Las fracciones `phiHFrac` y `kHFrac` (0–1) suman exactamente 1 cuando Σφ·h > 0 y Σk·h > 0.
 */
export function smlpSubUnits(units: readonly RawFlowUnit[], breaks: readonly number[] = []): SmlpSubUnit[] {
  const n = units.length;
  if (n === 0) return [];

  let totalPhiH = 0;
  let totalKH = 0;
  for (const u of units) {
    if (Number.isFinite(u.phiH) && u.phiH > 0) totalPhiH += u.phiH;
    if (Number.isFinite(u.kH) && u.kH > 0) totalKH += u.kH;
  }
  const hasPhi = totalPhiH > 0 && Number.isFinite(totalPhiH);
  const hasK = totalKH > 0 && Number.isFinite(totalKH);

  const clean = sanitizeSmlpBreaks(breaks, n);
  const bounds = [0, ...clean, n];
  const out: SmlpSubUnit[] = [];
  let cumPhi = 0;
  let cumK = 0;

  for (let m = 0; m < bounds.length - 1; m++) {
    const startIndex = bounds[m]!;
    const endIndex = bounds[m + 1]!;
    const first = units[startIndex]!;
    const last = units[endIndex - 1]!;
    const startPhi = hasPhi ? cumPhi / totalPhiH : NaN;
    const startK = hasK ? cumK / totalKH : NaN;

    let h = 0;
    let phiH = 0;
    let kH = 0;
    for (let i = startIndex; i < endIndex; i++) {
      const u = units[i]!;
      if (Number.isFinite(u.h) && u.h > 0) h += u.h;
      if (Number.isFinite(u.phiH) && u.phiH > 0) phiH += u.phiH;
      if (Number.isFinite(u.kH) && u.kH > 0) kH += u.kH;
    }
    cumPhi += phiH;
    cumK += kH;

    const isLast = m === bounds.length - 2;
    const endPhi = hasPhi ? (isLast ? 1 : cumPhi / totalPhiH) : NaN;
    const endK = hasK ? (isLast ? 1 : cumK / totalKH) : NaN;
    const phiHFrac = hasPhi ? phiH / totalPhiH : NaN;
    const kHFrac = hasK ? kH / totalKH : NaN;

    let slope = NaN;
    if (hasPhi && hasK) {
      if (phiHFrac > 0) slope = kHFrac / phiHFrac;
      else if (kHFrac > 0) slope = Infinity;
    }

    const index = m + 1;
    out.push({
      index,
      label: `S${index}`,
      startIndex,
      endIndex,
      unitCount: endIndex - startIndex,
      top: first.top,
      base: last.base,
      h,
      phiH,
      kH,
      phiMean: h > 0 ? phiH / h : NaN,
      kMean: h > 0 ? kH / h : NaN,
      phiHFrac,
      kHFrac,
      startPhiH: startPhi,
      endPhiH: endPhi,
      startKH: startK,
      endKH: endK,
      slope,
      character: classifySmlpSlope(slope),
    });
  }
  return out;
}

/** Sumas prefijas de la integral continua ∫ d_perp(s)² ds a lo largo de la polilínea estratigráfica. */
interface ArcErrorPrefix {
  pXX: Float64Array;
  pYY: Float64Array;
  pXY: Float64Array;
  pX: Float64Array;
  pY: Float64Array;
  pW: Float64Array;
}

function buildArcErrorPrefix(pts: readonly LorenzPoint[]): ArcErrorPrefix {
  const n = pts.length - 1;
  const pXX = new Float64Array(n + 1);
  const pYY = new Float64Array(n + 1);
  const pXY = new Float64Array(n + 1);
  const pX = new Float64Array(n + 1);
  const pY = new Float64Array(n + 1);
  const pW = new Float64Array(n + 1);
  for (let t = 0; t < n; t++) {
    const x0 = pts[t]!.x;
    const y0 = pts[t]!.y;
    const x1 = pts[t + 1]!.x;
    const y1 = pts[t + 1]!.y;
    const w = Math.hypot(x1 - x0, y1 - y0);
    const w3 = w / 3;
    pXX[t + 1] = pXX[t]! + w3 * (x0 * x0 + x0 * x1 + x1 * x1);
    pYY[t + 1] = pYY[t]! + w3 * (y0 * y0 + y0 * y1 + y1 * y1);
    pXY[t + 1] = pXY[t]! + w3 * (2 * x0 * y0 + x0 * y1 + x1 * y0 + 2 * x1 * y1);
    pX[t + 1] = pX[t]! + w * (x0 + x1);
    pY[t + 1] = pY[t]! + w * (y0 + y1);
    pW[t + 1] = pW[t]! + w;
  }
  return { pXX, pYY, pXY, pX, pY, pW };
}

/** Integral continua ∫ d_perp(s)² ds de la sub-polilínea pts[i..j] respecto de la cuerda pts[i]→pts[j] en O(1). */
function segmentArcSqError(pts: readonly LorenzPoint[], pref: ArcErrorPrefix, i: number, j: number): number {
  if (j - i <= 1) return 0;
  const xi = pts[i]!.x;
  const yi = pts[i]!.y;
  const dx = pts[j]!.x - xi;
  const dy = pts[j]!.y - yi;
  const len2 = dx * dx + dy * dy;
  // Como F_φh y F_kh son monótonas no decrecientes, dx = dy = 0 implica que todos los vértices intermedios coinciden.
  if (len2 <= 0) return 0;
  const len = Math.sqrt(len2);
  const a = dy / len;
  const b = -dx / len;
  const c = (dx * yi - dy * xi) / len;
  const sXX = pref.pXX[j]! - pref.pXX[i]!;
  const sYY = pref.pYY[j]! - pref.pYY[i]!;
  const sXY = pref.pXY[j]! - pref.pXY[i]!;
  const sX = pref.pX[j]! - pref.pX[i]!;
  const sY = pref.pY[j]! - pref.pY[i]!;
  const sW = pref.pW[j]! - pref.pW[i]!;
  const val = a * a * sXX + b * b * sYY + a * b * sXY + a * c * sX + b * c * sY + c * c * sW;
  return val > 0 ? val : 0;
}

/** Desvío perpendicular máximo de pts[i..j] respecto de la cuerda pts[i]→pts[j] y su índice. */
function segmentMaxPerp(pts: readonly LorenzPoint[], i: number, j: number): { index: number; dist: number } {
  if (j - i <= 1) return { index: -1, dist: 0 };
  const xi = pts[i]!.x;
  const yi = pts[i]!.y;
  const dx = pts[j]!.x - xi;
  const dy = pts[j]!.y - yi;
  const len = Math.hypot(dx, dy);
  if (len <= 0) return { index: -1, dist: 0 };
  let bestIdx = -1;
  let bestDist = 0;
  for (let t = i + 1; t < j; t++) {
    const d = Math.abs(dy * (pts[t]!.x - xi) - dx * (pts[t]!.y - yi)) / len;
    if (d > bestDist) {
      bestDist = d;
      bestIdx = t;
    }
  }
  return { index: bestIdx, dist: bestDist };
}

/** Preselección de hasta `maxCount` vértices candidatos para curvas largas (> 250 tramos) vía división top-down. */
function selectCandidates(pts: readonly LorenzPoint[], maxCount: number): number[] {
  const n = pts.length - 1;
  if (n + 1 <= maxCount) return Array.from({ length: n + 1 }, (_, i) => i);
  interface Span {
    a: number;
    b: number;
    split: number;
    dist: number;
  }
  const makeSpan = (a: number, b: number): Span => {
    const m = segmentMaxPerp(pts, a, b);
    return { a, b, split: m.index, dist: m.dist };
  };
  const spans: Span[] = [makeSpan(0, n)];
  const chosen = new Set<number>([0, n]);
  while (chosen.size < maxCount) {
    let bestPos = -1;
    let bestDist = 1e-12;
    for (let s = 0; s < spans.length; s++) {
      const sp = spans[s]!;
      if (sp.split > sp.a && sp.split < sp.b && sp.dist > bestDist) {
        bestDist = sp.dist;
        bestPos = s;
      }
    }
    if (bestPos < 0) break;
    const sp = spans[bestPos]!;
    chosen.add(sp.split);
    spans.splice(bestPos, 1, makeSpan(sp.a, sp.split), makeSpan(sp.split, sp.b));
  }
  return [...chosen].sort((a, b) => a - b);
}

/**
 * Sugiere quiebres sobre la curva de Lorenz estratigráfica F_kh(F_φh) ajustando tramos lineales por tramos.
 * Minimiza la integral continua del error perpendicular cuadrático ∫ d_perp(s)² ds (invariante a la densidad de
 * muestreo y simétrica entre almacenaje y flujo) por programación dinámica y elige la menor cantidad de segmentos
 * (1…maxSegments) cuyo desvío perpendicular máximo queda por debajo de `tolerance`.
 */
export function suggestSmlpBreaks(units: readonly RawFlowUnit[], opts: SmlpSuggestOptions = {}): SmlpSuggestion {
  const pts = lorenzStratigraphic(units);
  if (pts.length === 0) return { breaks: [], maxError: NaN, rmsError: NaN };
  const n = pts.length - 1;
  if (n <= 1) return { breaks: [], maxError: 0, rmsError: 0 };

  const rawMax = opts.maxSegments;
  const maxSegments = Math.max(1, Math.min(n, Math.floor(rawMax !== undefined && Number.isFinite(rawMax) ? rawMax : 5)));
  const rawTol = opts.tolerance;
  const tol = rawTol !== undefined && Number.isFinite(rawTol) && rawTol >= 0 ? rawTol : 0.02;
  const stopTol = Math.max(tol, 1e-9);

  const pref = buildArcErrorPrefix(pts);
  const totalW = pref.pW[n]!;
  const rmsOf = (cost: number) => (totalW > 0 ? Math.sqrt(Math.max(0, cost) / totalW) : 0);

  const evalBreaks = (breaks: readonly number[]): { cost: number; maxError: number; rmsError: number } => {
    let cost = 0;
    let maxError = 0;
    let prev = 0;
    for (let r = 0; r <= breaks.length; r++) {
      const next = r < breaks.length ? breaks[r]! : n;
      if (next - prev > 1) {
        const xi = pts[prev]!.x;
        const yi = pts[prev]!.y;
        const dx = pts[next]!.x - xi;
        const dy = pts[next]!.y - yi;
        const len = Math.hypot(dx, dy);
        if (len > 0) {
          let dPrev = 0;
          for (let t = prev; t < next; t++) {
            const p0 = pts[t]!;
            const p1 = pts[t + 1]!;
            const dNext = t + 1 === next ? 0 : (dy * (p1.x - xi) - dx * (p1.y - yi)) / len;
            const adNext = Math.abs(dNext);
            if (adNext > maxError) maxError = adNext;
            const w = Math.hypot(p1.x - p0.x, p1.y - p0.y);
            cost += (w / 3) * (dPrev * dPrev + dPrev * dNext + dNext * dNext);
            dPrev = dNext;
          }
        }
      }
      prev = next;
    }
    return { cost, maxError, rmsError: rmsOf(cost) };
  };

  const base = evalBreaks([]);
  if (base.maxError <= stopTol || maxSegments === 1) {
    return { breaks: [], maxError: base.maxError, rmsError: base.rmsError };
  }

  const MAX_DP_VERTICES = 250;
  const cand = n + 1 <= MAX_DP_VERTICES ? Array.from({ length: n + 1 }, (_, i) => i) : selectCandidates(pts, 200);
  const m = cand.length;
  const maxK = Math.min(maxSegments, m - 1);

  // Programación dinámica exacta sobre los vértices candidatos: dp[k][j] = costo mínimo con k segmentos hasta cand[j].
  let dpPrev = new Float64Array(m);
  for (let j = 1; j < m; j++) dpPrev[j] = segmentArcSqError(pts, pref, cand[0]!, cand[j]!);
  const parents: Int32Array[] = [new Int32Array(m)];

  let bestBreaks: number[] = [];
  let bestCost = base.cost;
  let bestMaxError = base.maxError;
  let bestRmsError = base.rmsError;

  for (let k = 2; k <= maxK; k++) {
    const dpCurr = new Float64Array(m).fill(Infinity);
    const parent = new Int32Array(m).fill(-1);
    for (let j = k; j < m; j++) {
      const cj = cand[j]!;
      let best = Infinity;
      let bestI = -1;
      for (let i = k - 1; i < j; i++) {
        const c = dpPrev[i]! + segmentArcSqError(pts, pref, cand[i]!, cj);
        if (c + 1e-15 < best) {
          best = c;
          bestI = i;
        }
      }
      dpCurr[j] = best;
      parent[j] = bestI;
    }
    parents.push(parent);
    dpPrev = dpCurr;

    // Reconstruye los k − 1 quiebres interiores.
    const breaks = new Array<number>(k - 1);
    let cur = m - 1;
    let valid = true;
    for (let step = k - 1; step >= 1; step--) {
      const prevIdx = parents[step]![cur]!;
      if (prevIdx <= 0) {
        valid = false;
        break;
      }
      breaks[step - 1] = cand[prevIdx]!;
      cur = prevIdx;
    }
    if (!valid) break;

    // Si hubo preselección de candidatos (curva larga), ajusta cada quiebre al índice exacto óptimo en 0…n.
    if (cand.length < n + 1) {
      for (let pass = 0; pass < 2; pass++) {
        let moved = false;
        for (let r = 0; r < breaks.length; r++) {
          const left = r === 0 ? 0 : breaks[r - 1]!;
          const right = r === breaks.length - 1 ? n : breaks[r + 1]!;
          let bestIdx = breaks[r]!;
          let bestPair = segmentArcSqError(pts, pref, left, bestIdx) + segmentArcSqError(pts, pref, bestIdx, right);
          for (let idx = left + 1; idx < right; idx++) {
            const pair = segmentArcSqError(pts, pref, left, idx) + segmentArcSqError(pts, pref, idx, right);
            if (pair + 1e-15 < bestPair) {
              bestPair = pair;
              bestIdx = idx;
            }
          }
          if (bestIdx !== breaks[r]!) {
            breaks[r] = bestIdx;
            moved = true;
          }
        }
        if (!moved) break;
      }
    }

    const ev = evalBreaks(breaks);
    // En curvas simétricas en «S», k = 2 puede no mejorar a k = 1 mientras k = 3 sí anula el error: seguir evaluando.
    if (ev.cost >= bestCost - 1e-15 && ev.maxError >= bestMaxError - 1e-12) continue;

    bestBreaks = breaks;
    bestCost = ev.cost;
    bestMaxError = ev.maxError;
    bestRmsError = ev.rmsError;

    if (bestMaxError <= stopTol) break;
  }

  return { breaks: bestBreaks, maxError: bestMaxError, rmsError: bestRmsError };
}
