/**
 * Sustituto de `predict.worker-only.ts` en el bundle del hilo principal (ver ese archivo y vite.config.ts). Solo se
 * ejecuta si el Web Worker del motor no arrancó y el motor corre en proceso: la pista avisa en vez de dibujar.
 */
import type { ModelCurves } from '../../ml/features';
import type { LithologyPrediction } from '../../ml/lithologyModel';
import type { PeUsage } from './model';

export type FaciesPrediction = LithologyPrediction & { variant: 'withPe' | 'noPe'; variantReason: string };

export function predictFacies(_curves: ModelCurves, _pe: PeUsage): FaciesPrediction | null {
  return null;
}

export function faciesImportance(_variant: 'withPe' | 'noPe'): { feature: string; importance: number }[] | null {
  return null;
}
