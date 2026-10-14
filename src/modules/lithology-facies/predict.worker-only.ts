/**
 * Predicción con el random forest embebido (~1,4 MB de texto, `src/ml/model/lithologyModels.ts`).
 *
 * SOLO WORKER: en el build, el bundle del hilo principal reemplaza este archivo por `predict.main-thread.ts`
 * (plugin `workerOnlyFiles` de vite.config.ts; convención en docs/arquitectura.md, «Archivos solo-worker»), así el modelo viaja una sola vez, dentro del Web Worker del motor.
 * En desarrollo y en los tests (Vitest) se usa este archivo en los dos lados. Ambos exportan la misma API.
 */
import { getLithologyModel, predictLithologyEmbedded } from '../../ml/embedded';
import type { ModelCurves } from '../../ml/features';
import { modelImportance, type LithologyPrediction } from '../../ml/lithologyModel';
import type { PeUsage } from './model';

export type FaciesPrediction = LithologyPrediction & { variant: 'withPe' | 'noPe'; variantReason: string };

/** null = el modelo no está disponible en este hilo (solo pasa en el motor en proceso del build). */
export function predictFacies(curves: ModelCurves, pe: PeUsage): FaciesPrediction | null {
  // Las entradas llegan en la unidad canónica de su rol: el neutrón ya está en v/v.
  return predictLithologyEmbedded(curves, { pe, nphiUnit: 'fraction' });
}

/** Importancia por impureza (MDI) guardada en el modelo de la variante, de mayor a menor (suma 1). */
export function faciesImportance(variant: 'withPe' | 'noPe'): { feature: string; importance: number }[] | null {
  return modelImportance(getLithologyModel(variant));
}
