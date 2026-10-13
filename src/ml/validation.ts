/**
 * Validación de modelos de facies: métricas, esquemas de partición SIN FUGA y validación cruzada.
 *
 * POR QUÉ NO AL AZAR. Las muestras de un perfil están a 0,15 m y son casi idénticas a sus vecinas: una partición al
 * azar pone en entrenamiento la «copia» de cada muestra de prueba y devuelve exactitudes infladas que no dicen nada
 * sobre un pozo nuevo. Aquí hay dos esquemas:
 *
 *  1. `depthBlockFolds`: por pozo, la profundidad se corta en bloques contiguos de `blockLength` m; los bloques se
 *     reparten entre los folds (round-robin con desfase propio de cada pozo). Un bloque está SIEMPRE completo en un
 *     solo fold (nunca en train y test a la vez) y las muestras de entrenamiento a menos de `gap` m de un bloque de
 *     prueba se descartan (buffer). Mide la generalización dentro de un pozo conocido a tramos no vistos.
 *  2. `leaveOneWellOutFolds`: cada pozo es un fold de prueba; el resto entrena. Mide la generalización a un pozo
 *     nuevo, que es la situación real al aplicar el modelo al pozo del TP (aun así optimista: los pozos de FORCE son
 *     de la misma cuenca; el TP es otra, ver decisión 0030).
 *
 * MÉTRICAS. Exactitud (aciertos / muestras), F1 macro (promedio no ponderado del F1 de las clases con soporte > 0 en
 * la verdad; una clase que nunca se predice cuenta con F1 = 0) y penalización media de la competencia FORCE 2020
 * (`FORCE_PENALTY_MATRIX`, menor es mejor; la puntuación oficial es su negativo).
 */

import { predictForest, trainRandomForest, argmaxRows, type ForestOptions, type TrainingMatrix } from './forest.ts';
import { FORCE_PENALTY_MATRIX } from './lithology.ts';
import { deriveSeed, mulberry32 } from './rng.ts';

export interface Fold {
  /** Índices de muestras de entrenamiento. */
  train: Int32Array;
  /** Índices de muestras de prueba. */
  test: Int32Array;
  /** Etiqueta legible (p. ej. «fold 2» o el nombre del pozo). */
  label: string;
}

export interface DepthBlockOptions {
  /** Identificador de pozo de cada muestra (enteros). */
  wellIds: ArrayLike<number>;
  /** Profundidad de cada muestra (m, creciente hacia abajo; puede venir sin ordenar). */
  depth: ArrayLike<number>;
  /** Número de folds (≥ 2). */
  nFolds: number;
  /** Largo de cada bloque contiguo, en las unidades de `depth`. */
  blockLength: number;
  /** Buffer, en las unidades de `depth`: ninguna muestra de entrenamiento queda a menos de `gap` de un bloque de prueba. */
  gap: number;
  seed?: number;
}

/**
 * Folds por bloques contiguos de profundidad, por pozo, con buffer. Garantías (testeadas en `tests/ml-validation.test.ts`):
 *  - los `test` de los folds son una partición del conjunto de muestras (cada muestra es de prueba exactamente una vez);
 *  - `train` y `test` de un mismo fold no comparten índices;
 *  - para toda muestra de train y toda de test del mismo pozo, |profundidad_train − profundidad_test| ≥ gap.
 * Las muestras con profundidad no finita se ignoran (ni train ni test).
 */
