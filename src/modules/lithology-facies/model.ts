/**
 * Constantes y lectura de parámetros del módulo de facies (fase 10c). Puro: lo usan la definición (worker), la pista
 * (hilo principal) y los tests. No importa el modelo embebido.
 */
import type { ParamState } from '../../core/params';
import { LITHOLOGY_CLASSES } from '../../ml/lithology';

export const LITHOLOGY_FACIES_ID = 'lithology-facies';
export const LITHOLOGY_FACIES_OVERLAY_ID = 'lithology-facies';

/** Puertos de curva (roles propios del módulo). Las clases son el índice FORCE 0–11 de `LITHOLOGY_CLASSES`. */
export const PORT = {
  cls: 'LITH_ML',
  conf: 'LITH_ML_P',
  cls2: 'LITH_ML_2',
  conf2: 'LITH_ML_P2',
  cls3: 'LITH_ML_3',
  conf3: 'LITH_ML_P3',
} as const;
export const SUMMARY_TABLE = 'LITH_ML_SUMMARY';

export const CLASS_COUNT = LITHOLOGY_CLASSES.length;
export const classLabel = (index: number): string => LITHOLOGY_CLASSES[index]?.label ?? '—';

/**
 * Clases que el modelo apenas distingue: F1 < 0,25 en la validación leave-one-well-out del modelo sin PE
 * (docs/decisiones/0030-modelos-de-facies-metricas.md): Arenisca/Lutita 0,18, Marga 0,20, Dolomía 0, Creta 0,10,
 * Toba 0,05, Basamento 0. La pista las atenúa y el tooltip lo dice; no se ocultan (la probabilidad sigue a la vista).
 */
export const LOW_SKILL_CLASSES: ReadonlySet<number> = new Set([1, 3, 4, 6, 9, 11]);

export const DEFAULT_MIN_CONFIDENCE = 0.4;

export type PeUsage = 'auto' | 'use' | 'ignore';

const key = (k: string) => `${LITHOLOGY_FACIES_ID}.${k}`;

/** Umbral de confianza vigente (global), resuelto como el motor: lo guardado o el de fábrica. */
export function minConfidenceOf(params: Pick<ParamState, 'global'>): number {
  const v = params.global[key('minConfidence')];
  return typeof v === 'number' && Number.isFinite(v) ? v : DEFAULT_MIN_CONFIDENCE;
}

export const TRANSFER_WARNING =
  'Es una sugerencia con probabilidad, no una litología medida: el modelo se entrenó con 98 pozos del Mar del Norte (FORCE 2020) y sus métricas de validación son de esa cuenca. Contrastala con corona, recortes o la columna sedimentológica.';
