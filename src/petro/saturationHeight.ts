import { fitTrend } from './regression';
import { brooksCoreySw } from './rockTyping';

const GRAVITY_M_PER_S2 = 9.80665;

type Range = readonly [number, number];

export interface PressureTest {
  id: string;
  depthM: number;
  pressurePa: number;
}

export interface VerticalPressureFit {
  gradientPaPerM: number;
  densityKgPerM3: number;
  centerM: number;
  pressureAtCenterPa: number;
  rmsePa: number;
  r2: number;
  n: number;
  rangeM: Range;
  residualsPa: readonly number[];
}

export interface PressurePair {
  ok: true;
  water: VerticalPressureFit;
  hydrocarbon: VerticalPressureFit;
  classicFwlM: number;
  deltaGradientPaPerM: number;
  fwlSensitivityM: Range;
  deltaGradientSensitivityPaPerM: Range;
}

interface Failure {
  ok: false;
  reason: string;
}

export type PressurePairResult = PressurePair | Failure;

function validRange([lower, upper]: Range): boolean {
  return Number.isFinite(lower) && Number.isFinite(upper) && lower < upper;
}

function inRange(value: number, [lower, upper]: Range): boolean {
  return Number.isFinite(value) && value >= lower && value <= upper;
}

function preparePressureFit(
  points: readonly PressureTest[],
  centerM: number,
  referencePressurePa: number,
) {
  const depths = points.map((point) => point.depthM - centerM);
  const pressures = points.map((point) => point.pressurePa - referencePressurePa);

  function fit(excludedIndex = -1) {
    return fitTrend(depths, pressures, 'linear', { exclude: (i) => i === excludedIndex });
  }

  function evidence(result: NonNullable<ReturnType<typeof fit>>): VerticalPressureFit {
    return {
      gradientPaPerM: result.b,
      densityKgPerM3: result.b / GRAVITY_M_PER_S2,
      centerM,
      pressureAtCenterPa: result.a + referencePressurePa,
      rmsePa: result.rmse,
      r2: result.r2,
      n: result.n,
      rangeM: [result.xMin + centerM, result.xMax + centerM],
      residualsPa: pressures.map((pressure, i) => pressure - (result.a + result.b * depths[i]!)),
    };
  }

  return { fit, evidence };
}

type Line = { a: number; b: number };

function intersect(water: Line | null, hydrocarbon: Line | null, centerM: number, interval: Range) {
  if (!water || !hydrocarbon || !(hydrocarbon.b > 0 && water.b > hydrocarbon.b)) return null;
  const delta = water.b - hydrocarbon.b;
  const fwl = centerM + (hydrocarbon.a - water.a) / delta;
  return inRange(fwl, interval) ? { delta, fwl } : null;
}

/** Ajuste de dos gradientes en TVD y sensibilidad al retirar una prueba a la vez. */
export function fitPressurePair(
  water: readonly PressureTest[],
  hydrocarbon: readonly PressureTest[],
  interval: Range,
): PressurePairResult {
  if (!validRange(interval)) return { ok: false, reason: 'Intervalo vertical de admisión inválido.' };
  const points = [...water, ...hydrocarbon];
  if (points.some(({ id, depthM, pressurePa }) => !id.trim() || !Number.isFinite(depthM) || !Number.isFinite(pressurePa))) {
    return { ok: false, reason: 'Cada prueba MDT debe tener identificador, TVD y presión finita.' };
  }
  if (new Set(points.map(({ id }) => id)).size !== points.length) {
    return { ok: false, reason: 'Una prueba MDT no puede repetirse ni asignarse a ambas fases.' };
  }
  if ([water, hydrocarbon].some((phase) => new Set(phase.map(({ depthM }) => depthM)).size < 3)) {
    return { ok: false, reason: 'Cada fase requiere al menos tres profundidades verticales distintas.' };
  }

  const centerM = interval[0] / 2 + interval[1] / 2;
  const referencePressurePa = water[0]!.pressurePa;
  const waterFit = preparePressureFit(water, centerM, referencePressurePa);
  const hydrocarbonFit = preparePressureFit(hydrocarbon, centerM, referencePressurePa);
  const waterLine = waterFit.fit();
  const hydrocarbonLine = hydrocarbonFit.fit();
  const baseline = intersect(waterLine, hydrocarbonLine, centerM, interval);
  if (!waterLine || !hydrocarbonLine || !baseline) {
    return { ok: false, reason: 'Pendientes MDT no físicas o FWL fuera del intervalo admitido.' };
  }

  const fwlSensitivityM: [number, number] = [baseline.fwl, baseline.fwl];
  const deltaGradientSensitivityPaPerM: [number, number] = [baseline.delta, baseline.delta];
  for (const [i, point] of points.entries()) {
    const result = i < water.length
      ? intersect(waterFit.fit(i), hydrocarbonLine, centerM, interval)
      : intersect(waterLine, hydrocarbonFit.fit(i - water.length), centerM, interval);
    if (!result) {
      return { ok: false, reason: `Al retirar la prueba MDT «${point.id}», el par de pendientes o el FWL queda fuera de dominio.` };
    }
    fwlSensitivityM[0] = Math.min(fwlSensitivityM[0], result.fwl);
    fwlSensitivityM[1] = Math.max(fwlSensitivityM[1], result.fwl);
    deltaGradientSensitivityPaPerM[0] = Math.min(deltaGradientSensitivityPaPerM[0], result.delta);
    deltaGradientSensitivityPaPerM[1] = Math.max(deltaGradientSensitivityPaPerM[1], result.delta);
  }
  return {
    ok: true,
    water: waterFit.evidence(waterLine),
    hydrocarbon: hydrocarbonFit.evidence(hydrocarbonLine),
    classicFwlM: baseline.fwl,
    deltaGradientPaPerM: baseline.delta,
    fwlSensitivityM,
    deltaGradientSensitivityPaPerM,
  };
}

