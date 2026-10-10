/**
 * Histograma (src/plots/histogram/histogram.ts, docs/decisiones/0014 D5): clases automáticas (Freedman–Diaconis,
 * Sturges), bordes lineales y log, conteo, %, acumulada, rango robusto, estadísticos y reparto a cada lado de un
 * cutoff. Valores verificados con cuentas a mano.
 */
import { describe, expect, it } from 'vitest';
import { AUTO_BINS, autoBinCount, autoRange, binEdges, binIndex, collect, countBins, cumulativePercent, cutoffSplit, sampleStats, toPercent } from '../../src/plots/histogram/histogram';

describe('autoBinCount (Freedman–Diaconis con límites)', () => {
  it('h = 2·IQR·n^(−1/3)', () => {
    // n = 1000 → n^(−1/3) = 0,1; IQR = 10 → h = 2; rango 40 → 20 clases.
    expect(autoBinCount(1000, 10, 40)).toBe(20);
    // rango 41 → ⌈20,5⌉ = 21.
    expect(autoBinCount(1000, 10, 41)).toBe(21);
  });
  it('Sturges si el IQR es 0', () => {
    // n = 1000 → ⌈log2 1000⌉ + 1 = 10 + 1 = 11.
    expect(autoBinCount(1000, 0, 5)).toBe(11);
  });
  it('acota entre el mínimo y el máximo', () => {
    expect(autoBinCount(1000, 10, 4)).toBe(AUTO_BINS.min);
    expect(autoBinCount(1e6, 0.001, 1000)).toBe(AUTO_BINS.max);
    expect(autoBinCount(1, 1, 1)).toBe(AUTO_BINS.min);
  });
});

describe('binEdges / binIndex', () => {
  it('clases iguales en lineal', () => {
    expect(Array.from(binEdges(0, 10, 5, 'linear'))).toEqual([0, 2, 4, 6, 8, 10]);
  });
  it('clases iguales en log10 (progresión geométrica)', () => {
    const e = binEdges(0.1, 1000, 4, 'log');
    [0.1, 1, 10, 100, 1000].forEach((v, k) => expect(e[k]).toBeCloseTo(v, 9));
  });
  it('la última clase es cerrada a la derecha; afuera = −1', () => {
    const e = binEdges(0, 10, 5, 'linear');
    expect(binIndex(e, 0)).toBe(0);
    expect(binIndex(e, 1.999)).toBe(0);
    expect(binIndex(e, 2)).toBe(1);
    expect(binIndex(e, 10)).toBe(4);
    expect(binIndex(e, 10.01)).toBe(-1);
    expect(binIndex(e, -0.01)).toBe(-1);
    expect(binIndex(e, NaN)).toBe(-1);
  });
});

describe('countBins, toPercent y acumulada', () => {
  const v = [0.5, 1.5, 1.6, 2.5, 3.5, 3.6, 3.7, NaN, 9];
  const e = binEdges(0, 4, 4, 'linear');
  it('cuenta por clase y separa lo que queda afuera', () => {
    const h = countBins(v, e, 'linear');
    expect(Array.from(h.counts)).toEqual([1, 2, 1, 3]);
    expect(h.n).toBe(7);
    expect(h.below).toBe(0);
    expect(h.above).toBe(1);
  });
  it('respeta el filtro de muestras', () => {
    const h = countBins(v, e, 'linear', (i) => i < 3);
    expect(Array.from(h.counts)).toEqual([1, 2, 0, 0]);
  });
  it('% sobre el total (con lo de afuera) y acumulada en el borde derecho', () => {
    const h = countBins(v, e, 'linear');
    expect(Array.from(toPercent(h.counts, 8))).toEqual([12.5, 25, 12.5, 37.5]);
    expect(Array.from(cumulativePercent(h))).toEqual([12.5, 37.5, 50, 87.5]);
  });
  it('en log no cuentan los valores ≤ 0', () => {
    const h = countBins([0, -1, 1, 10, 100], binEdges(1, 100, 2, 'log'), 'log');
    expect(h.n).toBe(3);
    expect(h.below + h.above).toBe(0);
    expect(collect([0, -1, 1, 10, 100], 'log').length).toBe(3);
  });
});

describe('autoRange', () => {
  it('una lectura espuria no estira el rango (percentiles 0,5–99,5 ensanchados)', () => {
    const v = Array.from({ length: 1000 }, (_, i) => i / 1000); // 0…0,999
    v.push(1e6);
    const r = autoRange(v, 'linear')!;
    expect(r.lo).toBeGreaterThanOrEqual(0);
    expect(r.hi).toBeLessThan(1.1);
    expect(r.hi).toBeGreaterThan(0.99);
  });
  it('no se pasa de los extremos reales', () => {
    const r = autoRange([1, 2, 3, 4, 5], 'linear')!;
    expect(r.lo).toBeGreaterThanOrEqual(1);
    expect(r.hi).toBeLessThanOrEqual(5);
  });
  it('clases fijas reemplazan a las automáticas; sin datos → null', () => {
    expect(autoRange([1, 2, 3, 4], 'linear', undefined, 7)!.bins).toBe(7);
    expect(autoRange([NaN, 1], 'linear')).toBeNull();
  });
  it('valores todos iguales: un rango chico alrededor', () => {
    const r = autoRange([2, 2, 2], 'linear')!;
    expect(r.lo).toBeLessThan(2);
    expect(r.hi).toBeGreaterThan(2);
  });
});

describe('sampleStats', () => {
  it('n, media y percentiles (Hyndman–Fan 7)', () => {
    const s = sampleStats([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, NaN], 'linear');
    expect(s.n).toBe(10);
    expect(s.mean).toBeCloseTo(5.5, 12);
    // h = 9·p: P10 → 1,9; P50 → 5,5; P90 → 9,1.
    expect(s.p10).toBeCloseTo(1.9, 12);
    expect(s.p50).toBeCloseTo(5.5, 12);
    expect(s.p90).toBeCloseTo(9.1, 12);
    expect([s.min, s.max]).toEqual([1, 10]);
  });
  it('en log la media es geométrica', () => {
    const s = sampleStats([1, 10, 100], 'log');
    expect(s.geometric).toBe(true);
    expect(s.mean).toBeCloseTo(10, 10);
    expect(s.p50).toBeCloseTo(10, 10);
  });
  it('sin muestras → NaN', () => {
    expect(sampleStats([NaN], 'linear').n).toBe(0);
    expect(sampleStats([NaN], 'linear').mean).toBeNaN();
  });
});

describe('cutoffSplit', () => {
  it('% a cada lado, inclusivo abajo (como los cutoffs del motor)', () => {
    const s = cutoffSplit([0.05, 0.08, 0.1, 0.2, NaN], 0.08);
    expect(s.n).toBe(4);
    expect(s.below).toBe(50);
    expect(s.above).toBe(50);
  });
});
