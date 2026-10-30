/** Identidad científica de la proyección efectiva. Claves de sesión, nunca hashes persistidos ni gen/seq. */
import type { Interpretation } from '../interpretation';
import type { EngineCurve, EngineWell } from './engine';
export interface EngineContext {
  wellId: string;
  inputRevisionId: string | null;
  depthKey: string;
  preparationKey: string;
  engineKey: string;
}
export interface CurveProvenance {
  origin: 'original' | 'prepared';
  contentVersion: string;
  depthKey: string;
  ancestorToolIds: readonly string[];
  qualityKey?: string;
}
const canonical = (value: unknown) => JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const identities = new WeakMap<object, number>();
let nextIdentity = 0;
export function identityKey(value: object): string {
  let id = identities.get(value);
  if (id === undefined)
    identities.set(value, id = ++nextIdentity);
  return String(id);
}
export function curveProvenance(curve: EngineCurve, depthKey: string): CurveProvenance {
  return curve.provenance ?? { origin: 'original', contentVersion: `array:${identityKey(curve.data)}`, depthKey, ancestorToolIds: [] };
}
const inputKeys = new WeakMap<readonly EngineCurve[], {
  id: string;
  depth: Float64Array;
  key: string;
}>();
export function wellInputKey(well: EngineWell): string {
  const hit = inputKeys.get(well.curves);
  if (hit?.id === well.id && hit.depth === well.depth)
    return hit.key;
  const depthKey = `depth:${identityKey(well.depth)}`;
  const key = JSON.stringify([well.id, depthKey, well.curves.map((c) => [c.id, c.mnemonic, c.role, c.unit, curveProvenance(c, depthKey)])]);
  inputKeys.set(well.curves, { id: well.id, depth: well.depth, key });
  return key;
}
export const engineDecisionKey = (interpretation: Interpretation): string => canonical([interpretation.zones, interpretation.params, interpretation.sources, interpretation.compare, interpretation.disabled, interpretation.toolString ?? null]);
export function engineContext(well: EngineWell, interpretation: Interpretation, inputRevisionId: string | null = null): EngineContext {
  if (well.curves.some(c => c.provenance?.origin === 'prepared'))
    throw new Error('La proyección preparada requiere un plan validado; no se puede usar como identidad.');
  return Object.freeze({ wellId: well.id, inputRevisionId, depthKey: `depth:${identityKey(well.depth)}`, preparationKey: 'identity',
    engineKey: wellInputKey(well) + '|' + engineDecisionKey(interpretation) });
}
export function validContext(value: unknown): value is EngineContext {
  if (!value || typeof value !== 'object')
    return false;
  const c = value as EngineContext;
  return typeof c.wellId === 'string' && !!c.wellId && (c.inputRevisionId === null || typeof c.inputRevisionId === 'string' && !!c.inputRevisionId)
    && ['depthKey', 'preparationKey', 'engineKey'].every((key) => typeof c[key as keyof EngineContext] === 'string' && !!c[key as keyof EngineContext]);
}
export function sameContext(a: EngineContext | null | undefined, b: EngineContext | null | undefined): boolean {
  return !!a && !!b && a.wellId === b.wellId && a.inputRevisionId === b.inputRevisionId && a.depthKey === b.depthKey && a.preparationKey === b.preparationKey && a.engineKey === b.engineKey;
}
export function sameInputDomain(a: EngineContext, b: EngineContext): boolean {
  return a.wellId === b.wellId && a.inputRevisionId === b.inputRevisionId && a.depthKey === b.depthKey && a.preparationKey === b.preparationKey;
}
/** Solo permite retaggear un resultado completo cuando el cálculo usa exactamente las mismas entradas. */
export function sameComputation(a: EngineContext, b: EngineContext): boolean {
  return a.wellId === b.wellId && a.depthKey === b.depthKey && a.preparationKey === b.preparationKey && a.engineKey === b.engineKey;
}
export function contextMatchesWell(context: EngineContext | undefined, well: EngineWell): boolean {
  return validContext(context) && context.wellId === well.id && context.depthKey === `depth:${identityKey(well.depth)}` && context.engineKey.startsWith(wellInputKey(well) + '|');
}
export function entryEngineContext(entry: {
  well: {
    id: string;
    depth: {
      values: Float64Array;
    };
    curves: readonly EngineCurve[];
  };
  interpretation: Interpretation;
  inputRevisionId?: string;
}): EngineContext {
  return engineContext({ id: entry.well.id, depth: entry.well.depth.values, curves: entry.well.curves }, entry.interpretation, entry.inputRevisionId ?? null);
}