export function compareExternalFwl(
  pair: PressurePair,
  externalFwlM: number,
  tolerancePa: number,
): { ok: true; residualPa: number } | (Failure & { residualPa?: number }) {
  if (!Number.isFinite(externalFwlM) || !Number.isFinite(tolerancePa) || tolerancePa < 0) {
    return { ok: false, reason: 'El FWL externo y su tolerancia de presión deben ser válidos.' };
  }
  // El signo coincide con P_hc menos P_w en las rectas originales.
  const residualPa = pair.deltaGradientPaPerM * (pair.classicFwlM - externalFwlM);
  if (!Number.isFinite(residualPa)) return { ok: false, reason: 'La diferencia de presión no es finita.' };
  if (Math.abs(residualPa) > tolerancePa) {
    return { ok: false, reason: 'El FWL externo contradice las rectas MDT dentro de la tolerancia declarada.', residualPa };
  }
  return { ok: true, residualPa };
}

export function heightAboveFwl(depthM: number, fwlM: number): number | null {
  const heightM = fwlM - depthM;
  return Number.isFinite(heightM) ? heightM : null;
}

export interface CapillarySystem {
  tensionNPerM: number;
  angleDeg: number;
  angleUncertaintyDeg: number;
}

interface RockGeometry {
  permeabilityMd: number;
  porosity: number;
}

function angularScale(system: CapillarySystem) {
  const { tensionNPerM, angleDeg, angleUncertaintyDeg } = system;
  if (
    !Number.isFinite(tensionNPerM) || tensionNPerM <= 0 ||
    !Number.isFinite(angleDeg) || angleDeg < 0 || angleDeg > 180 ||
    !Number.isFinite(angleUncertaintyDeg) || angleUncertaintyDeg <= 0
  ) return null;
  // En los extremos físicos de la escala angular, acotar el alcance de la incertidumbre a [0°, 180°].
  const lowerAngle = Math.max(0, angleDeg - angleUncertaintyDeg);
  const upperAngle = Math.min(180, angleDeg + angleUncertaintyDeg);
  if (lowerAngle <= 90 && upperAngle >= 90) return null;
  const scale = (deg: number) => tensionNPerM * Math.abs(Math.cos(deg * Math.PI / 180));
  return {
    nominal: scale(angleDeg),
    min: Math.min(scale(lowerAngle), scale(upperAngle)),
    max: Math.max(scale(lowerAngle), scale(upperAngle)),
  };
}

function poreGeometryScale({ permeabilityMd, porosity }: RockGeometry): number {
  if (!Number.isFinite(permeabilityMd) || permeabilityMd <= 0 ||
      !Number.isFinite(porosity) || porosity <= 0 || porosity > 1) return NaN;
  return Math.sqrt(permeabilityMd / porosity);
}

/** Factor de presión por similitud capilar y, si se declara la geometría, por transferencia J. */
export function capillaryTransferFactor(
  source: CapillarySystem,
  destination: CapillarySystem,
  maxRelativeUncertainty: number,
  geometry?: { source: RockGeometry; destination: RockGeometry },
): { ok: true; factor: number; relativeUncertainty: number } | Failure {
  const from = angularScale(source);
  const to = angularScale(destination);
  if (!from || !to) {
    return { ok: false, reason: 'Tensión o evidencia angular inválida, o intervalo angular que alcanza 90°.' };
  }
  if (!Number.isFinite(maxRelativeUncertainty) || maxRelativeUncertainty < 0) {
    return { ok: false, reason: 'El máximo de incertidumbre relativa debe estar declarado y ser válido.' };
  }
  const nominal = to.nominal / from.nominal;
  const relativeUncertainty = Math.max(
    1 - (to.min / from.max) / nominal,
    (to.max / from.min) / nominal - 1,
  );
  if (!Number.isFinite(relativeUncertainty) || relativeUncertainty > maxRelativeUncertainty) {
    return { ok: false, reason: 'La incertidumbre del factor supera el máximo declarado.' };
  }
  const geometryFactor = geometry
    ? poreGeometryScale(geometry.source) / poreGeometryScale(geometry.destination)
    : 1;
  const factor = nominal * geometryFactor;
  if (!Number.isFinite(factor) || factor <= 0) {
    return { ok: false, reason: 'Geometría poral o factor de transferencia capilar inválido.' };
  }
  return { ok: true, factor, relativeUncertainty };
}

