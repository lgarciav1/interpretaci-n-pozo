import type { ClientResult } from '../../core/engine/client';
import type { Interpretation } from '../../core/interpretation';
import type { Curve } from '../../core/well';

/** La comparación es una preferencia de vista; nunca cambia fuentes ni datos. */
export function preparationViewCurves(curves: readonly Curve[], interpretation: Interpretation | undefined, result: ClientResult | null, compare: boolean): readonly Curve[] {
  if (compare || !result?.preparation || !interpretation) return curves;
  const selected = new Set(Object.values(interpretation.sources).flatMap(s => s.kind === 'curve' ? [s.curveId] : []));
  const active = result.preparation.plan.artifacts.filter(a => selected.has(a.id));
  const originals = new Set(active.map(a => a.sourceCurveId));
  const ports = new Set(Object.entries(interpretation.sources).filter(([,s]) => s.kind === 'curve' && active.some(a => a.id === s.curveId)).map(([port]) => port));
  return curves.filter(c => c.origin.kind === 'prepared' ? selected.has(c.id) : !originals.has(c.id) && !(c.role && ports.has(c.role)));
}
