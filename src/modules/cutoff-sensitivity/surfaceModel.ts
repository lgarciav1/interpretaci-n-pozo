/**
 * Adaptador puro de la superficie 2D de estabilidad de cutoffs (G09 — docs/decisiones/0093).
 *
 * Sin React, sin stores ni `src/app/`: resuelve curvas activas o medidas del pozo, calcula bajo demanda la grilla 2D
 * por zona o acumulada en `Total`, extrae contornos de Marching Squares y evalúa estabilidad local bivariada.
 */
import type { ClientResult } from '../../core/engine/client';
import type { Interpretation } from '../../core/interpretation';
import { resolveParamsForModule } from '../../core/module';
import { paramScope, paramStorageKey, type NumberParamSpec } from '../../core/params';
import { setParam, type Project } from '../../core/state/project';
import { convert, convertArray, sameDimension, type UnitId } from '../../core/units';
import { layoutZones, sampleThickness, type Well, type ZoneSpan } from '../../core/well';
import { hasPermCutoff, netReservoirFlagK, type Cutoffs } from '../../petro/cutoffs';
import {
  CUTOFF_STABILITY_HALF,
  SURFACE_PAIRS,
  classifyStability2D,
  contourLevelsForRange,
  cutoffSurface2D,
  evalCutoffPairPoint,
  extractContours2D,
  sampleSurface2D,
  stabilityBox2D,
  sweepThresholds,
  type ContourLevel,
  type StabilityAssessment,
  type Surface2D,
  type SurfacePairDef,
  type SurfacePairId,
  type SweepVariable,
} from '../../petro/sensitivity';
import { zoneInPlace, type FluidKind } from '../../petro/volumetrics';
import cutoffSensitivityModule, { SWEEP_GRIDS } from './index';

export type CutoffParamKey = 'vshCutoff' | 'phiCutoff' | 'swCutoff';
export type SurfaceViewMetric = 'netPay' | 'hphiShPay' | 'ooip' | 'ogip';

export const PARAM_BY_VAR: Readonly<Record<SweepVariable, CutoffParamKey>> = {
  vsh: 'vshCutoff',
  phi: 'phiCutoff',
  sw: 'swCutoff',
};

export const VAR_SYMBOL: Readonly<Record<SweepVariable, string>> = {
  vsh: 'Vsh',
  phi: 'φ',
  sw: 'Sw',
};

export const VAR_OP: Readonly<Record<SweepVariable, '≤' | '≥'>> = {
  vsh: '≤',
  phi: '≥',
  sw: '≤',
};

export const VAR_TICKS: Readonly<Record<SweepVariable, readonly number[]>> = {
  vsh: [0, 0.25, 0.5, 0.75, 1],
  phi: [0, 0.1, 0.2, 0.3, 0.4],
  sw: [0, 0.25, 0.5, 0.75, 1],
};

/** 41 puntos reproduce paso 0,01 en φ y 0,025 en Vsh/Sw (múltiplo exacto de las bandas ±0,01 y ±0,05). */
export const DEFAULT_SURFACE_STEPS = 41;

export interface CutoffSurfaceView {
  pair: SurfacePairDef;
  xParam: CutoffParamKey;
  yParam: CutoffParamKey;
  fixedParam: CutoffParamKey;
  metric: SurfaceViewMetric;
  metricLabel: string;
  unit: UnitId;
  /** Cutoffs vigentes de referencia para la vista elegida. */
  xCurrent: number;
  yCurrent: number;
  fixedCurrent: number;
  permCutoff: number | null;
  /** Zonas que sobrescriben el corte cuando la vista es Total. */
  xOverrides: readonly string[];
  yOverrides: readonly string[];
  hasOil: boolean;
  hasGas: boolean;
  xThresholds: Float64Array;
  yThresholds: Float64Array;
  nx: number;
  ny: number;
  /** Valores de la métrica activa en `unit`, en orden fila-mayor `jy * nx + ix`. */
  values: Float64Array;
  minValue: number;
  maxValue: number;
  contours: readonly ContourLevel[];
  stability: StabilityAssessment;
}

export interface BuildSurfaceOptions {
  well: Readonly<Well>;
  interpretation: Readonly<Interpretation>;
  result: ClientResult | null;
  zoneId: string | null;
  pairId: SurfacePairId;
  metric: SurfaceViewMetric;
  fluidPick?: 'ooip' | 'ogip';
  steps?: number;
}

const METRIC_LABELS: Record<SurfaceViewMetric, string> = {
  netPay: 'Neto pay',
  hphiShPay: 'h·φ·Sh pay',
  ooip: 'Petróleo in situ',
  ogip: 'Gas in situ',
};

function convertSafe(data: Float64Array, fromUnit: UnitId | undefined, targetUnit: UnitId): Float64Array {
  if (!fromUnit || fromUnit === targetUnit || !sameDimension(fromUnit, targetUnit)) return data;
  return convertArray(data, fromUnit, targetUnit);
}

