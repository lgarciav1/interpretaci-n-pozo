/**
 * Columna litológica del pozo para la formación de la escena 3D (0033 D9; también la usa Inicio, 0065): la litología
 * sugerida si el motor la calculó, si no el GR medido. Sale del pozo, no de la sarta: apagar una herramienta no cambia
 * la roca.
 */
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

