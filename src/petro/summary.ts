/**
 * Sumario de espesores netos y promedios por intervalo (zona o pozo completo).
 *
 * Unidades: espesores en m, φ, Sw y Vsh en v/v (fracción, NO %), permeabilidad en mD. Banderas netRes/netPay:
 * 1 (neto), 0 (no neto), NaN (sin dato). NaN = sin dato en todas las variables.
 *
 * Definiciones (docs/decisiones/0007-modulos-fase-6a.md, D6). Sea hᵢ el espesor de la muestra i:
 *   Bruto             gross = Σ hᵢ                       (todas las muestras del intervalo)
 *   Sin dato          noData = Σ hᵢ donde netRes = NaN   (ninguna curva conocida la descarta y falta Vsh o φ)
 *   Sin dato de pay   noDataPay = Σ hᵢ donde netRes = 1 y netPay = NaN   (reservorio sin Sw)
 *   Arena neta        netSand = Σ hᵢ donde NET_SAND = 1   (NaN si no se pasa la bandera de arena; 0054)
 *   Neto reservorio   netRes = Σ hᵢ donde NET_RES = 1;   neto pay   netPay = Σ hᵢ donde NET_PAY = 1
 *   Neto/bruto        N/G = neto / bruto                  (NaN si bruto = 0; también para la arena)
 *   Porosidad media   φ̄ = Σ hᵢφᵢ / Σ hᵢ                  (sobre el neto)
 *   Sw media          S̄w = Σ hᵢφᵢSwᵢ / Σ hᵢφᵢ            (ponderada por volumen poral; sobre el neto)
 *   Vsh y k medias    x̄ = Σ hᵢxᵢ / Σ hᵢ
 *   Capacidad de flujo kh = Σ hᵢ·kᵢ                       (mD·m)  (media ARITMÉTICA: flujo horizontal, capas en paralelo)
 *   Acumulados        h·φ = Σ hᵢφᵢ;   h·φ·Sh = Σ hᵢφᵢ(1 − Swᵢ)    (m)
 * Cada promedio usa solo las muestras netas CON dato en las variables que intervienen. Con la ponderación por
 * volumen poral se cumple h·φ̄·(1 − S̄w) = h·φ·Sh cuando todas las muestras netas tienen φ y Sw (siempre en el pay).
 * Neto cero → promedios NaN y sumas 0. EXCEPCIÓN (Sw faltante): si el intervalo tiene reservorio y NINGUNA muestra de
 * reservorio tiene dato de pay, el pay es «sin dato», no 0: netPay, ntgPay, khPay, hphiPay, hphiShPay (y hphiShRes,
 * si ninguna tiene Sw) son NaN. Si solo parte del Sw falta, se suma lo conocido y el faltante queda en noDataPay.
 *
 * Estadísticas agregadas (solo se agregan campos; los anteriores no cambian). Sobre el MISMO conjunto de muestras que
 * cada promedio (neto de reservorio para φ, Sw y Vsh; neto pay para φ, Sw, Vsh, k y RT, como phiPay…kPay):
 *   Geométrica        x̄g = exp(Σ hᵢ·ln xᵢ / Σ hᵢ)   k y RT (`kMeansPay`, `rtMeansPay`); solo xᵢ > 0, el resto es nulo
 *   Armónica          x̄h = Σ hᵢ / Σ(hᵢ / xᵢ)         k con flujo vertical (capas en serie); idem para RT (= resistividad
 *                                                     horizontal de capas en paralelo, Σhᵢ/Σ(hᵢ/Rᵢ)); solo xᵢ > 0
 *                     Ambas ponderadas por espesor; con k = 0 en el pay, `kMeansPay.arith` (aritmética sobre los
 *                     k > 0) es ≥ `kPay` (que incluye los ceros): la desigualdad x̄h ≤ x̄g ≤ x̄a vale con `arith`.
 *   Percentiles       P10, P50, P90 ponderados (`statsRes`, `statsPay`; RT también en el reservorio, `statsRes.rt`):
 *                     por espesor hᵢ en φ, Vsh, k y RT; por volumen poral
 *                     hᵢφᵢ en Sw. P10 = el 10 % del peso tiene un valor MENOR (percentil, no la excedencia de reservas).
 *   Definición de percentil ponderado (la de `weightedQuantiles`, src/petro/distribution.ts, la misma de los boxplots de
 *   Distribución por zona): con las muestras ordenadas por valor y pesos wⱼ = hⱼ, cada muestra se ubica en el punto
 *   medio de su tramo de la CDF, cⱼ = (Σₖ<ⱼ wₖ + wⱼ/2)/Σw, y el percentil p se interpola linealmente entre los (cⱼ, xⱼ);
 *   fuera de [c₁, cₙ] vale el extremo (no extrapola). Con pesos iguales es Hazen (tipo 5 de Hyndman y Fan, 1996).
 *   OJO: el histograma (`sampleStats`) usa tipo 7 SIN pesos; son definiciones distintas, coinciden solo aproximadamente.
 *   Nulos: muestras del conjunto cuyo valor falta (NaN/no finito); se informan su cantidad y su espesor. Para la
 *   geométrica/armónica también es nulo el valor ≤ 0. Para Sw, el conjunto es el de S̄w (muestras con φ y Sw): una
 *   muestra con Sw pero sin φ es nula. Los percentiles de Sw van ponderados por volumen poral h·φ, como S̄w y Distribución por zona.
 * Zona sin muestras / sin dato → NaN (nunca 0, nunca excepción).
 * Varios rangos se acumulan (sumas) y los promedios se recalculan desde las
 * sumas, no promediando promedios; los rangos no deben solaparse.
 *
 * Referencias: Asquith y Krygowski (2004), "Basic Well Log Analysis", AAPG Methods in Exploration 16
 * (espesor neto, φ promedio ponderada por espesor, Sw promedio ponderada por porosidad); Worthington y Cosentino
 * (2005), SPE Reservoir Evaluation & Engineering 8(4); Warren y Price (1961), SPE Journal 1(3) y Lake (1989),
 * "Enhanced Oil Recovery", cap. 2 (promedios de k); Hyndman y Fan (1996), The American Statistician 50(4) (cuantiles).
 */

