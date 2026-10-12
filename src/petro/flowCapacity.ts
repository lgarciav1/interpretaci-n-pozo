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
 * Devuelve [] si Σφh = 0 o Σkh = 0 (no normalizable). El último punto es exactamente (1,1).
 */
export function lorenzStratigraphic(units: readonly RawFlowUnit[]): LorenzPoint[] {
  let sPhi = 0;
  let sK = 0;
  for (const u of units) {
    sPhi += u.phiH;
    sK += u.kH;
  }
  if (units.length === 0 || !(sPhi > 0) || !(sK > 0)) return [];
  const pts: LorenzPoint[] = [{ x: 0, y: 0 }];
  let cPhi = 0;
  let cK = 0;
  for (const u of units) {
    cPhi += u.phiH;
    cK += u.kH;
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
