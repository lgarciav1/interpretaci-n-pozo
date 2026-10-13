/**
 * Electrofacies sin supervisión: agrupa las muestras de un pozo por la similitud de sus perfiles, sin etiquetas.
 *
 * Flujo: curvas → características (mismas transformaciones que los modelos supervisados, `features.ts`) →
 * estandarización ROBUSTA por característica (mediana y semiancho entre los percentiles 16 y 84, que coincide con la
 * desviación estándar en datos normales y no se deja arrastrar por los picos espurios) → k-means o mezcla gaussiana →
 * clusters ORDENADOS por el centro (lexicográfico por el orden de las características: con GR primero, el cluster 0 es
 * el de menor GR). El orden fijo hace los resultados comparables entre corridas y entre semillas.
 *
 * Las etiquetas de cluster no son litologías: son grupos de respuesta similar que el intérprete debe nombrar. Con
 * `k` mal elegido (demasiado grande) separan una litología en varias; `scanClusterCount` ayuda a elegirlo (BIC para
 * la mezcla gaussiana, inercia para k-means).
 */

import { buildFeatureMatrix, type FeatureName, type FeatureOptions, type ModelCurves } from './features.ts';
import { gmm } from './gmm.ts';
import { kmeans, kmeansPseudoProbabilities } from './kmeans.ts';
import { argmaxRows } from './forest.ts';

export type ClusterMethod = 'kmeans' | 'gmm';

export interface ElectrofaciesOptions {
  /** Número de clusters. */
  k: number;
  method?: ClusterMethod;
  seed?: number;
  /** Características a usar. Por defecto las que no dependen del PE ni del caliper: GR, RHOB, NPHI, DTC, LOG_RDEP. */
  features?: readonly FeatureName[];
  /** Si es false no se estandariza (para datos ya normalizados). Por defecto true. */
  standardize?: boolean;
  maxIter?: number;
  nInit?: number;
  /** Piso de varianza de la mezcla gaussiana (en unidades estandarizadas). */
  varFloor?: number;
  featureOptions?: FeatureOptions;
}

export const DEFAULT_CLUSTER_FEATURES: readonly FeatureName[] = ['GR', 'RHOB', 'NPHI', 'DTC', 'LOG_RDEP'];

export interface ElectrofaciesResult {
  method: ClusterMethod;
  k: number;
  n: number;
  featureNames: FeatureName[];
  /** Cluster de cada muestra (0..k−1). */
  labels: Int16Array;
  /** Probabilidad (GMM: responsabilidad; k-means: pseudo-probabilidad) n × k fila a fila; filas suman 1. */
  probabilities: Float32Array;
  /** Probabilidad del cluster ganador. */
  confidence: Float32Array;
  /** Centros k × d en las unidades de las características (LOG_RDEP en log10(ohm·m)). */
  centers: Float64Array;
  /** Centros k × d estandarizados. */
  centersStandardized: Float64Array;
  /** Mediana y escala usadas para estandarizar, por característica. */
  location: Float64Array;
  scale: Float64Array;
  /** Peso de cada cluster (GMM: peso de la mezcla; k-means: fracción de muestras). */
  weights: Float64Array;
  /** Desvío estándar por cluster y característica (k × d, unidades originales); k-means: desvío dentro del cluster. */
  stdDevs: Float64Array;
  /** Muestras por cluster. */
  counts: Int32Array;
  /** 1 si la muestra tenía alguna característica con dato. */
  valid: Uint8Array;
  inertia?: number;
  logLikelihood?: number;
  bic?: number;
  iterations: number;
  converged: boolean;
}

function quantile(sorted: Float64Array, p: number): number {
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.min(sorted.length - 1, lo + 1);
  return sorted[lo]! + (h - lo) * (sorted[hi]! - sorted[lo]!);
}

