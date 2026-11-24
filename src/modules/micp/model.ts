/**
 * Análisis MICP: modelo PURO del panel (sin React ni stores). Usa el motor `src/petro/micp.ts` sobre las curvas de
 * cualquier conjunto de puntos `capillary` del pozo (las MICP del TP u otras): ajustes de Thomeer y Brooks–Corey,
 * permeabilidad desde la curva, Sw contra altura sobre el agua libre, permeabilidad relativa y cutoff de Sw por flujo
 * fraccional, y comparación con el BVI/PHIE del CMR.
 *
 * Unidades: Pc en psi (mercurio–aire, como `PcCurve`), Sw y φ en v/v, alturas y profundidades en m, densidades en g/cm³.
 * Los ajustes del panel se guardan en `interpretation.moduleState['micp']` (`writeMicpSettings`, una receta: un Ctrl+Z).
 */
import type { JsonValue } from '../../core/interpretation';
import { pointTexts, type PointSet } from '../../core/pointSets';
import { setModuleState, setParam, type Project } from '../../core/state/project';
import {
  cmrBviEquivalentHeights,
  DEFAULT_OIL_DENSITY_GCC,
  DEFAULT_OIL_VISCOSITY_CP,
  DEFAULT_WATER_DENSITY_GCC,
  DEFAULT_WATER_VISCOSITY_CP,
  densityFromGradientPsiPerFt,
  entryHeightM,
  fitBrooksCorey,
  fitThomeer,
  fractionalFlowWater,
  heightFromLabPc,
  krnwBrooksCorey,
  krwBrooksCorey,
  labPcFromHeight,
  summarizeCutoffs,
  swansonPermeabilityFromCurve,
  swAtCmrCalibration,
  swAtFractionalFlow,
  swAtHeightFromCurve,
  SYSTEM_GAS_WATER,
  SYSTEM_HG_AIR,
  SYSTEM_OIL_WATER,
  thomeerBv,
  thomeerPermeability,
  type BrooksCoreyFit,
  type CutoffSummary,
  type HeightContext,
  type InterfacialSystem,
  type ThomeerFit,
} from '../../petro/micp';
import { TP_CORE_PLUGS } from '../core/tpData';
import { CAPILLARY_KIND, pcCurvesFromPointSet, type PcCurve } from '../rock-typing/model';
import { isTpMicpSet } from '../rock-typing/tp';
import { TP_MICP_SAMPLES } from '../rock-typing/tpMicp';
import { MICP_ID } from './index';

export { MICP_ID };
export const MICP_DOCK_ID = MICP_ID;

// ── muestras ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface MicpSample {
  id: string;
  label: string;
  /** Profundidad de la muestra (m): la del primer punto del grupo. */
  depthM: number;
  /** k de la tabla del conjunto (mD): en el TP, la «k de gas» de la hoja SCAL. */
  kTable: number;
  /** k medida del plug del mismo número (hoja PB del TP; NaN si no hay). */
  kPlug: number;
  plugId: string | null;
  phi: number;
  pcPsi: Float64Array;
  sw: Float64Array;
  /** Curva del TP (hoja SCAL). */
  tp: boolean;
}

/** Muestras de todos los conjuntos `capillary` del pozo, con profundidad y, en el TP, la k del plug. */
export function micpSamples(sets: readonly PointSet[]): MicpSample[] {
  const out: MicpSample[] = [];
  for (const set of sets) {
    if (set.kind !== CAPILLARY_KIND) continue;
    const tp = isTpMicpSet(set);
    const names = pointTexts(set, 'sample');
    for (const c of pcCurvesFromPointSet(set)) {
      const i = names ? names.findIndex((n) => (n || set.name) === c.label) : 0;
      const tpSample = tp ? TP_MICP_SAMPLES.find((s) => s.sample === c.label) : undefined;
      const plug = tpSample ? TP_CORE_PLUGS.find((p) => p.id === tpSample.plugId) : undefined;
      out.push({
        id: c.id,
        label: c.label,
        depthM: set.depth[Math.max(0, i)] ?? NaN,
        kTable: c.k,
        kPlug: plug?.kMd ?? NaN,
        plugId: tpSample?.plugId ?? null,
        phi: c.phi,
        pcPsi: c.pc,
        sw: c.sw,
        tp,
      });
    }
  }
  return out;
}