import { sampleThickness } from '../core/well';
import { weightedQuantiles } from './distribution';
import { positiveMeans, type PositiveMeans } from './stats';

export interface SummaryInput {
  /** m por muestra (ctx.thickness). */
  thickness: ArrayLike<number>;
  /** Banderas 0/1/NaN. */
  netRes: ArrayLike<number>;
  netPay: ArrayLike<number>;
  /** Bandera de arena neta 0/1/NaN (opcional: sin ella netSand y ntgSand son NaN). */
  netSand?: ArrayLike<number>;
  /** v/v */
  phi: ArrayLike<number>;
  sw: ArrayLike<number>;
  /** v/v, mD */
  vsh?: ArrayLike<number>;
  perm?: ArrayLike<number>;
  /** Resistividad verdadera, ohm·m (opcional: sin ella las estadísticas de RT son NaN). */
  rt?: ArrayLike<number>;
}

/** P10/P50/P90 ponderados por espesor y nulos de una variable sobre un conjunto de muestras (ver cabecera). */
export interface SampleDistribution {
  /** Muestras del conjunto con dato. */
  n: number;
  /** m: espesor de las muestras con dato (siempre espesor, también en Sw, aunque sus percentiles pesen h·φ). */
  thickness: number;
  /** Muestras del conjunto sin dato (valor NaN/no finito; para Sw, también sin φ). NaN si no se pasó la curva. */
  nullCount: number;
  /** m: espesor de las muestras sin dato. NaN si no se pasó la curva. */
  nullThickness: number;
  p10: number;
  p50: number;
  p90: number;
}

