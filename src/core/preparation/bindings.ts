import { curveProvenance, identityKey } from '../engine/context';
import type { InputRevision } from '../inputs/revisions';
import type { Interpretation } from '../interpretation';
import type { PreparationBindings } from './plan';
import { validatePreparation, nodeGapFill, nodeFilter } from './state';
import { interpolationSourceProblem } from './interpolation';
import { validateMgtInputs, mgtAcquisitionKey } from './mgt';

export function preparationBindings(i: Interpretation, wellId: string, revisions: Readonly<Record<string, InputRevision>> | undefined, activeRevisionId?: string): PreparationBindings {
  if (i.preparation === undefined) return {};
  validatePreparation(i.preparation);
  return Object.fromEntries(i.preparation.nodes.map(node => {
    const revision = revisions?.[node.input.inputRevisionId];
    if (!revision || revision.wellId !== wellId) throw new Error('La preparación refiere a una revisión inexistente o de otro pozo.');
    const c = revision.well.curves.find(c => c.id === node.input.curveId);
    if (!c) throw new Error('La curva original fijada por la preparación no existe en su revisión.');
    if (node.kind !== 'mask') {
      const problem = interpolationSourceProblem(c, node.kind === 'median-filter' ? 'El filtro' : undefined);
      if (problem) throw new Error(problem);
    }
    const gapFill = nodeGapFill(node);
    if (gapFill && (gapFill.top < revision.well.depth.values[0]! || gapFill.base > revision.well.depth.values.at(-1)!)) throw new Error('El tramo de interpolación está fuera de las entradas fijadas.');
    const filter = nodeFilter(node);
    if (filter && (filter.top < revision.well.depth.values[0]! || filter.base > revision.well.depth.values.at(-1)!)) throw new Error('El tramo del filtro está fuera de las entradas fijadas.');
    const target = activeRevisionId ? revisions?.[activeRevisionId] : revision;
    let mgt;
      if (node.kind === "mgt-borehole") {
        const inputs = validateMgtInputs(
          revision.well,
          revision.acquisition,
          c.id,
          node.mgt,
        );
        const currentCaliper = target?.well.curves.find(
          (x) => x.id === inputs.caliper.id,
        );
        if (
          !target ||
          mgtAcquisitionKey(target.acquisition) !==
            mgtAcquisitionKey(revision.acquisition) ||
          currentCaliper?.data !== inputs.caliper.data ||
          currentCaliper.unit !== inputs.caliper.unit ||
          currentCaliper.role !== inputs.caliper.role ||
          currentCaliper.mnemonic !== inputs.caliper.mnemonic
        )
          return [node.id, null];
        if (
          node.enabled &&
          i.preparation!.nodes.some(
            (n) =>
              n.enabled &&
              n.id !== node.id &&
              n.input.curveId === inputs.caliper.id,
          )
        )
          throw new Error(
            "MGT v1 no admite caliper preparado; retiralo antes de corregir GR.",
          );
        mgt = {
          caliperContentVersion: curveProvenance(
            inputs.caliper,
            `depth:${identityKey(revision.well.depth.values)}`,
          ).contentVersion,
          caliperUnit: inputs.caliper.unit,
          acquisitionKey: mgtAcquisitionKey(revision.acquisition),
        };
      }
      const shiftFrame = node.kind === 'constant-shift' ? { referenceId: wellId, sourceDatum: revision.acquisition.depth.datum, targetDatum: target?.acquisition.depth.datum ?? null } : undefined;
    if (node.kind === 'constant-shift' && (node.shift.referenceId !== wellId || !target || target.wellId !== wellId || [shiftFrame!.sourceDatum, shiftFrame!.targetDatum].some(d => d !== null && d !== node.shift.datum))) throw new Error('La referencia o datum de la alineación no coincide con las entradas.');
    const depthKey = `depth:${identityKey(revision.well.depth.values)}`;
    return [node.id, { ...(shiftFrame ? { shiftFrame } : {}), ...(mgt ? { mgt } : {}), depthKey, contentVersion: curveProvenance(c, depthKey).contentVersion, mnemonic: c.mnemonic, unit: c.unit, role: c.role }];
  }));
}
