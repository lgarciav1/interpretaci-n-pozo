/**
 * Tipos de roca: modelo PURO del panel y de la pista (docs/decisiones/0024-rock-typing.md).
 *
 * - Plugs incluidos con su profundidad CORREGIDA (`shiftedDepth`, la puesta en profundidad del panel «Corona») y con φ
 *   y k válidas: FZI, RQI, φz y radios de garganta (Winland R35 o Pittman R25/R35/R50) con el motor puro
 *   `src/petro/rockTyping.ts`.
 * - Unidades de flujo sobre los plugs: Fisher–Jenks en log FZI (`autoFlowUnits`, 2–6 clases) o límites manuales
 *   (`describeFlowUnits`), guardados en los ajustes del conjunto de plugs. «Llevar al pozo» escribe método, número
 *   de unidades y límites en el módulo `rock-typing` del motor: una receta, un Ctrl+Z.
 * - Presión capilar: `PcCurve[]` de un conjunto de puntos `capillary` (las curvas MICP del TP, `./tp.ts`) o, sin
 *   conjunto, el EJEMPLO DE LIBRO (`EXAMPLE_PC_CLASSES`). Con curvas medidas, R35 medido contra Winland por muestra
 *   (`measuredR35Rows`).
 * - Colores de clase: `draw.ts` (`classColor`), los mismos en el panel y en la pista del visor.
 *
 * Sin React, stores ni `src/plots` (regla de pureza de las carpetas de módulos): lo importan el panel, la superposición
 * y los tests.
 */
import type { Interpretation } from '../../core/interpretation';
import type { ParamState } from '../../core/params';
import { pointNumbers, pointTexts, shiftedDepth, type PointSet, type PointSetDecisions } from '../../core/pointSets';
import { setParam, type Project } from '../../core/state/project';
import {
  autoFlowUnits,
  brooksCoreyCurve,
  describeFlowUnits,
  EXAMPLE_PC_CLASSES,
  flowZoneIndex,
  HG_AIR_SIGMA,
  HG_AIR_THETA_DEG,
  leverettJ,
  measuredR35,
  normalizedPorosity,
  permForThroatRadius,
  PITTMAN_COEFFICIENTS,
  portClassIndex,
  PORT_CLASSES,
  reservoirQualityIndex,
  throatRadius,
  throatSizeDistribution,
  WINLAND_R35,
  winlandR35,
  classifyByBounds,
  type FlowUnitClassification,
  type ThroatCoefficients,
  type ThroatSizeDistribution,
} from '../../petro/rockTyping';
import { COL, plugStatuses } from '../core/model';
import rockTyping, { activeBounds, ascending, BOUND_KEYS, classLabel, MAX_FLOW_UNITS, MIN_FLOW_UNITS, ROCK_TYPING_ID, type RockTypingMethod } from './index';

export const ROCK_DOCK_ID = 'rock-typing';
export const ROCK_OVERLAY_ID = 'rock-typing';

// ── ajustes del conjunto de plugs (en `Interpretation.pointSets[conjunto].settings`; no cambiarlos: se guardan) ──

export const RT_MODE_SETTING = 'rtMode';
export const RT_UNITS_SETTING = 'rtUnits';
export const RT_BOUNDS_SETTING = 'rtBounds';
export const RT_THROAT_SETTING = 'rtThroat';
export const DEFAULT_UNITS = 4;

export type FlowUnitMode = 'auto' | 'manual';
export type ThroatMethod = 'winland' | 'p25' | 'p35' | 'p50';

export interface ThroatMethodDef {
  id: ThroatMethod;
  label: string;
  /** Rótulo del radio («R35»). */
  radius: string;
  coef: ThroatCoefficients;
}

export const THROAT_METHODS: readonly ThroatMethodDef[] = [
  { id: 'winland', label: 'Winland R35', radius: 'R35', coef: WINLAND_R35 },
  { id: 'p25', label: 'Pittman R25', radius: 'R25', coef: PITTMAN_COEFFICIENTS[25]! },
  { id: 'p35', label: 'Pittman R35', radius: 'R35', coef: PITTMAN_COEFFICIENTS[35]! },
  { id: 'p50', label: 'Pittman R50', radius: 'R50', coef: PITTMAN_COEFFICIENTS[50]! },
];
export const throatMethod = (id: ThroatMethod): ThroatMethodDef => THROAT_METHODS.find((m) => m.id === id) ?? THROAT_METHODS[0]!;

/** Radios de las isolíneas del gráfico k–φ (µm): los límites de las clases de garganta de Martin et al. (1997). */
export const ISO_RADII: readonly number[] = PORT_CLASSES.slice(0, -1).map((c) => c.max);