export function depthBlockFolds(opts: DepthBlockOptions): Fold[] {
  const { wellIds, depth, nFolds, blockLength, gap } = opts;
  if (!(nFolds >= 2)) throw new Error('nFolds debe ser ≥ 2.');
  if (!(blockLength > 0)) throw new Error('blockLength debe ser > 0.');
  if (!(gap >= 0)) throw new Error('gap debe ser ≥ 0.');
  const n = wellIds.length;
  if (depth.length !== n) throw new Error('wellIds y depth deben tener la misma longitud.');
  const seed = opts.seed ?? 1;

  const minDepth = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    const z = depth[i]!;
    if (!Number.isFinite(z)) continue;
    const w = wellIds[i]!;
    const cur = minDepth.get(w);
    if (cur === undefined || z < cur) minDepth.set(w, z);
  }
  const offsets = new Map<number, number>();
  for (const w of minDepth.keys()) offsets.set(w, Math.floor(mulberry32(deriveSeed(seed, w))() * nFolds));

  // Bloque y fold de cada muestra.
  const block = new Int32Array(n).fill(-1);
  const foldOf = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    const z = depth[i]!;
    if (!Number.isFinite(z)) continue;
    const w = wellIds[i]!;
    const b = Math.floor((z - minDepth.get(w)!) / blockLength);
    block[i] = b;
    foldOf[i] = (b + offsets.get(w)!) % nFolds;
  }

  const folds: Fold[] = [];
  const reach = Math.ceil(gap / blockLength) + 1;
  for (let f = 0; f < nFolds; f++) {
    const train: number[] = [];
    const test: number[] = [];
    for (let i = 0; i < n; i++) {
      if (foldOf[i]! < 0) continue;
      if (foldOf[i] === f) {
        test.push(i);
        continue;
      }
      // ¿Hay un bloque de prueba del fold f a menos de `gap`? Se revisan los bloques vecinos del mismo pozo.
      const w = wellIds[i]!;
      const z = depth[i]! - minDepth.get(w)!;
      const bi = block[i]!;
      const off = offsets.get(w)!;
      let tooClose = false;
      for (let b = Math.max(0, bi - reach); b <= bi + reach && !tooClose; b++) {
        if (b === bi || (b + off) % nFolds !== f) continue;
        const start = b * blockLength;
        const end = start + blockLength;
        const dist = z < start ? start - z : z >= end ? z - end : 0;
        if (dist < gap) tooClose = true;
      }
      if (!tooClose) train.push(i);
    }
    folds.push({ train: Int32Array.from(train), test: Int32Array.from(test), label: `fold ${f + 1}/${nFolds}` });
  }
  return folds;
}

/**
 * Un fold por pozo: prueba = todas las muestras del pozo; entrenamiento = las de los demás. `wellsPerFold` > 1 agrupa
 * pozos (leave-group-out) para abaratar el cómputo; con 1 (por defecto) es leave-one-well-out estricto.
 */
export function leaveOneWellOutFolds(wellIds: ArrayLike<number>, opts: { wellsPerFold?: number; labels?: ReadonlyMap<number, string> } = {}): Fold[] {
  const n = wellIds.length;
  const wells = [...new Set(Array.from({ length: n }, (_, i) => wellIds[i]!))].sort((a, b) => a - b);
  const per = Math.max(1, opts.wellsPerFold ?? 1);
  const folds: Fold[] = [];
  for (let s = 0; s < wells.length; s += per) {
    const group = new Set(wells.slice(s, s + per));
    const train: number[] = [];
    const test: number[] = [];
    for (let i = 0; i < n; i++) (group.has(wellIds[i]!) ? test : train).push(i);
    const names = [...group].map(w => opts.labels?.get(w) ?? String(w));
    folds.push({ train: Int32Array.from(train), test: Int32Array.from(test), label: names.join(', ') });
  }
  return folds;
}

/** Matriz de confusión K × K aplanada, `[verdad·K + predicción]`. Se ignoran los pares con clase fuera de [0, K). */
export function confusionMatrix(truth: ArrayLike<number>, pred: ArrayLike<number>, K: number): Int32Array {
  const cm = new Int32Array(K * K);
  const n = Math.min(truth.length, pred.length);
  for (let i = 0; i < n; i++) {
    const t = truth[i]!;
    const p = pred[i]!;
    if (t >= 0 && t < K && p >= 0 && p < K) cm[t * K + p]!++;
  }
  return cm;
}