/** Resuelve una curva de entrada en la unidad canónica declarada por el módulo (`v/v` o `mD`) siguiendo `inputs` del motor. */
function resolveInputCurve(
  well: Readonly<Well>,
  result: ClientResult | null,
  port: 'VSH' | 'PHIE' | 'SW' | 'PERM',
  inputKey: 'vsh' | 'phi' | 'sw' | 'perm',
  targetUnit: UnitId,
): Float64Array | null {
  const n = well.depth.values.length;
  const current = result?.wellId === well.id ? result : null;
  const csNode = current?.nodes.find((node) => node.moduleId === cutoffSensitivityModule.id);

  const resolveFromRef = (ref: { kind: 'module'; moduleId: string; port?: string } | { kind: 'curve'; curveId: string }): Float64Array | null => {
    if (ref.kind === 'module') {
      const out =
        current!.outputs.find((o) => o.kind === 'curve' && o.port === port && o.moduleId === ref.moduleId) ??
        current!.outputs.find((o) => o.kind === 'curve' && o.port === port && o.active);
      if (out && out.value instanceof Float64Array && out.value.length === n) {
        return convertSafe(out.value, out.unit, targetUnit);
      }
      return null;
    }
    const c = well.curves.find((x) => x.id === ref.curveId && x.data.length === n);
    return c ? convertSafe(c.data, c.unit, targetUnit) : null;
  };

  if (csNode?.status === 'ok' && csNode.inputs && inputKey in csNode.inputs) {
    const chosen = csNode.inputs[inputKey];
    if (chosen === null) return null;
    if (chosen) return resolveFromRef(chosen);
  }

  const src = current?.sources[port];
  if (src) {
    const resolved = resolveFromRef(src);
    if (resolved) return resolved;
  }

  const active = current?.outputs.find((o) => o.kind === 'curve' && o.active && o.port === port);
  if (active && active.value instanceof Float64Array && active.value.length === n) {
    return convertSafe(active.value, active.unit, targetUnit);
  }

  const measured = well.curves.find((x) => x.role === port && x.data.length === n);
  if (measured) return convertSafe(measured.data, measured.unit, targetUnit);
  return null;
}

interface ResolvedZoneParams {
  cutoffs: Cutoffs;
  fluid: FluidKind;
  areaM2: number;
  bo: number;
  bg: number;
}

function toResolvedParams(raw: Record<string, string | number | boolean>): ResolvedZoneParams {
  const vshMax = Number(raw['vshCutoff']);
  const phiMin = Number(raw['phiCutoff']);
  const swMax = Number(raw['swCutoff']);
  const permOn = Boolean(raw['permCutoffOn']);
  const permCutoff = Number(raw['permCutoff']);
  const fluidRaw = String(raw['fluid']);
  const fluid: FluidKind = fluidRaw === 'oil' || fluidRaw === 'gas' ? fluidRaw : 'none';
  return {
    cutoffs: {
      vshMax,
      phiMin,
      swMax,
      ...(permOn && Number.isFinite(permCutoff) ? { permMin: permCutoff } : {}),
    },
    fluid,
    areaM2: Number(raw['area']) * 1e6,
    bo: Number(raw['bo']),
    bg: Number(raw['bg']),
  };
}

function isClassifiedInRange(
  vsh: ArrayLike<number>,
  phi: ArrayLike<number>,
  perm: ArrayLike<number> | undefined,
  c: Cutoffs,
  start: number,
  end: number,
): boolean {
  const kCut = hasPermCutoff(c);
  const permMin = kCut ? c.permMin : NaN;
  for (let i = start; i < end; i++) {
    const kv = perm ? perm[i]! : NaN;
    if (!Number.isNaN(netReservoirFlagK(vsh[i]!, phi[i]!, kv, c.vshMax, c.phiMin, permMin))) return true;
  }
  return false;
}

interface RawMatrices {
  netRes: Float64Array;
  netPay: Float64Array;
  hphiShPay: Float64Array;
  noDataPay: Float64Array;
  ooip: Float64Array;
  ogip: Float64Array;
  hasOil: boolean;
  hasGas: boolean;
}

function finiteMinMax(values: ArrayLike<number>): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return min <= max ? { min, max } : { min: NaN, max: NaN };
}

function zoneVolumeScalar(
  span: Pick<ZoneSpan, 'kind'>,
  zp: ResolvedZoneParams,
  ok: boolean,
  hphiSh: number,
): { ooip: number; ogip: number } {
  if (span.kind === 'seal') return { ooip: 0, ogip: 0 };
  return zoneInPlace(zp.fluid, zp.areaM2, ok ? hphiSh : NaN, zp.bo, zp.bg);
}

/**
 * Construye el modelo completo de vista para la pestaña «Superficie 2D» de `cutoff-sensitivity`.
 * Retorna `null` solo cuando faltan curvas requeridas (`VSH`, `PHIE`, `SW`).
 */