export interface RockSettings {
  mode: FlowUnitMode;
  nUnits: number;
  /** Límites manuales (ascendentes, > 0) o null si no se eligieron. */
  manualBounds: number[] | null;
  throat: ThroatMethod;
}

const settingOf = (dec: PointSetDecisions | undefined, key: string) => dec?.settings?.[key];

/** Límites guardados como texto «0.3;0.8;2» (los ajustes son escalares). */
export const encodeBounds = (b: readonly number[]): string => b.map((v) => String(v)).join(';');
export function decodeBounds(text: unknown): number[] | null {
  if (typeof text !== 'string' || !text.trim()) return null;
  const v = text.split(';').map(Number);
  return v.length > 0 && v.length < MAX_FLOW_UNITS && v.every((x) => Number.isFinite(x) && x > 0) && ascending(v) ? v : null;
}

export const clampUnits = (n: number) => Math.max(MIN_FLOW_UNITS, Math.min(MAX_FLOW_UNITS, Math.round(n)));

export function rockSettings(dec: PointSetDecisions | undefined): RockSettings {
  const mode = settingOf(dec, RT_MODE_SETTING) === 'manual' ? 'manual' : 'auto';
  const u = settingOf(dec, RT_UNITS_SETTING);
  const t = settingOf(dec, RT_THROAT_SETTING);
  const manualBounds = decodeBounds(settingOf(dec, RT_BOUNDS_SETTING));
  return {
    mode,
    nUnits: typeof u === 'number' && Number.isFinite(u) ? clampUnits(u) : DEFAULT_UNITS,
    manualBounds,
    throat: THROAT_METHODS.some((m) => m.id === t) ? (t as ThroatMethod) : 'winland',
  };
}

// ── plugs ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface RockPlugs {
  /** Índices en el conjunto de los plugs usados (incluidos, con φ ∈ (0, 1) y k > 0). */
  idx: number[];
  /** Profundidad CORREGIDA (m). */
  depth: Float64Array;
  phi: Float64Array;
  k: Float64Array;
  fzi: Float64Array;
  rqi: Float64Array;
  phiZ: Float64Array;
  /** Plugs incluidos que no se usan por faltarles φ o k válidas. */
  skipped: number;
  /** El conjunto tiene columnas de φ y k. */
  hasColumns: boolean;
}

/** Plugs incluidos con φ y k válidas, en su profundidad corregida, con FZI, RQI y φz. */
export function rockPlugs(set: PointSet, dec: PointSetDecisions | undefined): RockPlugs {
  const st = plugStatuses(set, dec);
  const z = shiftedDepth(set, dec);
  const phiCol = pointNumbers(set, COL.phi);
  const kCol = pointNumbers(set, COL.k);
  const idx: number[] = [];
  let skipped = 0;
  for (let i = 0; i < st.length; i++) {
    if (!st[i]!.included) continue;
    const p = phiCol?.[i] ?? NaN;
    const k = kCol?.[i] ?? NaN;
    if (p > 0 && p < 1 && k > 0 && Number.isFinite(k)) idx.push(i);
    else skipped++;
  }
  const pick = (src: ArrayLike<number> | null | undefined) => Float64Array.from(idx, (i) => (src ? src[i]! : NaN));
  const phi = pick(phiCol);
  const k = pick(kCol);
  return {
    idx,
    depth: pick(z),
    phi,
    k,
    fzi: Float64Array.from(idx, (_, j) => flowZoneIndex(phi[j]!, k[j]!)),
    rqi: Float64Array.from(idx, (_, j) => reservoirQualityIndex(phi[j]!, k[j]!)),
    phiZ: Float64Array.from(phi, normalizedPorosity),
    skipped,
    hasColumns: !!phiCol && !!kCol,
  };
}

// ── Winland / Pittman ────────────────────────────────────────────────────────────────────────────────────────

/** Radio de garganta (µm) de cada plug con el método elegido. */
export const plugThroatRadii = (plugs: RockPlugs, m: ThroatMethod): Float64Array =>
  Float64Array.from(plugs.phi, (p, j) => throatRadius(throatMethod(m).coef, p, plugs.k[j]!));

/** Clase de garganta (índice de `PORT_CLASSES`, −1 sin clase) de cada radio. */
export const portClasses = (radii: ArrayLike<number>): Int32Array => Int32Array.from(radii as ArrayLike<number>, portClassIndex);

