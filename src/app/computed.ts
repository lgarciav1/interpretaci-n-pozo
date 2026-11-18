import { effectiveWell } from './preparation/data';
/**
 * Curvas calculadas del último resultado del motor, como las ve el visor (activas y alternativas). Una lista por
 * resultado (caché por identidad): el visor y el panel de tendencias comparten la misma.
 */
import { contextMatchesWell } from '../core/engine/context';
import type { ClientResult } from '../core/engine/client';
import { RoleCatalog } from '../core/roles';
import type { Well } from '../core/well';
import { registry } from '../modules';
import type { ComputedCurve } from '../viewer/resolve';
import type { ViewerTable } from '../viewer/overlay';
import { moduleWorkspaces, type ReadonlyTableValue } from '../core/module';

const cache = new WeakMap<ClientResult, ComputedCurve[]>();
const NONE: ComputedCurve[] = [];
const tableCache = new WeakMap<ClientResult, ViewerTable[]>();
const NO_TABLES: ViewerTable[] = [];

/** La identidad del resultado y del pozo protege también las tablas al cambiar de pozo. */
export function computedTables(result: ClientResult | null, well: Well | null): ViewerTable[] {
  if (well) well = effectiveWell(well, result);
  if (!result || !well || !contextMatchesWell(result.context,{id:well.id,depth:well.depth.values,curves:well.curves})) return NO_TABLES;
  let tables = tableCache.get(result);
  if (!tables) {
    tables = result.outputs.filter(o => o.kind === 'table').map(o => ({ moduleId: o.moduleId, port: o.port, active: o.active, value: o.value as ReadonlyTableValue }));
    tableCache.set(result, tables);
  }
  return tables;
}

export function computedCurves(result: ClientResult | null, well: Well | null): ComputedCurve[] {
  if (well) well = effectiveWell(well, result);
  if (!result || !well || !contextMatchesWell(result.context,{id:well.id,depth:well.depth.values,curves:well.curves})) return NONE;
  let out = cache.get(result);
  if (!out) {
    out = [];
    for (const o of result.outputs) {
      if (o.kind !== 'curve' || !(o.value instanceof Float64Array)) continue;
      const mod = registry.get(o.moduleId);
      out.push({ port: o.port, moduleId: o.moduleId, label: mod?.name ?? o.label, ...(o.formula !== undefined ? { formula: o.formula } : {}), ...(o.unit !== undefined ? { unit: o.unit } : {}), data: o.value, active: o.active, ...(mod ? { workspaces: moduleWorkspaces(mod) } : {}) });
    }
    cache.set(result, out);
  }
  return out;
}


/** Los roles de fórmula se publican con el resultado, sin mutar el catálogo global. */
export function computedRoleCatalog(curves: readonly ComputedCurve[]): RoleCatalog {
  const formulas = curves.filter(c => c.formula !== undefined);
  if (!formulas.length) return registry.roles;
  return new RoleCatalog([...registry.roles.all(), ...formulas.map(c => ({
    id: c.port, label: c.label, unit: c.unit ?? 'unitless', family: 'other' as const, origin: 'computed' as const,
  }))]);
}