export interface SummaryOptions {
  /**
   * Calcular percentiles (`statsRes`, `statsPay`) y medias geométrica/armónica (`kMeansPay`, `rtMeansPay`). Por defecto sí.
   * Con `false` esos campos quedan sin dato (NaN, n = 0) y se evita ordenar las muestras: cuesta unos 2 ms por llamada sobre
   * el pozo del TP completo (el resto del sumario, ~0,05 ms), que importa en el recálculo en vivo al mover un corte.
   */
  distributions?: boolean;
}

export interface IntervalSummary {
  /** m */
  gross: number;
  /** Espesor sin clasificar (netRes NaN). */
  noData: number;
  /** Espesor de reservorio sin dato de pay (netRes = 1, netPay NaN: falta Sw). */
  noDataPay: number;
  /** Arena neta (NaN sin bandera de arena). */
  netSand: number;
  /** Espesor sin dato de arena (falta Vsh; NaN sin bandera de arena). */
  noDataSand: number;
  netRes: number;
  netPay: number;
  /** v/v (NaN si gross = 0) */
  ntgSand: number;
  ntgRes: number;
  ntgPay: number;
  /** Promedios sobre el neto de reservorio. */
  phiRes: number;
  swRes: number;
  vshRes: number;
  /** Promedios sobre el neto pay. */
  phiPay: number;
  swPay: number;
  vshPay: number;
  kPay: number;
  /** mD·m */
  khPay: number;
  /** m */
  hphiRes: number;
  hphiShRes: number;
  hphiPay: number;
  hphiShPay: number;
  /**
   * Percentiles y nulos sobre el neto de reservorio. `rt` (RT, ohm·m, peso h): la resistividad de todo el reservorio,
   * no solo del pay, para comparar el pay con el resto (nulos = RT sin dato; NaN si no se pasó la curva).
   */
  statsRes: { phi: SampleDistribution; sw: SampleDistribution; vsh: SampleDistribution; rt: SampleDistribution };
  /** Percentiles y nulos sobre el neto pay (mismo conjunto que phiPay…kPay). */
  statsPay: { phi: SampleDistribution; sw: SampleDistribution; vsh: SampleDistribution; k: SampleDistribution; rt: SampleDistribution };
  /** k del pay: geométrica y armónica ponderadas por espesor (mD); nulos = k ≤ 0 o sin dato. La aritmética sobre las mismas muestras k > 0 es `.arith`; `kPay` incluye los k = 0. */
  kMeansPay: PositiveMeans;
  /** RT del pay: geométrica y armónica ponderadas por espesor (ohm·m); nulos = RT ≤ 0 o sin dato. */
  rtMeansPay: PositiveMeans;
}

/** Acumuladores sobre un conjunto de muestras netas. */
interface NetSums {
  h: number; // Σ h (neto)
  hPhi: number; // Σ h·φ (muestras con φ)
  hPhiForAvg: number; // Σ h (muestras con φ) — denominador de φ̄
  hPhiSw: number; // Σ h·φ·Sw (muestras con φ y Sw)
  hPhiWithSw: number; // Σ h·φ (muestras con φ y Sw) — denominador de S̄w
  hPhiSh: number; // Σ h·φ·(1 − Sw)
  hVsh: number; // Σ h·vsh
  hWithVsh: number; // Σ h (muestras con vsh)
  hK: number; // Σ h·k
  hWithK: number; // Σ h (muestras con k)
}

function emptySums(): NetSums {
  return { h: 0, hPhi: 0, hPhiForAvg: 0, hPhiSw: 0, hPhiWithSw: 0, hPhiSh: 0, hVsh: 0, hWithVsh: 0, hK: 0, hWithK: 0 };
}

/** Muestras de una variable en un conjunto, para los percentiles. */
interface Col {
  xs: number[];
  /** Peso de cada muestra para los percentiles y las medias (espesor, o h·φ en Sw). */
  ws: number[];
  /** m: espesor de las muestras con dato (siempre espesor, aunque `ws` sea h·φ). */
  thk: number;
  nullCount: number;
  nullH: number;
}

