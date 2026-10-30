/** Proyección pura de artefactos ya evaluados. No ejecuta métodos ni modifica originales. */
import type { EngineCurve, EngineWell } from '../engine/engine';
import { engineContext, engineDecisionKey, identityKey, wellInputKey, type CurveProvenance, type EngineContext } from '../engine/context';
import type { Interpretation } from '../interpretation';
import type { ToolCatalog } from '../tools';
import type { Registry } from '../registry';
import { excludedCurveIds } from '../toolString';
import { getUnit } from '../units';
import type { Curve, Well } from '../well';
import { isPreparedId } from './source';

export interface ArtifactInput { curveId: string; contentVersion: string }
export interface PreparedArtifact {
  id: string;
  mnemonic: string;
  role: Curve['role'];
  unit: Curve['unit'];
  inputRevisionId: string;
  depthKey: string;
  /** Firma canónica de método/versión/configuración/alcance, suministrada por el evaluador. */
  recipeKey: string;
  inputs: readonly ArtifactInput[];
  data: Float64Array;
  quality: Uint16Array;
}
export interface DataContext {
  preparationStateKey?: string;
  /** Originales y alternativas preparadas, sin filtrado destructivo. Nunca se guarda en Project. */
  well: Well;
  engineWell: EngineWell;
  context: EngineContext;
  eligible: readonly Curve[];
  excluded: ReadonlySet<string>;
  lineage: ReadonlyMap<string, CurveProvenance>;
  quality: ReadonlyMap<string, Uint16Array>;
}

/** El filtro común del motor, visor, plots y disponibilidad. Preserva identidad en el caso vacío. */
export function selectDataCurves<C extends Pick<EngineCurve, 'id' | 'mnemonic' | 'role' | 'provenance'>>(curves: readonly C[], interpretation: Pick<Interpretation, 'toolString'> | undefined, tools: ToolCatalog) {
  const excluded = excludedCurveIds(curves, interpretation?.toolString, tools);
  return { eligible: excluded.size ? curves.filter(c => !excluded.has(c.id)) : curves, excluded };
}

const cache = new WeakMap<Well, { interpretation: Interpretation; revision: string | null; registry: Pick<Registry, 'tools' | 'roles'>; artifactKey: string; value: DataContext }>();
/**
 * Valida el lote completo antes de exponerlo. Los originales se comparten, nunca se renombran ni se copian a Project.
 * Un artefacto ausente no se sustituye aquí: la elección explícita se bloquea en el grafo.
 */
