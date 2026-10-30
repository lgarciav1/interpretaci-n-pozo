import { toEngineWell } from '../engine/engine';
import { curveProvenance, identityKey } from '../engine/context';
import { interpolationSourceProblem } from '../preparation/interpolation';
import { preparationBindings } from '../preparation/bindings';
import { planPreparation, type PreparationPlan } from '../preparation/plan';
import { preparedCurveId } from '../preparation/source';
import { preparationState, validateGapFill, validateMedianFilter, nodeGapFill, type MedianFilter, validatePreparation, type GapFill, type MaskInterval, type PreparationNode } from '../preparation/state';
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
  return addMaskIntervals(project, wellId, curveId, [interval], nodeId);
}

/** Acepta un lote revisado como una sola decisión, sin publicar estados intermedios. */
export function addMaskIntervals(project: Project, wellId: string, curveId: string, intervals: MaskInterval[], nodeId: string): Project {
  if (!intervals.length || intervals.length > 256) throw new Error('Elegí entre 1 y 256 muestras o intervalos.');
  const next = enableProjectInputRevisions(project);
  const entry = next.wells.find(e => e.well.id === wellId);
  const curve = entry?.well.curves.find(c => c.id === curveId);
  if (!entry || !curve) throw new Error('La curva original ya no existe.');
  const depth = entry.well.depth.values;
  for (const interval of intervals) {
    if (!Number.isFinite(interval.top) || !Number.isFinite(interval.base) || interval.base < interval.top || interval.top < depth[0]! || interval.base > depth.at(-1)!) throw new Error('Elegí un intervalo dentro del pozo, con base mayor o igual al tope.');
    // No aceptar un tramo sin ninguna muestra.
    let lo = 0, hi = depth.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (depth[mid]! < interval.top) lo = mid + 1; else hi = mid; }
    if (lo >= depth.length || depth[lo]! > interval.base) throw new Error('El intervalo no contiene muestras.');
  }
  const existing = entry.interpretation.preparation?.nodes.find(n => n.input.curveId === curveId);
  if (existing) {
    const binding = preparationBindings(entry.interpretation, wellId, next.inputRevisions)[existing.id];
    const depthKey = `depth:${identityKey(depth)}`;
    if (!binding || binding.depthKey !== depthKey || binding.contentVersion !== curveProvenance(curve, depthKey).contentVersion || binding.unit !== curve.unit || binding.role !== curve.role || binding.mnemonic !== curve.mnemonic) throw new Error('La máscara está vinculada a otros datos. Restaurá el original antes de preparar esta revisión.');
  }
  const node: PreparationNode = existing ? { ...existing, enabled: true, intervals: [...existing.intervals, ...intervals] } : {
    id: nodeId, kind: 'mask', methodVersion: 1, enabled: true, input: { kind: 'original', inputRevisionId: entry.inputRevisionId!, curveId }, intervals: [...intervals],
  };
  const previousNodes = entry.interpretation.preparation?.nodes ?? [];
  const preparation = preparationState(existing ? previousNodes.map(n => n.id === node.id ? node : n) : [...previousNodes, node]);
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
    if (intervalId && intervals.length === node.intervals.length) return i;
    const keep = !!intervalId && (intervals.length > 0 || node.kind !== 'mask');
    const nodes = i.preparation!.nodes.flatMap(n => n.id !== nodeId ? [n] : keep ? [{ ...node, intervals }] : []);
    const sources = { ...i.sources };
    if (!keep) for (const [port, ref] of Object.entries(sources)) if (ref.kind === 'curve' && ref.curveId === preparedCurveId(nodeId, 'masked')) sources[port] = { kind: 'curve', curveId: node.input.curveId };
    const { preparation: _old, ...rest } = i;
    return { ...rest, sources, ...(nodes.length ? { preparation: preparationState(nodes) } : {}) };
  });
}

/** Una receta por curva: se conservan las exclusiones y su referencia al original. */
export function setGapFill(project: Project, wellId: string, curveId: string, gapFill: GapFill, nodeId: string): Project {
  validateGapFill(gapFill);
  const next = enableProjectInputRevisions(project);
  const entry = next.wells.find(e => e.well.id === wellId), curve = entry?.well.curves.find(c => c.id === curveId);
  if (!entry || !curve) throw new Error('La curva original ya no existe.');
  const problem = interpolationSourceProblem(curve);
  if (problem) throw new Error(problem);
  const depth = entry.well.depth.values;
  if (gapFill.top < depth[0]! || gapFill.base > depth.at(-1)!) throw new Error('Elegí un tramo de interpolación dentro del pozo.');
  const existing = entry.interpretation.preparation?.nodes.find(n => n.input.curveId === curveId);
  if (existing) {
    const binding = preparationBindings(entry.interpretation, wellId, next.inputRevisions)[existing.id];
    const depthKey = `depth:${identityKey(depth)}`;
    if (!binding || binding.depthKey !== depthKey || binding.contentVersion !== curveProvenance(curve, depthKey).contentVersion || binding.unit !== curve.unit || binding.role !== curve.role || binding.mnemonic !== curve.mnemonic) throw new Error('La receta está vinculada a otros datos. Restaurá el original antes de preparar esta revisión.');
  }
  const id = existing?.id ?? nodeId;
  const source = curve.role ? entry.interpretation.sources[curve.role] : undefined;
  const oldFill = existing ? nodeGapFill(existing) : undefined;
  if (oldFill && existing!.enabled && oldFill.top === gapFill.top && oldFill.base === gapFill.base && oldFill.maxGapM === gapFill.maxGapM && (!curve.role || source?.kind === 'curve' && source.curveId === preparedCurveId(id, 'masked'))) return project;
  const node: PreparationNode = { id, ...(existing?.kind === 'median-filter' ? { kind: 'median-filter' as const, filter: existing.filter } : { kind: 'linear-interpolation' as const }), methodVersion: 1, enabled: true,
    input: existing?.input ?? { kind: 'original', inputRevisionId: entry.inputRevisionId!, curveId }, intervals: existing?.intervals ?? [], gapFill: { ...gapFill } };
  const nodes = entry.interpretation.preparation?.nodes ?? [];
  const preparation = preparationState(existing ? nodes.map(n => n.id === id ? node : n) : [...nodes, node]);
  validatePreparation(preparation);
  return updateInterpretation(next, wellId, i => ({ ...i, preparation, sources: curve.role ? { ...i.sources, [curve.role]: { kind: 'curve', curveId: preparedCurveId(id, 'masked') } } : i.sources }));
}

