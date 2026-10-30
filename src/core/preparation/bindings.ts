import { curveProvenance, identityKey } from '../engine/context';
import type { InputRevision } from '../inputs/revisions';
import type { Interpretation } from '../interpretation';
import type { PreparationBindings } from './plan';
import { validatePreparation } from './state';
import { interpolationSourceProblem } from './interpolation';

export function preparationBindings(i: Interpretation, wellId: string, revisions: Readonly<Record<string, InputRevision>> | undefined): PreparationBindings {
  if (i.preparation === undefined) return {};
  validatePreparation(i.preparation);
  return Object.fromEntries(i.preparation.nodes.map(node => {
    const revision = revisions?.[node.input.inputRevisionId];
    if (!revision || revision.wellId !== wellId) throw new Error('La preparación refiere a una revisión inexistente o de otro pozo.');
    const c = revision.well.curves.find(c => c.id === node.input.curveId);
    if (!c) throw new Error('La curva original fijada por la preparación no existe en su revisión.');
    if (node.kind === 'linear-interpolation') {
      const problem = interpolationSourceProblem(c);
      if (problem) throw new Error(problem);
    }
    if (node.kind === 'linear-interpolation' && (node.gapFill.top < revision.well.depth.values[0]! || node.gapFill.base > revision.well.depth.values.at(-1)!)) throw new Error('El tramo de interpolación está fuera de las entradas fijadas.');
    const depthKey = `depth:${identityKey(revision.well.depth.values)}`;
    return [node.id, { depthKey, contentVersion: curveProvenance(c, depthKey).contentVersion, mnemonic: c.mnemonic, unit: c.unit, role: c.role }];
  }));
}
