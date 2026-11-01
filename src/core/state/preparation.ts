import { toEngineWell } from '../engine/engine';
import { curveProvenance, identityKey } from '../engine/context';
import { preparationBindings } from '../preparation/bindings';
import { planPreparation, type PreparationPlan } from '../preparation/plan';
import { preparedCurveId } from '../preparation/source';
import { validatePreparation, type MaskInterval, type MaskNode } from '../preparation/state';
import type { Registry } from '../registry';
import { enableProjectInputRevisions } from './inputRevisions';
import { updateInterpretation, type Project, type WellEntry } from './project';

const plans = new WeakMap<WellEntry, { revisionsKey: string; registry: Registry; plan: PreparationPlan }>();
export function entryPreparationPlan(project: Project, entry: WellEntry, registry: Registry): PreparationPlan {
  const hit = plans.get(entry);
  const revisionsKey = project.inputRevisions ? identityKey(project.inputRevisions) : 'legacy';
  if (hit && hit.revisionsKey === revisionsKey && hit.registry === registry) return hit.plan;
  const plan = planPreparation(toEngineWell(entry.well), entry.interpretation, entry.inputRevisionId ?? null, registry, preparationBindings(entry.interpretation, entry.well.id, project.inputRevisions));
  plans.set(entry, { revisionsKey, registry, plan }); return plan;
}

/** Una sola receta: migración optativa, máscara y selección explícita se aceptan juntas. */
export function addMaskInterval(project: Project, wellId: string, curveId: string, interval: MaskInterval, nodeId: string): Project {
  const next = enableProjectInputRevisions(project);
  const entry = next.wells.find(e => e.well.id === wellId);
  const curve = entry?.well.curves.find(c => c.id === curveId);
  if (!entry || !curve) throw new Error('La curva original ya no existe.');
  const depth = entry.well.depth.values;
  if (!Number.isFinite(interval.top) || !Number.isFinite(interval.base) || interval.base < interval.top || interval.top < depth[0]! || interval.base > depth.at(-1)!) throw new Error('Elegí un intervalo dentro del pozo, con base mayor o igual al tope.');
  // No aceptar un tramo sin ninguna muestra.
  let lo = 0, hi = depth.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (depth[mid]! < interval.top) lo = mid + 1; else hi = mid; }
  if (lo >= depth.length || depth[lo]! > interval.base) throw new Error('El intervalo no contiene muestras.');
  const existing = entry.interpretation.preparation?.nodes.find(n => n.input.curveId === curveId);
  if (existing) {
    const binding = preparationBindings(entry.interpretation, wellId, next.inputRevisions)[existing.id];
    const depthKey = `depth:${identityKey(depth)}`;
    if (!binding || binding.depthKey !== depthKey || binding.contentVersion !== curveProvenance(curve, depthKey).contentVersion || binding.unit !== curve.unit || binding.role !== curve.role || binding.mnemonic !== curve.mnemonic) throw new Error('La máscara está vinculada a otros datos. Restaurá el original antes de preparar esta revisión.');
  }
  const node: MaskNode = existing ? { ...existing, enabled: true, intervals: [...existing.intervals, interval] } : {
    id: nodeId, kind: 'mask', methodVersion: 1, enabled: true, input: { kind: 'original', inputRevisionId: entry.inputRevisionId!, curveId }, intervals: [interval],
  };
  const previousNodes = entry.interpretation.preparation?.nodes ?? [];
  const preparation = { schemaVersion: 1 as const, nodes: existing ? previousNodes.map(n => n.id === node.id ? node : n) : [...previousNodes, node] };
  validatePreparation(preparation);
  return updateInterpretation(next, wellId, i => ({ ...i, preparation, sources: curve.role ? { ...i.sources, [curve.role]: { kind: 'curve', curveId: preparedCurveId(node.id, 'masked') } } : i.sources }));
}

/** Restaurar la última exclusión vuelve explícitamente a su original, nunca a otra fuente por defecto. */
export function restoreMaskInterval(project: Project, wellId: string, nodeId: string, intervalId?: string): Project {
  return updateInterpretation(project, wellId, i => {
    const node = i.preparation?.nodes.find(n => n.id === nodeId);
    if (!node) return i;
    const present = project.wells.find(e => e.well.id === wellId)?.well.curves.some(c => c.id === node.input.curveId);
    if (!present && Object.values(i.sources).some(ref => ref.kind === 'curve' && ref.curveId === preparedCurveId(nodeId, 'masked'))) throw new Error('El original ya no está en la revisión activa. Elegí otra fuente antes de quitar esta máscara.');
    const intervals = intervalId ? node.intervals.filter(r => r.id !== intervalId) : [];
    if (intervals.length === node.intervals.length) return i;
    const nodes = i.preparation!.nodes.flatMap(n => n.id !== nodeId ? [n] : intervals.length ? [{ ...node, intervals }] : []);
    const sources = { ...i.sources };
    if (!intervals.length) for (const [port, ref] of Object.entries(sources)) if (ref.kind === 'curve' && ref.curveId === preparedCurveId(nodeId, 'masked')) sources[port] = { kind: 'curve', curveId: node.input.curveId };
    const { preparation: _old, ...rest } = i;
    return { ...rest, sources, ...(nodes.length ? { preparation: { schemaVersion: 1, nodes } as const } : {}) };
  });
}
