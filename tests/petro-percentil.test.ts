import { describe, expect, it } from 'vitest';
import { percentile } from '../src/petro/stats';

// Valores esperados de numpy.percentile (método por defecto, tipo 7) y verificados a mano con h = (m − 1)·p.
describe('petro/stats: percentile (tipo 7, como NumPy)', () => {
  const x = [15, 1, 7, 3, 9]; // ordenado: 1, 3, 7, 9, 15 (m = 5)

  it('p = 0,25 → h = 1 → 3 exacto; p = 0,5 → 7; p = 0 → mínimo; p = 1 → máximo', () => {
    expect(percentile(x, 0.25)).toBe(3);
    expect(percentile(x, 0.5)).toBe(7);
    expect(percentile(x, 0)).toBe(1);
    expect(percentile(x, 1)).toBe(15);
  });

  it('interpola: p = 0,1 → h = 0,4 → 1 + 0,4·2 = 1,8; p = 0,9 → h = 3,6 → 9 + 0,6·6 = 12,6', () => {
    expect(percentile(x, 0.1)).toBeCloseTo(1.8, 12);
    expect(percentile(x, 0.9)).toBeCloseTo(12.6, 12);
  });

  it('cantidad par: mediana de [1,2,3,4] = 2,5; p = 0,1 → 1,3; p = 0,33 → 1,99', () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentile([1, 2, 3, 4], 0.1)).toBeCloseTo(1.3, 12);
    expect(percentile([1, 2, 3, 4], 0.33)).toBeCloseTo(1.99, 12);
  });

  it('ignora NaN e Infinity, y respeta [start, end)', () => {
    expect(percentile([NaN, 15, 1, Infinity, 7, 3, 9, -Infinity], 0.5)).toBe(7);
    expect(percentile([100, 1, 2, 3, 4, 100], 0.5, 1, 5)).toBe(2.5);
  });

  it('include filtra por índice (del arreglo original)', () => {
    const v = [5, 1, 9, 2, 8];
    const keep = new Set([1, 3]); // valores 1 y 2
    expect(percentile(v, 0.5, 0, v.length, (i) => keep.has(i))).toBe(1.5);
  });

  it('un solo valor → ese valor; sin valores o p fuera de [0, 1] → NaN; no muta la entrada', () => {
    expect(percentile([4], 0.3)).toBe(4);
    expect(percentile([], 0.5)).toBeNaN();
    expect(percentile([NaN, NaN], 0.5)).toBeNaN();
    expect(percentile([1, 2, 3], 0.5, 1, 1)).toBeNaN();
    expect(percentile([1, 2, 3], -0.1)).toBeNaN();
    expect(percentile([1, 2, 3], 1.1)).toBeNaN();
    expect(percentile([1, 2, 3], NaN)).toBeNaN();
    const orig = [3, 1, 2];
    percentile(orig, 0.5);
    expect(orig).toEqual([3, 1, 2]);
  });
});