export interface ClassMetrics {
  precision: number;
  recall: number;
  f1: number;
  support: number;
}

export interface Metrics {
  n: number;
  accuracy: number;
  f1Macro: number;
  /** Penalización media de la competencia FORCE 2020 (≥ 0, menor es mejor). NaN si no se pidió matriz. */
  penalty: number;
  confusion: Int32Array;
  perClass: ClassMetrics[];
}

/** Métricas de una matriz de confusión; `penaltyMatrix` es K × K (por defecto la de FORCE si K = 12, si no, NaN). */
export function metricsFromConfusion(
  confusion: Int32Array,
  K: number,
  penaltyMatrix: readonly (readonly number[])[] | null = K === 12 ? FORCE_PENALTY_MATRIX : null,
): Metrics {
  let n = 0;
  let correct = 0;
  let penalty = 0;
  const perClass: ClassMetrics[] = [];
  for (let t = 0; t < K; t++) {
    for (let p = 0; p < K; p++) {
      const v = confusion[t * K + p]!;
      n += v;
      if (t === p) correct += v;
      if (penaltyMatrix) penalty += v * penaltyMatrix[t]![p]!;
    }
  }
  let f1Sum = 0;
  let nClasses = 0;
  for (let c = 0; c < K; c++) {
    let support = 0;
    let predicted = 0;
    for (let k = 0; k < K; k++) {
      support += confusion[c * K + k]!;
      predicted += confusion[k * K + c]!;
    }
    const tp = confusion[c * K + c]!;
    const precision = predicted > 0 ? tp / predicted : 0;
    const recall = support > 0 ? tp / support : 0;
    const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
    perClass.push({ precision, recall, f1, support });
    if (support > 0) {
      f1Sum += f1;
      nClasses++;
    }
  }
  return {
    n,
    accuracy: n > 0 ? correct / n : NaN,
    f1Macro: nClasses > 0 ? f1Sum / nClasses : NaN,
    penalty: penaltyMatrix && n > 0 ? penalty / n : NaN,
    confusion,
    perClass,
  };
}

/** Métricas de predicciones contra verdad (índices de clase). */
export function evaluatePredictions(
  truth: ArrayLike<number>,
  pred: ArrayLike<number>,
  K: number,
  penaltyMatrix: readonly (readonly number[])[] | null = K === 12 ? FORCE_PENALTY_MATRIX : null,
): Metrics {
  return metricsFromConfusion(confusionMatrix(truth, pred, K), K, penaltyMatrix);
}

export interface FoldResult {
  label: string;
  nTrain: number;
  nTest: number;
  accuracy: number;
  f1Macro: number;
  penalty: number;
}

export interface CrossValidationResult {
  folds: FoldResult[];
  /** Métricas sobre todas las predicciones de prueba juntas (cada muestra de prueba aparece una vez por esquema). */
  pooled: Metrics;
  /** Media simple de las métricas por fold (los folds sin muestras se omiten) y su desvío estándar. */
  mean: { accuracy: number; f1Macro: number; penalty: number };
  std: { accuracy: number; f1Macro: number; penalty: number };
}

export interface CrossValidateOptions {
  folds: readonly Fold[];
  /** Clase verdadera de cada muestra (índice en [0, K)). */
  truth: ArrayLike<number>;
  nClasses: number;
  /**
   * Entrena con `fold.train`, predice `fold.test` y devuelve la clase predicha de cada muestra de prueba, en el
   * mismo orden que `fold.test`. NO debe usar ninguna muestra fuera de `fold.train` para ajustar nada.
   */
  fitPredict: (fold: Fold, foldIndex: number) => ArrayLike<number>;
  /** Si se da, solo las muestras de prueba para las que devuelve true cuentan en las métricas (p. ej. confianza alta). */
  includeTest?: (sampleIndex: number) => boolean;
  penaltyMatrix?: readonly (readonly number[])[] | null;
  /** Callback de progreso (log). */
  onFold?: (result: FoldResult, foldIndex: number) => void;
}

