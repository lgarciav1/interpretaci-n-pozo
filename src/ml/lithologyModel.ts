/**
 * API de alto nivel para litología: curvas → probabilidades por clase, clase ganadora y confianza.
 *
 * Es la parte que consume la interfaz (fase 10c). No importa nada de React ni del DOM.
 */

import { argmaxRows, predictForest, type ForestModel } from './forest.ts';
import { buildFeatureMatrix, type CurveKey, type FeatureName, type FeatureOptions, type ModelCurves } from './features.ts';
import { LITHOLOGY_CLASSES, type LithologyClass } from './lithology.ts';

export interface LithologyPrediction {
  n: number;
  nClasses: number;
  /** Clases del modelo, en el orden de las columnas de `probabilities`. */
  classes: LithologyClass[];
  /** Índice (en `classes`) de la clase ganadora de cada muestra. */
  classIndex: Int16Array;
  /** Código FORCE 2020 de la clase ganadora de cada muestra. */
  classCode: Int32Array;
  /** Probabilidades n × nClasses fila a fila (cada fila suma 1; nunca NaN). */
  probabilities: Float32Array;
  /** Probabilidad de la clase ganadora. */
  confidence: Float32Array;
  /** 1 si la muestra tuvo suficientes características con dato; 0 si se devolvió la distribución a priori. */
  valid: Uint8Array;
  /** Curvas que el modelo necesita y no se proporcionaron. */
  missingCurves: CurveKey[];
  featureNames: FeatureName[];
}

export interface LithologyPredictOptions extends FeatureOptions {
  /** Mínimo de características con dato para predecir con el bosque (por defecto 2). */
  minValidFeatures?: number;
}

/** Clases de un modelo de litología, resueltas por código (un código desconocido se nombra «Clase <código>»). */
export function modelClasses(model: ForestModel): LithologyClass[] {
  return Array.from(model.classCodes, (code, index) => {
    const known = LITHOLOGY_CLASSES.find(c => c.code === code);
    return known ? { ...known, index } : { index, code, name: `Class ${code}`, label: `Clase ${code}` };
  });
}

/**
 * Predice la litología de cada muestra. `curves` lleva las curvas en las unidades documentadas en `features.ts`
 * (resistividad en ohm·m, sin log; neutrón en v/v o %, se detecta). Las curvas que el modelo necesita y faltan se
 * tratan como sin dato; la lista se devuelve en `missingCurves`. Las muestras sin datos suficientes reciben la
 * distribución a priori del entrenamiento y `valid = 0`.
 */
export function predictLithology(model: ForestModel, curves: ModelCurves, opts: LithologyPredictOptions = {}): LithologyPrediction {
  const featureNames = model.featureNames as FeatureName[];
  const fm = buildFeatureMatrix(curves, featureNames, opts);
  const pred = predictForest(model, fm.X, fm.n, opts.minValidFeatures === undefined ? {} : { minValidFeatures: opts.minValidFeatures });
  const K = model.classCodes.length;
  const { classIndex, confidence } = argmaxRows(pred.probabilities, fm.n, K);
  const classCode = new Int32Array(fm.n);
  for (let i = 0; i < fm.n; i++) classCode[i] = model.classCodes[classIndex[i]!]!;
  return {
    n: fm.n,
    nClasses: K,
    classes: modelClasses(model),
    classIndex,
    classCode,
    probabilities: pred.probabilities,
    confidence,
    valid: pred.valid,
    missingCurves: fm.missingCurves,
    featureNames,
  };
}

/** Importancia por impureza (MDI) del modelo, por característica (suma 1), ordenada de mayor a menor. */
export function modelImportance(model: ForestModel): { feature: string; importance: number }[] {
  return model.featureNames
    .map((feature, j) => ({ feature, importance: model.importance[j]! }))
    .sort((a, b) => b.importance - a.importance);
}
