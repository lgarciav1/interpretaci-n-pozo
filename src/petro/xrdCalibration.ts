/** Ajustes GR–proxy de Vsh. Sin UI; pesos iguales por localización independiente. */
import { gammaRayIndex } from "./igr";
import { vshFromIgr, type VshMethod } from "./vsh";
export interface CalibrationPoint {
  id: string;
  depth: number;
  gr: number;
  target: number;
}
export interface GrBounds {
  clean: { min: number; max: number; step: number };
  shale: { min: number; max: number; step: number };
}
export interface CalibrationPolicy {
  minLocations: number;
  minRange: number;
  minGrRange: number;
  minCorrelation: number;
  cleanSupportMax: number;
  shaleSupportMin: number;
  blocks: number;
  minTraining: number;
  minValidation: number;
  maxRMSE: number;
  maxBias: number;
  maxEndpointSpread: number;
  separationM: number;
  maxReplicaSpread: number;
  maxReportedUncertainty: number;
  maxRelativeDensityUncertainty: number;
  allowEstimatedGR: boolean;
}
export const DEFAULT_GR_POLICY: Readonly<CalibrationPolicy> = Object.freeze({
  minLocations: 12,
  minRange: 0.6,
  minGrRange: 20,
  minCorrelation: 0.6,
  cleanSupportMax: 0.2,
  shaleSupportMin: 0.8,
  blocks: 3,
  minTraining: 6,
  minValidation: 2,
  maxRMSE: 0.1,
  maxBias: 0.05,
  maxEndpointSpread: 20,
  separationM: 1,
  maxReplicaSpread: 0.15,
  maxReportedUncertainty: 0.05,
  maxRelativeDensityUncertainty: 0.1,
  allowEstimatedGR: false,
});
export interface GrEndpoints {
  clean: number;
  shale: number;
}
export interface FitMetrics {
  rmse: number;
  bias: number;
  grRMSE: number;
}
export interface CalibrationFit {
  method: VshMethod;
  raw: GrEndpoints;
  applied: GrEndpoints;
  metrics: FitMetrics;
  validation: FitMetrics | null;
  locations: number;
  range: [number, number];
  endpointSpread: GrEndpoints;
  folds: { training: number; validation: number; endpoints: GrEndpoints }[];
  reasons: string[];
  admitted: boolean;
}
const prediction = (gr: number, p: GrEndpoints, method: VshMethod) =>
  vshFromIgr(gammaRayIndex(gr, p.clean, p.shale), method);