/** Muestras desde curvas sueltas (para tests y para curvas sin conjunto). */
export const sampleFromCurve = (c: PcCurve, depthM = NaN): MicpSample => ({ id: c.id, label: c.label, depthM, kTable: c.k, kPlug: NaN, plugId: null, phi: c.phi, pcPsi: c.pc, sw: c.sw, tp: false });

// ── ajustes del panel (moduleState) ─────────────────────────────────────────────────────────────────────────────

export type ReservoirSystem = 'oil-water' | 'gas-water';
export const RESERVOIR_SYSTEMS: readonly { id: ReservoirSystem; label: string; system: InterfacialSystem; hcLabel: string }[] = [
  { id: 'oil-water', label: 'Petróleo–agua', system: SYSTEM_OIL_WATER, hcLabel: 'petróleo' },
  { id: 'gas-water', label: 'Gas–agua', system: SYSTEM_GAS_WATER, hcLabel: 'gas' },
];
/** Densidad de gas de reservorio por defecto (g/cm³). Supuesto. */
export const DEFAULT_GAS_DENSITY_GCC = 0.25;
export const DEFAULT_COLUMN_M = 100;

export interface MicpSettings {
  system: ReservoirSystem;
  rhoWater: number;
  rhoHc: number;
  /** Profundidad supuesta del nivel de agua libre (m); null sin elegir. */
  fwlM: number | null;
  /** Altura de la columna de hidrocarburo (m) para el Swirr de la permeabilidad relativa. */
  columnM: number;
  muWater: number;
  muHc: number;
}

export const DEFAULT_MICP_SETTINGS: MicpSettings = {
  system: 'oil-water',
  rhoWater: DEFAULT_WATER_DENSITY_GCC,
  rhoHc: DEFAULT_OIL_DENSITY_GCC,
  fwlM: null,
  columnM: DEFAULT_COLUMN_M,
  muWater: DEFAULT_WATER_VISCOSITY_CP,
  muHc: DEFAULT_OIL_VISCOSITY_CP,
};

const posOr = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : d);

/** Ajustes guardados (lo que no sea válido vuelve al valor de fábrica). */
export function readMicpSettings(state: JsonValue | undefined): MicpSettings {
  const s = state && typeof state === 'object' && !Array.isArray(state) ? (state as Record<string, JsonValue>) : {};
  const d = DEFAULT_MICP_SETTINGS;
  return {
    system: s['system'] === 'gas-water' ? 'gas-water' : 'oil-water',
    rhoWater: posOr(s['rhoWater'], d.rhoWater),
    rhoHc: posOr(s['rhoHc'], s['system'] === 'gas-water' ? DEFAULT_GAS_DENSITY_GCC : d.rhoHc),
    fwlM: typeof s['fwlM'] === 'number' && Number.isFinite(s['fwlM']) ? s['fwlM'] : null,
    columnM: posOr(s['columnM'], d.columnM),
    muWater: posOr(s['muWater'], d.muWater),
    muHc: posOr(s['muHc'], d.muHc),
  };
}

/**
 * Cambia ajustes del panel (una receta). Al cambiar de sistema, la densidad del hidrocarburo vuelve a la típica del
 * nuevo (0,80 petróleo, 0,25 gas) salvo que el cambio traiga otra.
 */