/** Mediana y escala robusta ((p84 − p16)/2) por columna; escala 1 si degenera. NaN-safe. */
export function robustStandardize(X: ArrayLike<number>, n: number, d: number): { Z: Float64Array; location: Float64Array; scale: Float64Array } {
  const location = new Float64Array(d);
  const scale = new Float64Array(d).fill(1);
  const Z = new Float64Array(n * d);
  for (let j = 0; j < d; j++) {
    const vals: number[] = [];
    for (let i = 0; i < n; i++) {
      const x = X[i * d + j]!;
      if (Number.isFinite(x)) vals.push(x);
    }
    if (vals.length > 0) {
      const sorted = Float64Array.from(vals).sort();
      location[j] = quantile(sorted, 0.5);
      const s = (quantile(sorted, 0.84) - quantile(sorted, 0.16)) / 2;
      scale[j] = s > 1e-12 ? s : 1;
    }
    for (let i = 0; i < n; i++) {
      const x = X[i * d + j]!;
      Z[i * d + j] = Number.isFinite(x) ? (x - location[j]!) / scale[j]! : NaN;
    }
  }
  return { Z, location, scale };
}

/** Agrupa una matriz de características n × d (NaN = sin dato). Función de bajo nivel de `clusterElectrofacies`. */
export function clusterMatrix(
  X: ArrayLike<number>,
  n: number,
  d: number,
  featureNames: readonly FeatureName[],
  opts: ElectrofaciesOptions,
): ElectrofaciesResult {
  const method = opts.method ?? 'gmm';
  const k = opts.k;
  const standardize = opts.standardize ?? true;
  let Z: ArrayLike<number>;
  let location: Float64Array = new Float64Array(d);
  let scale: Float64Array = new Float64Array(d).fill(1);
  if (standardize) {
    const s = robustStandardize(X, n, d);
    Z = s.Z;
    location = s.location;
    scale = s.scale;
  } else {
    Z = X;
  }

  let labels: Int16Array;
  let probs: Float32Array;
  let centers: Float64Array;
  let weights: Float64Array;
  let variances: Float64Array; // en unidades estandarizadas
  let valid: Uint8Array;
  let iterations: number;
  let converged: boolean;
  const extra: { inertia?: number; logLikelihood?: number; bic?: number } = {};
  const seedOpt = opts.seed === undefined ? {} : { seed: opts.seed };
  const iterOpt = opts.maxIter === undefined ? {} : { maxIter: opts.maxIter };
  const initOpt = opts.nInit === undefined ? {} : { nInit: opts.nInit };

  if (method === 'kmeans') {
    const km = kmeans(Z, n, d, { k, ...seedOpt, ...iterOpt, ...initOpt });
    labels = km.labels;
    centers = km.centers;
    probs = kmeansPseudoProbabilities(Z, n, d, km);
    valid = km.valid;
    iterations = km.iterations;
    converged = km.converged;
    extra.inertia = km.inertia;
    const total = km.counts.reduce((s, c) => s + c, 0) || 1;
    weights = Float64Array.from(km.counts, c => c / total);
    // Varianza dentro del cluster por dimensión.
    variances = new Float64Array(k * d);
    const cnt = new Float64Array(k * d);
    for (let r = 0; r < n; r++) {
      if (!valid[r]) continue;
      const c = labels[r]!;
      for (let j = 0; j < d; j++) {
        const x = Z[r * d + j]!;
        if (x === x) {
          variances[c * d + j]! += (x - centers[c * d + j]!) ** 2;
          cnt[c * d + j]!++;
        }
      }
    }
    for (let i = 0; i < k * d; i++) variances[i] = cnt[i]! > 0 ? variances[i]! / cnt[i]! : 0;
  } else {
    const g = gmm(Z, n, d, { k, ...seedOpt, ...iterOpt, ...initOpt, ...(opts.varFloor === undefined ? {} : { varFloor: opts.varFloor }) });
    labels = g.labels;
    centers = g.means;
    probs = g.responsibilities;
    weights = g.weights;
    variances = g.variances;
    valid = g.valid;
    iterations = g.iterations;
    converged = g.converged;
    extra.logLikelihood = g.logLikelihood;
    extra.bic = g.bic;
  }

  // Orden canónico de clusters: lexicográfico por el centro estandarizado, en el orden de las características.
  const order = Array.from({ length: k }, (_, i) => i).sort((a, b) => {
    for (let j = 0; j < d; j++) {
      const diff = centers[a * d + j]! - centers[b * d + j]!;
      if (Math.abs(diff) > 1e-9) return diff;
    }
    return a - b;
  });
  const newIndex = new Int16Array(k);
  order.forEach((old, idx) => (newIndex[old] = idx));

  const outLabels = new Int16Array(n);
  const outProbs = new Float32Array(n * k);
  const counts = new Int32Array(k);
  for (let r = 0; r < n; r++) {
    outLabels[r] = newIndex[labels[r]!]!;
    for (let c = 0; c < k; c++) outProbs[r * k + newIndex[c]!] = probs[r * k + c]!;
    if (valid[r]) counts[outLabels[r]!]!++;
  }
  // Etiqueta = argmax de la probabilidad reordenada (coincide con labels salvo empates exactos).
  const win = argmaxRows(outProbs, n, k);
  const centersStd = new Float64Array(k * d);
  const centersOut = new Float64Array(k * d);
  const stdDevs = new Float64Array(k * d);
  const w = new Float64Array(k);
  order.forEach((old, idx) => {
    w[idx] = weights[old]!;
    for (let j = 0; j < d; j++) {
      centersStd[idx * d + j] = centers[old * d + j]!;
      centersOut[idx * d + j] = standardize ? centers[old * d + j]! * scale[j]! + location[j]! : centers[old * d + j]!;
      stdDevs[idx * d + j] = Math.sqrt(variances[old * d + j]!) * (standardize ? scale[j]! : 1);
    }
  });
  return {
    method,
    k,
    n,
    featureNames: [...featureNames],
    labels: outLabels,
    probabilities: outProbs,
    confidence: win.confidence,
    centers: centersOut,
    centersStandardized: centersStd,
    location,
    scale,
    weights: w,
    stdDevs,
    counts,
    valid,
    ...extra,
    iterations,
    converged,
  };
}

