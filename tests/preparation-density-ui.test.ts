import { describe, it, expect } from 'vitest';
import type { ClientResult } from '../src/core/engine/client';
import type { Interpretation } from '../src/core/interpretation';
import type { Curve } from '../src/core/well';
import { preparationViewCurves } from '../src/app/preparation/view';
import { Quality } from '../src/core/preparation/quality';
import { flagCounts, dominantFlag } from '../src/modules/preparation/flags';
import { valueAxis } from '../src/modules/preparation/draw';

describe('F20 lectura de densidad preparada', () => {
  it('mantiene densidad original visible aun con Comparar apagado y fuente preparada activa', () => {
    const curves = [
      { id: 'rho', role: 'RHOB', origin: { kind: 'measured' } },
      { id: 'prep:d:masked', role: 'RHOB', origin: { kind: 'prepared' } },
      { id: 'gr', role: 'GR', origin: { kind: 'measured' } },
    ] as unknown as Curve[];
    const interpretation = { sources: { RHOB: { kind: 'curve', curveId: 'prep:d:masked' } }, preparation: { nodes: [{ kind: 'density-reconstruction', input: { curveId: 'rho' } }] } } as unknown as Interpretation;
    const result = { preparation: { plan: { artifacts: [{ id: 'prep:d:masked', sourceCurveId: 'rho' }] } } } as unknown as ClientResult;
    expect(preparationViewCurves(curves, interpretation, result, false).map(c => c.id)).toEqual(['rho', 'prep:d:masked', 'gr']);
    // Una preparación convencional conserva su comportamiento previo.
    const conventional = { ...interpretation, preparation: { nodes: [{ kind: 'mask', input: { curveId: 'rho' } }] } } as unknown as Interpretation;
    expect(preparationViewCurves(curves, conventional, result, false).map(c => c.id)).toEqual(['prep:d:masked', 'gr']);
  });
  it('distingue estimaciones ML y falta de soporte de una medición o corrección física', () => {
    const counts = flagCounts(Uint16Array.of(0, Quality.EstimatedML, Quality.OriginallyMissing | Quality.EstimatedML, Quality.UnsupportedML));
    expect(counts.estimated).toBe(2);
    expect(counts.unsupported).toBe(1);
    expect(counts.corrected).toBe(0);
    expect(dominantFlag(Quality.UnsupportedML | Quality.OriginallyMissing)).toBe('unsupported');
  });
  it('incluye banda en rango vertical para que el error no quede recortado', () => {
    const axis = valueAxis({ original: Float64Array.of(2.4, 2.5), after: Float64Array.of(2.4, 2.5), lower: Float64Array.of(2.1, 2.2), upper: Float64Array.of(2.7, 2.8), start: 0, end: 2, log: false });
    expect(axis!.min).toBeLessThanOrEqual(2.1);
    expect(axis!.max).toBeGreaterThanOrEqual(2.8);
  });
});
