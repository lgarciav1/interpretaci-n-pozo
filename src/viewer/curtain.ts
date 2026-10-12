/**
 * Cortina antes/después (docs/decisiones/0026): arma el lado «antes» alineado con las pistas que se ven. Puro.
 *
 * Las dos versiones de una pista comparten la caja y la escala: el lado «antes» toma de la pista actual la grilla y,
 * para cada curva que también existe ahora (misma clave), su escala y su estilo. Así una curva medida se ve idéntica de
 * los dos lados y una calculada cambia solo por sus datos, nunca porque su escala se ajustó a otros valores.
 */
import type { ResolvedCurve, ResolvedTrack } from './resolve';

export function alignCurtainTracks(after: readonly ResolvedTrack[], before: readonly ResolvedTrack[]): (ResolvedTrack | null)[] {
  const byId = new Map(before.map((t) => [t.id, t]));
  return after.map((at) => {
    const bt = byId.get(at.id);
    if (!bt) return null;
    const now = new Map(at.curves.map((c) => [c.key, c]));
    const remap = new Map<ResolvedCurve, ResolvedCurve>();
    const curves = bt.curves.map((c) => {
      const a = now.get(c.key);
      const out = a ? { ...c, axis: a.axis, styles: a.styles, wrap: a.wrap } : c;
      remap.set(c, out);
      return out;
    });
    const fills = bt.fills.map((fl) => ({ ...fl, a: remap.get(fl.a) ?? fl.a, ...(fl.b ? { b: remap.get(fl.b) ?? fl.b } : {}) }));
    return { ...bt, curves, fills, grid: at.grid };
  });
}
