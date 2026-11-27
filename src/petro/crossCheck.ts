/**
 * G08 — Motor puro de coherencia cruzada entre herramientas (docs/decisiones/0092).
 *
 * Audita consistencia física entre mediciones independientes (Archie vs. SCAL, agua ligada BVW/RMN/SCAL,
 * porosidad perfil/RMN/corona, contactos MDT vs. saturación, capacidad capilar de sello MICP/SCAL,
 * aporte de uranio al GR y movilidad de hidrocarburos) sin recalcular petrofísica ni mutar ninguna entrada.
 *
 * Convenciones:
 * - Saturaciones (SW, SWI, MOS) y porosidades (PHIE, PHIE_NMR, BVI_NMR, BVW) en v/v.
 * - Profundidades y espesores en m MD.
 * - Presiones de desplazamiento de laboratorio Pd en psi (mercurio–aire).
 * - Los umbrales son criterios operativos de auditoría declarados en `CROSS_CHECK_THRESHOLDS`, no leyes universales.
 */
import { entryHeightM, SYSTEM_HG_AIR, SYSTEM_OIL_WATER, type HeightContext } from './micp';
import { KGF_CM2_TO_PSI } from './rockTyping';
import { SW_BELOW_SWI_TOLERANCE, swBelowSwiFlag } from './swiPc';

/** Convierte presión de desplazamiento Pd de kg/cm² (tabla SCAL) a psi mercurio–aire. */
export function scalPdKgCm2ToLabPsi(pdKgCm2: number): number {
  return Number.isFinite(pdKgCm2) && pdKgCm2 > 0 ? pdKgCm2 * KGF_CM2_TO_PSI : NaN;
}

export type CrossCheckStatus = 'ok' | 'warn' | 'tension' | 'unsupported';

export type CrossCheckId =
  | 'sw-vs-swi'
  | 'bound-water'
  | 'porosity'
  | 'mdt-vs-sw'
  | 'seal-capacity'
  | 'uranium-gr'
  | 'hc-movability';

export type ZoneCheckId = Exclude<CrossCheckId, 'seal-capacity'>;

export const ZONE_CHECK_IDS: readonly ZoneCheckId[] = [
  'sw-vs-swi',
  'bound-water',
  'porosity',
  'mdt-vs-sw',
  'uranium-gr',
  'hc-movability',
];

export const CROSS_CHECK_STATUS_LABEL: Readonly<Record<CrossCheckStatus, string>> = {
  ok: 'Acuerdo',
  warn: 'Atención',
  tension: 'Tensión',
  unsupported: 'Sin soporte',
};

export const CROSS_CHECK_META: Readonly<Record<CrossCheckId, { title: string; shortTitle: string; subtitle: string }>> = {
  'sw-vs-swi': {
    title: 'Archie (Sw) vs. SCAL (Swi)',
    shortTitle: 'Sw vs. Swi',
    subtitle: 'Fracción del pay con Sw por debajo de la saturación irreducible SCAL',
  },
  'bound-water': {
    title: 'Agua ligada: Archie vs. RMN vs. SCAL',
    shortTitle: 'Agua ligada',
    subtitle: 'Medianas de BVW, BVI RMN y φe·Swi en reservorio neto',
  },
  porosity: {
    title: 'Porosidad: Perfil vs. RMN vs. Corona',
    shortTitle: 'Porosidad',
    subtitle: 'Sesgo de φe frente a RMN y plugs, distinguiendo derrumbes, gas/fluido o matriz',
  },
  'mdt-vs-sw': {
    title: 'Contactos MDT vs. Saturación',
    shortTitle: 'MDT vs. Sw',
    subtitle: 'Consistencia entre OWC/GWC de presiones y distribución de pay y arenas acuíferas',
  },
  'seal-capacity': {
    title: 'Capacidad de sello vs. columna',
    shortTitle: 'Sello MICP',
    subtitle: 'Columna máxima retenible desde Pd de laboratorio con supuestos del panel MICP',
  },
  'uranium-gr': {
    title: 'Efecto de uranio en GR',
    shortTitle: 'Uranio GR',
    subtitle: 'Aporte espectral de uranio (U_GR_FRAC) y sensibilidad del volumen de arcilla',
  },
  'hc-movability': {
    title: 'Movilidad del hidrocarburo',
    shortTitle: 'Movilidad',
    subtitle: 'Fracción móvil del hidrocarburo (MOS / Sh) en el pay con invasión resuelta',
  },
};

/** Criterios operativos de auditoría (ADR 0092): visibles en UI y documentados en Ecuaciones. */
export const CROSS_CHECK_THRESHOLDS = Object.freeze({
  swBelowSwi: Object.freeze({
    warnPct: 5,
    tensionPct: 20,
    defaultTolerance: SW_BELOW_SWI_TOLERANCE,
  }),
  boundWater: Object.freeze({
    nmrScalWarnRatio: 1.25,
    nmrScalWarnDiff: 0.015,
    nmrScalTensionRatio: 1.5,
    nmrScalTensionDiff: 0.03,
    nmrBvwWarnDiff: 0.02,
    nmrBvwTensionDiff: 0.04,
    bvwBelowScalWarnDiff: -0.015,
    bvwBelowScalTensionDiff: -0.03,
    freeWaterWarnDiff: 0.04,
  }),
  porosity: Object.freeze({
    warnBias: 0.02,
    tensionBias: 0.04,
    deficitWarnPct: 15,
    deficitTensionPct: 35,
    washoutCausePct: 15,
  }),
  mdtVsSw: Object.freeze({
    marginM: 2.0,
    wetSwMin: 0.8,
    cleanVshMax: 0.35,
    cleanPhiMin: 0.08,
    payBelowTensionM: 1.5,
    payBelowTensionPct: 10,
    wetAboveWarnPct: 5,
    wetAboveWarnM: 1.0,
    wetAboveTensionPct: 20,
    wetAboveTensionM: 3.0,
  }),
  sealCapacity: Object.freeze({
    okMarginFactor: 1.2,
  }),
  uraniumGr: Object.freeze({
    warnMedian: 0.15,
    tensionMedian: 0.3,
    highSampleThreshold: 0.25,
    highSamplesWarnPct: 20,
  }),
  hcMovability: Object.freeze({
    okMovableFrac: 0.3,
    warnMovableFrac: 0.1,
    minCoveragePct: 20,
  }),
});

export interface CrossCheckZoneInput {
  id: string;
  name: string;
  top: number;
  base: number;
  kind?: string;
}

export interface CrossCheckCorePlug {
  depthM: number;
  phiCore: number;
  phiLog: number;
  label?: string;
}

export interface CrossCheckWaterContact {
  kind: 'OWC' | 'GWC';
  depthM: number;
  /** Extremo superior del compartimiento/gradientes que definen el contacto (m MD). */
  spanTopM: number;
  /** Extremo inferior del compartimiento/gradientes que definen el contacto (m MD). */
  spanBaseM: number;
  warning?: string | null;
  label?: string;
}

export interface CrossCheckSealSample {
  id: string;
  label: string;
  depthM: number;
  /** Presión de desplazamiento de laboratorio en psi (mercurio–aire). */
  pdLabPsi: number;
  source: 'micp' | 'scal';
  /** true solo si la muestra pertenece físicamente a una roca sello (zona kind='seal' o etiquetada como sello). */
  isSeal: boolean;
  zoneName?: string | null;
}

export interface CrossCheckSealAssumptions {
  systemLabel: string;
  heightContext: HeightContext;
  rhoWaterGcc: number;
  rhoHcGcc: number;
}

