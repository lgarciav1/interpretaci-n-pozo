/**
 * Curvas calculadas del último resultado del motor, como las ve el visor (activas y alternativas). Una lista por
 * resultado (caché por identidad): el visor y el panel de tendencias comparten la misma.
 */
import type { ClientResult } from '../core/engine/client';
import type { Well } from '../core/well';
import { registry } from '../modules';
import type { ComputedCurve } from '../viewer/resolve';

const cache = new WeakMap<ClientResult, ComputedCurve[]>();
const NONE: ComputedCurve[] = [];

export function computedCurves(result: ClientResult | null, well: Well | null): ComputedCurve[] {
  if (!result || !well || result.wellId !== well.id) return NONE;
  let out = cache.get(result);
  if (!out) {
    out = [];
    for (const o of result.outputs) {
      if (o.kind !== 'curve' || !(o.value instanceof Float64Array)) continue;
      out.push({ port: o.port, moduleId: o.moduleId, label: registry.get(o.moduleId)?.name ?? o.label, data: o.value, active: o.active });
    }
    cache.set(result, out);
  }
  return out;
}