/** Cuántos plugs por clase de garganta (5 clases). */
export function portClassCounts(classes: ArrayLike<number>): number[] {
  const out = PORT_CLASSES.map(() => 0);
  for (let i = 0; i < classes.length; i++) {
    const c = classes[i]!;
    if (c >= 0) out[c]!++;
  }
  return out;
}

/** Isolínea k(φ) de un radio de garganta (µm) con el método elegido, con `n` φ equiespaciadas en [lo, hi] (v/v). */
export function throatIsoline(m: ThroatMethod, radius: number, lo: number, hi: number, n = 24): { x: Float64Array; y: Float64Array } {
  const coef = throatMethod(m).coef;
  const x = Float64Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1));
  return { x, y: Float64Array.from(x, (p) => permForThroatRadius(coef, radius, p)) };
}

// ── unidades de flujo (FZI / RQI) ────────────────────────────────────────────────────────────────────────────

/** Clasificación de los plugs: automática (Fisher–Jenks con n clases) o con los límites manuales. null sin FZI válidos. */
export function plugFlowUnits(plugs: RockPlugs, s: Pick<RockSettings, 'mode' | 'nUnits' | 'manualBounds'>): FlowUnitClassification | null {
  if (plugs.fzi.length === 0) return null;
  if (s.mode === 'manual' && s.manualBounds) return describeFlowUnits(plugs.fzi, s.manualBounds);
  return autoFlowUnits(plugs.fzi, s.nUnits);
}

export interface FlowUnitRow {
  index: number;
  label: string;
  lower: number;
  upper: number;
  n: number;
  /** FZI medio (media geométrica, µm). */
  fziMean: number;
  /** Mediana de φ de los plugs de la clase (v/v). */
  phi: number;
  /** k media geométrica de los plugs de la clase (mD). */
  k: number;
}

