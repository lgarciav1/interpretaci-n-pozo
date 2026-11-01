import { curveInputKey, curveProvenance, engineDecisionKey, identityKey, sameContext, wellInputKey, type CurveProvenance, type EngineContext } from '../engine/context';
import type { EngineCurve, EngineWell } from '../engine/engine';
import type { Interpretation } from '../interpretation';
import type { Registry } from '../registry';
import type { Curve, Well } from '../well';
import { selectDataCurves, type DataContext } from './projection';
import { preparedCurveId } from './source';
import { maskRanges, preparationStateKey, PREPARATION_BUDGET, validatePreparation } from './state';

export interface MaskBinding { depthKey: string; contentVersion: string; mnemonic: string; role: string | null; unit: string }
export type PreparationBindings = Readonly<Record<string, MaskBinding | null>>;
export interface PlannedMask {
  id: string;
  nodeId: string;
  sourceCurveId: string;
  mnemonic: string;
  role: string | null;
  unit: string;
  recipeKey: string;
  ranges: { top: number; base: number }[];
  provenance: CurveProvenance;
  /** Una máscara no corrige efectos ambientales. */
  correctionLedger: [];
}
export interface PreparationPlan {
  stateKey: string;
  context: EngineContext;
  originalKey: string;
  bindings: PreparationBindings;
  artifacts: PlannedMask[];
  diagnostics: { nodeId: string; status: 'disabled' | 'needs-input'; message: string }[];
  toolString?: Interpretation['toolString'];
}
export interface PreparedPayload { id: string; version: string; data: Float64Array; quality: Uint16Array }
export interface PreparedPackage { plan: PreparationPlan; artifacts: PreparedPayload[] }

export function planPreparation(well: EngineWell, i: Interpretation, inputRevisionId: string | null, registry: Pick<Registry, 'tools'>, bindings: PreparationBindings = {}, depthKey = `depth:${identityKey(well.depth)}`): PreparationPlan {
  if (i.preparation !== undefined) validatePreparation(i.preparation);
  const originals = well.curves.map(c => ({ ...c, provenance: curveProvenance(c, depthKey) }));
  const originalKey = curveInputKey(well.id, depthKey, originals);
  const artifacts: PlannedMask[] = [], diagnostics: PreparationPlan['diagnostics'] = [];
  const nodes = i.preparation?.nodes ?? [];
  if (nodes.length && well.curves.some(c => c.provenance?.origin === 'prepared')) throw new Error('La preparación necesita originales, no una proyección anterior.');
  if (nodes.length && !inputRevisionId) throw new Error('La preparación necesita revisiones de entradas.');
  for (const node of nodes) {
    if (!node.enabled) { diagnostics.push({ nodeId: node.id, status: 'disabled', message: 'Máscara desactivada.' }); continue; }
    const c = originals.find(c => c.id === node.input.curveId), binding = bindings[node.id];
    if (!c || !binding || binding.depthKey !== depthKey || binding.contentVersion !== c.provenance.contentVersion || binding.unit !== c.unit || binding.role !== c.role || binding.mnemonic !== c.mnemonic) {
      diagnostics.push({ nodeId: node.id, status: 'needs-input', message: `La máscara de '${node.input.curveId}' está vinculada a otros datos. Revisá su origen antes de aplicarla.` }); continue;
    }
    const id = preparedCurveId(node.id, 'masked');
    if (well.curves.some(c => c.id === id)) throw new Error('El identificador preparado colisiona con un original.');
    const ranges = maskRanges(node.intervals);
    const recipeKey = JSON.stringify(['mask', 1, c.id, c.provenance.contentVersion, depthKey, c.role, c.unit, ranges]);
    const owner = registry.tools.ownerOf(c);
    const provenance: CurveProvenance = { origin: 'prepared', contentVersion: `mask:${recipeKey}`, depthKey, ancestorToolIds: owner ? [owner.id] : [], qualityKey: `mask-quality:${recipeKey}` };
    artifacts.push({ id, nodeId: node.id, sourceCurveId: c.id, mnemonic: `${c.mnemonic} preparada`, role: c.role, unit: c.unit, recipeKey, ranges, provenance, correctionLedger: [] });
  }
  if (well.depth.length * 10 * artifacts.length > PREPARATION_BUDGET) throw new Error('La preparación supera 128 MiB de artefactos. Reducí la cantidad de curvas.');
  const preparationKey = nodes.length ? JSON.stringify([artifacts.map(a => [a.id, a.provenance]), diagnostics]) : 'identity';
  const context: EngineContext = Object.freeze({ wellId: well.id, inputRevisionId, depthKey, preparationKey,
    engineKey: curveInputKey(well.id, depthKey, [...originals, ...artifacts]) + '|' + engineDecisionKey(i) });
  return { stateKey: preparationStateKey(i.preparation), context, originalKey, bindings, artifacts, diagnostics, ...(i.toolString ? { toolString: i.toolString } : {}) };
}