export interface CrossCheckInput {
  depth: ArrayLike<number>;
  /** Espesor por muestra (m). Si se omite, se estima por semidistancia a vecinos. */
  thickness?: ArrayLike<number>;
  zones: readonly CrossCheckZoneInput[];
  curves: {
    sw?: ArrayLike<number> | null;
    swi?: ArrayLike<number> | null;
    bvw?: ArrayLike<number> | null;
    bviNmr?: ArrayLike<number> | null;
    phie?: ArrayLike<number> | null;
    phieNmr?: ArrayLike<number> | null;
    vsh?: ArrayLike<number> | null;
    netRes?: ArrayLike<number> | null;
    netPay?: ArrayLike<number> | null;
    indWashout?: ArrayLike<number> | null;
    indNmrDeficit?: ArrayLike<number> | null;
    uGrFrac?: ArrayLike<number> | null;
    mos?: ArrayLike<number> | null;
    mhi?: ArrayLike<number> | null;
  };
  /** Tolerancia efectiva de `swi-pc` por zona (y global de respaldo). */
  swiToleranceGlobal?: number;
  swiToleranceByZone?: ReadonlyMap<string, number>;
  /** % de muestras fuera del rango √(k/φ) de SCAL por zona (desde tabla SWI_ZONES, opcional). */
  swiOutOfRangePctByZone?: ReadonlyMap<string, number>;
  /** Etiqueta del nivel de presión capilar SCAL activo por zona (opcional). */
  swiLevelByZone?: ReadonlyMap<string, string>;
  /** Plugs de corona incluidos y emparejados con PHIE. */
  corePlugs?: readonly CrossCheckCorePlug[];
  /** Contactos de agua válidos (OWC/GWC) resueltos en MDT. */
  waterContacts?: readonly CrossCheckWaterContact[];
  /** Muestras con presión de desplazamiento Pd (MICP o tabla SCAL). */
  sealSamples?: readonly CrossCheckSealSample[];
  /** Supuestos vigentes del panel MICP para convertir Pd a altura. */
  sealAssumptions?: CrossCheckSealAssumptions;
  /** Rango [min, max] del cociente CMR/MICP a 100 psi aire–salmuera (si hay curvas MICP). */
  micpCmrRatioRange?: readonly [number, number] | null;
  /** Altura de columna de hidrocarburo de referencia (m): desde FWL/MDT o espesor observado. */
  observedColumnM?: number | null;
  /** Descripción breve de cómo se obtuvo `observedColumnM`. */
  columnBasis?: string | null;
  /** true si el puerto IGR está conectado a `igr-cgr` (GR sin uranio). */
  igrUsesCgr?: boolean;
  /** true si existen curvas MICP cargadas en el pozo (ajusta el enlace sugerido). */
  hasMicp?: boolean;
}

export type CrossCheckTarget =
  | { kind: 'dock'; panelId: string; label: string }
  | { kind: 'module'; moduleId: string; label: string };

export interface CrossCheckItem {
  id: CrossCheckId;
  zoneId: string | null;
  zoneName: string;
  status: CrossCheckStatus;
  headline: string;
  detail: string;
  focusRange: [number, number] | null;
  action: CrossCheckTarget | null;
  metrics: Readonly<Record<string, number | boolean | string | null>>;
}

export interface CrossCheckZoneRow {
  zoneId: string;
  zoneName: string;
  zoneKind: string;
  top: number;
  base: number;
  checks: Record<ZoneCheckId, CrossCheckItem>;
  worstStatus: CrossCheckStatus;
}

export interface SealSampleEval {
  id: string;
  label: string;
  depthM: number;
  pdLabPsi: number;
  hMaxM: number;
  source: 'micp' | 'scal';
  isSeal: boolean;
  zoneName: string | null;
}

export interface CrossCheckReport {
  zones: CrossCheckZoneRow[];
  seal: CrossCheckItem;
  sealSamples: SealSampleEval[];
  sealAssumptions: {
    systemLabel: string;
    sigmaDynPerCm: number;
    thetaDeg: number;
    rhoWaterGcc: number;
    rhoHcGcc: number;
    deltaRhoGcc: number;
  };
  counts: Record<CrossCheckStatus, number>;
  overallStatus: CrossCheckStatus;
}

// ── utilidades numéricas puras ──────────────────────────────────────────────────────────────────────────────────

const SEVERITY: Readonly<Record<CrossCheckStatus, number>> = {
  unsupported: 0,
  ok: 1,
  warn: 2,
  tension: 3,
};

export function worstCrossCheckStatus(statuses: readonly CrossCheckStatus[]): CrossCheckStatus {
  let worst: CrossCheckStatus = 'unsupported';
  for (const s of statuses) {
    if (SEVERITY[s] > SEVERITY[worst]) worst = s;
  }
  return worst;
}

export function quantileOf(values: readonly number[], p: number): number {
  if (!(p >= 0 && p <= 1)) return NaN;
  const clean: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (Number.isFinite(v)) clean.push(v);
  }
  if (clean.length === 0) return NaN;
  clean.sort((a, b) => a - b);
  const pos = p * (clean.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return clean[lo]!;
  return clean[lo]! + (clean[hi]! - clean[lo]!) * (pos - lo);
}

export function medianOf(values: readonly number[]): number {
  return quantileOf(values, 0.5);
}