/** Quita sólo la estimación; las exclusiones y la identidad de salida se conservan. */
export function removeGapFill(project: Project, wellId: string, nodeId: string): Project {
  const node = project.wells.find(e => e.well.id === wellId)?.interpretation.preparation?.nodes.find(n => n.id === nodeId);
  if (!node || !nodeGapFill(node)) return project;
  if (!node.intervals.length && node.kind !== 'median-filter') return restoreMaskInterval(project, wellId, nodeId);
  return updateInterpretation(project, wellId, i => ({ ...i, preparation: preparationState(i.preparation!.nodes.map(n => {
    if (n.id !== nodeId || n.kind === 'mask') return n;
    const { gapFill: _removed, ...rest } = n;
    if (n.kind === 'median-filter') return { ...rest, kind: 'median-filter' as const, filter: n.filter };
    return { ...rest, kind: 'mask' as const };
  })) }));
}


export function setMedianFilter(project: Project, wellId: string, curveId: string, filter: MedianFilter, nodeId: string): Project {
  validateMedianFilter(filter);
  const next = enableProjectInputRevisions(project), entry = next.wells.find(e => e.well.id === wellId), curve = entry?.well.curves.find(c => c.id === curveId);
  if (!entry || !curve) throw new Error('La curva original ya no existe.');
  const problem = interpolationSourceProblem(curve, 'El filtro');
  if (problem) throw new Error(problem);
  const depth = entry.well.depth.values;
  if (filter.top < depth[0]! || filter.base > depth.at(-1)!) throw new Error('Elegí un tramo de filtrado dentro del pozo.');
  const existing = entry.interpretation.preparation?.nodes.find(n => n.input.curveId === curveId);
  if (existing) {
    const binding = preparationBindings(entry.interpretation, wellId, next.inputRevisions)[existing.id], depthKey = `depth:${identityKey(depth)}`;
    if (!binding || binding.depthKey !== depthKey || binding.contentVersion !== curveProvenance(curve, depthKey).contentVersion || binding.unit !== curve.unit || binding.role !== curve.role || binding.mnemonic !== curve.mnemonic) throw new Error('La receta está vinculada a otros datos. Restaurá el original antes de preparar esta revisión.');
  }
  const id = existing?.id ?? nodeId, gapFill = existing ? nodeGapFill(existing) : undefined;
  const source = curve.role ? entry.interpretation.sources[curve.role] : undefined;
  if (existing?.kind === 'median-filter' && existing.enabled && existing.filter.top === filter.top && existing.filter.base === filter.base && existing.filter.radiusM === filter.radiusM && existing.filter.maxStepM === filter.maxStepM && (!curve.role || source?.kind === 'curve' && source.curveId === preparedCurveId(id, 'masked'))) return project;
  const node: PreparationNode = { id, kind: 'median-filter', methodVersion: 1, enabled: true, input: existing?.input ?? { kind: 'original', inputRevisionId: entry.inputRevisionId!, curveId }, intervals: existing?.intervals ?? [], filter: { ...filter }, ...(gapFill ? { gapFill } : {}) };
  const nodes = entry.interpretation.preparation?.nodes ?? [], preparation = preparationState(existing ? nodes.map(n => n.id === id ? node : n) : [...nodes, node]);
  validatePreparation(preparation);
  return updateInterpretation(next, wellId, i => ({ ...i, preparation, sources: curve.role ? { ...i.sources, [curve.role]: { kind: 'curve', curveId: preparedCurveId(id, 'masked') } } : i.sources }));
}
export function removeMedianFilter(project: Project, wellId: string, nodeId: string): Project {
  const node = project.wells.find(e => e.well.id === wellId)?.interpretation.preparation?.nodes.find(n => n.id === nodeId);
  if (!node || node.kind !== 'median-filter') return project;
  if (!node.intervals.length && !node.gapFill) return restoreMaskInterval(project, wellId, nodeId);
  return updateInterpretation(project, wellId, i => ({ ...i, preparation: preparationState(i.preparation!.nodes.map(n => {
    if (n.id !== nodeId || n.kind !== 'median-filter') return n;
    const { filter: _removed, gapFill, ...rest } = n;
    return gapFill ? { ...rest, kind: 'linear-interpolation' as const, gapFill } : { ...rest, kind: 'mask' as const };
  })) }));
}