function inverse(target: number, method: VshMethod) {
  if (target < 0 || target > vshFromIgr(1, method) + 1e-12) return NaN;
  let a = 0,
    b = 1;
  for (let i = 0; i < 52; i++) {
    const mid = (a + b) / 2;
    if (vshFromIgr(mid, method) < target) a = mid;
    else b = mid;
  }
  return (a + b) / 2;
}
function regression(
  points: readonly CalibrationPoint[],
  method: VshMethod,
): GrEndpoints {
  let n = 0,
    mx = 0,
    my = 0,
    xx = 0,
    xy = 0;
  for (const p of points) {
    const x = method === "linear" ? p.target : inverse(p.target, method);
    if (!Number.isFinite(x)) return { clean: NaN, shale: NaN };
    n++;
    const dx = x - mx;
    mx += dx / n;
    const dy = p.gr - my;
    my += dy / n;
    xx += dx * (x - mx);
    xy += dx * (p.gr - my);
  }
  const slope = xy / xx,
    clean = my - slope * mx;
  return { clean, shale: clean + slope };
}
function inside(p: GrEndpoints, b: GrBounds) {
  return (
    Number.isFinite(p.clean) &&
    Number.isFinite(p.shale) &&
    p.clean >= b.clean.min &&
    p.clean <= b.clean.max &&
    p.shale >= b.shale.min &&
    p.shale <= b.shale.max &&
    p.shale > p.clean
  );
}
function rounded(p: GrEndpoints, b: GrBounds): GrEndpoints {
  return {
    clean:
      b.clean.min +
      Math.round((p.clean - b.clean.min) / b.clean.step) * b.clean.step,
    shale:
      b.shale.min +
      Math.round((p.shale - b.shale.min) / b.shale.step) * b.shale.step,
  };
}
function loss(
  points: readonly CalibrationPoint[],
  p: GrEndpoints,
  method: VshMethod,
) {
  let s = 0;
  for (const point of points) {
    const r = prediction(point.gr, p, method) - point.target;
    s += r * r;
  }
  return s / points.length;
}
function metrics(
  points: readonly CalibrationPoint[],
  p: GrEndpoints,
  method: VshMethod,
): FitMetrics {
  let error = 0,
    bias = 0,
    grError = 0;
  for (const point of points) {
    const r = prediction(point.gr, p, method) - point.target;
    error += r * r;
    bias += r;
    const g =
      point.gr -
      (p.clean + (p.shale - p.clean) * inverse(point.target, method));
    grError += g * g;
  }
  return {
    rmse: Math.sqrt(error / points.length),
    bias: bias / points.length,
    grRMSE: Math.sqrt(grError / points.length),
  };
}
async function optimize(
  points: readonly CalibrationPoint[],
  method: VshMethod,
  b: GrBounds,
  checkpoint: () => Promise<void>,
): Promise<GrEndpoints> {
  const initial = regression(points, method);
  if (method === "linear") return initial;
  // Toda la caja primero; cinco refinamientos, sin abandonar la caja ni cruzar extremos.
  let best = inside(initial, b)
    ? initial
    : { clean: b.clean.min, shale: b.shale.max };
  let bestLoss = loss(points, best, method);
  let cl = b.clean.min,
    ch = b.clean.max,
    sl = b.shale.min,
    sh = b.shale.max;
  for (let level = 0; level < 6; level++) {
    await checkpoint();
    const dc = (ch - cl) / 20,
      ds = (sh - sl) / 20;
    for (let i = 0; i <= 20; i++)
      for (let j = 0; j <= 20; j++) {
        const p = { clean: cl + i * dc, shale: sl + j * ds };
        if (!inside(p, b)) continue;
        const l = loss(points, p, method);
        if (l < bestLoss) {
          bestLoss = l;
          best = p;
        }
      }
    cl = Math.max(b.clean.min, best.clean - dc);
    ch = Math.min(b.clean.max, best.clean + dc);
    sl = Math.max(b.shale.min, best.shale - ds);
    sh = Math.min(b.shale.max, best.shale + ds);
  }
  return best;
}
export function validateGrPolicy(p: CalibrationPolicy) {
  if (
    Object.keys(p).length !== Object.keys(DEFAULT_GR_POLICY).length ||
    Object.keys(DEFAULT_GR_POLICY).some((k) => !Object.hasOwn(p, k))
  )
    throw new Error("Esquema de umbrales no admitido.");
  const numbers = Object.entries(p).filter(([k]) => k !== "allowEstimatedGR");
  if (
    numbers.some(
      ([, v]) => typeof v !== "number" || !Number.isFinite(v) || v < 0,
    ) ||
    typeof p.allowEstimatedGR !== "boolean" ||
    p.minLocations < 6 ||
    p.minLocations > 512 ||
    !Number.isInteger(p.minLocations) ||
    p.blocks < 3 ||
    p.blocks > 5 ||
    !Number.isInteger(p.blocks) ||
    p.minTraining < 3 ||
    !Number.isInteger(p.minTraining) ||
    p.minValidation < 1 ||
    !Number.isInteger(p.minValidation) ||
    p.minGrRange <= 0 ||
    p.minCorrelation <= 0 ||
    p.minCorrelation > 1 ||
    p.minRange <= 0 ||
    p.minRange > 1 ||
    p.cleanSupportMax >= p.shaleSupportMin ||
    p.shaleSupportMin > 1 ||
    p.maxRMSE <= 0 ||
    p.maxRMSE > 1 ||
    p.maxBias > 1 ||
    p.maxEndpointSpread <= 0 ||
    p.maxReplicaSpread > 1 ||
    p.maxReportedUncertainty > 1 ||
    p.maxRelativeDensityUncertainty > 1
  )
    throw new Error("Umbrales de admisión GR inválidos.");
}
export async function fitGrCalibration(
  points: readonly CalibrationPoint[],
  method: VshMethod,
  bounds: GrBounds,
  policy: CalibrationPolicy,
  guardM: number,
  checkpoint: () => Promise<void> = async () => {},
): Promise<CalibrationFit> {
  validateGrPolicy(policy);
  if (
    points.length < 3 ||
    points.length > 512 ||
    points.some(
      (p) =>
        ![p.depth, p.gr, p.target].every(Number.isFinite) ||
        p.target < 0 ||
        p.target > 1,
    ) ||
    !Number.isFinite(guardM) ||
    guardM < 0
  )
    throw new Error("El ajuste necesita entre 3 y 512 localizaciones válidas.");
  for (const b of [bounds.clean, bounds.shale])
    if (
      ![b.min, b.max, b.step].every(Number.isFinite) ||
      b.max <= b.min ||
      b.step <= 0
    )
      throw new Error("Límites canónicos de parámetros inválidos.");
  const sorted = [...points].sort((a, b) => a.depth - b.depth),
    targets = points.map((p) => p.target),
    range: [number, number] = [Math.min(...targets), Math.max(...targets)];
  const reasons: string[] = [];
  const meanGr = points.reduce((s, p) => s + p.gr, 0) / points.length,
    meanTarget = points.reduce((s, p) => s + p.target, 0) / points.length;
  let covariance = 0,
    varianceGr = 0,
    varianceTarget = 0;
  for (const p of points) {
    covariance += (p.gr - meanGr) * (p.target - meanTarget);
    varianceGr += (p.gr - meanGr) ** 2;
    varianceTarget += (p.target - meanTarget) ** 2;
  }
  const associationR =
    covariance / Math.sqrt(varianceGr) / Math.sqrt(varianceTarget);
  if (
    Math.max(...points.map((p) => p.gr)) -
      Math.min(...points.map((p) => p.gr)) <
      policy.minGrRange ||
    !Number.isFinite(associationR) ||
    associationR < policy.minCorrelation
  )
    reasons.push(
      "Rango de GR o asociación positiva insuficientes para identificar extremos.",
    );
  if (points.length < policy.minLocations)
    reasons.push("Pocas localizaciones independientes.");
  if (
    range[1] - range[0] < policy.minRange ||
    range[0] > policy.cleanSupportMax ||
    range[1] < policy.shaleSupportMin
  )
    reasons.push("Falta rango o soporte de ambos extremos.");
  if (points.some((p) => !Number.isFinite(inverse(p.target, method))))
    reasons.push("Objetivo fuera del dominio del método Vsh.");
  const association = regression(points, method);
  if (
    !Number.isFinite(association.clean) ||
    !(association.shale > association.clean)
  )
    reasons.push("Relación no identificable o sin pendiente positiva.");
  const raw = await optimize(points, method, bounds, checkpoint),
    applied = rounded(raw, bounds);
  if (!inside(raw, bounds) || !inside(applied, bounds))
    reasons.push("Extremos fuera de límites o pendiente no positiva.");
  if (
    raw.clean <= bounds.clean.min + bounds.clean.step ||
    raw.clean >= bounds.clean.max - bounds.clean.step ||
    raw.shale <= bounds.shale.min + bounds.shale.step ||
    raw.shale >= bounds.shale.max - bounds.shale.step
  )
    reasons.push("Solución en el borde del dominio.");
  const resultMetrics = metrics(points, applied, method);
  if (
    !Object.values(resultMetrics).every(Number.isFinite) ||
    resultMetrics.rmse > policy.maxRMSE ||
    Math.abs(resultMetrics.bias) > policy.maxBias
  )
    reasons.push("Residuo o sesgo excede la admisión.");
  const folds: CalibrationFit["folds"] = [],
    validationGrResiduals: number[] = [],
    validationResiduals: number[] = [],
    endpoints: GrEndpoints[] = [raw];
  for (let k = 0; k < policy.blocks; k++) {
    const first = Math.floor((k * sorted.length) / policy.blocks),
      last = Math.floor(((k + 1) * sorted.length) / policy.blocks),
      held = sorted.slice(first, last);
    if (!held.length) continue;
    const lo = held[0]!.depth,
      hi = held.at(-1)!.depth;
    const training = sorted.filter(
      (p) => p.depth < lo - guardM || p.depth > hi + guardM,
    );
    if (
      training.length < policy.minTraining ||
      held.length < policy.minValidation
    )
      continue;
    const trainRange =
      Math.max(...training.map((p) => p.target)) -
      Math.min(...training.map((p) => p.target));
    if (trainRange < policy.minRange) continue;
    const fitted = await optimize(training, method, bounds, checkpoint);
    if (!inside(fitted, bounds)) continue;
    const roundedFit = rounded(fitted, bounds);
    endpoints.push(fitted);
    folds.push({
      training: training.length,
      validation: held.length,
      endpoints: fitted,
    });
    for (const p of held) {
      validationResiduals.push(prediction(p.gr, roundedFit, method) - p.target);
      validationGrResiduals.push(
        p.gr -
          (roundedFit.clean +
            (roundedFit.shale - roundedFit.clean) * inverse(p.target, method)),
      );
    }
  }
  const validation =
    folds.length === policy.blocks
      ? {
          rmse: Math.sqrt(
            validationResiduals.reduce((s, v) => s + v * v, 0) /
              validationResiduals.length,
          ),
          bias:
            validationResiduals.reduce((s, v) => s + v, 0) /
            validationResiduals.length,
          grRMSE: Math.sqrt(
            validationGrResiduals.reduce((s, v) => s + v * v, 0) /
              validationGrResiduals.length,
          ),
        }
      : null;
  if (!validation)
    reasons.push(
      "Sin validación independiente suficiente por bloques separados.",
    );
  else if (
    !Number.isFinite(validation.rmse) ||
    validation.rmse > policy.maxRMSE ||
    Math.abs(validation.bias) > policy.maxBias
  )
    reasons.push("La validación por bloques no satisface los umbrales.");
  const spread = {
    clean:
      Math.max(...endpoints.map((p) => p.clean)) -
      Math.min(...endpoints.map((p) => p.clean)),
    shale:
      Math.max(...endpoints.map((p) => p.shale)) -
      Math.min(...endpoints.map((p) => p.shale)),
  };
  if (
    !Number.isFinite(spread.clean) ||
    !Number.isFinite(spread.shale) ||
    Math.max(spread.clean, spread.shale) > policy.maxEndpointSpread
  )
    reasons.push("Extremos inestables al retirar bloques.");
  await checkpoint();
  return {
    method,
    raw,
    applied,
    metrics: resultMetrics,
    validation,
    locations: points.length,
    range,
    endpointSpread: spread,
    folds,
    reasons,
    admitted: !reasons.length,
  };
}