export function buildCutoffSurfaceView(opts: BuildSurfaceOptions): CutoffSurfaceView | null {
  const { well, interpretation, result, zoneId, pairId } = opts;
  const steps = Math.max(11, Math.round(opts.steps ?? DEFAULT_SURFACE_STEPS));
  const vsh = resolveInputCurve(well, result, 'VSH', 'vsh', 'v/v');
  const phi = resolveInputCurve(well, result, 'PHIE', 'phi', 'v/v');
  const sw = resolveInputCurve(well, result, 'SW', 'sw', 'v/v');
  if (!vsh || !phi || !sw) return null;

  const perm = resolveInputCurve(well, result, 'PERM', 'perm', 'mD') ?? undefined;
  const depth = well.depth.values;
  const n = depth.length;
  const thickness = sampleThickness(depth);
  const layout = layoutZones(depth, interpretation.zones);
  const spans = layout.spans;

  const resolved = resolveParamsForModule(
    cutoffSensitivityModule,
    interpretation.params,
    spans.map((z) => z.id),
  );
  const globalParams = toResolvedParams(resolved.global);
  const zoneParams = new Map<string, ResolvedZoneParams>();
  for (const z of spans) zoneParams.set(z.id, toResolvedParams(resolved.byZone.get(z.id) ?? resolved.global));

  const pair = SURFACE_PAIRS.find((p) => p.id === pairId) ?? SURFACE_PAIRS[0]!;
  const xRange = SWEEP_GRIDS[pair.xVar];
  const yRange = SWEEP_GRIDS[pair.yVar];
  const xGrid = { ...xRange, steps };
  const yGrid = { ...yRange, steps };
  const xThresholds = sweepThresholds(xGrid);
  const yThresholds = sweepThresholds(yGrid);
  const nx = xThresholds.length;
  const ny = yThresholds.length;
  const size = nx * ny;

  const xParam = PARAM_BY_VAR[pair.xVar];
  const yParam = PARAM_BY_VAR[pair.yVar];
  const fixedParam = PARAM_BY_VAR[pair.fixedVar];

  const activeZone = zoneId ? (spans.find((z) => z.id === zoneId) ?? null) : null;
  const refCutoffs = activeZone ? zoneParams.get(activeZone.id)!.cutoffs : globalParams.cutoffs;
  const readCut = (c: Cutoffs, v: SweepVariable) => (v === 'vsh' ? c.vshMax : v === 'phi' ? c.phiMin : c.swMax);
  const xCurrent = readCut(refCutoffs, pair.xVar);
  const yCurrent = readCut(refCutoffs, pair.yVar);
  const fixedCurrent = readCut(refCutoffs, pair.fixedVar);
  const permCutoff = hasPermCutoff(refCutoffs) ? refCutoffs.permMin : null;

  const overridesOf = (paramKey: CutoffParamKey): string[] => {
    if (activeZone || spans.length === 0) return [];
    const spec = cutoffSensitivityModule.params[paramKey]!;
    const storage = paramStorageKey(cutoffSensitivityModule.id, paramKey, spec);
    return spans.filter((z) => interpretation.params.zones[z.id]?.[storage] !== undefined).map((z) => z.name);
  };

  let raw: RawMatrices;
  let evalShiftedPoint: (dx: number, dy: number, m: SurfaceViewMetric) => number;
  const clampAxis = (val: number, range: { min: number; max: number }) => (val < range.min ? range.min : val > range.max ? range.max : val);

  if (spans.length === 0) {
    const surf: Surface2D = cutoffSurface2D(vsh, phi, sw, thickness, globalParams.cutoffs, pair.id, xGrid, yGrid, [{ start: 0, end: n }], perm);
    const nanGrid = new Float64Array(size).fill(NaN);
    raw = {
      netRes: surf.netRes,
      netPay: surf.netPay,
      hphiShPay: surf.hphiShPay,
      noDataPay: surf.noDataPay,
      ooip: nanGrid,
      ogip: nanGrid,
      hasOil: false,
      hasGas: false,
    };
    evalShiftedPoint = (dx, dy, m) => {
      if (m === 'ooip' || m === 'ogip') return NaN;
      const xVal = clampAxis(xCurrent + dx, xRange);
      const yVal = clampAxis(yCurrent + dy, yRange);
      return evalCutoffPairPoint(vsh, phi, sw, thickness, globalParams.cutoffs, pair.id, xVal, yVal, [{ start: 0, end: n }], perm)[m];
    };
  } else if (activeZone) {
    const zp = zoneParams.get(activeZone.id)!;
    const seal = activeZone.kind === 'seal';
    const ok = isClassifiedInRange(vsh, phi, perm, zp.cutoffs, activeZone.start, activeZone.end);
    const surf = cutoffSurface2D(vsh, phi, sw, thickness, zp.cutoffs, pair.id, xGrid, yGrid, [{ start: activeZone.start, end: activeZone.end }], perm);
    const netRes = new Float64Array(size);
    const netPay = new Float64Array(size);
    const hphiShPay = new Float64Array(size);
    const noDataPay = new Float64Array(size);
    const ooip = new Float64Array(size);
    const ogip = new Float64Array(size);
    let hasOil = false;
    let hasGas = false;

    for (let k = 0; k < size; k++) {
      const vol = zoneVolumeScalar(activeZone, zp, ok, surf.hphiShPay[k]!);
      ooip[k] = vol.ooip;
      ogip[k] = vol.ogip;
      if (Number.isFinite(vol.ooip) && vol.ooip > 0) hasOil = true;
      if (Number.isFinite(vol.ogip) && vol.ogip > 0) hasGas = true;
      if (!ok) {
        netRes[k] = NaN;
        netPay[k] = NaN;
        hphiShPay[k] = NaN;
        noDataPay[k] = NaN;
      } else {
        netRes[k] = surf.netRes[k]!;
        netPay[k] = surf.netPay[k]!;
        hphiShPay[k] = surf.hphiShPay[k]!;
        noDataPay[k] = surf.noDataPay[k]!;
      }
    }
    raw = { netRes, netPay, hphiShPay, noDataPay, ooip, ogip, hasOil, hasGas };
    evalShiftedPoint = (dx, dy, m) => {
      if (!ok) {
        if (m === 'ooip' || m === 'ogip') return seal ? 0 : NaN;
        return NaN;
      }
      const xVal = clampAxis(xCurrent + dx, xRange);
      const yVal = clampAxis(yCurrent + dy, yRange);
      const pt = evalCutoffPairPoint(vsh, phi, sw, thickness, zp.cutoffs, pair.id, xVal, yVal, [{ start: activeZone.start, end: activeZone.end }], perm);
      if (m === 'netPay' || m === 'hphiShPay') return pt[m];
      const vol = zoneVolumeScalar(activeZone, zp, ok, pt.hphiShPay);
      return m === 'ooip' ? vol.ooip : vol.ogip;
    };
  } else {
    // Vista Total: suma zonas exactamente con la lógica `Acc` de `cutoff-sensitivity/index.ts`.
    const zoneSurfs = spans.map((z) => {
      const zp = zoneParams.get(z.id)!;
      const ok = isClassifiedInRange(vsh, phi, perm, zp.cutoffs, z.start, z.end);
      const surf = cutoffSurface2D(vsh, phi, sw, thickness, zp.cutoffs, pair.id, xGrid, yGrid, [{ start: z.start, end: z.end }], perm);
      return { z, zp, ok, surf };
    });

    const netRes = new Float64Array(size);
    const netPay = new Float64Array(size);
    const hphiShPay = new Float64Array(size);
    const noDataPay = new Float64Array(size);
    const ooip = new Float64Array(size);
    const ogip = new Float64Array(size);
    let hasOil = false;
    let hasGas = false;

    for (let k = 0; k < size; k++) {
      let accRes = 0;
      let accPay = 0;
      let accUnk = 0;
      let accHp = 0;
      let accOoip = 0;
      let accOgip = 0;
      let ooipN = 0;
      let ogipN = 0;
      let anyClassified = false;
      let anyUnknown = false;
      let anyKnown = false;

      for (const { z, zp, ok, surf } of zoneSurfs) {
        const vol = zoneVolumeScalar(z, zp, ok, surf.hphiShPay[k]!);
        if (Number.isFinite(vol.ooip)) { accOoip += vol.ooip; ooipN++; }
        if (Number.isFinite(vol.ogip)) { accOgip += vol.ogip; ogipN++; }
        if (!ok) continue;
        anyClassified = true;
        const r = surf.netRes[k]!;
        const pa = surf.netPay[k]!;
        const hp = surf.hphiShPay[k]!;
        const un = surf.noDataPay[k]!;
        accRes += r;
        accUnk += un;
        if (Number.isNaN(pa)) anyUnknown = true;
        else {
          accPay += pa;
          accHp += hp;
          if (r > 0) anyKnown = true;
        }
      }

      const ooipVal = ooipN > 0 ? accOoip : NaN;
      const ogipVal = ogipN > 0 ? accOgip : NaN;
      ooip[k] = ooipVal;
      ogip[k] = ogipVal;
      if (Number.isFinite(ooipVal) && ooipVal > 0) hasOil = true;
      if (Number.isFinite(ogipVal) && ogipVal > 0) hasGas = true;

      if (!anyClassified) {
        netRes[k] = NaN;
        netPay[k] = NaN;
        hphiShPay[k] = NaN;
        noDataPay[k] = NaN;
      } else {
        const unknown = anyUnknown && !anyKnown;
        netRes[k] = accRes;
        netPay[k] = unknown ? NaN : accPay;
        hphiShPay[k] = unknown ? NaN : accHp;
        noDataPay[k] = accUnk;
      }
    }
    raw = { netRes, netPay, hphiShPay, noDataPay, ooip, ogip, hasOil, hasGas };
    evalShiftedPoint = (dx, dy, m) => {
      let accPay = 0;
      let accHp = 0;
      let accOoip = 0;
      let accOgip = 0;
      let ooipN = 0;
      let ogipN = 0;
      let anyClassified = false;
      let anyUnknown = false;
      let anyKnown = false;

      for (const { z, zp, ok } of zoneSurfs) {
        const xZone = clampAxis(readCut(zp.cutoffs, pair.xVar) + dx, xRange);
        const yZone = clampAxis(readCut(zp.cutoffs, pair.yVar) + dy, yRange);
        const pt = ok
          ? evalCutoffPairPoint(vsh, phi, sw, thickness, zp.cutoffs, pair.id, xZone, yZone, [{ start: z.start, end: z.end }], perm)
          : { netRes: NaN, netPay: NaN, hphiShPay: NaN, noDataPay: NaN };
        const vol = zoneVolumeScalar(z, zp, ok, pt.hphiShPay);
        if (Number.isFinite(vol.ooip)) { accOoip += vol.ooip; ooipN++; }
        if (Number.isFinite(vol.ogip)) { accOgip += vol.ogip; ogipN++; }
        if (!ok) continue;
        anyClassified = true;
        if (Number.isNaN(pt.netPay)) anyUnknown = true;
        else {
          accPay += pt.netPay;
          accHp += pt.hphiShPay;
          if (pt.netRes > 0) anyKnown = true;
        }
      }
      if (m === 'ooip') return ooipN > 0 ? accOoip : NaN;
      if (m === 'ogip') return ogipN > 0 ? accOgip : NaN;
      if (!anyClassified) return NaN;
      const unknown = anyUnknown && !anyKnown;
      if (unknown) return NaN;
      return m === 'netPay' ? accPay : accHp;
    };
  }

  // Resolver métrica activa según disponibilidad real de petróleo/gas en la vista actual.
  let activeMetric = opts.metric;
  if (activeMetric === 'ooip' && !raw.hasOil) activeMetric = raw.hasGas && opts.fluidPick === 'ogip' ? 'ogip' : 'netPay';
  else if (activeMetric === 'ogip' && !raw.hasGas) activeMetric = raw.hasOil && opts.fluidPick === 'ooip' ? 'ooip' : 'netPay';

  const rawValues = raw[activeMetric];
  let unit: UnitId = 'm';
  let values: Float64Array;
  if (activeMetric === 'ooip' || activeMetric === 'ogip') {
    const rawRange = finiteMinMax(rawValues);
    const maxRaw = Number.isFinite(rawRange.max) ? rawRange.max : 0;
    unit = activeMetric === 'ooip' && maxRaw < 1e6 ? 'Mm3' : 'MMm3';
    values = new Float64Array(size);
    for (let k = 0; k < size; k++) {
      const v = rawValues[k]!;
      values[k] = Number.isFinite(v) ? convert(v, 'm3', unit) : NaN;
    }
  } else {
    values = rawValues;
  }

  const { min: minValue, max: maxValue } = finiteMinMax(values);
  const levels = contourLevelsForRange(minValue, maxValue, 5);
  const gridMeta = { xThresholds, yThresholds, nx, ny };
  const contours = extractContours2D(gridMeta, values, levels);

  const box = stabilityBox2D(pair, xCurrent, yCurrent, xRange, yRange);
  const hx = CUTOFF_STABILITY_HALF[pair.xVar];
  const hy = CUTOFF_STABILITY_HALF[pair.yVar];
  const toUnit = (v: number) => (!Number.isFinite(v) ? NaN : unit === 'm' ? v : convert(v, 'm3', unit));
  const cVal = toUnit(evalShiftedPoint(0, 0, activeMetric));
  const corners = [
    toUnit(evalShiftedPoint(-hx, -hy, activeMetric)),
    toUnit(evalShiftedPoint(hx, -hy, activeMetric)),
    toUnit(evalShiftedPoint(-hx, hy, activeMetric)),
    toUnit(evalShiftedPoint(hx, hy, activeMetric)),
  ];
  const stability = classifyStability2D(cVal, corners, box);

  return {
    pair,
    xParam,
    yParam,
    fixedParam,
    metric: activeMetric,
    metricLabel: METRIC_LABELS[activeMetric],
    unit,
    xCurrent,
    yCurrent,
    fixedCurrent,
    permCutoff,
    xOverrides: overridesOf(xParam),
    yOverrides: overridesOf(yParam),
    hasOil: raw.hasOil,
    hasGas: raw.hasGas,
    xThresholds,
    yThresholds,
    nx,
    ny,
    values,
    minValue,
    maxValue,
    contours,
    stability,
  };
}