function fmt(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return 'n/d';
  return v.toLocaleString('es-AR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function fmtPct(v: number, digits = 1): string {
  if (!Number.isFinite(v)) return 'n/d';
  return `${fmt(v, digits)} %`;
}

function fmtSigned(v: number, digits = 3): string {
  if (!Number.isFinite(v)) return 'n/d';
  const sign = v > 0 ? '+' : '';
  return `${sign}${fmt(v, digits)}`;
}

function paddedRange(top: number, base: number, minSpan = 20): [number, number] | null {
  if (!Number.isFinite(top) || !Number.isFinite(base)) return null;
  const lo = Math.min(top, base);
  const hi = Math.max(top, base);
  const span = hi - lo;
  if (span >= minSpan) {
    const pad = Math.min(8, span * 0.12);
    return [lo - pad, hi + pad];
  }
  const mid = (lo + hi) / 2;
  return [mid - minSpan / 2, mid + minSpan / 2];
}

function readAt(arr: ArrayLike<number> | null | undefined, i: number): number {
  if (!arr || i < 0 || i >= arr.length) return NaN;
  return arr[i]!;
}

function sampleThickness(depth: ArrayLike<number>, thickness: ArrayLike<number> | undefined, i: number): number {
  if (thickness && i < thickness.length) {
    const t = thickness[i]!;
    if (Number.isFinite(t) && t >= 0) return t;
  }
  const n = depth.length;
  if (n < 2) return 0;
  if (i === 0) {
    const a = depth[0]!;
    const b = depth[1]!;
    return Number.isFinite(a) && Number.isFinite(b) ? Math.abs(b - a) : 0;
  }
  if (i === n - 1) {
    const a = depth[n - 2]!;
    const b = depth[n - 1]!;
    return Number.isFinite(a) && Number.isFinite(b) ? Math.abs(b - a) : 0;
  }
  const a = depth[i - 1]!;
  const b = depth[i + 1]!;
  if (Number.isFinite(a) && Number.isFinite(b)) return Math.abs(b - a) / 2;
  const c = depth[i]!;
  if (Number.isFinite(c) && Number.isFinite(a)) return Math.abs(c - a);
  if (Number.isFinite(c) && Number.isFinite(b)) return Math.abs(b - c);
  return 0;
}

function zoneIndices(depth: ArrayLike<number>, top: number, base: number): number[] {
  const lo = Math.min(top, base);
  const hi = Math.max(top, base);
  const out: number[] = [];
  for (let i = 0; i < depth.length; i++) {
    const d = depth[i]!;
    if (Number.isFinite(d) && d >= lo && d <= hi) out.push(i);
  }
  return out;
}

function defaultSealAssumptions(): CrossCheckSealAssumptions {
  return {
    systemLabel: 'Petróleo–agua',
    heightContext: {
      lab: SYSTEM_HG_AIR,
      reservoir: SYSTEM_OIL_WATER,
      deltaRhoGcc: 0.25,
    },
    rhoWaterGcc: 1.05,
    rhoHcGcc: 0.8,
  };
}

// ── chequeo 1: Archie (SW) vs. SCAL (SWI) ───────────────────────────────────────────────────────────────────────

function evalSwVsSwi(
  zone: CrossCheckZoneInput,
  indices: readonly number[],
  input: CrossCheckInput,
): CrossCheckItem {
  const { sw, swi, netPay } = input.curves;
  const action: CrossCheckTarget = { kind: 'dock', panelId: 'scal', label: 'Abrir SCAL' };
  const tolRaw = input.swiToleranceByZone?.get(zone.id) ?? input.swiToleranceGlobal ?? CROSS_CHECK_THRESHOLDS.swBelowSwi.defaultTolerance;
  const tol = Number.isFinite(tolRaw) && tolRaw >= 0 ? tolRaw : CROSS_CHECK_THRESHOLDS.swBelowSwi.defaultTolerance;
  const outOfRangePct = input.swiOutOfRangePctByZone?.get(zone.id) ?? null;

  if (!sw || !swi) {
    return {
      id: 'sw-vs-swi',
      zoneId: zone.id,
      zoneName: zone.name,
      status: 'unsupported',
      headline: 'Sin dato',
      detail: !sw && !swi ? 'Faltan las curvas SW y SWI (SCAL).' : !sw ? 'Falta la curva SW para comparar contra Swi.' : 'Falta la curva SWI del módulo SCAL.',
      focusRange: paddedRange(zone.top, zone.base),
      action,
      metrics: { nEvaluated: 0, nBelow: 0, pctBelow: null, tolerance: tol, usedPayMask: !!netPay, outOfRangePct },
    };
  }

  let nAllBoth = 0;
  let nAllBelow = 0;
  let nPayTotal = 0;
  let nPayBoth = 0;
  let nPayBelow = 0;
  let worstDeficit = -Infinity;
  let worstDepth = NaN;
  let violTop = Infinity;
  let violBase = -Infinity;

  for (const i of indices) {
    const s = readAt(sw, i);
    const si = readAt(swi, i);
    const isPay = netPay ? readAt(netPay, i) === 1 : true;
    if (netPay && isPay) nPayTotal++;
    const flag = swBelowSwiFlag(s, si, tol);
    if (!Number.isFinite(flag)) continue;
    nAllBoth++;
    if (flag === 1) nAllBelow++;
    if (!isPay) continue;
    nPayBoth++;
    if (flag === 1) {
      nPayBelow++;
      const d = input.depth[i]!;
      const deficit = si - s;
      if (deficit > worstDeficit) {
        worstDeficit = deficit;
        worstDepth = d;
      }
      if (d < violTop) violTop = d;
      if (d > violBase) violBase = d;
    }
  }

  if (netPay && nPayTotal === 0) {
    const allNote = nAllBoth > 0 ? ` En toda la zona: ${fmtPct((100 * nAllBelow) / nAllBoth)} (${nAllBelow}/${nAllBoth}) con Sw < Swi − tol.` : '';
    return {
      id: 'sw-vs-swi',
      zoneId: zone.id,
      zoneName: zone.name,
      status: 'unsupported',
      headline: 'Sin pay',
      detail: `No hay muestras de pay neto en la zona para auditar Sw vs. Swi.${allNote}`,
      focusRange: paddedRange(zone.top, zone.base),
      action,
      metrics: { nEvaluated: 0, nBelow: 0, pctBelow: null, nAllBoth, nAllBelow, tolerance: tol, usedPayMask: true, outOfRangePct },
    };
  }

  const nEval = netPay ? nPayBoth : nAllBoth;
  const nBelow = netPay ? nPayBelow : nAllBelow;
  if (nEval === 0) {
    return {
      id: 'sw-vs-swi',
      zoneId: zone.id,
      zoneName: zone.name,
      status: 'unsupported',
      headline: 'Sin pares',
      detail: 'No hay muestras con Sw y Swi simultáneamente válidas en el intervalo.',
      focusRange: paddedRange(zone.top, zone.base),
      action,
      metrics: { nEvaluated: 0, nBelow: 0, pctBelow: null, tolerance: tol, usedPayMask: !!netPay, outOfRangePct },
    };
  }

  const pctBelow = (100 * nBelow) / nEval;
  const { warnPct, tensionPct } = CROSS_CHECK_THRESHOLDS.swBelowSwi;
  const status: CrossCheckStatus = pctBelow > tensionPct ? 'tension' : pctBelow >= warnPct ? 'warn' : 'ok';
  const scopeText = netPay ? 'del pay' : 'de las muestras válidas (sin bandera NET_PAY)';
  const worstText = Number.isFinite(worstDepth) ? ` Pico de tensión en ${fmt(worstDepth, 1)} m (Swi − Sw = ${fmt(worstDeficit, 2)} v/v).` : '';
  const rangeText = outOfRangePct !== null && Number.isFinite(outOfRangePct) && outOfRangePct > 25 ? ` ${fmtPct(outOfRangePct, 0)} fuera del rango SCAL.` : '';
  const verdict =
    status === 'ok'
      ? `Coherente: ${fmtPct(pctBelow)} ${scopeText} (${nBelow}/${nEval}) cae por debajo de Swi − ${fmt(tol, 2)} v/v.`
      : status === 'warn'
        ? `Atención: ${fmtPct(pctBelow)} ${scopeText} (${nBelow}/${nEval}) tiene Sw < Swi − ${fmt(tol, 2)} v/v. Revisar nivel capilar SCAL o parámetros de Archie.`
        : `Tensión física: ${fmtPct(pctBelow)} ${scopeText} (${nBelow}/${nEval}) da Sw < Swi − ${fmt(tol, 2)} v/v. Revisar Rw, m/n, porosidad o nivel SCAL.`;

  const focusRange = Number.isFinite(worstDepth)
    ? paddedRange(Math.max(violTop, worstDepth - 8), Math.min(violBase, worstDepth + 8))
    : paddedRange(zone.top, zone.base);

  return {
    id: 'sw-vs-swi',
    zoneId: zone.id,
    zoneName: zone.name,
    status,
    headline: fmtPct(pctBelow),
    detail: `${verdict}${worstText}${rangeText}`,
    focusRange,
    action,
    metrics: {
      nEvaluated: nEval,
      nBelow,
      pctBelow,
      worstDeficit: Number.isFinite(worstDeficit) ? worstDeficit : null,
      worstDepthM: Number.isFinite(worstDepth) ? worstDepth : null,
      tolerance: tol,
      usedPayMask: !!netPay,
      outOfRangePct,
    },
  };
}

// ── chequeo 2: agua ligada BVW vs. BVI_NMR vs. SCAL (PHIE·SWI) ──────────────────────────────────────────────────

function evalBoundWater(
  zone: CrossCheckZoneInput,
  indices: readonly number[],
  input: CrossCheckInput,
): CrossCheckItem {
  const { bvw, bviNmr, phie, swi, netRes, netPay } = input.curves;
  const action: CrossCheckTarget = input.hasMicp
    ? { kind: 'dock', panelId: 'micp', label: 'Abrir MICP (CMR)' }
    : { kind: 'dock', panelId: 'scal', label: 'Abrir SCAL' };

  const bvwVals: number[] = [];
  const bviNmrVals: number[] = [];
  const bviScalVals: number[] = [];
  let nResTotal = 0;
  let nPayInZone = 0;
  let worstDiff = -Infinity;
  let worstDepth = NaN;

  for (const i of indices) {
    if (netPay && readAt(netPay, i) === 1) nPayInZone++;
    const inScope = netRes ? readAt(netRes, i) === 1 : true;
    if (netRes && inScope) nResTotal++;
    if (!inScope) continue;

    const vBvw = readAt(bvw, i);
    const vNmr = readAt(bviNmr, i);
    const vPhi = readAt(phie, i);
    const vSwi = readAt(swi, i);
    const vScal = Number.isFinite(vPhi) && vPhi > 0 && vPhi <= 1 && Number.isFinite(vSwi) && vSwi >= 0 && vSwi <= 1 ? vPhi * vSwi : NaN;

    const okBvw = Number.isFinite(vBvw) && vBvw >= 0 && vBvw <= 1;
    const okNmr = Number.isFinite(vNmr) && vNmr >= 0 && vNmr <= 1;
    const okScal = Number.isFinite(vScal) && vScal >= 0 && vScal <= 1;

    if (okBvw) bvwVals.push(vBvw);
    if (okNmr) bviNmrVals.push(vNmr);
    if (okScal) bviScalVals.push(vScal);

    const d1 = okNmr && okScal ? Math.abs(vNmr - vScal) : -1;
    const d2 = okNmr && okBvw ? Math.abs(vNmr - vBvw) : -1;
    const d3 = okBvw && okScal ? Math.abs(vBvw - vScal) : -1;
    const dm = Math.max(d1, d2, d3);
    if (dm >= 0 && dm > worstDiff) {
      worstDiff = dm;
      worstDepth = input.depth[i]!;
    }
  }

  if (netRes && nResTotal === 0) {
    return {
      id: 'bound-water',
      zoneId: zone.id,
      zoneName: zone.name,
      status: 'unsupported',
      headline: 'Sin res.',
      detail: 'No hay muestras de reservorio neto en la zona para comparar agua ligada.',
      focusRange: paddedRange(zone.top, zone.base),
      action,
      metrics: { bvwMed: null, bviNmrMed: null, bviScalMed: null, nmrOverScal: null, nBvw: 0, nNmr: 0, nScal: 0 },
    };
  }

  const bvwMed = medianOf(bvwVals);
  const bviNmrMed = medianOf(bviNmrVals);
  const bviScalMed = medianOf(bviScalVals);
  const available = [bvwMed, bviNmrMed, bviScalMed].filter(Number.isFinite).length;

  if (available < 2) {
    return {
      id: 'bound-water',
      zoneId: zone.id,
      zoneName: zone.name,
      status: 'unsupported',
      headline: 'Sin soporte',
      detail: 'Se requieren al menos dos estimaciones válidas entre BVW (Archie), BVI RMN y φe·Swi (SCAL) en la zona.',
      focusRange: paddedRange(zone.top, zone.base),
      action,
      metrics: {
        bvwMed: Number.isFinite(bvwMed) ? bvwMed : null,
        bviNmrMed: Number.isFinite(bviNmrMed) ? bviNmrMed : null,
        bviScalMed: Number.isFinite(bviScalMed) ? bviScalMed : null,
        nmrOverScal: null,
        nBvw: bvwVals.length,
        nNmr: bviNmrVals.length,
        nScal: bviScalVals.length,
      },
    };
  }

  const t = CROSS_CHECK_THRESHOLDS.boundWater;
  const nmrOverScal = Number.isFinite(bviNmrMed) && Number.isFinite(bviScalMed) && bviScalMed > 1e-4 ? bviNmrMed / bviScalMed : NaN;
  const diffNmrScal = Number.isFinite(bviNmrMed) && Number.isFinite(bviScalMed) ? bviNmrMed - bviScalMed : NaN;
  const diffNmrBvw = Number.isFinite(bviNmrMed) && Number.isFinite(bvwMed) ? bviNmrMed - bvwMed : NaN;
  const diffBvwScal = Number.isFinite(bvwMed) && Number.isFinite(bviScalMed) ? bvwMed - bviScalMed : NaN;
  const diffBvwNmr = Number.isFinite(bvwMed) && Number.isFinite(bviNmrMed) ? bvwMed - bviNmrMed : NaN;

  let status: CrossCheckStatus = 'ok';
  const elevate = (s: CrossCheckStatus) => {
    if (SEVERITY[s] > SEVERITY[status]) status = s;
  };
  const notes: string[] = [];

  const scalNearZero = Number.isFinite(bviScalMed) && bviScalMed <= 1e-4;
  const nmrHighTension =
    ((Number.isFinite(nmrOverScal) ? nmrOverScal >= t.nmrScalTensionRatio : scalNearZero) && diffNmrScal >= t.nmrScalTensionDiff) ||
    (Number.isFinite(diffNmrBvw) && diffNmrBvw >= t.nmrBvwTensionDiff);
  const nmrHighWarn =
    ((Number.isFinite(nmrOverScal) ? nmrOverScal >= t.nmrScalWarnRatio : scalNearZero) && diffNmrScal >= t.nmrScalWarnDiff) ||
    (Number.isFinite(diffNmrBvw) && diffNmrBvw >= t.nmrBvwWarnDiff);

  if (nmrHighTension) {
    elevate('tension');
    const ratioStr = Number.isFinite(nmrOverScal) ? ` (${fmt(nmrOverScal, 1)}× SCAL)` : '';
    notes.push(`El CMR sobreestima el agua ligada${ratioStr}: el corte fijo de T2 de 33 ms suele clasificar agua capilar móvil como BVI; calibrar con SCAL/MICP.`);
  } else if (nmrHighWarn) {
    elevate('warn');
    const ratioStr = Number.isFinite(nmrOverScal) ? ` (${fmt(nmrOverScal, 1)}× SCAL)` : '';
    notes.push(`BVI del CMR moderadamente por encima de SCAL/Archie${ratioStr}: revisar el corte de T2 de 33 ms.`);
  }

  if (Number.isFinite(diffBvwScal) && diffBvwScal <= t.bvwBelowScalTensionDiff) {
    elevate('tension');
    notes.push(`BVW de Archie (${fmt(bvwMed, 3)}) queda por debajo del agua ligada SCAL (${fmt(bviScalMed, 3)} v/v).`);
  } else if (Number.isFinite(diffBvwScal) && diffBvwScal <= t.bvwBelowScalWarnDiff) {
    elevate('warn');
    notes.push(`BVW de Archie ligeramente por debajo del agua ligada SCAL.`);
  }

  const freeWater =
    (Number.isFinite(diffBvwScal) && diffBvwScal >= t.freeWaterWarnDiff) ||
    (!Number.isFinite(diffBvwScal) && Number.isFinite(diffBvwNmr) && diffBvwNmr >= t.freeWaterWarnDiff);
  if (freeWater) {
    if (netPay && nPayInZone === 0) {
      notes.push('Agua libre predominante (BVW supera al agua ligada, esperado en zona sin pay).');
    } else {
      elevate('warn');
      notes.push('BVW supera claramente al agua ligada: indica presencia de agua libre/móvil o zona de transición.');
    }
  }

  if ((nmrHighTension || nmrHighWarn) && input.micpCmrRatioRange && input.micpCmrRatioRange[0] > 1.5 && Number.isFinite(bviNmrMed)) {
    notes.push(`MICP confirma BVI/φe ${fmt(input.micpCmrRatioRange[0], 1)}–${fmt(input.micpCmrRatioRange[1], 1)}× la Sw de calibración.`);
  }

  const swiLevel = input.swiLevelByZone?.get(zone.id);
  const parts: string[] = [];
  if (Number.isFinite(bvwMed)) parts.push(`BVW ${fmt(bvwMed, 3)}`);
  if (Number.isFinite(bviNmrMed)) parts.push(`RMN ${fmt(bviNmrMed, 3)}`);
  if (Number.isFinite(bviScalMed)) parts.push(`SCAL ${fmt(bviScalMed, 3)}${swiLevel ? ` (${swiLevel})` : ''}`);

  const headline =
    Number.isFinite(nmrOverScal) && (nmrHighTension || nmrHighWarn)
      ? `RMN ${fmt(nmrOverScal, 1)}× SCAL`
      : Number.isFinite(bvwMed) && Number.isFinite(bviScalMed)
        ? `${fmt(bvwMed, 2)} / ${fmt(bviScalMed, 2)}`
        : Number.isFinite(bviNmrMed) && Number.isFinite(bvwMed)
          ? `${fmt(bvwMed, 2)} / ${fmt(bviNmrMed, 2)}`
          : `${fmt(bviNmrMed, 2)} / ${fmt(bviScalMed, 2)}`;

  const scopeNote = netRes ? 'Medianas en reservorio neto' : 'Medianas en la zona (sin bandera NET_RES)';
  const detail = `${scopeNote}: ${parts.join(' · ')} v/v. ${notes.length ? notes.join(' ') : 'Estimaciones de agua ligada coherentes entre sí.'}`;

  return {
    id: 'bound-water',
    zoneId: zone.id,
    zoneName: zone.name,
    status,
    headline,
    detail,
    focusRange: Number.isFinite(worstDepth) ? paddedRange(worstDepth, worstDepth) : paddedRange(zone.top, zone.base),
    action,
    metrics: {
      bvwMed: Number.isFinite(bvwMed) ? bvwMed : null,
      bviNmrMed: Number.isFinite(bviNmrMed) ? bviNmrMed : null,
      bviScalMed: Number.isFinite(bviScalMed) ? bviScalMed : null,
      nmrOverScal: Number.isFinite(nmrOverScal) ? nmrOverScal : null,
      nBvw: bvwVals.length,
      nNmr: bviNmrVals.length,
      nScal: bviScalVals.length,
    },
  };
}

// ── chequeo 3: porosidad PHIE vs. PHIE_NMR vs. Corona ───────────────────────────────────────────────────────────

function evalPorosity(
  zone: CrossCheckZoneInput,
  indices: readonly number[],
  input: CrossCheckInput,
): CrossCheckItem {
  const { phie, phieNmr, indWashout, indNmrDeficit } = input.curves;
  const lo = Math.min(zone.top, zone.base);
  const hi = Math.max(zone.top, zone.base);

  const plugs = (input.corePlugs ?? []).filter(
    (p) => Number.isFinite(p.depthM) && p.depthM >= lo && p.depthM <= hi && Number.isFinite(p.phiCore) && Number.isFinite(p.phiLog),
  );
  const hasCore = plugs.length > 0;
  const action: CrossCheckTarget = hasCore
    ? { kind: 'dock', panelId: 'core-calibration', label: 'Abrir Calibración' }
    : { kind: 'module', moduleId: 'nmr-fluids', label: 'Ver módulo RMN' };

  if (!phie) {
    return {
      id: 'porosity',
      zoneId: zone.id,
      zoneName: zone.name,
      status: 'unsupported',
      headline: 'Sin PHIE',
      detail: 'Falta la curva de porosidad efectiva (PHIE) del perfil.',
      focusRange: paddedRange(zone.top, zone.base),
      action,
      metrics: { nmrBias: null, coreBias: null, washoutPct: null, nmrDeficitPct: null, nNmr: 0, nCore: plugs.length },
    };
  }

  const nmrDiffs: number[] = [];
  let nWashChecked = 0;
  let nWashFlag = 0;
  let nDefChecked = 0;
  let nDefFlag = 0;
  let worstAbs = -Infinity;
  let worstDepth = NaN;

  for (const i of indices) {
    const p = readAt(phie, i);
    if (!Number.isFinite(p)) continue;
    const w = readAt(indWashout, i);
    if (Number.isFinite(w)) {
      nWashChecked++;
      if (w === 1) nWashFlag++;
    }
    const pn = readAt(phieNmr, i);
    if (Number.isFinite(pn)) {
      const diff = pn - p;
      nmrDiffs.push(diff);
      const absDiff = Math.abs(diff);
      if (absDiff > worstAbs) {
        worstAbs = absDiff;
        worstDepth = input.depth[i]!;
      }
      const def = readAt(indNmrDeficit, i);
      if (Number.isFinite(def)) {
        nDefChecked++;
        if (def === 1) nDefFlag++;
      }
    }
  }

  const coreDiffs: number[] = [];
  let coreSumSq = 0;
  for (const p of plugs) {
    const diff = p.phiLog - p.phiCore;
    coreDiffs.push(diff);
    coreSumSq += diff * diff;
    const absDiff = Math.abs(diff);
    if (absDiff > worstAbs) {
      worstAbs = absDiff;
      worstDepth = p.depthM;
    }
  }

  if (nmrDiffs.length === 0 && coreDiffs.length === 0) {
    return {
      id: 'porosity',
      zoneId: zone.id,
      zoneName: zone.name,
      status: 'unsupported',
      headline: 'Sin ref.',
      detail: 'No hay PHIE de RMN ni plugs de corona válidos en esta zona para contrastar PHIE.',
      focusRange: paddedRange(zone.top, zone.base),
      action,
      metrics: { nmrBias: null, coreBias: null, washoutPct: nWashChecked > 0 ? (100 * nWashFlag) / nWashChecked : null, nmrDeficitPct: null, nNmr: 0, nCore: 0 },
    };
  }

  const nmrBias = medianOf(nmrDiffs);
  const coreBias = medianOf(coreDiffs);
  const coreRmse = coreDiffs.length > 0 ? Math.sqrt(coreSumSq / coreDiffs.length) : NaN;
  const washoutPct = nWashChecked > 0 ? (100 * nWashFlag) / nWashChecked : null;
  const nmrDeficitPct = nDefChecked > 0 ? (100 * nDefFlag) / nDefChecked : null;

  const t = CROSS_CHECK_THRESHOLDS.porosity;
  const EPS = 1e-12;
  const absNmr = Number.isFinite(nmrBias) ? Math.abs(nmrBias) : 0;
  const absCore = Number.isFinite(coreBias) ? Math.abs(coreBias) : 0;
  const maxAbsBias = Math.max(absNmr, absCore);

  let status: CrossCheckStatus = 'ok';
  if (maxAbsBias > t.tensionBias + EPS || (nmrDeficitPct !== null && nmrDeficitPct > t.deficitTensionPct + EPS)) {
    status = 'tension';
  } else if (maxAbsBias > t.warnBias + EPS || (nmrDeficitPct !== null && nmrDeficitPct >= t.deficitWarnPct - EPS)) {
    status = 'warn';
  }

  // Atribución de causa física
  const causes: string[] = [];
  if (status !== 'ok') {
    const hasWashout = washoutPct !== null && washoutPct >= t.washoutCausePct;
    const hasGasDeficit = (nmrDeficitPct !== null && nmrDeficitPct >= t.deficitWarnPct) || (Number.isFinite(nmrBias) && nmrBias < -t.warnBias);
    const hasMatrix = (Number.isFinite(nmrBias) && nmrBias > t.warnBias) || (Number.isFinite(coreBias) && Math.abs(coreBias) > t.warnBias);

    if (hasWashout) {
      causes.push(`derrumbes de pozo (IND_WASHOUT en ${fmtPct(washoutPct!, 0)}) degradando el contacto del patín de densidad`);
    }
    if (hasGasDeficit) {
      const defTxt = nmrDeficitPct !== null ? ` (déficit RMN en ${fmtPct(nmrDeficitPct, 0)})` : '';
      causes.push(`efecto de gas/fluido liviano o microporosidad fuera de φe,RMN${defTxt}`);
    }
    if (hasMatrix) {
      causes.push('posible desajuste de matriz (ρma) o calibración de densidad de grano');
    }
  }

  const summaryParts: string[] = [];
  if (Number.isFinite(nmrBias)) summaryParts.push(`Δφ RMN−perfil ${fmtSigned(nmrBias, 3)} v/v`);
  if (Number.isFinite(coreBias)) summaryParts.push(`perfil−corona ${fmtSigned(coreBias, 3)} v/v (RMSE ${fmt(coreRmse, 3)}, ${plugs.length} plugs)`);

  const headline =
    Number.isFinite(coreBias) && absCore >= absNmr
      ? `${fmtSigned(coreBias, 3)} cor.`
      : Number.isFinite(nmrBias)
        ? `${fmtSigned(nmrBias, 3)} RMN`
        : `${fmtSigned(coreBias, 3)} cor.`;

  const detail =
    status === 'ok'
      ? `Acuerdo en porosidad: ${summaryParts.join(' · ')}.${washoutPct !== null && washoutPct >= t.washoutCausePct ? ` Nota: derrumbes en ${fmtPct(washoutPct, 0)} de la zona.` : ''}`
      : `${summaryParts.join(' · ')}. Causa probable: ${causes.join('; ')}.`;

  return {
    id: 'porosity',
    zoneId: zone.id,
    zoneName: zone.name,
    status,
    headline,
    detail,
    focusRange: Number.isFinite(worstDepth) ? paddedRange(worstDepth, worstDepth) : paddedRange(zone.top, zone.base),
    action,
    metrics: {
      nmrBias: Number.isFinite(nmrBias) ? nmrBias : null,
      coreBias: Number.isFinite(coreBias) ? coreBias : null,
      coreRmse: Number.isFinite(coreRmse) ? coreRmse : null,
      washoutPct,
      nmrDeficitPct,
      nNmr: nmrDiffs.length,
      nCore: plugs.length,
    },
  };
}

// ── chequeo 4: contactos MDT vs. saturación del perfil ──────────────────────────────────────────────────────────

function evalMdtVsSw(
  zone: CrossCheckZoneInput,
  indices: readonly number[],
  input: CrossCheckInput,
): CrossCheckItem {
  const action: CrossCheckTarget = { kind: 'dock', panelId: 'mdt', label: 'Abrir MDT' };
  const contacts = (input.waterContacts ?? []).filter((c) => Number.isFinite(c.depthM));
  const lo = Math.min(zone.top, zone.base);
  const hi = Math.max(zone.top, zone.base);
  const mid = (lo + hi) / 2;

  // Contactos que corresponden al compartimiento de esta zona (sus gradientes o el corte intersectan la zona).
  const governing = contacts
    .filter((c) => {
      const bounds = [c.depthM, c.spanTopM, c.spanBaseM].filter(Number.isFinite);
      const cLo = Math.min(...bounds);
      const cHi = Math.max(...bounds);
      return cLo <= hi && cHi >= lo;
    })
    .sort((a, b) => Math.abs(a.depthM - mid) - Math.abs(b.depthM - mid));

  if (governing.length === 0) {
    return {
      id: 'mdt-vs-sw',
      zoneId: zone.id,
      zoneName: zone.name,
      status: 'unsupported',
      headline: 'Sin contacto',
      detail:
        contacts.length === 0
          ? 'No hay contactos agua–hidrocarburo (OWC/GWC) resueltos en Presiones MDT.'
          : 'Los contactos MDT resueltos pertenecen a otro compartimiento/intervalo de presión.',
      focusRange: paddedRange(zone.top, zone.base),
      action,
      metrics: { contactDepthM: null, contactKind: null, payBelowThkM: null, wetAboveThkM: null, wetAbovePct: null },
    };
  }

  const contact = governing[0]!;
  const { sw, netPay, netRes, vsh, phie } = input.curves;
  if (!sw && !netPay) {
    return {
      id: 'mdt-vs-sw',
      zoneId: zone.id,
      zoneName: zone.name,
      status: 'unsupported',
      headline: 'Sin Sw/pay',
      detail: `Contacto ${contact.kind} en ${fmt(contact.depthM, 1)} m, pero faltan SW y NET_PAY para contrastarlo.`,
      focusRange: paddedRange(contact.depthM, contact.depthM),
      action,
      metrics: { contactDepthM: contact.depthM, contactKind: contact.kind, payBelowThkM: null, wetAboveThkM: null, wetAbovePct: null },
    };
  }

  const t = CROSS_CHECK_THRESHOLDS.mdtVsSw;
  let nValidSamples = 0;
  let totalPayThk = 0;
  let payBelowThk = 0;
  let payBelowSamples = 0;
  let payBelowTop = Infinity;
  let payBelowBase = -Infinity;

  let cleanAboveThk = 0;
  let wetAboveThk = 0;
  let wetAboveSamples = 0;
  let wetAboveTop = Infinity;
  let wetAboveBase = -Infinity;

  for (const i of indices) {
    const d = input.depth[i]!;
    const thk = sampleThickness(input.depth, input.thickness, i);
    const vPay = readAt(netPay, i);
    const vSw = readAt(sw, i);
    if (Number.isFinite(vPay) || Number.isFinite(vSw)) nValidSamples++;
    const isPay = vPay === 1;
    if (isPay) totalPayThk += thk;

    if (d > contact.depthM + t.marginM) {
      if (isPay) {
        payBelowSamples++;
        payBelowThk += thk;
        if (d < payBelowTop) payBelowTop = d;
        if (d > payBelowBase) payBelowBase = d;
      }
    } else if (d < contact.depthM - t.marginM) {
      if (!Number.isFinite(vSw)) continue;
      let isClean = false;
      if (netRes) {
        isClean = readAt(netRes, i) === 1;
      } else if (vsh && phie) {
        const vv = readAt(vsh, i);
        const vp = readAt(phie, i);
        isClean = Number.isFinite(vv) && vv <= t.cleanVshMax && Number.isFinite(vp) && vp >= t.cleanPhiMin;
      } else {
        isClean = true;
      }
      if (!isClean) continue;
      cleanAboveThk += thk;
      if (vSw > t.wetSwMin) {
        wetAboveSamples++;
        wetAboveThk += thk;
        if (d < wetAboveTop) wetAboveTop = d;
        if (d > wetAboveBase) wetAboveBase = d;
      }
    }
  }

  if (nValidSamples === 0) {
    return {
      id: 'mdt-vs-sw',
      zoneId: zone.id,
      zoneName: zone.name,
      status: 'unsupported',
      headline: 'Sin dato',
      detail: `Contacto ${contact.kind} en ${fmt(contact.depthM, 1)} m, pero no hay muestras válidas de Sw ni NET_PAY en la zona.`,
      focusRange: paddedRange(contact.depthM, contact.depthM),
      action,
      metrics: { contactDepthM: contact.depthM, contactKind: contact.kind, payBelowThkM: null, wetAboveThkM: null, wetAbovePct: null },
    };
  }

  const payBelowPct = totalPayThk > 0 ? (100 * payBelowThk) / totalPayThk : 0;
  const wetAbovePct = cleanAboveThk > 0 ? (100 * wetAboveThk) / cleanAboveThk : 0;

  let status: CrossCheckStatus = 'ok';
  if (
    payBelowThk > t.payBelowTensionM ||
    payBelowPct > t.payBelowTensionPct ||
    (wetAbovePct > t.wetAboveTensionPct && wetAboveThk > t.wetAboveTensionM)
  ) {
    status = 'tension';
  } else if (
    payBelowSamples > 0 ||
    wetAbovePct >= t.wetAboveWarnPct ||
    wetAboveThk >= t.wetAboveWarnM
  ) {
    status = 'warn';
  }

  const issues: string[] = [];
  if (payBelowSamples > 0) {
    issues.push(`${fmt(payBelowThk, 1)} m de pay neto por debajo de ${contact.kind} + ${fmt(t.marginM, 0)} m (${fmtPct(payBelowPct, 0)} del pay)`);
  }
  if (wetAboveSamples > 0 && (wetAbovePct >= t.wetAboveWarnPct || wetAboveThk >= t.wetAboveWarnM)) {
    issues.push(`${fmt(wetAboveThk, 1)} m (${fmtPct(wetAbovePct, 0)}) de arena limpia con Sw > 0,80 por encima de ${contact.kind} − ${fmt(t.marginM, 0)} m`);
  }
  const contactWarn = contact.warning ? ` Aviso MDT: ${contact.warning}` : '';

  const headline =
    status === 'ok'
      ? `${contact.kind} ${fmt(contact.depthM, 1)} m`
      : payBelowSamples > 0
        ? `${fmt(payBelowThk, 1)} m pay bajo ${contact.kind}`
        : `${fmt(wetAboveThk, 1)} m agua sobre ${contact.kind}`;

  const detail =
    status === 'ok'
      ? `Coherente con ${contact.kind} en ${fmt(contact.depthM, 1)} m (±${fmt(t.marginM, 0)} m): sin pay por debajo ni arenas acuíferas relevantes por encima.${contactWarn}`
      : `Contacto ${contact.kind} en ${fmt(contact.depthM, 1)} m: ${issues.join('; ')}. Revisar Rw, zona de transición capilar o compartimentalización.${contactWarn}`;

  const focusRange =
    payBelowSamples > 0
      ? paddedRange(payBelowTop, payBelowBase)
      : wetAboveSamples > 0
        ? paddedRange(wetAboveTop, wetAboveBase)
        : paddedRange(contact.depthM, contact.depthM);

  return {
    id: 'mdt-vs-sw',
    zoneId: zone.id,
    zoneName: zone.name,
    status,
    headline,
    detail,
    focusRange,
    action,
    metrics: {
      contactDepthM: contact.depthM,
      contactKind: contact.kind,
      payBelowThkM: payBelowThk,
      payBelowPct,
      wetAboveThkM: wetAboveThk,
      wetAbovePct,
      marginM: t.marginM,
    },
  };
}

// ── chequeo 5: capacidad capilar de sello vs. columna (nivel de pozo) ───────────────────────────────────────────

function evalSealCapacity(input: CrossCheckInput): {
  item: CrossCheckItem;
  evals: SealSampleEval[];
  assumptions: CrossCheckReport['sealAssumptions'];
} {
  const sa = input.sealAssumptions ?? defaultSealAssumptions();
  const res = sa.heightContext.reservoir;
  const assumptions: CrossCheckReport['sealAssumptions'] = {
    systemLabel: sa.systemLabel,
    sigmaDynPerCm: res.sigmaDynPerCm,
    thetaDeg: res.thetaDeg,
    rhoWaterGcc: sa.rhoWaterGcc,
    rhoHcGcc: sa.rhoHcGcc,
    deltaRhoGcc: sa.heightContext.deltaRhoGcc,
  };
  const assumptionsText = `Supuestos MICP: ${assumptions.systemLabel} (σ = ${fmt(assumptions.sigmaDynPerCm, 0)} dyn/cm, θ = ${fmt(assumptions.thetaDeg, 0)}°, Δρ = ${fmt(assumptions.deltaRhoGcc, 2)} g/cm³).`;

  const rawSamples = (input.sealSamples ?? []).filter((s) => Number.isFinite(s.pdLabPsi) && s.pdLabPsi > 0);
  const evals: SealSampleEval[] = rawSamples
    .map((s) => ({
      id: s.id,
      label: s.label,
      depthM: s.depthM,
      pdLabPsi: s.pdLabPsi,
      hMaxM: entryHeightM(s.pdLabPsi, sa.heightContext),
      source: s.source,
      isSeal: s.isSeal,
      zoneName: s.zoneName ?? null,
    }))
    .sort((a, b) => b.pdLabPsi - a.pdLabPsi);

  const sealZones = input.zones.filter((z) => z.kind === 'seal');
  const sealZonesMissing = sealZones
    .filter((z) => !evals.some((e) => e.isSeal && Number.isFinite(e.depthM) && e.depthM >= Math.min(z.top, z.base) && e.depthM <= Math.max(z.top, z.base)))
    .map((z) => z.name);

  if (evals.length === 0) {
    return {
      item: {
        id: 'seal-capacity',
        zoneId: null,
        zoneName: 'Pozo',
        status: 'unsupported',
        headline: 'Sin datos Pd',
        detail: `No hay curvas MICP cargadas ni presiones de desplazamiento Pd para estimar capacidad de sello. ${assumptionsText}`,
        focusRange: null,
        action: { kind: 'dock', panelId: 'micp', label: 'Abrir MICP' },
        metrics: { hMaxM: null, observedColumnM: input.observedColumnM ?? null, hasSealSupport: false, sampleCount: 0 },
      },
      evals: [],
      assumptions,
    };
  }

  if (!(assumptions.deltaRhoGcc > 0) || !evals.some((e) => Number.isFinite(e.hMaxM))) {
    return {
      item: {
        id: 'seal-capacity',
        zoneId: null,
        zoneName: 'Pozo',
        status: 'unsupported',
        headline: 'Δρ inválido',
        detail: `No se puede convertir Pd a altura de columna porque Δρ ≤ 0 o los parámetros interfaciales del panel MICP no son válidos. ${assumptionsText}`,
        focusRange: null,
        action: { kind: 'dock', panelId: 'micp', label: 'Revisar MICP' },
        metrics: { hMaxM: null, observedColumnM: input.observedColumnM ?? null, hasSealSupport: false, sampleCount: evals.length },
      },
      evals,
      assumptions,
    };
  }

  const measuredSeal = evals.filter((e) => e.isSeal && Number.isFinite(e.hMaxM));
  const col = input.observedColumnM !== undefined && input.observedColumnM !== null && Number.isFinite(input.observedColumnM) && input.observedColumnM > 0 ? input.observedColumnM : null;
  const colNote = col !== null ? ` Columna de referencia: ${fmt(col, 1)} m (${input.columnBasis ?? 'observada'}).` : '';

  if (measuredSeal.length > 0) {
    const top = measuredSeal[0]!;
    const margin = CROSS_CHECK_THRESHOLDS.sealCapacity.okMarginFactor;
    let status: CrossCheckStatus = 'ok';
    let verdict = `Dato medido de sello (${top.label}, Pd = ${fmt(top.pdLabPsi, 1)} psi Hg): columna máxima retenible h_max = ${fmt(top.hMaxM, 1)} m.`;
    if (col !== null) {
      if (top.hMaxM < col) {
        status = 'tension';
        verdict = `Tensión de sello: h_max = ${fmt(top.hMaxM, 1)} m (${top.label}, dato medido de sello) queda por debajo de la columna de ${fmt(col, 1)} m.`;
      } else if (top.hMaxM < margin * col) {
        status = 'warn';
        verdict = `Sello ajustado: h_max = ${fmt(top.hMaxM, 1)} m (${top.label}, dato medido de sello) supera a la columna de ${fmt(col, 1)} m con margen < 20 %.`;
      } else {
        status = 'ok';
        verdict = `Capacidad de sello holgada: h_max = ${fmt(top.hMaxM, 1)} m (${top.label}, dato medido de sello) retiene la columna de ${fmt(col, 1)} m.`;
      }
    }
    const missingTxt = sealZonesMissing.length ? ` Otros sellos sin ensayo MICP: ${sealZonesMissing.join(', ')}.` : '';
    return {
      item: {
        id: 'seal-capacity',
        zoneId: null,
        zoneName: 'Pozo',
        status,
        headline: `h_max ${fmt(top.hMaxM, 1)} m (sello)`,
        detail: `${verdict}${colNote}${missingTxt} ${assumptionsText}`,
        focusRange: Number.isFinite(top.depthM) ? paddedRange(top.depthM, top.depthM) : null,
        action: { kind: 'dock', panelId: top.source === 'micp' ? 'micp' : 'scal', label: top.source === 'micp' ? 'Abrir MICP' : 'Abrir SCAL' },
        metrics: {
          hMaxM: top.hMaxM,
          pdMaxLabPsi: top.pdLabPsi,
          observedColumnM: col,
          hasSealSupport: true,
          sampleCount: evals.length,
          sealSampleCount: measuredSeal.length,
          source: top.source,
        },
      },
      evals,
      assumptions,
    };
  }

  // Hay Pd medido (MICP/SCAL), pero únicamente en muestras de reservorio → sin soporte directo de roca sello.
  const top = evals.find((e) => Number.isFinite(e.hMaxM))!;
  const missingTxt = sealZonesMissing.length ? ` Zonas sello sin ensayo medido: ${sealZonesMissing.join(', ')}.` : '';
  return {
    item: {
      id: 'seal-capacity',
      zoneId: null,
      zoneName: 'Pozo',
      status: 'warn',
      headline: `${fmt(top.hMaxM, 1)} m (sin sello)`,
      detail: `Sin soporte directo de roca sello: las ${evals.length} muestras con Pd provienen de reservorio (${top.source === 'micp' ? 'MICP medido' : 'tabla SCAL'}). La muestra más apretada (${top.label}, Pd = ${fmt(top.pdLabPsi, 1)} psi Hg) da h_max = ${fmt(top.hMaxM, 1)} m solo como cota inferior intrarreservorio.${colNote}${missingTxt} ${assumptionsText}`,
      focusRange: Number.isFinite(top.depthM) ? paddedRange(top.depthM, top.depthM) : null,
      action: { kind: 'dock', panelId: top.source === 'micp' ? 'micp' : 'scal', label: top.source === 'micp' ? 'Abrir MICP' : 'Abrir SCAL' },
      metrics: {
        hMaxM: top.hMaxM,
        pdMaxLabPsi: top.pdLabPsi,
        observedColumnM: col,
        hasSealSupport: false,
        sampleCount: evals.length,
        sealSampleCount: 0,
        source: top.source,
      },
    },
    evals,
    assumptions,
  };
}

// ── chequeo 6a: efecto de uranio en GR (G06) ────────────────────────────────────────────────────────────────────

function evalUraniumGr(
  zone: CrossCheckZoneInput,
  indices: readonly number[],
  input: CrossCheckInput,
): CrossCheckItem {
  const { uGrFrac, netRes } = input.curves;
  const usesCgr = input.igrUsesCgr === true;
  const action: CrossCheckTarget = {
    kind: 'module',
    moduleId: usesCgr ? 'cgr' : 'igr-cgr',
    label: usesCgr ? 'Ver CGR' : 'Ver IGR desde CGR',
  };

  if (!uGrFrac) {
    return {
      id: 'uranium-gr',
      zoneId: zone.id,
      zoneName: zone.name,
      status: 'unsupported',
      headline: 'Sin espectral',
      detail: 'No está activa la fracción de uranio (U_GR_FRAC); requiere GR espectral (THOR, POTA y URAN).',
      focusRange: paddedRange(zone.top, zone.base),
      action: { kind: 'module', moduleId: 'cgr', label: 'Ver CGR' },
      metrics: { uMedFrac: null, uP90Frac: null, pctHighU: null, n: 0, igrUsesCgr: usesCgr },
    };
  }

  const resVals: number[] = [];
  const allVals: number[] = [];
  let peakVal = -Infinity;
  let peakDepth = NaN;
  let peakResVal = -Infinity;
  let peakResDepth = NaN;

  for (const i of indices) {
    const u = readAt(uGrFrac, i);
    if (!Number.isFinite(u) || u < 0 || u > 1) continue;
    const d = input.depth[i]!;
    allVals.push(u);
    if (u > peakVal) {
      peakVal = u;
      peakDepth = d;
    }
    if (netRes && readAt(netRes, i) === 1) {
      resVals.push(u);
      if (u > peakResVal) {
        peakResVal = u;
        peakResDepth = d;
      }
    }
  }

  const useRes = resVals.length > 0;
  const vals = useRes ? resVals : allVals;
  const bestDepth = useRes ? peakResDepth : peakDepth;

  if (vals.length === 0) {
    return {
      id: 'uranium-gr',
      zoneId: zone.id,
      zoneName: zone.name,
      status: 'unsupported',
      headline: 'Sin dato',
      detail: 'Sin muestras válidas de U_GR_FRAC en la zona.',
      focusRange: paddedRange(zone.top, zone.base),
      action,
      metrics: { uMedFrac: null, uP90Frac: null, pctHighU: null, n: 0, igrUsesCgr: usesCgr },
    };
  }

  const t = CROSS_CHECK_THRESHOLDS.uraniumGr;
  const uMed = medianOf(vals);
  const uP90 = quantileOf(vals, 0.9);
  const nHigh = vals.filter((v) => v > t.highSampleThreshold).length;
  const pctHigh = (100 * nHigh) / vals.length;

  let status: CrossCheckStatus = 'ok';
  if (uMed > t.tensionMedian) {
    status = usesCgr ? 'warn' : 'tension';
  } else if (uMed >= t.warnMedian || pctHigh >= t.highSamplesWarnPct) {
    status = 'warn';
  }

  const scope = useRes ? 'en reservorio neto' : 'en toda la zona';
  const cgrNote = usesCgr
    ? 'IGR ya usa CGR (efecto de uranio mitigado en Vsh).'
    : status === 'ok'
      ? 'Aporte de uranio acotado sobre el GR total.'
      : 'IGR usa GR total: evaluar cambiar a «Índice de rayos gamma desde CGR» para no sobreestimar Vsh.';

  return {
    id: 'uranium-gr',
    zoneId: zone.id,
    zoneName: zone.name,
    status,
    headline: fmtPct(uMed * 100, 0),
    detail: `Uranio aporta mediana ${fmtPct(uMed * 100)} (P90 ${fmtPct(uP90 * 100)}) del GR ${scope} (${vals.length} muestras). ${cgrNote}`,
    focusRange: Number.isFinite(bestDepth) ? paddedRange(bestDepth, bestDepth) : paddedRange(zone.top, zone.base),
    action,
    metrics: {
      uMedFrac: uMed,
      uP90Frac: uP90,
      pctHighU: pctHigh,
      n: vals.length,
      usedNetRes: useRes,
      igrUsesCgr: usesCgr,
    },
  };
}

// ── chequeo 6b: movilidad del hidrocarburo en pay (G07) ─────────────────────────────────────────────────────────

function evalHcMovability(
  zone: CrossCheckZoneInput,
  indices: readonly number[],
  input: CrossCheckInput,
): CrossCheckItem {
  const { mos, sw, mhi, phie, netPay } = input.curves;
  const action: CrossCheckTarget = { kind: 'module', moduleId: 'movable-hc', label: 'Ver movilidad Sxo' };

  if (!mos || !sw) {
    return {
      id: 'hc-movability',
      zoneId: zone.id,
      zoneName: zone.name,
      status: 'unsupported',
      headline: 'Sin Rxo/MOS',
      detail: 'No hay evaluación de movilidad (requiere RXO o inversión de invasión activa).',
      focusRange: paddedRange(zone.top, zone.base),
      action,
      metrics: { movableHcFrac: null, resolvedPct: null, mhiMed: null, nPay: 0, nResolved: 0 },
    };
  }

  let nPay = 0;
  let nResolved = 0;
  let sumMosPV = 0;
  let sumShPV = 0;
  let sumMosH = 0;
  let sumShH = 0;
  let sumMosUnw = 0;
  let sumShUnw = 0;
  const mhiVals: number[] = [];
  let resTop = Infinity;
  let resBase = -Infinity;

  for (const i of indices) {
    const vSw = readAt(sw, i);
    const inPay = netPay ? readAt(netPay, i) === 1 : Number.isFinite(vSw) && vSw < 0.7;
    if (!inPay) continue;
    nPay++;

    const vMos = readAt(mos, i);
    if (!Number.isFinite(vMos) || vMos < 0 || !Number.isFinite(vSw) || vSw < 0 || vSw >= 1) continue;
    nResolved++;

    const d = input.depth[i]!;
    if (d < resTop) resTop = d;
    if (d > resBase) resBase = d;

    const thk = sampleThickness(input.depth, input.thickness, i);
    const vPhi = readAt(phie, i);
    const sh = 1 - vSw;
    const clampedMos = Math.min(vMos, sh);

    sumMosUnw += clampedMos;
    sumShUnw += sh;
    if (thk > 0) {
      sumMosH += thk * clampedMos;
      sumShH += thk * sh;
      if (Number.isFinite(vPhi) && vPhi > 0) {
        const pv = thk * vPhi;
        sumMosPV += pv * clampedMos;
        sumShPV += pv * sh;
      }
    }

    const vMhi = readAt(mhi, i);
    if (Number.isFinite(vMhi) && vMhi >= 0) mhiVals.push(vMhi);
  }

  if (nPay === 0) {
    return {
      id: 'hc-movability',
      zoneId: zone.id,
      zoneName: zone.name,
      status: 'unsupported',
      headline: 'Sin pay',
      detail: 'No hay muestras de pay en la zona para evaluar movilidad de hidrocarburos.',
      focusRange: paddedRange(zone.top, zone.base),
      action,
      metrics: { movableHcFrac: null, resolvedPct: null, mhiMed: null, nPay: 0, nResolved: 0 },
    };
  }

  if (nResolved === 0) {
    return {
      id: 'hc-movability',
      zoneId: zone.id,
      zoneName: zone.name,
      status: 'unsupported',
      headline: 'Sin invasión',
      detail: `El pay de la zona (${nPay} muestras) no tiene invasión resuelta (RXO nulo) para estimar MOS.`,
      focusRange: paddedRange(zone.top, zone.base),
      action,
      metrics: { movableHcFrac: null, resolvedPct: 0, mhiMed: null, nPay, nResolved: 0 },
    };
  }

  const resolvedPct = (100 * nResolved) / nPay;
  const movableHcFrac = sumShPV > 0 ? sumMosPV / sumShPV : sumShH > 0 ? sumMosH / sumShH : sumShUnw > 0 ? sumMosUnw / sumShUnw : NaN;
  const mhiMed = medianOf(mhiVals);

  if (!Number.isFinite(movableHcFrac)) {
    return {
      id: 'hc-movability',
      zoneId: zone.id,
      zoneName: zone.name,
      status: 'unsupported',
      headline: 'Sin dato',
      detail: 'No se pudo ponderar la fracción móvil de hidrocarburo en el pay.',
      focusRange: paddedRange(resTop, resBase),
      action,
      metrics: { movableHcFrac: null, resolvedPct, mhiMed: Number.isFinite(mhiMed) ? mhiMed : null, nPay, nResolved },
    };
  }

  const t = CROSS_CHECK_THRESHOLDS.hcMovability;
  let status: CrossCheckStatus;
  let note: string;
  if (movableHcFrac < t.warnMovableFrac) {
    status = 'tension';
    note = 'Hidrocarburo mayormente residual en las muestras con invasión resuelta: revisar Rmf/Rw, viscosidad o tipo de lodo.';
  } else if (movableHcFrac < t.okMovableFrac || resolvedPct < t.minCoveragePct) {
    status = 'warn';
    note =
      resolvedPct < t.minCoveragePct
        ? `Cobertura escasa de invasión resuelta (${fmtPct(resolvedPct, 0)} del pay): tomar con cautela.`
        : 'Movilidad moderada del hidrocarburo en el pay; conviene contrastar en el crossplot Rt–Rxo.';
  } else {
    status = 'ok';
    note = 'Desplazamiento claro de hidrocarburo móvil por el filtrado en el pay.';
  }

  const mhiText = Number.isFinite(mhiMed) ? ` · MHI mediano ${fmt(mhiMed, 2)}` : '';
  return {
    id: 'hc-movability',
    zoneId: zone.id,
    zoneName: zone.name,
    status,
    headline: fmtPct(movableHcFrac * 100, 0),
    detail: `MOS / Sh = ${fmtPct(movableHcFrac * 100)} en el pay (${fmtPct(resolvedPct, 0)} con invasión resuelta, ${nResolved}/${nPay})${mhiText}. ${note}`,
    focusRange: paddedRange(resTop, resBase),
    action,
    metrics: {
      movableHcFrac,
      resolvedPct,
      mhiMed: Number.isFinite(mhiMed) ? mhiMed : null,
      nPay,
      nResolved,
    },
  };
}

// ── evaluación completa ─────────────────────────────────────────────────────────────────────────────────────────

function finiteDepthBounds(depth: ArrayLike<number>): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < depth.length; i++) {
    const d = depth[i]!;
    if (!Number.isFinite(d)) continue;
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  return Number.isFinite(lo) && Number.isFinite(hi) ? [lo, hi] : null;
}

