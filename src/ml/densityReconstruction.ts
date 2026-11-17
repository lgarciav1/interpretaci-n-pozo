/** F20. Statistical reconstruction, not a tool/environment correction. ADR 0077.
 * Extra-randomized regression trees: Geurts et al. (2006). Honest held-out
 * calibration absolute residual quantile; no guarantee of exchangeability by depth.
 */
import { mulberry32 } from './rng.ts';

export type DensityPredictorRole = 'gr' | 'sonic' | 'resistivity' | 'neutron';
export interface DensityPredictor {
  id: string;
  role: DensityPredictorRole;
  values: ArrayLike<number>;
  trusted: boolean;
  reliableMask?: ArrayLike<number>;
}
export interface DensityReconstructionInput {
  depth: ArrayLike<number>;
  density: ArrayLike<number>;
  goodMask: ArrayLike<number>;
  washoutMask: ArrayLike<number>;
  predictors: readonly DensityPredictor[];
}
export interface DensityReconstructionReport {
  accepted: boolean;
  reasons: string[];
  rmse: number | null;
  r2: number | null;
  bandCoverage: number | null;
  validationCoverage: number;
  halfWidth: number | null;
  trainingCount: number;
  validationCount: number;
  calibrationCount: number;
  targetCount: number;
  estimatedCount: number;
  elapsedMs: number;
  nominalCoverage: number;
  version: 'density-rf-v1';
}
export interface DensityReconstructionResult {
  data: Float64Array;
  lower: Float64Array;
  upper: Float64Array;
  /** 0 original, 1 estimated, 2 invalid predictor, 3 unsupported, 4 rejected validation. */
  status: Uint8Array;
  report: DensityReconstructionReport;
  validation: { index: number; truth: number; predicted: number; halfWidth: number; fold: number }[];
}
export const DENSITY_POLICY = Object.freeze({ blockLength: 10, gap: 1.5, nFolds: 5, maxRmse: .08, minR2: .5,
  nominalCoverage: .9, minBandCoverage: .85, maxHalfWidth: .15, minValidationCoverage: .6,
  minTrain: 100, minCalibration: 20, minTest: 20, minBlocks: 15, minValidation: 100 });

type Row = { index: number; x: number[]; y: number; z: number; block: number; fold: number };
type Tree = { mean: number; feature?: number; threshold?: number; left?: Tree; right?: Tree };
type Model = { trees: Tree[]; rows: Row[]; min: number[]; range: number[] };

/** Conservative physical screening does not replace explicit trust. */
function featureValue(p: DensityPredictor, i: number): number {
  if (!p.trusted || (p.reliableMask && p.reliableMask[i] !== 1) || (p.role === 'neutron' && !p.reliableMask)) return NaN;
  const v = p.values[i]!;
  if (!Number.isFinite(v)) return NaN;
  switch (p.role) {
    case 'gr': return v >= 0 && v <= 500 ? v : NaN;
    case 'sonic': return v >= 30 && v <= 300 ? v : NaN;
    case 'resistivity': return v > 0 && v <= 100000 ? Math.log10(v) : NaN;
    case 'neutron': return v >= -.15 && v <= .8 ? v : NaN;
  }
}