export function validatePreparedPayloads(plan: PreparationPlan, payloads: unknown, n: number): asserts payloads is PreparedPayload[] {
  if (!Array.isArray(payloads) || payloads.length !== plan.artifacts.length) throw new Error('El paquete de preparación está incompleto.');
  const seen = new Set<string>();
  for (const p of payloads) {
    const expected = plan.artifacts.find(a => a.id === p?.id);
    if (!expected || seen.has(p.id) || p.version !== expected.provenance.contentVersion || !(p.data instanceof Float64Array) || !(p.quality instanceof Uint16Array) || p.data.length !== n || p.quality.length !== n || p.quality.some((q: number) => (q & ~3) !== 0)) throw new Error('Artefacto preparado inválido, repetido u obsoleto.');
    seen.add(p.id);
  }
}

/** Reconstrucción en el cliente: no evalúa recetas, publica solo el paquete completo del mismo contexto. */
export function materializePreparation(well: Well, prepared: PreparedPackage, context: EngineContext, registry: Pick<Registry, 'tools'>): DataContext {
  const { plan, artifacts: payloads } = prepared;
  if (!sameContext(context, plan.context) || plan.originalKey !== wellInputKey({ id: well.id, depth: well.depth.values, curves: well.curves })) throw new Error('La preparación no corresponde a los originales vigentes.');
  validatePreparedPayloads(plan, payloads, well.depth.values.length);
  const byId = new Map(payloads.map(p => [p.id, p]));
  const curves: Curve[] = [...well.curves, ...plan.artifacts.map(a => ({ id: a.id, mnemonic: a.mnemonic, role: a.role, unit: a.unit, data: byId.get(a.id)!.data, origin: { kind: 'prepared' as const }, provenance: a.provenance }))];
  const engineWell: EngineWell = { id: well.id, depth: well.depth.values, curves };
  if (!context.engineKey.startsWith(wellInputKey(engineWell) + '|')) throw new Error('La proyección reconstruida no coincide con el cálculo.');
  const lineage = new Map(curves.map(c => [c.id, c.provenance ?? { ...curveProvenance(c, context.depthKey), ancestorToolIds: registry.tools.ownerOf(c) ? [registry.tools.ownerOf(c)!.id] : [] }]));
  return { well: plan.artifacts.length ? { ...well, curves } : well, engineWell, context, preparationStateKey: plan.stateKey, ...selectDataCurves(curves, plan, registry.tools), lineage, quality: new Map(payloads.map(p => [p.id, p.quality])) };
}

export function projectedEngineCurves(well: EngineWell, plan: PreparationPlan, payloads: PreparedPayload[]): readonly EngineCurve[] {
  const byId = new Map(payloads.map(p => [p.id, p]));
  return [...well.curves, ...plan.artifacts.map(a => ({ id: a.id, mnemonic: a.mnemonic, role: a.role, unit: a.unit, provenance: a.provenance, data: byId.get(a.id)!.data }))];
}
