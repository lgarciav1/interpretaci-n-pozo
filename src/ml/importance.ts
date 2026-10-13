/**
 * Importancia por permutación (Breiman 2001; Fisher, Rudin y Dominici 2019): cuánto empeora una métrica cuando se
 * destruye la información de UNA característica barajando sus valores entre muestras.
 *
 *   importancia_j = métrica(base) − promedio_r métrica(X con la columna j permutada, repetición r)
 *
 * (para métricas «mayor es mejor»; para la penalización de la competencia, «menor es mejor», se invierte el signo,
 * de modo que una importancia positiva siempre significa «la característica ayuda»). Ventajas sobre la importancia
 * por impureza (MDI, almacenada en el modelo): se calcula sobre datos NO usados para entrenar y no favorece
 * características continuas. Límite: con características correlacionadas (RHOB–NPHI–DTC lo son) la importancia se
 * reparte o se subestima, porque el modelo compensa con la correlada.
 *
 * Es una función pura: recibe un `predict` (matriz → clases) y no conoce el modelo. `groups` opcional restringe la
 * permutación a dentro de cada grupo (p. ej. dentro de cada pozo), para no mezclar niveles de pozos distintos.
 */

import { evaluatePredictions } from './validation.ts';
import { deriveSeed, mulberry32, shuffleInPlace } from './rng.ts';

export type ImportanceMetric = 'accuracy' | 'f1Macro' | 'penalty';

export interface PermutationImportanceOptions {
  /** Matriz de características n × d fila a fila (NaN = sin dato). */
  X: ArrayLike<number>;
  n: number;
  d: number;
  /** Clase verdadera de cada fila (índice en [0, nClasses)). */
  truth: ArrayLike<number>;
  nClasses: number;
  /** Predicción de clases (índices) para una matriz n × d; no debe mutar la entrada. */
  predict: (X: Float32Array, n: number) => ArrayLike<number>;
  metric?: ImportanceMetric;
  /** Repeticiones del barajado por característica (por defecto 5). */
  repeats?: number;
  seed?: number;
  /** Grupo de cada fila; si se da, se baraja solo dentro de cada grupo. */
  groups?: ArrayLike<number>;
  /** Nombres de las características, para el resultado. */
  featureNames?: readonly string[];
}

export interface PermutationImportanceResult {
  featureNames: string[];
  metric: ImportanceMetric;
  /** Valor de la métrica sin permutar. */
  baseline: number;
  /** Caída media de la métrica (positivo = la característica ayuda), por característica. */
  importance: Float64Array;
  /** Desvío estándar entre repeticiones. */
  std: Float64Array;
}

function metricValue(metric: ImportanceMetric, truth: ArrayLike<number>, pred: ArrayLike<number>, K: number): number {
  const m = evaluatePredictions(truth, pred, K);
  if (metric === 'accuracy') return m.accuracy;
  if (metric === 'f1Macro') return m.f1Macro;
  return -m.penalty; // mayor es mejor
}

/** Importancia por permutación de cada característica. Determinística para la misma semilla. */
export function permutationImportance(opts: PermutationImportanceOptions): PermutationImportanceResult {
  const { X, n, d, truth, nClasses: K } = opts;
  const metric = opts.metric ?? 'f1Macro';
  const repeats = Math.max(1, opts.repeats ?? 5);
  const seed = opts.seed ?? 1;
  const base = Float32Array.from({ length: n * d }, (_, i) => X[i]!);
  const baseline = metricValue(metric, truth, opts.predict(base, n), K);

  // Grupos → listas de filas.
  const groupRows: Int32Array[] = [];
  if (opts.groups) {
    const map = new Map<number, number[]>();
    for (let i = 0; i < n; i++) {
      const g = opts.groups[i]!;
      const list = map.get(g);
      if (list) list.push(i);
      else map.set(g, [i]);
    }
    for (const list of map.values()) groupRows.push(Int32Array.from(list));
  } else {
    groupRows.push(Int32Array.from({ length: n }, (_, i) => i));
  }

  const importance = new Float64Array(d);
  const std = new Float64Array(d);
  const work = new Float32Array(base);
  for (let j = 0; j < d; j++) {
    const drops: number[] = [];
    for (let rep = 0; rep < repeats; rep++) {
      const rng = mulberry32(deriveSeed(seed, j * 1009 + rep));
      work.set(base);
      for (const rows of groupRows) {
        const perm = Int32Array.from(rows);
        shuffleInPlace(perm, rng);
        for (let q = 0; q < rows.length; q++) work[rows[q]! * d + j] = base[perm[q]! * d + j]!;
      }
      drops.push(baseline - metricValue(metric, truth, opts.predict(work, n), K));
    }
    const mean = drops.reduce((s, x) => s + x, 0) / drops.length;
    importance[j] = mean;
    std[j] = Math.sqrt(drops.reduce((s, x) => s + (x - mean) ** 2, 0) / drops.length);
  }
  return {
    featureNames: opts.featureNames ? [...opts.featureNames] : Array.from({ length: d }, (_, j) => `f${j}`),
    metric,
    baseline: metric === 'penalty' ? -baseline : baseline,
    importance,
    std,
  };
}