/**
 * Electrofacies de un pozo a partir de sus curvas. Devuelve etiquetas, probabilidades por clase, la clase ganadora con
 * su confianza y los centros (en unidades de las características). Determinístico para la misma semilla.
 */
export function clusterElectrofacies(curves: ModelCurves, opts: ElectrofaciesOptions): ElectrofaciesResult {
  const features = opts.features ?? DEFAULT_CLUSTER_FEATURES;
  const fm = buildFeatureMatrix(curves, features, opts.featureOptions);
  return clusterMatrix(fm.X, fm.n, fm.d, fm.featureNames, opts);
}

export interface ClusterScanRow {
  k: number;
  inertia?: number;
  logLikelihood?: number;
  bic?: number;
}

/** Ajusta el modelo para cada k de la lista y devuelve inercia (k-means) o log-verosimilitud y BIC (GMM). */
export function scanClusterCount(curves: ModelCurves, ks: readonly number[], opts: Omit<ElectrofaciesOptions, 'k'>): ClusterScanRow[] {
  const features = opts.features ?? DEFAULT_CLUSTER_FEATURES;
  const fm = buildFeatureMatrix(curves, features, opts.featureOptions);
  return ks.map(k => {
    const r = clusterMatrix(fm.X, fm.n, fm.d, fm.featureNames, { ...opts, k });
    const row: ClusterScanRow = { k };
    if (r.inertia !== undefined) row.inertia = r.inertia;
    if (r.logLikelihood !== undefined) row.logLikelihood = r.logLikelihood;
    if (r.bic !== undefined) row.bic = r.bic;
    return row;
  });
}