const newCol = (): Col => ({ xs: [], ws: [], thk: 0, nullCount: 0, nullH: 0 });

/** `q` es el peso del percentil (por defecto el espesor); el espesor con dato y los nulos se cuentan siempre en espesor. */
function pushCol(c: Col, x: number, h: number, q: number = h): void {
  if (Number.isFinite(x)) {
    c.xs.push(x);
    c.ws.push(q);
    if (h > 0) c.thk += h;
  } else {
    c.nullCount++;
    c.nullH += h;
  }
}

/** Medias geométrica/armónica de una variable; los NaN que no entraron a `c.xs` se suman a los nulos. */
function meansOf(c: Col | null): PositiveMeans {
  const m = positiveMeans(c?.xs ?? [], c?.ws);
  return c ? { ...m, nullCount: m.nullCount + c.nullCount, nullWeight: m.nullWeight + c.nullH } : m;
}

/** `c` null = la curva no se pasó. */
function distOf(c: Col | null): SampleDistribution {
  if (!c) return { n: 0, thickness: 0, nullCount: NaN, nullThickness: NaN, p10: NaN, p50: NaN, p90: NaN };
  const [p10, p50, p90] = weightedQuantiles(c.xs, c.ws, [0.1, 0.5, 0.9]) as [number, number, number];
  return { n: c.xs.length, thickness: c.thk, nullCount: c.nullCount, nullThickness: c.nullH, p10, p50, p90 };
}

function ratio(num: number, den: number): number {
  return den > 0 ? num / den : NaN;
}

/**
 * Sumario sobre la unión de los `ranges` ([start, end), sin solaparse). Ver definiciones en la cabecera.
 * `vshRes`/`vshPay` son NaN si no hay `vsh`; `kPay`/`khPay` son NaN si no hay `perm`.
 */