export function writeMicpSettings(project: Project, wellId: string, current: MicpSettings, patch: Partial<MicpSettings>): Project {
  const next: MicpSettings = { ...current, ...patch };
  if (patch.system && patch.system !== current.system && patch.rhoHc === undefined) next.rhoHc = patch.system === 'gas-water' ? DEFAULT_GAS_DENSITY_GCC : DEFAULT_OIL_DENSITY_GCC;
  const value: Record<string, JsonValue> = { version: 1, system: next.system, rhoWater: next.rhoWater, rhoHc: next.rhoHc, columnM: next.columnM, muWater: next.muWater, muHc: next.muHc };
  if (next.fwlM !== null) value['fwlM'] = next.fwlM;
  return setModuleState(project, wellId, MICP_ID, value);
}

/** Contexto de conversión laboratorio → reservorio; Δρ ≤ 0 deja las alturas en NaN (el motor lo valida). */
export function heightContext(s: MicpSettings): HeightContext {
  const sys = RESERVOIR_SYSTEMS.find((r) => r.id === s.system)!.system;
  return { lab: SYSTEM_HG_AIR, reservoir: sys, deltaRhoGcc: s.rhoWater - s.rhoHc };
}

// ── 1. ajustes y permeabilidad ──────────────────────────────────────────────────────────────────────────────────

export interface FitRow {
  sample: MicpSample;
  thomeer: ThomeerFit | null;
  brooksCorey: BrooksCoreyFit | null;
  kSwanson: number;
  kThomeer: number;
}

export function fitRows(samples: readonly MicpSample[]): FitRow[] {
  return samples.map((s) => {
    const thomeer = fitThomeer(s.pcPsi, s.sw, s.phi);
    return {
      sample: s,
      thomeer,
      brooksCorey: fitBrooksCorey(s.pcPsi, s.sw),
      kSwanson: swansonPermeabilityFromCurve(s.pcPsi, s.sw, s.phi),
      kThomeer: thomeer ? thomeerPermeability(thomeer.g, thomeer.pd, thomeer.bvInfPct) : NaN,
    };
  });
}

/** Bv medido (% del volumen total) de cada punto: (1 − Sw)·φ·100. */
export const measuredBv = (s: MicpSample): Float64Array => Float64Array.from(s.sw, (v) => Math.max(0, 1 - v) * s.phi * 100);

/** Hipérbola de Thomeer ajustada, en `n` presiones log-equiespaciadas entre Pd (apenas arriba) y la última Pc medida. */
export function thomeerCurve(fit: ThomeerFit, pcMaxPsi: number, n = 64): { pc: Float64Array; bv: Float64Array } {
  const lo = Math.log10(fit.pd * 1.0005);
  const hi = Math.log10(Math.max(pcMaxPsi, fit.pd * 1.01));
  const pc = Float64Array.from({ length: n }, (_, i) => 10 ** (lo + ((hi - lo) * i) / (n - 1)));
  return { pc, bv: Float64Array.from(pc, (p) => thomeerBv(p, fit.pd, fit.g, fit.bvInfPct)) };
}

/** Comparación de la k de la tabla con Swanson: cuántas muestras coinciden dentro de `tol` (relativa). */
export function tableVsSwanson(rows: readonly FitRow[], tol = 0.007): { within: number; n: number } {
  const valid = rows.filter((r) => r.sample.kTable > 0 && r.kSwanson > 0);
  return { within: valid.filter((r) => Math.abs(r.kSwanson / r.sample.kTable - 1) <= tol).length, n: valid.length };
}

// ── 2. altura sobre el agua libre ───────────────────────────────────────────────────────────────────────────────

/** Curva Sw–altura de una muestra en los escalones medidos (sin extrapolar): h = 0 → Sw = 1 y cada Pc → su altura. */
export function heightCurve(s: MicpSample, ctx: HeightContext): { sw: Float64Array; h: Float64Array } {
  const sw: number[] = [];
  const h: number[] = [];
  if (s.sw.length && s.sw[0]! >= 1) {
    sw.push(1);
    h.push(0);
  }
  for (let i = 0; i < s.pcPsi.length; i++) {
    const hi = heightFromLabPc(s.pcPsi[i]!, ctx);
    if (!Number.isFinite(hi)) continue;
    sw.push(s.sw[i]!);
    h.push(hi);
  }
  return { sw: Float64Array.from(sw), h: Float64Array.from(h) };
}