export interface CapillaryPoint {
  pressurePa: number;
  sw: number;
}

export type CapillaryModel =
  | {
      kind: 'brooks-corey';
      entryPressurePa: number;
      lambda: number;
      irreducibleSw: number;
      rangePa: Range;
      entryPlateau: boolean;
    }
  | { kind: 'table'; points: readonly CapillaryPoint[] };

export function validateCapillaryModel(model: CapillaryModel): boolean {
  if (model.kind === 'brooks-corey') {
    return Number.isFinite(model.entryPressurePa) && model.entryPressurePa > 0 &&
      Number.isFinite(model.lambda) && model.lambda > 0 &&
      Number.isFinite(model.irreducibleSw) && model.irreducibleSw >= 0 && model.irreducibleSw < 1 &&
      typeof model.entryPlateau === 'boolean' && Array.isArray(model.rangePa) && model.rangePa.length === 2 &&
      validRange(model.rangePa) && model.rangePa[0] >= 0 &&
      (model.entryPlateau || model.rangePa[1] > model.entryPressurePa);
  }

  return model.points.length >= 2 && model.points.every(({ pressurePa, sw }, i, points) => {
    const previous = points[i - 1];
    return Number.isFinite(pressurePa) && pressurePa >= 0 && sw >= 0 && sw <= 1 &&
      (!previous || (previous.pressurePa < pressurePa && previous.sw >= sw));
  });
}

/** Aplica la escala una sola vez a todas las presiones, incluida la entrada y el dominio. */
export function transferCapillaryModel(model: CapillaryModel, factor: number): CapillaryModel | null {
  if (!Number.isFinite(factor) || factor <= 0 || !validateCapillaryModel(model)) return null;
  const scaled: CapillaryModel = model.kind === 'brooks-corey'
    ? {
        ...model,
        entryPressurePa: model.entryPressurePa * factor,
        rangePa: [model.rangePa[0] * factor, model.rangePa[1] * factor],
      }
    : { kind: 'table', points: model.points.map((point) => ({ ...point, pressurePa: point.pressurePa * factor })) };
  return validateCapillaryModel(scaled) ? scaled : null;
}

function interpolateTable(points: readonly CapillaryPoint[], pressurePa: number): number | null {
  let lo = 0;
  let hi = points.length - 1;
  if (pressurePa < points[lo]!.pressurePa || pressurePa > points[hi]!.pressurePa) return null;
  while (hi - lo > 1) {
    const middle = Math.floor((lo + hi) / 2);
    if (points[middle]!.pressurePa <= pressurePa) lo = middle;
    else hi = middle;
  }
  const start = points[lo]!;
  const end = points[hi]!;
  return start.sw + (end.sw - start.sw) * ((pressurePa - start.pressurePa) / (end.pressurePa - start.pressurePa));
}

/** Valida una vez para evaluar repetidamente una misma línea sobre un perfil. */
export function createSaturationHeightEvaluator(
  deltaGradientPaPerM: number,
  model: CapillaryModel,
): ((heightM: number) => number | null) | null {
  if (!Number.isFinite(deltaGradientPaPerM) || deltaGradientPaPerM <= 0 || !validateCapillaryModel(model)) return null;
  const lower = model.kind === 'table' ? model.points[0]!.pressurePa
    : Math.max(model.rangePa[0], model.entryPlateau ? 0 : model.entryPressurePa);
  const upper = model.kind === 'table' ? model.points.at(-1)!.pressurePa : model.rangePa[1];
  const lowerHeight = lower / deltaGradientPaPerM;
  const upperHeight = upper / deltaGradientPaPerM;
  return (heightM) => {
    if (!Number.isFinite(heightM) || heightM < lowerHeight || heightM > upperHeight) return null;
    // Comparar primero en altura evita perder los extremos del soporte por redondeo de Pc → h → Pc.
    const pressurePa = heightM === lowerHeight ? lower : heightM === upperHeight ? upper
      : Math.max(lower, Math.min(upper, deltaGradientPaPerM * heightM));
    if (model.kind === 'table') return interpolateTable(model.points, pressurePa);
    return brooksCoreySw(pressurePa, model.entryPressurePa, model.lambda, model.irreducibleSw);
  };
}

export function saturationAtHeight(heightM: number, deltaGradientPaPerM: number, model: CapillaryModel): number | null {
  return createSaturationHeightEvaluator(deltaGradientPaPerM, model)?.(heightM) ?? null;
}