export function summarizeRanges(
  input: SummaryInput,
  ranges: readonly { start: number; end: number }[],
  options: SummaryOptions = {},
): IntervalSummary {
  const dist = options.distributions !== false;
  const { thickness, netRes, netPay, netSand, phi, sw, vsh, perm, rt } = input;
  let gross = 0;
  let sandH = 0;
  let noDataSand = 0;
  let noData = 0;
  let noDataPay = 0;
  let nRes = 0; // muestras de reservorio
  let nPayKnown = 0; // de ellas, con dato de pay (netPay 0 o 1)
  let nResWithSw = 0; // de ellas, con φ y Sw
  const res = emptySums();
  const pay = emptySums();
  // Muestras para percentiles y medias geométrica/armónica (mismos conjuntos que los promedios).
  // Con `distributions: false` no se reúnen ni se ordenan las muestras (todas las columnas null → estadísticas sin dato).
  const mk = (present = true): Col | null => (dist && present ? newCol() : null);
  const colsRes = { phi: mk(), sw: mk(), vsh: mk(!!vsh), rt: mk(!!rt) };
  const colsPay = { phi: mk(), sw: mk(), vsh: mk(!!vsh), k: mk(!!perm), rt: mk(!!rt) };

  const collect = (c: Pick<typeof colsRes, 'phi' | 'sw' | 'vsh'>, h: number, p: number, w: number, v: number): void => {
    if (!dist) return;
    pushCol(c.phi!, p, h);
    // Conjunto y peso de S̄w: con φ y Sw, ponderada por volumen poral h·φ (como Distribución por zona).
    pushCol(c.sw!, Number.isFinite(p) ? w : NaN, h, h * p);
    if (c.vsh) pushCol(c.vsh, v, h);
  };

  const add = (s: NetSums, h: number, p: number, w: number, v: number, k: number): void => {
    s.h += h;
    if (Number.isFinite(p)) {
      s.hPhi += h * p;
      s.hPhiForAvg += h;
      if (Number.isFinite(w)) {
        s.hPhiSw += h * p * w;
        s.hPhiWithSw += h * p;
        s.hPhiSh += h * p * (1 - w);
      }
    }
    if (Number.isFinite(v)) {
      s.hVsh += h * v;
      s.hWithVsh += h;
    }
    if (Number.isFinite(k)) {
      s.hK += h * k;
      s.hWithK += h;
    }
  };

  for (const { start, end } of ranges) {
    for (let i = start; i < end; i++) {
      const h = thickness[i]!;
      if (!Number.isFinite(h) || h < 0) continue;
      gross += h;
      if (netSand) {
        const a = netSand[i]!;
        if (a === 1) sandH += h;
        else if (!Number.isFinite(a)) noDataSand += h;
      }
      const r = netRes[i]!;
      if (!Number.isFinite(r)) {
        noData += h;
        continue;
      }
      if (r !== 1) continue;
      const p = phi[i]!;
      const w = sw[i]!;
      const v = vsh ? vsh[i]! : NaN;
      const k = perm ? perm[i]! : NaN;
      add(res, h, p, w, v, k);
      collect(colsRes, h, p, w, v);
      if (colsRes.rt) pushCol(colsRes.rt, rt![i]!, h);
      nRes++;
      if (Number.isFinite(p) && Number.isFinite(w)) nResWithSw++;
      const pf = netPay[i]!;
      if (pf === 1) {
        add(pay, h, p, w, v, k);
        collect(colsPay, h, p, w, v);
        if (colsPay.k) pushCol(colsPay.k, k, h);
        if (colsPay.rt) pushCol(colsPay.rt, rt![i]!, h);
      }
      if (pf === 0 || pf === 1) nPayKnown++;
      else noDataPay += h;
    }
  }

  const payUnknown = nRes > 0 && nPayKnown === 0;
  const unk = (x: number) => (payUnknown ? NaN : x);
  return {
    gross,
    noData,
    noDataPay,
    netSand: netSand ? sandH : NaN,
    noDataSand: netSand ? noDataSand : NaN,
    netRes: res.h,
    netPay: unk(pay.h),
    ntgSand: netSand ? ratio(sandH, gross) : NaN,
    ntgRes: ratio(res.h, gross),
    ntgPay: unk(ratio(pay.h, gross)),
    phiRes: ratio(res.hPhi, res.hPhiForAvg),
    swRes: ratio(res.hPhiSw, res.hPhiWithSw),
    vshRes: vsh ? ratio(res.hVsh, res.hWithVsh) : NaN,
    phiPay: ratio(pay.hPhi, pay.hPhiForAvg),
    swPay: ratio(pay.hPhiSw, pay.hPhiWithSw),
    vshPay: vsh ? ratio(pay.hVsh, pay.hWithVsh) : NaN,
    kPay: perm ? ratio(pay.hK, pay.hWithK) : NaN,
    khPay: perm ? unk(pay.hK) : NaN,
    hphiRes: res.hPhi,
    hphiShRes: nRes > 0 && nResWithSw === 0 ? NaN : res.hPhiSh,
    hphiPay: unk(pay.hPhi),
    hphiShPay: unk(pay.hPhiSh),
    statsRes: { phi: distOf(colsRes.phi), sw: distOf(colsRes.sw), vsh: distOf(colsRes.vsh), rt: distOf(colsRes.rt) },
    statsPay: {
      phi: distOf(colsPay.phi),
      sw: distOf(colsPay.sw),
      vsh: distOf(colsPay.vsh),
      k: distOf(colsPay.k),
      rt: distOf(colsPay.rt),
    },
    kMeansPay: meansOf(colsPay.k),
    rtMeansPay: meansOf(colsPay.rt),
  };
}

