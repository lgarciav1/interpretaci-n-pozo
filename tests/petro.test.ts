import { describe, expect, it } from 'vitest';
import { gammaRayIndex, gammaRayIndexInto } from '../src/petro/igr';
import { thresholdFlag, thresholdFlagInto } from '../src/petro/flags';
import { intervalStats, thicknessWhere } from '../src/petro/stats';

describe('petro/igr (ejemplo fase 1)', () => {
  it('IGR = (GR − GRlimpia)/(GRarcilla − GRlimpia)', () => {
    // GR=75, limpia 30, arcilla 120 → 45/90 = 0,5
    expect(gammaRayIndex(75, 30, 120)).toBeCloseTo(0.5, 12);
    // GR=60, limpia 20, arcilla 120 → 40/100 = 0,4
    expect(gammaRayIndex(60, 20, 120)).toBeCloseTo(0.4, 12);
  });

  it('recorta a [0, 1] y propaga NaN', () => {
    expect(gammaRayIndex(10, 30, 120)).toBe(0);
    expect(gammaRayIndex(200, 30, 120)).toBe(1);
    expect(gammaRayIndex(NaN, 30, 120)).toBeNaN();
  });

  it('parámetros degenerados (arcilla ≤ limpia) → NaN', () => {
    expect(gammaRayIndex(50, 100, 100)).toBeNaN();
    expect(gammaRayIndex(50, 100, 80)).toBeNaN();
  });

  it('versión por tramo escribe solo [start, end)', () => {
    const out = new Float64Array(4).fill(-1);
    gammaRayIndexInto([30, 75, 120, 75], out, 30, 120, 1, 3);
    expect([...out]).toEqual([-1, 0.5, 1, -1]);
  });
});

describe('petro/flags y stats', () => {
  it('bandera por umbral (≥ corte → 1)', () => {
    expect(thresholdFlag(0.5, 0.5)).toBe(1);
    expect(thresholdFlag(0.49, 0.5)).toBe(0);
    expect(thresholdFlag(NaN, 0.5)).toBeNaN();
    expect([...thresholdFlagInto([0.1, 0.9], new Float64Array(2), 0.5)]).toEqual([0, 1]);
  });

  it('media ponderada por espesor ignora NaN', () => {
    const s = intervalStats([1, NaN, 3], [1, 1, 3]);
    expect(s.mean).toBeCloseTo((1 * 1 + 3 * 3) / 4, 12);
    expect(s.thickness).toBe(5);
    expect(s.validThickness).toBe(4);
    expect(s.count).toBe(2);
    expect(intervalStats([NaN], [1]).mean).toBeNaN();
    expect(thicknessWhere([1, 0, 1, NaN], [0.5, 0.5, 0.5, 0.5], 1)).toBe(1);
  });
});