/** Evalúa la matriz completa de coherencia cruzada por zona y capacidad de sello del pozo. Pura y determinista. */
export function evaluateCrossCheck(input: CrossCheckInput): CrossCheckReport {
  const depthBounds = input.zones.length === 0 ? finiteDepthBounds(input.depth) : null;
  const effectiveZones: readonly CrossCheckZoneInput[] =
    input.zones.length > 0
      ? input.zones
      : depthBounds
        ? [
            {
              id: '__well__',
              name: 'Pozo completo',
              top: depthBounds[0],
              base: depthBounds[1],
              kind: 'formation',
            },
          ]
        : [];

  const counts: Record<CrossCheckStatus, number> = { ok: 0, warn: 0, tension: 0, unsupported: 0 };
  const rows: CrossCheckZoneRow[] = [];

  for (const zone of effectiveZones) {
    const indices = zoneIndices(input.depth, zone.top, zone.base);
    const checks: Record<ZoneCheckId, CrossCheckItem> = {
      'sw-vs-swi': evalSwVsSwi(zone, indices, input),
      'bound-water': evalBoundWater(zone, indices, input),
      porosity: evalPorosity(zone, indices, input),
      'mdt-vs-sw': evalMdtVsSw(zone, indices, input),
      'uranium-gr': evalUraniumGr(zone, indices, input),
      'hc-movability': evalHcMovability(zone, indices, input),
    };
    const statuses = ZONE_CHECK_IDS.map((id) => checks[id].status);
    for (const s of statuses) counts[s]++;
    rows.push({
      zoneId: zone.id,
      zoneName: zone.name,
      zoneKind: zone.kind ?? 'formation',
      top: zone.top,
      base: zone.base,
      checks,
      worstStatus: worstCrossCheckStatus(statuses),
    });
  }

  const seal = evalSealCapacity(input);
  counts[seal.item.status]++;
  const overallStatus = worstCrossCheckStatus([...rows.map((r) => r.worstStatus), seal.item.status]);

  return {
    zones: rows,
    seal: seal.item,
    sealSamples: seal.evals,
    sealAssumptions: seal.assumptions,
    counts,
    overallStatus,
  };
}