/** Rango de muestras [start, end) que cumplen top ≤ depth[i] ≤ base (profundidad creciente; coincide con layoutZones). */
export function depthIndexRange(depth: ArrayLike<number>, top: number, base: number): { start: number; end: number } {
  const n = depth.length;
  if (n === 0 || !Number.isFinite(top) || !Number.isFinite(base)) return { start: 0, end: 0 };
  const lo = Math.min(top, base);
  const hi = Math.max(top, base);
  if (!(hi > lo)) return { start: 0, end: 0 };
  let l = 0;
  let r = n;
  while (l < r) {
    const m = (l + r) >>> 1;
    if (depth[m]! < lo) l = m + 1;
    else r = m;
  }
  const start = l;
  l = start;
  r = n;
  while (l < r) {
    const m = (l + r) >>> 1;
    if (depth[m]! <= hi) l = m + 1;
    else r = m;
  }
  return { start, end: l };
}

/** Curvas disponibles para resumir un tramo de profundidad (todas opcionales salvo `depth`). */
export interface DepthIntervalInput {
  depth: ArrayLike<number>;
  /** Espesor por muestra (m). Si se omite, se calcula con `sampleThickness(depth)`. */
  thickness?: ArrayLike<number> | null;
  netRes?: ArrayLike<number> | null;
  netPay?: ArrayLike<number> | null;
  netSand?: ArrayLike<number> | null;
  phi?: ArrayLike<number> | null;
  sw?: ArrayLike<number> | null;
  vsh?: ArrayLike<number> | null;
  perm?: ArrayLike<number> | null;
}

/** Métricas brutas sobre el tramo completo (sin filtrar por cutoffs), para pozos sin `NET_RES`/`NET_PAY`. */
export interface GrossIntervalMetrics {
  /** Porosidad efectiva media ponderada por espesor (v/v). */
  phi: number;
  /** Saturación de agua media ponderada por volumen poral h·φ (v/v). */
  sw: number;
  /** Permeabilidad media geométrica ponderada por espesor para k > 0 (mD). */
  kGeo: number;
  /** Capacidad de flujo Σ hᵢ·kᵢ (mD·m); NaN si no hay muestras con k finito. */
  kh: number;
  /** Espesor equivalente de hidrocarburo Σ hᵢ·φᵢ·(1 − Swᵢ) (m); NaN si no hay muestras con φ y Sw finitos. */
  hphiSh: number;
}

/** Sumario petrofísico de un intervalo arbitrario [top, base] (regla viva del visor). */
export interface DepthIntervalSummary {
  start: number;
  end: number;
  sampleCount: number;
  /** Espesor bruto muestral Σ hᵢ en [start, end) (m). */
  gross: number;
  /** true si existe curva NET_RES y al menos una muestra del tramo fue clasificada (0 o 1). */
  hasNetRes: boolean;
  /** true si existe curva NET_PAY y el pay es conocido (no faltan todos los Sw del reservorio). */
  hasNetPay: boolean;
  netRes: number;
  ntgRes: number;
  netPay: number;
  ntgPay: number;
  noData: number;
  noDataPay: number;
  phiRes: number;
  phiPay: number;
  swRes: number;
  swPay: number;
  vshRes: number;
  vshPay: number;
  kPay: number;
  /** Permeabilidad media geométrica ponderada por espesor en el pay (k > 0, mD); coincide con `kMeansPay.geo`. */
  kGeoPay: number;
  khPay: number;
  hphiPay: number;
  hphiShPay: number;
  /** Promedios brutos del tramo completo (sin filtrar por cutoffs). NaN cuando falta la curva correspondiente. */
  grossMetrics: GrossIntervalMetrics;
}

function emptyGrossMetrics(): GrossIntervalMetrics {
  return { phi: NaN, sw: NaN, kGeo: NaN, kh: NaN, hphiSh: NaN };
}