/** Reexporta muestreo bilineal sobre una vista 2D ya calculada (tooltip / cursor). */
export function sampleViewSurface2D(view: Pick<CutoffSurfaceView, 'xThresholds' | 'yThresholds' | 'nx' | 'ny' | 'values'>, x: number, y: number): number {
  return sampleSurface2D(view, view.values, x, y);
}

/** Parámetros disponibles de métrica para el selector del panel según volúmenes presentes. */
export function availableSurfaceMetrics(hasOil: boolean, hasGas: boolean): { value: SurfaceViewMetric; label: string }[] {
  const opts: { value: SurfaceViewMetric; label: string }[] = [
    { value: 'netPay', label: 'Neto pay' },
    { value: 'hphiShPay', label: 'h·φ·Sh' },
  ];
  if (hasOil) opts.push({ value: 'ooip', label: 'Petróleo' });
  if (hasGas) opts.push({ value: 'ogip', label: 'Gas' });
  return opts;
}

/**
 * Receta pura e inmutable para fijar simultáneamente uno o dos cutoffs en `Project` dentro de una única
 * entrada de historial (`Ctrl+Z` atómico).
 */
export function setCutoffPairRecipe(
  project: Project,
  wellId: string,
  zoneId: string | null,
  updates: readonly { key: CutoffParamKey; value: number }[],
): Project {
  let next = project;
  for (const u of updates) {
    const spec = cutoffSensitivityModule.params[u.key] as NumberParamSpec;
    const storage = paramStorageKey(cutoffSensitivityModule.id, u.key, spec);
    const scope = zoneId && paramScope(spec) === 'zone' ? zoneId : null;
    next = setParam(next, wellId, storage, u.value, scope);
  }
  return next;
}