export function resolveDataContext(well: Well, interpretation: Interpretation, registry: Pick<Registry, 'tools' | 'roles'>, inputRevisionId: string | null = null, artifacts: readonly PreparedArtifact[] = []): DataContext {
  const { tools, roles } = registry;
  const hit = cache.get(well);
  const sameInputs = hit?.interpretation === interpretation && hit.revision === inputRevisionId && hit.registry === registry;
  if (!artifacts.length && sameInputs && hit.artifactKey === '') return hit.value;
  if (well.curves.some(c => c.origin.kind === 'prepared')) throw new Error('Los datos originales no pueden contener artefactos preparados.');
  const depthKey = `depth:${identityKey(well.depth.values)}`;
  const lineage = new Map<string, CurveProvenance>();
  const byId = new Map<string, Curve>();
  for (const c of well.curves) {
    if (byId.has(c.id)) throw new Error(`Curva original duplicada: '${c.id}'.`);
    byId.set(c.id, c);
    const tool = tools.ownerOf(c);
    lineage.set(c.id, Object.freeze({ origin: 'original', contentVersion: `array:${identityKey(c.data)}`, depthKey, ancestorToolIds: Object.freeze(tool ? [tool.id] : []) }));
  }
  if (artifacts.length && !inputRevisionId) throw new Error('La preparación requiere una revisión de entradas explícita.');
  const pending = new Map<string, PreparedArtifact>();
  for (const a of artifacts) {
    if (!/^prep:[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+$/.test(a.id) || byId.has(a.id) || pending.has(a.id)) throw new Error(`Identificador de artefacto inválido o duplicado: '${a.id}'.`);
    if (a.inputRevisionId !== inputRevisionId || a.depthKey !== depthKey) throw new Error(`El artefacto '${a.id}' pertenece a otras entradas o profundidad.`);
    if (!a.mnemonic?.trim() || !a.recipeKey?.trim() || !getUnit(a.unit) || (a.role !== null && typeof a.role !== 'string')) throw new Error(`Metadatos inválidos de '${a.id}'.`);
    if (a.role !== null && (!roles.has(a.role) || getUnit(a.unit)?.dimension !== getUnit(roles.unitOf(a.role))?.dimension)) throw new Error(`Unidad o rol incompatible de '${a.id}'.`);
    if (!(a.data instanceof Float64Array) || !(a.quality instanceof Uint16Array) || a.data.length !== well.depth.values.length || a.quality.length !== a.data.length) throw new Error(`Dimensiones inválidas de '${a.id}'.`);
    if (!Array.isArray(a.inputs) || !a.inputs.length || new Set(a.inputs.map(x => x.curveId)).size !== a.inputs.length) throw new Error(`Entradas inválidas de '${a.id}'.`);
    pending.set(a.id, a);
  }
  const artifactKey = artifacts.length ? JSON.stringify(artifacts.map(a => [a.id, a.mnemonic, a.role, a.unit, a.inputRevisionId, a.depthKey, a.recipeKey,
    a.inputs.map(p => [p.curveId, p.contentVersion]), identityKey(a.data), identityKey(a.quality)])) : '';
  if (sameInputs && hit.artifactKey === artifactKey) return hit.value;
  const quality = new Map<string, Uint16Array>();
  const prepared = new Map<string, Curve>();
  while (pending.size) {
    let progress = false;
    for (const [id, a] of pending) {
      if (a.inputs.some(p => pending.has(p.curveId))) continue;
      const parents = a.inputs.map(p => {
        const parent = lineage.get(p.curveId);
        if (!parent || parent.contentVersion !== p.contentVersion) throw new Error(`La entrada '${p.curveId}' de '${id}' falta o está obsoleta.`);
        return parent;
      });
      const ancestorToolIds = Object.freeze([...new Set(parents.flatMap(p => p.ancestorToolIds))].sort());
      const contentVersion = JSON.stringify([a.recipeKey, a.inputs.map(p => [p.curveId, p.contentVersion]), identityKey(a.data), identityKey(a.quality)]);
      const provenance: CurveProvenance = Object.freeze({ origin: 'prepared', depthKey, ancestorToolIds, contentVersion, qualityKey: `quality:${identityKey(a.quality)}` });
      const c: Curve = Object.freeze({ id, mnemonic: a.mnemonic, role: a.role, unit: a.unit, data: a.data, origin: Object.freeze({ kind: 'prepared' as const }), provenance });
      prepared.set(id, c); byId.set(id, c); lineage.set(id, provenance); quality.set(id, a.quality);
      pending.delete(id); progress = true;
    }
    if (!progress) throw new Error('La preparación contiene un ciclo.');
  }
  // Orden de presentación estable; la evaluación puede haber seguido otro orden topológico.
  const curves = artifacts.length ? [...well.curves, ...artifacts.map(a => prepared.get(a.id)!)] : well.curves;
  const projected = curves === well.curves ? well : { ...well, curves };
  const engineWell: EngineWell = { id: well.id, depth: well.depth.values, curves };
  let context: EngineContext;
  if (!artifacts.length) context = engineContext(engineWell, interpretation, inputRevisionId);
  else {
    const base = engineContext({ ...engineWell, curves: well.curves }, interpretation, inputRevisionId);
    context = Object.freeze({ ...base, preparationKey: JSON.stringify(artifacts.map(a => [a.id, lineage.get(a.id)])), engineKey: wellInputKey(engineWell) + '|' + engineDecisionKey(interpretation) });
  }
  const selection = selectDataCurves(curves, interpretation, tools);
  const value = Object.freeze({ well: projected, engineWell, context, ...selection, lineage, quality });
  cache.set(well, { interpretation, revision: inputRevisionId, registry, artifactKey, value });
  return value;
}

/** Los originales legados con este prefijo siguen siendo originales; nuevos imports lo reservan. */
export function isPreparedCurve(curve: EngineCurve): boolean { return isPreparedId(curve.id) && curve.provenance?.origin === 'prepared'; }