function fit(rows: Row[]): Model {
  const d = rows[0]!.x.length;
  const min = Array(d).fill(Infinity) as number[], max = Array(d).fill(-Infinity) as number[];
  for (const row of rows) for (let j = 0; j < d; j++) { min[j] = Math.min(min[j]!, row.x[j]!); max[j] = Math.max(max[j]!, row.x[j]!); }
  const rng = mulberry32(2077);
  function tree(samples: Row[], depth: number): Tree {
    let sum = 0, ss = 0;
    for (const r of samples) { sum += r.y; ss += r.y * r.y; }
    const node: Tree = { mean: sum / samples.length };
    if (depth >= 10 || samples.length < 12 || ss - sum * sum / samples.length < 1e-10) return node;
    let best = -Infinity, bf = -1, bt = 0;
    for (let f = 0; f < d; f++) {
      let lo = Infinity, hi = -Infinity;
      for (const r of samples) { lo = Math.min(lo, r.x[f]!); hi = Math.max(hi, r.x[f]!); }
      if (!(hi > lo)) continue;
      for (let k = 0; k < 8; k++) {
        const t = lo + rng() * (hi - lo);
        let n = 0, s = 0;
        for (const r of samples) if (r.x[f]! <= t) { n++; s += r.y; }
        if (n < 6 || samples.length - n < 6) continue;
        const gain = s * s / n + (sum - s) ** 2 / (samples.length - n) - sum * sum / samples.length;
        if (gain > best) { best = gain; bf = f; bt = t; }
      }
    }
    if (bf < 0 || best <= 1e-10) return node;
    node.feature = bf; node.threshold = bt;
    node.left = tree(samples.filter(r => r.x[bf]! <= bt), depth + 1);
    node.right = tree(samples.filter(r => r.x[bf]! > bt), depth + 1);
    return node;
  }
  // All rows per tree; randomized thresholds (ExtraTrees), no target quantization.
  return { trees: Array.from({ length: 32 }, () => tree(rows, 0)), rows, min, range: max.map((v, j) => v - min[j]!) };
}
function supported(model: Model, x: number[]): boolean {
  for (let j = 0; j < x.length; j++) if (x[j]! < model.min[j]! - 1e-12 || x[j]! > model.min[j]! + model.range[j]! + 1e-12) return false;
  const radius2 = .35 ** 2;
  for (const row of model.rows) {
    let dist = 0;
    for (let j = 0; j < x.length; j++) {
      const scale = model.range[j]!;
      dist += scale > 0 ? ((row.x[j]! - x[j]!) / scale) ** 2 : 0;
    }
    if (dist <= radius2) return true;
  }
  return false;
}
function predict(model: Model, x: number[]): number {
  let sum = 0;
  for (let node of model.trees) {
    while (node.feature !== undefined) node = x[node.feature]! <= node.threshold! ? node.left! : node.right!;
    sum += node.mean;
  }
  return sum / model.trees.length;
}
/** Finite sample upper absolute-residual quantile; null when insufficient. */
export function densityCalibrationHalfWidth(residuals: readonly number[]): number | null {
  if (residuals.length < DENSITY_POLICY.minCalibration || residuals.some(v => !Number.isFinite(v) || v < 0)) return null;
  const sorted = [...residuals].sort((a, b) => a - b);
  const rank = Math.ceil((sorted.length + 1) * .9);
  return rank <= sorted.length ? Math.max(.005, sorted[rank - 1]!) : null;
}
/** Independent-reference-friendly metrics; null R² for constant truth. */
export function densityRegressionMetrics(truth: readonly number[], predicted: readonly number[]) {
  if (!truth.length || truth.length !== predicted.length || truth.some((v, i) => !Number.isFinite(v) || !Number.isFinite(predicted[i]))) return { rmse: null, r2: null };
  const mean = truth.reduce((a, b) => a + b, 0) / truth.length;
  let sse = 0, sst = 0;
  truth.forEach((v, i) => { sse += (v - predicted[i]!) ** 2; sst += (v - mean) ** 2; });
  return { rmse: Math.sqrt(sse / truth.length), r2: sst > 1e-12 ? 1 - sse / sst : null };
}

