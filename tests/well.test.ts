import { describe, expect, it } from 'vitest';
import { createWell, layoutZones, sampleThickness } from '../src/core/well';
import { depthRange, zone } from './helpers';

describe('pozo y zonas', () => {
  it('detecta paso regular y valida profundidad creciente', () => {
    const w = createWell({ id: 'w', name: 'W', depth: depthRange(5, 100, 0.1524), curves: [] });
    expect(w.depth.step).toBeCloseTo(0.1524, 9);
    expect(() => createWell({ id: 'w', name: 'W', depth: Float64Array.from([1, 2, 2]), curves: [] })).toThrow(/creciente/);
    expect(() => createWell({ id: 'w', name: 'W', depth: Float64Array.from([1, NaN]), curves: [] })).toThrow(/inválida/);
  });

  it('rechaza curvas desalineadas o con id repetido', () => {
    const depth = depthRange(3);
    const c = (id: string, n: number) => ({ id, mnemonic: id, role: null, unit: 'unitless', data: new Float64Array(n), origin: { kind: 'measured' as const } });
    expect(() => createWell({ id: 'w', name: 'W', depth, curves: [c('A', 2)] })).toThrow(/2 muestras/);
    expect(() => createWell({ id: 'w', name: 'W', depth, curves: [c('A', 3), c('A', 3)] })).toThrow(/dos curvas/);
  });

  it('espesor por muestra = paso en un muestreo regular', () => {
    const t = sampleThickness(depthRange(4, 0, 0.5));
    expect([...t]).toEqual([0.5, 0.5, 0.5, 0.5]);
  });

  it('ubica zonas sobre las muestras y arma segmentos contiguos', () => {
    // muestras: 1000, 1000.5, ..., 1004.5 (10)
    const depth = depthRange(10);
    const layout = layoutZones(depth, [zone('b', 1003, 1004.5), zone('a', 1000.5, 1002)]);
    expect(layout.spans.map((s) => [s.id, s.start, s.end])).toEqual([
      ['a', 1, 5],
      ['b', 6, 10],
    ]);
    expect(layout.segments).toEqual([
      { start: 0, end: 1, zoneId: null },
      { start: 1, end: 5, zoneId: 'a' },
      { start: 5, end: 6, zoneId: null },
      { start: 6, end: 10, zoneId: 'b' },
    ]);
    expect(layout.problems).toEqual([]);
  });

  it('informa zonas superpuestas o inválidas', () => {
    const layout = layoutZones(depthRange(10), [zone('a', 1000, 1003), zone('b', 1002, 1004), zone('c', 1005, 1001)]);
    expect(layout.problems.join(' ')).toMatch(/superponen/);
    expect(layout.problems.join(' ')).toMatch(/se ignora/);
    // la de tope más somero gana en el solapamiento
    expect(layout.zoneIndex[5]).toBe(0); // 1002.5 está en a y b
  });
});
