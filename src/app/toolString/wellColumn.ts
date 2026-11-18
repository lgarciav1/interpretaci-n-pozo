/**
 * Columna litológica del pozo para la formación de la escena 3D (0033 D9; también la usa Inicio, 0065): la litología
 * sugerida si el motor la calculó, si no el GR medido. Sale del pozo, no de la sarta: apagar una herramienta no cambia
 * la roca.
 */
import { convertArray, sameDimension } from '../../core/units';
import type { Interpretation } from '../../core/interpretation';
import { visibleCurves } from './select';
import { typicalStep, type RadialLog } from './radialProfile';
import type { ClientResult } from '../../core/engine/client';
import type { Well } from '../../core/well';
import { LITHOLOGY_FACIES_ID, PORT as FACIES_PORT } from '../../modules/lithology-facies/model';
import { computedCurves } from '../computed';
import { formationFromFacies, formationFromGr, type FormationColumn } from './formation';

export function wellColumn(well: Well | undefined, result: ClientResult | null): FormationColumn | null {
  if (!well) return null;
  const depth = well.depth.values;
  const facies = computedCurves(result, well).find((c) => c.moduleId === LITHOLOGY_FACIES_ID && c.port === FACIES_PORT.cls && c.active);
  const fromFacies = facies && facies.data.length === depth.length ? formationFromFacies(depth, facies.data) : null;
  if (fromFacies) return fromFacies;
  const gr = well.curves.find((c) => c.role === 'GR' && c.origin.kind === 'measured');
  return gr ? formationFromGr(depth, gr.data) : null;
}


/** Fuentes radiales de la escena. CAL se toma de la sarta disponible y DI/RXO del mismo ajuste publicado. */
export function wellRadialLog(well: Well, interpretation: Interpretation, result: ClientResult | null): RadialLog {
  const depth = well.depth.values;
  const eligible = visibleCurves(well, interpretation).filter(c => c.origin.kind === 'measured' && sameDimension(c.unit, 'in') && c.data.length === depth.length);
  // El motor resuelve las preferencias suspendidas cuando cambia la sarta.
  const source = result ? result.sources.CALI : interpretation.sources.CALI;
  const curve = source?.kind === 'curve' ? eligible.find(c => c.id === source.curveId && c.role === 'CALI') : eligible.find(c => c.role === 'CALI');
  const log: RadialLog = { depth, step: well.depth.step ?? typicalStep(depth) };
  if (curve && (!result || source)) log.cal = convertArray(curve.data, curve.unit, 'in');
  const calculated = computedCurves(result, well).filter(c => c.moduleId === 'invasion-step' && c.data.length === depth.length);
  for (const c of calculated) {
    if (c.port === 'DI') log.di = c.data;
    if (c.port === 'RXO') log.rxo = c.data;
  }
  return log;
}