const median = (v: number[]) => {
  if (v.length === 0) return NaN;
  const s = [...v].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** Filas de la tabla de clases: n, FZI medio y φ–k representativas de los plugs de cada unidad. */
export function flowUnitRows(plugs: RockPlugs, fu: FlowUnitClassification): FlowUnitRow[] {
  return fu.classes.map((c) => {
    const phis: number[] = [];
    let sLog = 0;
    let n = 0;
    for (let j = 0; j < fu.labels.length; j++) {
      if (fu.labels[j] !== c.index) continue;
      phis.push(plugs.phi[j]!);
      sLog += Math.log10(plugs.k[j]!);
      n++;
    }
    return { index: c.index, label: classLabel('fzi', c.index), lower: c.lower, upper: c.upper, n: c.n, fziMean: c.fziMean, phi: median(phis), k: n ? 10 ** (sLog / n) : NaN };
  });
}

/** Recta de una unidad en log RQI – log φz (pendiente 1): RQI = FZI·φz en [lo, hi]. */
export const rqiLine = (fzi: number, lo: number, hi: number) => ({ x: Float64Array.of(lo, hi), y: Float64Array.of(fzi * lo, fzi * hi) });

/** Límite de FZI redondeado a 3 cifras significativas dentro del rango del parámetro (0,01–100 µm). */
export function roundBound(v: number): number {
  if (!(v > 0) || !Number.isFinite(v)) return NaN;
  return Math.min(100, Math.max(0.01, +v.toPrecision(3)));
}

/** Límites que se llevarían al pozo (redondeados, crecientes y distintos). */
export function boundsToApply(bounds: readonly number[]): number[] {
  const r = bounds.map(roundBound).filter(Number.isFinite);
  return r.filter((v, i) => i === 0 || v > r[i - 1]!);
}

// ── parámetros del módulo y recetas «Llevar al pozo» ───────────────────────────────────────────────────────

const key = (k: string) => `${ROCK_TYPING_ID}.${k}`;

export interface RockModuleParams {
  method: RockTypingMethod;
  nUnits: number;
  /** Límites que usa el motor (los n − 1 primeros, ordenados). */
  bounds: number[];
}

/** Parámetros vigentes del módulo `rock-typing` (globales), resueltos como el motor: lo guardado o el de fábrica. */
export function rockModuleParams(params: Pick<ParamState, 'global'>): RockModuleParams {
  const g = params.global;
  const spec = rockTyping.params;
  const m = g[key('method')];
  const method: RockTypingMethod = m === 'winland' || m === 'fzi' ? m : spec.method.default;
  const u = g[key('nUnits')];
  const nUnits = clampUnits(typeof u === 'number' && Number.isFinite(u) ? u : spec.nUnits.default);
  const values: Record<string, unknown> = {};
  for (const b of BOUND_KEYS) {
    const v = g[key(b)];
    values[b] = typeof v === 'number' && Number.isFinite(v) ? v : spec[b].default;
  }
  return { method, nUnits, bounds: [...activeBounds(values, nUnits)].sort((a, b) => a - b) };
}

/** ¿El motor ya usa estas unidades de flujo (FZI con estos límites redondeados)? */
export function flowUnitsApplied(params: Pick<ParamState, 'global'>, bounds: readonly number[]): boolean {
  const cur = rockModuleParams(params);
  const want = boundsToApply(bounds);
  return cur.method === 'fzi' && cur.nUnits === want.length + 1 && cur.bounds.length === want.length && want.every((v, i) => Math.abs(cur.bounds[i]! - v) < 1e-12);
}

/** «Llevar al pozo» las unidades de flujo: método FZI, número de unidades y límites. Una receta (un Ctrl+Z). */
export function applyFlowUnits(project: Project, wellId: string, bounds: readonly number[]): Project {
  const b = boundsToApply(bounds);
  if (b.length < MIN_FLOW_UNITS - 1 || b.length > MAX_FLOW_UNITS - 1) return project;
  let p = setParam(project, wellId, key('method'), 'fzi');
  p = setParam(p, wellId, key('nUnits'), b.length + 1);
  b.forEach((v, i) => (p = setParam(p, wellId, key(BOUND_KEYS[i]!), v)));
  return p;
}

/** «Llevar al pozo» las clases de garganta de Winland (método del módulo). Una receta. */
export const applyWinland = (project: Project, wellId: string): Project => setParam(project, wellId, key('method'), 'winland');

/** ¿La permeabilidad del perfil sale del modelo k–φ de corona? */
export const permFromCore = (interp: Pick<Interpretation, 'sources'>) => {
  const s = interp.sources['PERM'];
  return s?.kind === 'module' && s.moduleId === 'perm-core';
};

// ── colores y rótulos de clase (panel y pista) ─────────────────────────────────────────────────────────────

/** Número de clases del método vigente del módulo. */
export const classCount = (p: RockModuleParams) => (p.method === 'winland' ? PORT_CLASSES.length : p.bounds.length + 1);

/** Rango de una clase en texto (µm): «< 0,6», «0,6–1,5», «> 8». */
export function classRangeText(method: RockTypingMethod, index: number, bounds: readonly number[], fmt: (v: number) => string): string {
  const edges = method === 'winland' ? ISO_RADII : bounds;
  const lo = index > 0 ? edges[index - 1] : undefined;
  const hi = index < edges.length ? edges[index] : undefined;
  const what = method === 'winland' ? 'R35' : 'FZI';
  if (lo === undefined && hi !== undefined) return `${what} < ${fmt(hi)} µm`;
  if (hi === undefined && lo !== undefined) return `${what} > ${fmt(lo)} µm`;
  return `${what} ${fmt(lo!)}–${fmt(hi!)} µm`;
}

export { classLabel };

// ── presión capilar: curvas medidas (conjunto `capillary`) o ejemplo de libro ──────────────────────────────────

/** Tipo de conjunto de puntos de una curva Pc–Sw digitalizada (columnas `sample`, `sw`, `pc`, y opcionales `k`, `phi`). */
export const CAPILLARY_KIND = 'capillary';

/** Curva de presión capilar mercurio–aire (Pc creciente, Sw decreciente) lista para graficar. */
export interface PcCurve {
  id: string;
  label: string;
  /** 'book' = EJEMPLO DE LIBRO (rotularlo siempre); 'measured' = digitalizada de un ensayo del pozo. */
  source: 'book' | 'measured';
  /** k (mD) y φ (v/v) de la muestra: escalan la J de Leverett y dan el FZI de la curva. */
  k: number;
  phi: number;
  sw: Float64Array;
  /** psi, creciente. */
  pc: Float64Array;
  sigma: number;
  thetaDeg: number;
}

/** Las cinco curvas de ejemplo de libro (Brooks–Corey con Pd por Leverett), de mejor a peor roca. */
export function examplePcCurves(n = 60): PcCurve[] {
  return EXAMPLE_PC_CLASSES.map((c) => {
    const { sw, pc } = brooksCoreyCurve(c.pd, c.lambda, c.swirr, n);
    return { id: c.id, label: c.label, source: 'book', k: c.k, phi: c.phi, sw, pc, sigma: HG_AIR_SIGMA, thetaDeg: HG_AIR_THETA_DEG };
  });
}

/**
 * Curvas de un conjunto de puntos `capillary` (Pc–Sw medido, p. ej. las MICP del TP): una por valor de `sample`, ordenada
 * por Pc creciente, con k y φ del primer valor finito del grupo (NaN si no hay). Mercurio–aire.
 */
export function pcCurvesFromPointSet(set: PointSet): PcCurve[] {
  if (set.kind !== CAPILLARY_KIND) return [];
  const sw = pointNumbers(set, 'sw');
  const pc = pointNumbers(set, 'pc');
  if (!sw || !pc) return [];
  const sample = pointTexts(set, 'sample');
  const k = pointNumbers(set, 'k');
  const phi = pointNumbers(set, 'phi');
  const groups = new Map<string, number[]>();
  for (let i = 0; i < sw.length; i++) {
    if (!Number.isFinite(sw[i]!) || !(pc[i]! > 0)) continue;
    const g = sample?.[i] || set.name;
    const list = groups.get(g) ?? [];
    list.push(i);
    groups.set(g, list);
  }
  const first = (col: Float64Array | null, ids: number[]) => ids.map((i) => col?.[i] ?? NaN).find(Number.isFinite) ?? NaN;
  return [...groups].map(([g, ids]) => {
    const order = [...ids].sort((a, b) => pc[a]! - pc[b]!);
    return {
      id: `${set.id}:${g}`,
      label: g,
      source: 'measured' as const,
      k: first(k, ids),
      phi: first(phi, ids),
      sw: Float64Array.from(order, (i) => sw[i]!),
      pc: Float64Array.from(order, (i) => pc[i]!),
      sigma: HG_AIR_SIGMA,
      thetaDeg: HG_AIR_THETA_DEG,
    };
  });
}

/** Curvas a mostrar: las digitalizadas del pozo si hay; si no, el ejemplo de libro. */
export function capillaryCurves(sets: readonly PointSet[]): { curves: PcCurve[]; book: boolean } {
  const measured = sets.flatMap(pcCurvesFromPointSet);
  return measured.length ? { curves: measured, book: false } : { curves: examplePcCurves(), book: true };
}

/** J de Leverett de cada punto de la curva (NaN sin k o φ). */
export const leverettCurve = (c: PcCurve): Float64Array => Float64Array.from(c.pc, (p) => leverettJ(p, c.k, c.phi, c.sigma, c.thetaDeg));

/** Distribución de tamaño de gargantas (Washburn) de una curva: SHg = 1 − Sw contra Pc creciente. */
export const curveThroats = (c: PcCurve): ThroatSizeDistribution =>
  throatSizeDistribution(c.pc, Float64Array.from(c.sw, (s) => 1 - s), c.sigma, c.thetaDeg);

/** FZI de la muestra de una curva (NaN sin k o φ). */
export const curveFzi = (c: PcCurve) => flowZoneIndex(c.phi, c.k);

/** Unidad de flujo (índice) en la que cae una curva con los límites dados; −1 sin FZI. */
export const curveFlowUnit = (c: PcCurve, bounds: readonly number[]) => classifyByBounds(curveFzi(c), bounds);

// ── R35 medido contra Winland ─────────────────────────────────────────────────────────────────────────────────

export interface R35Row {
  id: string;
  label: string;
  /** k de la muestra (mD) y φ (v/v). */
  k: number;
  phi: number;
  /** R35 de la curva medida (µm): Washburn a la Pc en que el mercurio ocupa el 35 % del poro. NaN si no llega. */
  measured: number;
  /** R35 de Winland con k y φ de la muestra (µm). */
  winland: number;
  /** Diferencia de Winland respecto del medido (%): positiva si Winland lo sobreestima. */
  diffPct: number;
  /** Clase de garganta (índice de `PORT_CLASSES`, −1 sin clase) del R35 medido y del de Winland. */
  classMeasured: number;
  classWinland: number;
}

/**
 * Una fila por curva MEDIDA (las de libro se ignoran): R35 de la curva contra el que estima Winland con su k y φ.
 * `pc` de la curva en psi y `sw` en v/v, como `PcCurve`.
 */
export function measuredR35Rows(curves: readonly PcCurve[]): R35Row[] {
  return curves
    .filter((c) => c.source === 'measured')
    .map((c) => {
      const measured = measuredR35(c.pc, c.sw, c.sigma, c.thetaDeg);
      const winland = winlandR35(c.phi, c.k);
      const diffPct = measured > 0 && winland > 0 ? 100 * (winland / measured - 1) : NaN;
      return { id: c.id, label: c.label, k: c.k, phi: c.phi, measured, winland, diffPct, classMeasured: portClassIndex(measured), classWinland: portClassIndex(winland) };
    });
}