function emptyDepthIntervalSummary(start = 0, end = 0): DepthIntervalSummary {
  return {
    start,
    end,
    sampleCount: 0,
    gross: 0,
    hasNetRes: false,
    hasNetPay: false,
    netRes: NaN,
    ntgRes: NaN,
    netPay: NaN,
    ntgPay: NaN,
    noData: NaN,
    noDataPay: NaN,
    phiRes: NaN,
    phiPay: NaN,
    swRes: NaN,
    swPay: NaN,
    vshRes: NaN,
    vshPay: NaN,
    kPay: NaN,
    kGeoPay: NaN,
    khPay: NaN,
    hphiPay: NaN,
    hphiShPay: NaN,
    grossMetrics: emptyGrossMetrics(),
  };
}

function validCurve(c: ArrayLike<number> | null | undefined, expectedLength: number): ArrayLike<number> | undefined {
  return c && c.length === expectedLength ? c : undefined;
}

/** Buffer compartido de solo lectura lleno de NaN para evitar asignaciones en el arrastre cuando falta una curva. */
let sharedNanCurve = new Float64Array(0);
function nanCurve(minLength: number): Float64Array {
  if (sharedNanCurve.length < minLength) {
    sharedNanCurve = new Float64Array(minLength);
    sharedNanCurve.fill(NaN);
  }
  return sharedNanCurve;
}

/**
 * Sumario petrofísico de un tramo de profundidad [top, base] (en cualquier orden) usando las mismas convenciones de
 * `summarizeRanges` y `ZONE_SUMMARY` (ponderación por `thickness`, `Sw` por volumen poral `φ·h`, `k` geométrica para
 * `k > 0`). Si faltan curvas calculadas (p. ej. pozo sin cutoffs), devuelve NaN en las magnitudes no disponibles sin
 * inventar ceros y completa `grossMetrics` con las curvas presentes.
 */