export interface CutoffScenarioResult {
  baseline: {
    cutoffs: Cutoffs;
    netRes: number;
    netPay: number;
    hphiShPay: number;
    noDataPay: number;
    ooipMm3: number;
    ogipMMm3: number;
  };
  proposed: {
    cutoffs: Cutoffs;
    netRes: number;
    netPay: number;
    hphiShPay: number;
    noDataPay: number;
    ooipMm3: number;
    ogipMMm3: number;
  };
  hasOil: boolean;
  hasGas: boolean;
  /** Estabilidad 2D alrededor del escenario propuesto (par `phi-sw` o el par que incluye la variable movida). */
  stability: StabilityAssessment;
  stabilityPairId: SurfacePairId;
  /** En ámbito Total, nombres de las zonas que ya sobrescriben cada cutoff y mantienen su valor propio. */
  overriddenZones: { vsh: string[]; phi: string[]; sw: string[] };
}

/**
 * Simula exactamente 1 o 2 (o hasta 3) cambios de cutoffs sin construir una grilla 2D completa, compartiendo las
 * mismas curvas, parámetros de zona, corte opcional de k y volúmenes que `buildCutoffSurfaceView`.
 */
export function evaluateCutoffScenario(opts: {
  well: Readonly<Well>;
  interpretation: Readonly<Interpretation>;
  result: ClientResult | null;
  zoneId: string | null;
  changes: Partial<Record<SweepVariable, number>>;
}): CutoffScenarioResult | null {
  const { well, interpretation, result, zoneId, changes } = opts;
  const vsh = resolveInputCurve(well, result, 'VSH', 'vsh', 'v/v');
  const phi = resolveInputCurve(well, result, 'PHIE', 'phi', 'v/v');
  const sw = resolveInputCurve(well, result, 'SW', 'sw', 'v/v');
  if (!vsh || !phi || !sw) return null;

  const perm = resolveInputCurve(well, result, 'PERM', 'perm', 'mD') ?? undefined;
  const depth = well.depth.values;
  const n = depth.length;
  const thickness = sampleThickness(depth);
  const layout = layoutZones(depth, interpretation.zones);
  const spans = layout.spans;

  const resolved = resolveParamsForModule(
    cutoffSensitivityModule,
    interpretation.params,
    spans.map((z) => z.id),
  );
  const globalParams = toResolvedParams(resolved.global);
  const activeZone = zoneId ? (spans.find((z) => z.id === zoneId) ?? null) : null;
  if (zoneId && !activeZone) return null;

  const hasZoneOverride = (zId: string, paramKey: CutoffParamKey): boolean => {
    const spec = cutoffSensitivityModule.params[paramKey]!;
    const storage = paramStorageKey(cutoffSensitivityModule.id, paramKey, spec);
    return interpretation.params.zones[zId]?.[storage] !== undefined;
  };
  const overridesOf = (paramKey: CutoffParamKey): string[] =>
    activeZone || spans.length === 0 ? [] : spans.filter((z) => hasZoneOverride(z.id, paramKey)).map((z) => z.name);
  const overriddenZones = {
    vsh: overridesOf('vshCutoff'),
    phi: overridesOf('phiCutoff'),
    sw: overridesOf('swCutoff'),
  };

  const applyChangesFor = (zId: string | null, base: Cutoffs): Cutoffs => ({
    ...base,
    ...(changes.vsh !== undefined && (!zId || !hasZoneOverride(zId, 'vshCutoff')) ? { vshMax: changes.vsh } : {}),
    ...(changes.phi !== undefined && (!zId || !hasZoneOverride(zId, 'phiCutoff')) ? { phiMin: changes.phi } : {}),
    ...(changes.sw !== undefined && (!zId || !hasZoneOverride(zId, 'swCutoff')) ? { swMax: changes.sw } : {}),
  });

  const evalForCutoffs = (span: Pick<ZoneSpan, 'start' | 'end'>, c: Cutoffs) => {
    const ok = isClassifiedInRange(vsh, phi, perm, c, span.start, span.end);
    if (!ok) return { ok: false, netRes: NaN, netPay: NaN, hphiShPay: NaN, noDataPay: NaN };
    const pt = evalCutoffPairPoint(vsh, phi, sw, thickness, c, 'phi-sw', c.phiMin, c.swMax, [span], perm);
    return { ok: true, ...pt };
  };

  let baseNetRes = 0;
  let baseNetPay = 0;
  let baseHphi = 0;
  let baseNoData = 0;
  let propNetRes = 0;
  let propNetPay = 0;
  let propHphi = 0;
  let propNoData = 0;
  let baseOoip = NaN;
  let baseOgip = NaN;
  let propOoip = NaN;
  let propOgip = NaN;
  let hasOil = false;
  let hasGas = false;

  const refCutoffs = activeZone ? toResolvedParams(resolved.byZone.get(activeZone.id) ?? resolved.global).cutoffs : globalParams.cutoffs;
  const proposedRefCutoffs = applyChangesFor(null, refCutoffs);

  if (spans.length === 0) {
    const b = evalForCutoffs({ start: 0, end: n }, refCutoffs);
    const p = evalForCutoffs({ start: 0, end: n }, proposedRefCutoffs);
    baseNetRes = b.netRes;
    baseNetPay = b.netPay;
    baseHphi = b.hphiShPay;
    baseNoData = b.noDataPay;
    propNetRes = p.netRes;
    propNetPay = p.netPay;
    propHphi = p.hphiShPay;
    propNoData = p.noDataPay;
  } else if (activeZone) {
    const zp = toResolvedParams(resolved.byZone.get(activeZone.id) ?? resolved.global);
    const b = evalForCutoffs(activeZone, zp.cutoffs);
    const p = evalForCutoffs(activeZone, proposedRefCutoffs);
    baseNetRes = b.netRes;
    baseNetPay = b.netPay;
    baseHphi = b.hphiShPay;
    baseNoData = b.noDataPay;
    propNetRes = p.netRes;
    propNetPay = p.netPay;
    propHphi = p.hphiShPay;
    propNoData = p.noDataPay;
    const vb = zoneVolumeScalar(activeZone, zp, b.ok, b.hphiShPay);
    const vp = zoneVolumeScalar(activeZone, zp, p.ok, p.hphiShPay);
    baseOoip = vb.ooip;
    baseOgip = vb.ogip;
    propOoip = vp.ooip;
    propOgip = vp.ogip;
    if ((Number.isFinite(vb.ooip) && vb.ooip > 0) || (Number.isFinite(vp.ooip) && vp.ooip > 0)) hasOil = true;
    if ((Number.isFinite(vb.ogip) && vb.ogip > 0) || (Number.isFinite(vp.ogip) && vp.ogip > 0)) hasGas = true;
  } else {
    const agg = (useProposed: boolean) => {
      let accRes = 0;
      let accPay = 0;
      let accHp = 0;
      let accUnk = 0;
      let accOoip = 0;
      let accOgip = 0;
      let ooipN = 0;
      let ogipN = 0;
      let anyClassified = false;
      let anyUnknown = false;
      let anyKnown = false;
      for (const z of spans) {
        const zp = toResolvedParams(resolved.byZone.get(z.id) ?? resolved.global);
        const c = useProposed ? applyChangesFor(z.id, zp.cutoffs) : zp.cutoffs;
        const r = evalForCutoffs(z, c);
        const vol = zoneVolumeScalar(z, zp, r.ok, r.hphiShPay);
        if (Number.isFinite(vol.ooip)) { accOoip += vol.ooip; ooipN++; }
        if (Number.isFinite(vol.ogip)) { accOgip += vol.ogip; ogipN++; }
        if (!r.ok) continue;
        anyClassified = true;
        accRes += r.netRes;
        accUnk += r.noDataPay;
        if (Number.isNaN(r.netPay)) anyUnknown = true;
        else {
          accPay += r.netPay;
          accHp += r.hphiShPay;
          if (r.netRes > 0) anyKnown = true;
        }
      }
      const unknown = anyUnknown && !anyKnown;
      return {
        netRes: anyClassified ? accRes : NaN,
        netPay: !anyClassified || unknown ? NaN : accPay,
        hphiShPay: !anyClassified || unknown ? NaN : accHp,
        noDataPay: anyClassified ? accUnk : NaN,
        ooip: ooipN > 0 ? accOoip : NaN,
        ogip: ogipN > 0 ? accOgip : NaN,
      };
    };
    const b = agg(false);
    const p = agg(true);
    baseNetRes = b.netRes;
    baseNetPay = b.netPay;
    baseHphi = b.hphiShPay;
    baseNoData = b.noDataPay;
    baseOoip = b.ooip;
    baseOgip = b.ogip;
    propNetRes = p.netRes;
    propNetPay = p.netPay;
    propHphi = p.hphiShPay;
    propNoData = p.noDataPay;
    propOoip = p.ooip;
    propOgip = p.ogip;
    if ((Number.isFinite(b.ooip) && b.ooip > 0) || (Number.isFinite(p.ooip) && p.ooip > 0)) hasOil = true;
    if ((Number.isFinite(b.ogip) && b.ogip > 0) || (Number.isFinite(p.ogip) && p.ogip > 0)) hasGas = true;
  }

  // Par de estabilidad 2D: phi-sw por defecto; si se movió vsh + sw -> vsh-sw; si vsh sin sw -> vsh-phi.
  const hasVsh = changes.vsh !== undefined;
  const hasSw = changes.sw !== undefined;
  const stabilityPairId: SurfacePairId = hasVsh && hasSw ? 'vsh-sw' : hasVsh && !hasSw ? 'vsh-phi' : 'phi-sw';
  const sPair = SURFACE_PAIRS.find((p) => p.id === stabilityPairId)!;
  const xRange = SWEEP_GRIDS[sPair.xVar];
  const yRange = SWEEP_GRIDS[sPair.yVar];
  const readCut = (c: Cutoffs, v: SweepVariable) => (v === 'vsh' ? c.vshMax : v === 'phi' ? c.phiMin : c.swMax);
  const clampAxis = (val: number, range: { min: number; max: number }) => (val < range.min ? range.min : val > range.max ? range.max : val);
  const x0 = clampAxis(readCut(proposedRefCutoffs, sPair.xVar), xRange);
  const y0 = clampAxis(readCut(proposedRefCutoffs, sPair.yVar), yRange);
  const box = stabilityBox2D(sPair, x0, y0, xRange, yRange);
  const hx = CUTOFF_STABILITY_HALF[sPair.xVar];
  const hy = CUTOFF_STABILITY_HALF[sPair.yVar];

  const evalCornerDelta = (dx: number, dy: number): number => {
    const evalZone = (z: ZoneSpan, cBase: Cutoffs, zId: string | null) => {
      const cChanged = applyChangesFor(zId, cBase);
      const xVal = clampAxis(readCut(cChanged, sPair.xVar) + dx, xRange);
      const yVal = clampAxis(readCut(cChanged, sPair.yVar) + dy, yRange);
      const cCorner: Cutoffs = { ...cChanged };
      if (sPair.xVar === 'vsh') cCorner.vshMax = xVal;
      else if (sPair.xVar === 'phi') cCorner.phiMin = xVal;
      else cCorner.swMax = xVal;
      if (sPair.yVar === 'vsh') cCorner.vshMax = yVal;
      else if (sPair.yVar === 'phi') cCorner.phiMin = yVal;
      else cCorner.swMax = yVal;
      return evalForCutoffs(z, cCorner);
    };
    if (spans.length === 0) return evalZone({ id: '', name: 'Pozo', kind: 'reservoir', top: depth[0]!, base: depth[n - 1]!, start: 0, end: n }, globalParams.cutoffs, null).netPay;
    if (activeZone) {
      const zp = toResolvedParams(resolved.byZone.get(activeZone.id) ?? resolved.global);
      return evalZone(activeZone, zp.cutoffs, null).netPay;
    }
    let accPay = 0;
    let anyClassified = false;
    let anyUnknown = false;
    let anyKnown = false;
    for (const z of spans) {
      const zp = toResolvedParams(resolved.byZone.get(z.id) ?? resolved.global);
      const r = evalZone(z, zp.cutoffs, z.id);
      if (!r.ok) continue;
      anyClassified = true;
      if (Number.isNaN(r.netPay)) anyUnknown = true;
      else {
        accPay += r.netPay;
        if (r.netRes > 0) anyKnown = true;
      }
    }
    return !anyClassified || (anyUnknown && !anyKnown) ? NaN : accPay;
  };

  const stability = classifyStability2D(
    propNetPay,
    [evalCornerDelta(-hx, -hy), evalCornerDelta(hx, -hy), evalCornerDelta(-hx, hy), evalCornerDelta(hx, hy)],
    box,
  );

  return {
    baseline: {
      cutoffs: refCutoffs,
      netRes: baseNetRes,
      netPay: baseNetPay,
      hphiShPay: baseHphi,
      noDataPay: baseNoData,
      ooipMm3: Number.isFinite(baseOoip) ? convert(baseOoip, 'm3', 'Mm3') : NaN,
      ogipMMm3: Number.isFinite(baseOgip) ? convert(baseOgip, 'm3', 'MMm3') : NaN,
    },
    proposed: {
      cutoffs: proposedRefCutoffs,
      netRes: propNetRes,
      netPay: propNetPay,
      hphiShPay: propHphi,
      noDataPay: propNoData,
      ooipMm3: Number.isFinite(propOoip) ? convert(propOoip, 'm3', 'Mm3') : NaN,
      ogipMMm3: Number.isFinite(propOgip) ? convert(propOgip, 'm3', 'MMm3') : NaN,
    },
    hasOil,
    hasGas,
    stability,
    stabilityPairId,
    overriddenZones,
  };
}

export { isClassifiedInRange as _isClassifiedInRange };