function meanStd(values: number[]): { mean: number; std: number } {
  const v = values.filter(Number.isFinite);
  if (v.length === 0) return { mean: NaN, std: NaN };
  const mean = v.reduce((s, x) => s + x, 0) / v.length;
  const variance = v.reduce((s, x) => s + (x - mean) * (x - mean), 0) / v.length;
  return { mean, std: Math.sqrt(variance) };
}

/** Validación cruzada genérica sobre folds dados. Verifica que no haya solapamiento train/test en cada fold. */
export function crossValidate(opts: CrossValidateOptions): CrossValidationResult {
  const { folds, truth, nClasses: K } = opts;
  const penaltyMatrix = opts.penaltyMatrix === undefined ? (K === 12 ? FORCE_PENALTY_MATRIX : null) : opts.penaltyMatrix;
  const pooled = new Int32Array(K * K);
  const results: FoldResult[] = [];
  folds.forEach((fold, fi) => {
    const inTrain = new Set<number>();
    for (let i = 0; i < fold.train.length; i++) inTrain.add(fold.train[i]!);
    for (let i = 0; i < fold.test.length; i++) {
      if (inTrain.has(fold.test[i]!)) throw new Error(`Fuga de datos: la muestra ${fold.test[i]} está en train y test (${fold.label}).`);
    }
    if (fold.test.length === 0) return;
    const predicted = opts.fitPredict(fold, fi);
    if (predicted.length !== fold.test.length) throw new Error('fitPredict debe devolver una predicción por muestra de prueba.');
    const t: number[] = [];
    const p: number[] = [];
    for (let i = 0; i < fold.test.length; i++) {
      const s = fold.test[i]!;
      if (opts.includeTest && !opts.includeTest(s)) continue;
      t.push(truth[s]!);
      p.push(predicted[i]!);
    }
    const cm = confusionMatrix(t, p, K);
    for (let i = 0; i < cm.length; i++) pooled[i]! += cm[i]!;
    const m = metricsFromConfusion(cm, K, penaltyMatrix);
    const r: FoldResult = { label: fold.label, nTrain: fold.train.length, nTest: t.length, accuracy: m.accuracy, f1Macro: m.f1Macro, penalty: m.penalty };
    results.push(r);
    opts.onFold?.(r, fi);
  });
  const acc = meanStd(results.map(r => r.accuracy));
  const f1 = meanStd(results.map(r => r.f1Macro));
  const pen = meanStd(results.map(r => r.penalty));
  return {
    folds: results,
    pooled: metricsFromConfusion(pooled, K, penaltyMatrix),
    mean: { accuracy: acc.mean, f1Macro: f1.mean, penalty: pen.mean },
    std: { accuracy: acc.std, f1Macro: f1.std, penalty: pen.std },
  };
}

/**
 * `fitPredict` para random forest: entrena un bosque con las filas `fold.train` de `data` y predice las de `fold.test`.
 * Cada fold entrena con una copia de las opciones (la cuantización también se calcula solo con train).
 */
export function forestFitPredict(
  data: TrainingMatrix,
  options: ForestOptions,
  minValidFeatures?: number,
): (fold: Fold) => Int16Array {
  const { X, d } = data;
  return fold => {
    const model = trainRandomForest({ ...data, rows: fold.train }, options);
    const m = fold.test.length;
    const Xt = new Float32Array(m * d);
    for (let i = 0; i < m; i++) {
      const r = fold.test[i]!;
      for (let j = 0; j < d; j++) Xt[i * d + j] = X[r * d + j]!;
    }
    const pred = predictForest(model, Xt, m, minValidFeatures === undefined ? {} : { minValidFeatures });
    return argmaxRows(pred.probabilities, m, model.classCodes.length).classIndex;
  };
}
