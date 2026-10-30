import { curveInputKey, curveProvenance, engineDecisionKey, identityKey, sameContext, wellInputKey, type CurveProvenance, type EngineContext } from '../engine/context';
import type { EngineCurve, EngineWell } from '../engine/engine';
import type { Interpretation } from '../interpretation';
import type { Registry } from '../registry';
import type { Curve, Well } from '../well';
import { selectDataCurves, type DataContext } from './projection';
import { preparedCurveId } from './source';
import { interpolationSourceProblem } from './interpolation';
import { maskRanges, preparationStateKey, PREPARATION_BUDGET, validatePreparation, type GapFill, type MedianFilter, type DepthShift, nodeGapFill, nodeFilter } from './state';

export interface ShiftFrame { referenceId: string; sourceDatum: string | null; targetDatum: string | null }
export interface MaskBinding { shiftFrame?: ShiftFrame; depthKey: string; contentVersion: string; mnemonic: string; role: string | null; unit: string }
export type PreparationBindings = Readonly<Record<string, MaskBinding | null>>;
export interface PlannedPreparation {
  id: string;
  nodeId: string;
  sourceCurveId: string;
  mnemonic: string;
  role: string | null;
  unit: string;
  recipeKey: string;
  ranges: { top: number; base: number }[];
  gapFill?: GapFill;
  filter?: MedianFilter;
  shift?: DepthShift;
  boundaries?: number[];
  provenance: CurveProvenance;
  /** Una máscara no corrige efectos ambientales. */
  correctionLedger: [];
}
export interface PreparationPlan {
  stateKey: string;
  context: EngineContext;
  originalKey: string;
  bindings: PreparationBindings;
  artifacts: PlannedPreparation[];
  diagnostics: { nodeId: string; status: 'disabled' | 'needs-input'; message: string }[];
  toolString?: Interpretation['toolString'];
}
export interface PreparedPayload { sourceCounts?: { interpolated: number; filtered: number }; id: string; version: string; data: Float64Array; quality: Uint16Array }
export interface PreparedPackage { plan: PreparationPlan; artifacts: PreparedPayload[] }

export function planPreparation(well: EngineWell, i: Interpretation, inputRevisionId: string | null, registry: Pick<Registry, 'tools'>, bindings: PreparationBindings = {}, depthKey = `depth:${identityKey(well.depth)}`): PreparationPlan {
  if (i.preparation !== undefined) validatePreparation(i.preparation);
  const originals = well.curves.map(c => ({ ...c, provenance: curveProvenance(c, depthKey) }));
  const originalKey = curveInputKey(well.id, depthKey, originals);
  const artifacts: PlannedPreparation[] = [], diagnostics: PreparationPlan['diagnostics'] = [];
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
    const gapFill = nodeGapFill(node);
    const filter = nodeFilter(node);
    const shift = node.kind === 'constant-shift' ? node.shift : undefined;
    if (shift && (shift.referenceId !== well.id || !binding.shiftFrame || binding.shiftFrame.referenceId !== well.id || [binding.shiftFrame.sourceDatum, binding.shiftFrame.targetDatum].some(d => d !== null && d !== shift.datum))) throw new Error('La alineación requiere la misma referencia MD y datum declarado para origen y destino.');
    if ((gapFill || filter || shift) && i.zones.some(z => !Number.isFinite(z.top) || !Number.isFinite(z.base) || z.top >= z.base)) throw new Error('Las fronteras de zona deben ser finitas y ordenadas para interpolar.');
    const boundaries = gapFill || filter || shift ? [...new Set(i.zones.flatMap(z => [z.top, z.base]))].sort((a, b) => a - b) : undefined;
    if (gapFill || filter || shift) { const problem = interpolationSourceProblem(c, shift ? 'La alineación' : filter ? 'El filtro' : undefined); if (problem) throw new Error(problem); }
    const recipeKey = JSON.stringify([shift ? 'constant-shift' : filter ? 'median-filter' : gapFill ? 'linear-interpolation' : 'mask', 1, c.id, c.provenance.contentVersion, depthKey, c.role, c.unit, ranges, ...(gapFill ? [[gapFill.top, gapFill.base, gapFill.maxGapM], boundaries] : []), ...(filter ? [[filter.top, filter.base, filter.radiusM, filter.maxStepM], ...(gapFill ? [] : [boundaries])] : []), ...(shift ? [[shift.offsetM, shift.maxGapM, shift.referenceId, shift.depthKind, shift.datum], binding.shiftFrame, ...(!gapFill && !filter ? [boundaries] : [])] : [])]);
    const owner = registry.tools.ownerOf(c);
    const provenance: CurveProvenance = { origin: 'prepared', contentVersion: `mask:${recipeKey}`, depthKey, ancestorToolIds: owner ? [owner.id] : [], qualityKey: `mask-quality:${recipeKey}` };
    artifacts.push({ id, nodeId: node.id, sourceCurveId: c.id, mnemonic: `${c.mnemonic} preparada`, role: c.role, unit: c.unit, recipeKey, ranges, ...(gapFill ? { gapFill: { ...gapFill }, boundaries } : {}), ...(filter ? { filter: { ...filter }, boundaries } : {}), ...(shift ? { shift: { ...shift }, boundaries } : {}), provenance, correctionLedger: [] });
  }
  if (well.depth.length * 10 * (artifacts.length + (artifacts.some(a => a.filter || a.shift) ? 1 : 0)) > PREPARATION_BUDGET) throw new Error('La preparación supera 128 MiB de artefactos y memoria de trabajo. Reducí la cantidad de curvas.');
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
    if (!expected || seen.has(p.id) || p.version !== expected.provenance.contentVersion || !(p.data instanceof Float64Array) || !(p.quality instanceof Uint16Array) || p.data.length !== n || p.quality.length !== n) throw new Error('Artefacto preparado inválido, repetido u obsoleto.');
    if (expected.shift && (!p.sourceCounts || Object.keys(p.sourceCounts).length !== 2 || !['interpolated','filtered'].every(key => Number.isInteger(p.sourceCounts[key]) && p.sourceCounts[key] >= 0 && p.sourceCounts[key] <= n) || !expected.gapFill && p.sourceCounts.interpolated !== 0 || !expected.filter && p.sourceCounts.filtered !== 0)) throw new Error('Conteos de la entrada alineada inválidos.');
    for (let k = 0; k < n; k++) {
      const q = p.quality[k]!, value = p.data[k]!;
      if (expected.shift) {
        const allowed = 1 | 2 | 8 | 16 | 32 | 128;
        if ((q & ~allowed) || !(q & 32) || ((q & 16) && !expected.filter)) throw new Error('Calidad de alineación inválida.');
        if (q & 128) { if (!Number.isNaN(value)) throw new Error('La falta de soporte debe conservar NaN.'); }
        else if (Number.isFinite(value)) {
          if ((q & 2) || ((q & 1) && !(q & 8))) throw new Error('Una salida alineada finita tiene calidad incompatible.');
        } else if (!Number.isNaN(value) || ![33, 34, 35].includes(q)) throw new Error('Faltante alineado inválido.');
        continue;
      }
      if (q === 0 || (q === 9 && expected.gapFill) || (q === 16 && expected.filter) || ((q === 24 || q === 25) && expected.filter && expected.gapFill)) {
        if (!Number.isFinite(value)) throw new Error('Una medición o estimación publicada debe ser finita.');
      } else if ((q !== 1 && q !== 2 && q !== 3) || !Number.isNaN(value)) throw new Error('La calidad de preparación no corresponde al valor publicado.');
    }
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