export function summarizeDepthInterval(input: DepthIntervalInput, top: number, base: number): DepthIntervalSummary {
  const { start, end } = depthIndexRange(input.depth, top, base);
  if (start >= end) return emptyDepthIntervalSummary(start, end);

  const n = input.depth.length;
  const thickness = validCurve(input.thickness, n) ?? sampleThickness(input.depth);
  const netRes = validCurve(input.netRes, n);
  const netPay = validCurve(input.netPay, n);
  const netSand = validCurve(input.netSand, n);
  const phi = validCurve(input.phi, n);
  const sw = validCurve(input.sw, n);
  const vsh = validCurve(input.vsh, n);
  const perm = validCurve(input.perm, n);

  // Métricas brutas sobre el tramo completo (una pasada, sin asignaciones).
  let grossRaw = 0;
  let gHPhi = 0;
  let gHWithPhi = 0;
  let gHPhiSw = 0;
  let gHPhiWithSw = 0;
  let gHPhiSh = 0;
  let gNPhiSw = 0;
  let gHK = 0;
  let gNK = 0;
  let gWPosK = 0;
  let gSLnK = 0;
  let gNPosK = 0;

  for (let i = start; i < end; i++) {
    const h = thickness[i]!;
    if (!Number.isFinite(h) || h < 0) continue;
    grossRaw += h;
    if (!(h > 0)) continue;
    if (phi) {
      const p = phi[i]!;
      if (Number.isFinite(p)) {
        gHPhi += h * p;
        gHWithPhi += h;
        if (sw) {
          const w = sw[i]!;
          if (Number.isFinite(w)) {
            gHPhiSw += h * p * w;
            gHPhiWithSw += h * p;
            gHPhiSh += h * p * (1 - w);
            gNPhiSw++;
          }
        }
      }
    }
    if (perm) {
      const k = perm[i]!;
      if (Number.isFinite(k)) {
        gHK += h * k;
        gNK++;
        if (k > 0) {
          gWPosK += h;
          gSLnK += h * Math.log(k);
          gNPosK++;
        }
      }
    }
  }

  const grossMetrics: GrossIntervalMetrics = {
    phi: gHWithPhi > 0 ? gHPhi / gHWithPhi : NaN,
    sw: gHPhiWithSw > 0 ? gHPhiSw / gHPhiWithSw : NaN,
    kGeo: gNPosK > 0 ? Math.exp(gSLnK / gWPosK) : NaN,
    kh: gNK > 0 ? gHK : NaN,
    hphiSh: gNPhiSw > 0 ? gHPhiSh : NaN,
  };

  if (!netRes) {
    return {
      ...emptyDepthIntervalSummary(start, end),
      sampleCount: end - start,
      gross: grossRaw,
      grossMetrics,
    };
  }

  const s = summarizeRanges(
    {
      thickness,
      netRes,
      netPay: netPay ?? nanCurve(end),
      ...(netSand ? { netSand } : {}),
      phi: phi ?? nanCurve(end),
      sw: sw ?? nanCurve(end),
      ...(vsh ? { vsh } : {}),
      ...(perm ? { perm } : {}),
    },
    [{ start, end }],
    { distributions: false },
  );

  // Misma regla que ZONE_SUMMARY (D6): sin ninguna muestra clasificada (netRes 0 o 1), no inventar ceros.
  const hasClassified = s.gross > 0 && s.noData < s.gross;
  if (!hasClassified) {
    return {
      ...emptyDepthIntervalSummary(start, end),
      sampleCount: end - start,
      gross: s.gross,
      noData: s.noData,
      grossMetrics,
    };
  }

  const hasNetPay = Boolean(netPay) && Number.isFinite(s.netPay);

  // Media geométrica de k en el pay (idéntica a positiveMeans / kMeansPay.geo) y verificación de datos reales en pay.
  let payKGeo = NaN;
  let payKFinite = 0;
  let payPhiSwCount = 0;
  if (hasNetPay && netPay) {
    let wPos = 0;
    let sLn = 0;
    let nPos = 0;
    for (let i = start; i < end; i++) {
      if (netRes[i] !== 1 || netPay[i] !== 1) continue;
      const h = thickness[i]!;
      if (!Number.isFinite(h) || h < 0) continue;
      if (perm) {
        const k = perm[i]!;
        if (h > 0 && Number.isFinite(k)) {
          payKFinite++;
          if (k > 0) {
            wPos += h;
            sLn += h * Math.log(k);
            nPos++;
          }
        }
      }
      if (phi && sw && Number.isFinite(phi[i]!) && Number.isFinite(sw[i]!)) payPhiSwCount++;
    }
    if (nPos > 0) payKGeo = Math.exp(sLn / wPos);
  }

  const hasPayPhi = hasNetPay && Boolean(phi) && (s.netPay === 0 || Number.isFinite(s.phiPay));
  const hasPayPhiSw = hasNetPay && Boolean(phi) && Boolean(sw) && (s.netPay === 0 || payPhiSwCount > 0);
  const hasPayKh = hasNetPay && Boolean(perm) && (s.netPay === 0 || payKFinite > 0);

  return {
    start,
    end,
    sampleCount: end - start,
    gross: s.gross,
    hasNetRes: true,
    hasNetPay,
    netRes: s.netRes,
    ntgRes: s.ntgRes,
    netPay: hasNetPay ? s.netPay : NaN,
    ntgPay: hasNetPay ? s.ntgPay : NaN,
    noData: s.noData,
    noDataPay: netPay ? s.noDataPay : NaN,
    phiRes: phi ? s.phiRes : NaN,
    phiPay: hasNetPay && phi ? s.phiPay : NaN,
    swRes: phi && sw ? s.swRes : NaN,
    swPay: hasNetPay && phi && sw ? s.swPay : NaN,
    vshRes: vsh ? s.vshRes : NaN,
    vshPay: hasNetPay && vsh ? s.vshPay : NaN,
    kPay: hasNetPay && perm ? s.kPay : NaN,
    kGeoPay: payKGeo,
    khPay: hasPayKh ? s.khPay : NaN,
    hphiPay: hasPayPhi ? s.hphiPay : NaN,
    hphiShPay: hasPayPhiSw ? s.hphiShPay : NaN,
    grossMetrics,
  };
}
