/** Pedido aislado resuelto desde la revisión del snapshot, nunca desde un respaldo activo. */
import { entryPreparationPlan } from '../../core/state/preparation';
import { toEngineWell } from '../../core/engine/engine';
import { registry } from '../../modules';
import { resolveSnapshotInputs } from '../../core/state/inputRevisions';
import type { Project, Snapshot } from '../../core/state/project';
import type { Well } from '../../core/well';
import { runKey } from './runner';

export function snapshotRunRequest(project: Project, snapshot: Snapshot) {
  const inputs = resolveSnapshotInputs(project, snapshot);
  const plan = entryPreparationPlan(project, { well: inputs.well, interpretation: inputs.interpretation, ...(inputs.inputRevisionId ? { inputRevisionId: inputs.inputRevisionId } : {}), progress: { marks: {} } }, registry);
  const context=plan.context;
  return {
    ...inputs,
    key: runKey(snapshot.id, inputs.interpretation, { id: inputs.well.id, depth: inputs.well.depth.values, curves: inputs.well.curves }, inputs.inputRevisionId,context),
    engineWell: toEngineWell(inputs.well),
    preparation: inputs.interpretation.preparation?.nodes.length ? plan : undefined,
    context,
  };
}

function sameData(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a instanceof Float64Array && b instanceof Float64Array) {
    if (a.byteLength !== b.byteLength) return false;
    const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const y = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    return x.every((v, i) => v === y[i]);
  }
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const x = a as Record<string, unknown>, y = b as Record<string, unknown>;
  const keys = Object.keys(x);
  return keys.length === Object.keys(y).length && keys.every((key) => Object.hasOwn(y, key) && sameData(x[key], y[key]));
}

/** La cortina actual tiene un solo índice y datos puntuales compartidos: no dibujar estados incompatibles. */
export function snapshotCurtainIssue(current: Well, before: Well): string | null {
  if (current.id !== before.id) return 'Los estados pertenecen a pozos distintos.';
  if (!sameData(current.depth.values, before.depth.values)) return 'Los estados usan índices de profundidad distintos. Compará el sumario o restaurá el snapshot; la cortina requiere el mismo índice.';
  if (!sameData(current.pointSets, before.pointSets)) return 'Los estados usan datos puntuales distintos. Compará el sumario o restaurá el snapshot; la cortina no mezcla versiones de laboratorio.';
  return null;
}