/** Altura de entrada (m) con la Pd de Thomeer de cada muestra. */
export const entryHeights = (rows: readonly FitRow[], ctx: HeightContext): number[] => rows.map((r) => (r.thomeer ? entryHeightM(r.thomeer.pd, ctx) : NaN));

export interface ZoneSpan {
  id: string;
  name: string;
  top: number;
  base: number;
}

/** Zonas que contienen al menos una muestra. */
export const zonesWithSamples = (zones: readonly ZoneSpan[], samples: readonly MicpSample[]): ZoneSpan[] =>
  zones.filter((z) => samples.some((s) => s.depthM >= z.top && s.depthM <= z.base));

/**
 * Puntos del perfil (Sw, altura sobre el FWL) en las zonas dadas: h = FWL − profundidad (m, se descartan h < 0 y Sw no
 * válidas), diezmados a ≤ `max` puntos.
 */
export function logHeightPoints(depth: ArrayLike<number>, sw: ArrayLike<number>, zones: readonly ZoneSpan[], fwlM: number, max = 3000): { sw: Float64Array; h: Float64Array } {
  const xs: number[] = [];
  const hs: number[] = [];
  for (let i = 0; i < depth.length; i++) {
    const d = depth[i]!;
    const v = sw[i]!;
    if (!(v >= 0 && v <= 1) || !zones.some((z) => d >= z.top && d <= z.base)) continue;
    const h = fwlM - d;
    if (!(h >= 0)) continue;
    xs.push(v);
    hs.push(h);
  }
  const step = Math.max(1, Math.ceil(xs.length / max));
  const pick = (a: number[]) => Float64Array.from(a.filter((_, i) => i % step === 0));
  return { sw: pick(xs), h: pick(hs) };
}

/** Gradientes de las presiones MDT del TP (psi/ft, regresión de la app; tests/tp-datos-mdt-scal.test.ts). */
export const TP_MDT_GRADIENTS: readonly { zone: string; psiPerFt: number; n: number }[] = [
  { zone: 'B', psiPerFt: 0.4121, n: 25 },
  { zone: 'D', psiPerFt: 0.7313, n: 31 },
];

/** Densidad que implica cada gradiente (g/cm³). */
export const gradientDensities = () => TP_MDT_GRADIENTS.map((g) => ({ ...g, densityGcc: densityFromGradientPsiPerFt(g.psiPerFt) }));

// ── 3. permeabilidad relativa y cutoff de Sw ────────────────────────────────────────────────────────────────────

/** Cociente μw/μo de los extremos de la banda del cutoff. */
export const VISCOSITY_RATIO_BAND: readonly [number, number] = [0.25, 2];

export interface RelpermRow {
  sample: MicpSample;
  /** Sw de la curva a la altura de la columna (v/v); NaN si la curva no llega. */
  swirr: number;
  fit: BrooksCoreyFit | null;
  /** Sw con fw = 0,5 a las viscosidades elegidas. */
  cutoff: number;
  /** Cutoff con μw/μo = 0,25 y = 2 (mismo λ y Swirr). */
  band: [number, number];
}

export function relpermRows(samples: readonly MicpSample[], s: MicpSettings, ctx: HeightContext): RelpermRow[] {
  const pcMax = labPcFromHeight(s.columnM, ctx);
  return samples.map((sample) => {
    const swirr = swAtHeightFromCurve(sample.pcPsi, sample.sw, s.columnM, ctx);
    const fit = swirr >= 0 && swirr < 1 && pcMax > 0 ? fitBrooksCorey(sample.pcPsi, sample.sw, { swirr, pcMax }) : null;
    const cut = (muW: number, muO: number) => (fit ? swAtFractionalFlow(fit.lambda, fit.swirr, muW, muO) : NaN);
    const [r0, r1] = VISCOSITY_RATIO_BAND;
    return { sample, swirr, fit, cutoff: cut(s.muWater, s.muHc), band: [cut(r0, 1), cut(r1, 1)] };
  });
}