export function reconstructDensity(input: DensityReconstructionInput): DensityReconstructionResult {
  const validation: DensityReconstructionResult['validation'] = [];
  const start = performance.now(), { depth, density, goodMask, washoutMask, predictors } = input, n = depth.length;
  if (n > 20000) throw new Error('F20 admite hasta 20000 muestras por evaluación.');
  if (density.length !== n || goodMask.length !== n || washoutMask.length !== n || predictors.some(p => p.values.length !== n || (p.reliableMask && p.reliableMask.length !== n))) throw new Error('Longitudes incompatibles en reconstrucción de densidad.');
  if (predictors.length < 2 || predictors.length > 4 || new Set(predictors.map(p => p.role)).size !== predictors.length || new Set(predictors.map(p => p.id)).size !== predictors.length) throw new Error('Seleccioná entre dos y cuatro predictores distintos.');
  for (let i = 0; i < n; i++) {
    if ((goodMask[i] !== 0 && goodMask[i] !== 1) || (washoutMask[i] !== 0 && washoutMask[i] !== 1)) throw new Error('Las máscaras deben ser binarias.');
    if (goodMask[i] === 1 && washoutMask[i] === 1) throw new Error('Buen pozo y derrumbe no pueden solaparse.');
    if (i && !(depth[i]! > depth[i - 1]!)) throw new Error('La profundidad debe ser estrictamente creciente.');
    if (!Number.isFinite(depth[i])) throw new Error('Profundidad no finita.');
  }
  const data = Float64Array.from(density), lower = new Float64Array(n).fill(NaN), upper = new Float64Array(n).fill(NaN), status = new Uint8Array(n);
  const report: DensityReconstructionReport = { accepted: false, reasons: [], rmse: null, r2: null, bandCoverage: null, validationCoverage: 0, halfWidth: null,
    trainingCount: 0, validationCount: 0, calibrationCount: 0, targetCount: 0, estimatedCount: 0, elapsedMs: 0, nominalCoverage: .9, version: 'density-rf-v1' };
  const x = Array.from({ length: n }, (_, i) => predictors.map(p => featureValue(p, i)));
  const rows: Row[] = [];
  let eligibleGood = 0;
  for (let i = 0; i < n; i++) {
    if (washoutMask[i] === 1) { report.targetCount++; status[i] = 4; }
    if (goodMask[i] !== 1 || !Number.isFinite(density[i]) || density[i]! < 1 || density[i]! > 3.5) continue;
    eligibleGood++;
    if (x[i]!.some(v => !Number.isFinite(v))) continue;
    const block = Math.floor((depth[i]! - (depth[0] ?? 0)) / 10);
    rows.push({ index: i, x: x[i]!, y: density[i]!, z: depth[i]!, block, fold: block % 5 });
  }
  const finish = () => { report.elapsedMs = performance.now() - start; return { data, lower, upper, status, report, validation }; };
  if (new Set(rows.map(r => r.block)).size < 15) { report.reasons.push('Soporte insuficiente: se necesitan al menos 15 bloques sanos de 10 m.'); return finish(); }
  // Block boundaries, not observed sample edges: gaps cannot leak information.
  const nearFold = (r: Row, fold: number) => {
    const origin = depth[0]!;
    for (let b = Math.max(0, r.block - 2); b <= r.block + 2; b++) if (b % 5 === fold) {
      const lo = origin + b * 10, hi = lo + 10;
      const distance = r.z < lo ? lo - r.z : r.z > hi ? r.z - hi : 0;
      if (distance < 1.5) return true;
    }
    return false;
  };
  const truth: number[] = [], predictions: number[] = [];
  let covered = 0, missingFold = false;
  const calibrationWidths: number[] = [];
  for (let f = 0; f < 5; f++) {
    const calFold = (f + 1) % 5;
    const train = rows.filter(r => !nearFold(r, f) && !nearFold(r, calFold));
    const cal = rows.filter(r => r.fold === calFold), test = rows.filter(r => r.fold === f);
    if (train.length < 100 || cal.length < 20 || test.length < 20) { missingFold = true; continue; }
    const model = fit(train);
    const residuals = cal.filter(r => supported(model, r.x)).map(r => Math.abs(r.y - predict(model, r.x)));
    const width = densityCalibrationHalfWidth(residuals);
    if (width === null) { missingFold = true; continue; }
    calibrationWidths.push(width);
    let supportedTest = 0;
    for (const r of test) if (supported(model, r.x)) {
      supportedTest++;
      const p = predict(model, r.x); truth.push(r.y); predictions.push(p);
      validation.push({ index: r.index, truth: r.y, predicted: p, halfWidth: width, fold: f });
      if (Math.abs(r.y - p) <= width) covered++;
    }
    if (supportedTest < 20) missingFold = true;
  }
  const metrics = densityRegressionMetrics(truth, predictions);
  Object.assign(report, metrics);
  report.validationCount = truth.length;
  report.validationCoverage = eligibleGood ? truth.length / eligibleGood : 0;
  report.bandCoverage = truth.length ? covered / truth.length : null;
  const train = rows.filter(r => !nearFold(r, 0)), cal = rows.filter(r => r.fold === 0);
  report.trainingCount = train.length;
  if (train.length < 100) { report.reasons.push('Entrenamiento final insuficiente.'); return finish(); }
  const model = fit(train);
  const residuals = cal.filter(r => supported(model, r.x)).map(r => Math.abs(r.y - predict(model, r.x)));
  report.calibrationCount = residuals.length;
  const finalWidth = densityCalibrationHalfWidth(residuals);
  report.halfWidth = finalWidth === null ? null : Math.max(finalWidth, ...calibrationWidths);
  if (missingFold) report.reasons.push('Alguna partición no tiene entrenamiento, calibración o prueba suficientes.');
  if (truth.length < 100 || report.validationCoverage < .6) report.reasons.push('Cobertura insuficiente de validación en buen pozo (mínimo 60% y 100 muestras).');
  if (report.rmse === null || report.rmse > .08) report.reasons.push('RMSE supera 0,08 g/cm³ o no está disponible.');
  if (report.r2 === null || report.r2 < .5) report.reasons.push('R² inferior a 0,50 o no definido.');
  if (report.bandCoverage === null || report.bandCoverage < .85) report.reasons.push('Cobertura observada de banda inferior a 85%.');
  if (report.halfWidth === null || report.halfWidth > .15) report.reasons.push('Banda no calibrable o semiancho superior a 0,15 g/cm³.');
  report.accepted = report.reasons.length === 0;
  if (!report.accepted) return finish();
  for (let i = 0; i < n; i++) if (washoutMask[i] === 1) {
    if (x[i]!.some(v => !Number.isFinite(v))) { status[i] = 2; continue; }
    if (!supported(model, x[i]!)) { status[i] = 3; continue; }
    const value = predict(model, x[i]!);
    data[i] = value; lower[i] = value - report.halfWidth!; upper[i] = value + report.halfWidth!;
    status[i] = 1; report.estimatedCount++;
  }
  return finish();
}
