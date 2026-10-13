/**
 * Modelos de litología embebidos en el build (entrenados offline con FORCE 2020; ver `tools/ml/train.mjs`).
 *
 * Hay DOS variantes porque el PE del pozo del TP es sospechoso de baritina (decisión 0029): `withPe` usa
 * GR, RHOB, NPHI, PEF, DTC y log10 RDEP; `noPe` omite el PEF. La inferencia usa solo el modelo serializado, nunca el
 * dataset. Cada modelo se decodifica (zlib + base64) la primera vez que se pide y queda en caché.
 */

import { detectSuspectPe } from '../petro/mineralogy.ts';
import { type ForestModel } from './forest.ts';
import { predictLithology, type LithologyPrediction, type LithologyPredictOptions } from './lithologyModel.ts';
import { type ModelCurves } from './features.ts';
import { EMBEDDED_LITHOLOGY_MODELS } from './model/lithologyModels.ts';
import { decodeModelText } from './serialize.ts';

export type LithologyVariant = 'withPe' | 'noPe';

const cache = new Map<LithologyVariant, ForestModel>();

/** Modelo embebido de la variante pedida (decodifica y cachea). */
export function getLithologyModel(variant: LithologyVariant): ForestModel {
  let model = cache.get(variant);
  if (!model) {
    const text = EMBEDDED_LITHOLOGY_MODELS[variant];
    if (!text) throw new Error(`No hay modelo embebido para la variante «${variant}».`);
    model = decodeModelText(text);
    cache.set(variant, model);
  }
  return model;
}

export type PeUsage = 'auto' | 'use' | 'ignore';

export interface VariantChoice {
  variant: LithologyVariant;
  /** Fracción de muestras con la firma de baritina (PE > 4 b/e con ρb < 2,55 g/cm³); NaN si no se pudo evaluar. */
  suspectFraction: number;
  /** Por qué se eligió esa variante (texto para mostrar en un aviso). */
  reason: string;
}

/**
 * Elige la variante: 'use' → con PE; 'ignore' → sin PE; 'auto' (por defecto) → sin PE si falta la curva PE o si
 * `detectSuspectPe` la marca sospechosa (misma regla que la inversión mineral, decisión 0029).
 */
export function chooseLithologyVariant(curves: ModelCurves, usage: PeUsage = 'auto'): VariantChoice {
  if (usage === 'ignore') return { variant: 'noPe', suspectFraction: NaN, reason: 'PE ignorado por elección del usuario.' };
  if (!curves.PEF) return { variant: 'noPe', suspectFraction: NaN, reason: 'No hay curva de PE: se usa el modelo sin PE.' };
  if (usage === 'use') return { variant: 'withPe', suspectFraction: NaN, reason: 'PE usado por elección del usuario.' };
  if (!curves.RHOB) return { variant: 'noPe', suspectFraction: NaN, reason: 'Sin densidad no se puede validar el PE: se usa el modelo sin PE.' };
  const det = detectSuspectPe(curves.PEF, curves.RHOB);
  return det.suspect
    ? { variant: 'noPe', suspectFraction: det.fraction, reason: `PE sospechoso de baritina (${(det.fraction * 100).toFixed(0)} % de las muestras con PE > 4 b/e y ρb < 2,55 g/cm³): se usa el modelo sin PE.` }
    : { variant: 'withPe', suspectFraction: det.fraction, reason: 'PE compatible con la densidad: se usa el modelo con PE.' };
}

/** Predice con el modelo embebido elegido según el PE. Devuelve también la variante usada y el motivo. */
export function predictLithologyEmbedded(
  curves: ModelCurves,
  opts: LithologyPredictOptions & { pe?: PeUsage } = {},
): LithologyPrediction & { variant: LithologyVariant; variantReason: string } {
  const choice = chooseLithologyVariant(curves, opts.pe ?? 'auto');
  const prediction = predictLithology(getLithologyModel(choice.variant), curves, opts);
  return { ...prediction, variant: choice.variant, variantReason: choice.reason };
}