export const cutoffSummary = (rows: readonly RelpermRow[]): CutoffSummary | null => summarizeCutoffs(rows.map((r) => r.cutoff));

/** Curvas krw, kro y fw contra Sw (de Swirr a 1) de un ajuste. */
export function relpermCurves(fit: BrooksCoreyFit, muWater: number, muHc: number, n = 80): { sw: Float64Array; krw: Float64Array; kro: Float64Array; fw: Float64Array } {
  const sw = Float64Array.from({ length: n }, (_, i) => fit.swirr + ((1 - fit.swirr) * i) / (n - 1));
  return {
    sw,
    krw: Float64Array.from(sw, (v) => krwBrooksCorey(v, fit.lambda, fit.swirr)),
    kro: Float64Array.from(sw, (v) => krnwBrooksCorey(v, fit.lambda, fit.swirr)),
    fw: Float64Array.from(sw, (v) => fractionalFlowWater(v, fit.lambda, fit.swirr, muWater, muHc)),
  };
}

/** Clave del parámetro compartido de cutoff de Sw (módulo «cutoffs»). */
export const SW_CUTOFF_KEY = 'swCutoff';
/** Cutoff de Sw redondeado a 0,01 (el paso del parámetro). */
export const roundCutoff = (v: number) => Math.round(v * 100) / 100;
/** «Usar Sw cutoff = X»: escribe el cutoff de Sw global del módulo de cutoffs (una receta). */
export const applySwCutoff = (project: Project, wellId: string, value: number): Project => setParam(project, wellId, SW_CUTOFF_KEY, roundCutoff(value), null);

// ── 4. CMR ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Ventana (m) alrededor de cada muestra: la profundidad de las muestras tiene ±1 m de incertidumbre. */
export const CMR_WINDOW_M = 1;

export interface CmrRow {
  sample: MicpSample;
  bviOverPhie: number;
  nWindow: number;
  /** Sw de la curva a 100 psi aire–salmuera. */
  swCal: number;
  /** BVI/PHIE ÷ Sw de calibración. */
  ratio: number;
  heightM: number;
}

export function cmrRows(depth: ArrayLike<number>, bvi: ArrayLike<number>, phie: ArrayLike<number>, samples: readonly MicpSample[], ctx: HeightContext, windowM = CMR_WINDOW_M): CmrRow[] {
  const res = cmrBviEquivalentHeights(depth, bvi, phie, samples.map((s) => ({ depthM: s.depthM, pcPsi: s.pcPsi, swFrac: s.sw })), ctx, windowM);
  return samples.map((sample, i) => {
    const r = res[i]!;
    const swCal = swAtCmrCalibration(sample.pcPsi, sample.sw);
    return { sample, bviOverPhie: r.bviOverPhie, nWindow: r.nWindow, swCal, ratio: r.bviOverPhie / swCal, heightM: r.heightM };
  });
}

export interface CmrConclusion {
  cmr: [number, number];
  lab: [number, number];
  ratio: [number, number];
  n: number;
}

/** Rangos de BVI/PHIE, de la Sw de calibración y de su cociente en las muestras con los dos datos. null si ninguna. */
export function cmrConclusion(rows: readonly CmrRow[]): CmrConclusion | null {
  const ok = rows.filter((r) => Number.isFinite(r.ratio));
  if (!ok.length) return null;
  const span = (f: (r: CmrRow) => number): [number, number] => [Math.min(...ok.map(f)), Math.max(...ok.map(f))];
  return { cmr: span((r) => r.bviOverPhie), lab: span((r) => r.swCal), ratio: span((r) => r.ratio), n: ok.length };
}
