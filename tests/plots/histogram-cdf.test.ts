/**
 * Curva acumulada del histograma (src/plots/histogram/histogram.ts: cumulativeCurve, quantileFromCdf): normalizada 0–1
 * en los bordes de las clases, lineal y log, con pesos por espesor, y P10/P50/P90. Cuentas a mano en cada caso;
 * el pozo del TP verifica monotonía, cierre en 1 y que el P50 coincida con la mediana calculada aparte.
 */
import { describe, expect, it } from 'vitest';
import csvText from '../../datos/pozo_tp_perfiles.csv?raw';
import { autoRange, binEdges, binIndex, countBins, cumulativeCurve, cumulativePercent, quantileFromCdf } from '../../src/plots/histogram/histogram';

describe('cumulativeCurve: lineal', () => {
  it('valores 0,5…9,5 en 10 clases de ancho 1: cdf = j/10; P10 = 1, P50 = 5, P90 = 9 (y coinciden con los exactos)', () => {
    const v = Array.from({ length: 10 }, (_, i) => i + 0.5);
    const c = cumulativeCurve(v, binEdges(0, 10, 10, 'linear'), 'linear');
    c.cdf.forEach((y, j) => expect(y).toBeCloseTo(j / 10, 12));
    expect([c.p10, c.p50, c.p90]).toEqual([expect.closeTo(1, 12), expect.closeTo(5, 12), expect.closeTo(9, 12)]);
    // Hazen exacto: c_j = (j − 0,5)/10 → P50 entre 4,5 y 5,5 = 5
    expect(c.exact.p10).toBeCloseTo(1, 12);
    expect(c.exact.p50).toBeCloseTo(5, 12);
    expect(c.exact.p90).toBeCloseTo(9, 12);
    expect(c.n).toBe(10);
    expect(c.total).toBe(10);
  });
  it('valores 1…10 en 5 clases: cdf = [0; 0,1; 0,3; 0,5; 0,7; 1] y P50 = 6 (el borde donde llega a 0,5)', () => {
    const c = cumulativeCurve([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], binEdges(0, 10, 5, 'linear'), 'linear');
    [0, 0.1, 0.3, 0.5, 0.7, 1].forEach((y, j) => expect(c.cdf[j]).toBeCloseTo(y, 12));
    expect(c.p50).toBeCloseTo(6, 12);
    expect(c.exact.p50).toBeCloseTo(5.5, 12); // la interpolada por clases difiere a lo sumo una clase
    expect(Math.abs(c.p50 - c.exact.p50)).toBeLessThanOrEqual(2);
  });
  it('pesos por espesor: valores [1, 3] con pesos [1, 3], bordes [0, 2, 4] → cdf = [0; 0,25; 1]; P50 = 2 + 2·(1/3)', () => {
    const c = cumulativeCurve([1, 3], [0, 2, 4], 'linear', { weights: [1, 3] });
    [0, 0.25, 1].forEach((y, j) => expect(c.cdf[j]).toBeCloseTo(y, 12));
    expect(c.total).toBe(4);
    expect(c.p50).toBeCloseTo(2 + 2 / 3, 12); // (0,5 − 0,25)/(1 − 0,25) = 1/3 del tramo [2, 4]
    expect(c.p10).toBeCloseTo(0.8, 12); // (0,1/0,25) = 0,4 del tramo [0, 2]
  });
  it('lo que cae fuera de las clases no entra: se informa en below/above y la curva igual termina en 1', () => {
    const c = cumulativeCurve([-5, 1, 3, 3, 50, 60], [0, 2, 4], 'linear');
    expect(c.n).toBe(3);
    expect(c.below).toBe(1);
    expect(c.above).toBe(2);
    expect(Array.from(c.cdf)).toEqual([0, 1 / 3, 1]);
  });
  it('la última clase es cerrada a la derecha y la regla es la de countBins (mismos conteos)', () => {
    const v = [0, 2, 4, 4, 1.99];
    const edges = binEdges(0, 4, 2, 'linear');
    const h = countBins(v, edges, 'linear');
    const c = cumulativeCurve(v, edges, 'linear');
    expect(c.cdf[1]).toBeCloseTo(h.counts[0]! / h.n, 12);
    expect(c.cdf[1]).toBeCloseTo(2 / 5, 12); // 0 y 1,99 en la primera; 2, 4, 4 en la segunda
    // sin fuera de rango, coincide con la acumulada en % existente
    expect(cumulativePercent(h)[0]! / 100).toBeCloseTo(c.cdf[1]!, 12);
  });
  it('include filtra por índice y los no finitos no cuentan', () => {
    const c = cumulativeCurve([1, NaN, 3, Infinity, 100], [0, 2, 4], 'linear', { include: (i) => i !== 4 });
    expect(c.n).toBe(2);
    expect(c.cdf[1]).toBeCloseTo(0.5, 12);
  });
  it('sin muestras (o sin pesos válidos) → cdf y percentiles NaN, sin excepción', () => {
    for (const c of [
      cumulativeCurve([], [0, 1, 2], 'linear'),
      cumulativeCurve([NaN, 5], [0, 1, 2], 'linear'),
      cumulativeCurve([0.5, 1.5], [0, 1, 2], 'linear', { weights: [0, -1] }),
    ]) {
      expect(c.cdf).toHaveLength(3);
      expect(c.cdf.every(Number.isNaN)).toBe(true);
      expect([c.p10, c.p50, c.p90, c.exact.p50].every(Number.isNaN)).toBe(true);
      expect(c.total).toBe(0);
    }
  });
});

describe('cumulativeCurve: escala log', () => {
  it('valores 1, 10, 100, 1000 en 3 décadas: cdf = [0; 0,25; 0,5; 1]; P50 = 100; P10 interpola en log10 = 10^0,4', () => {
    const edges = binEdges(1, 1000, 3, 'log');
    expect(Array.from(edges).map((x) => Math.round(x))).toEqual([1, 10, 100, 1000]);
    const c = cumulativeCurve([1, 10, 100, 1000], edges, 'log');
    [0, 0.25, 0.5, 1].forEach((y, j) => expect(c.cdf[j]).toBeCloseTo(y, 12));
    expect(c.p50).toBeCloseTo(100, 9);
    expect(c.p10).toBeCloseTo(10 ** 0.4, 9); // (0,1/0,25) = 0,4 de la primera década; lineal daría 4,6
    expect(c.p90).toBeCloseTo(10 ** (2 + 0.8), 8); // tramo [100, 1000]: (0,9 − 0,5)/0,5 = 0,8 de la década
  });
  it('en log los valores ≤ 0 no cuentan (no se pueden ubicar)', () => {
    const c = cumulativeCurve([0, -3, 2, 20], binEdges(1, 100, 2, 'log'), 'log');
    expect(c.n).toBe(2);
    expect(c.total).toBe(2);
  });
  it('con pesos: la mediana log se corre hacia lo que más espesor tiene', () => {
    const edges = binEdges(1, 100, 2, 'log'); // [1, 10, 100]
    const c = cumulativeCurve([3, 30], edges, 'log', { weights: [1, 3] });
    expect(c.cdf[1]).toBeCloseTo(0.25, 12);
    expect(c.p50).toBeCloseTo(10 ** (1 + 1 / 3), 9);
  });
});

describe('quantileFromCdf', () => {
  it('tramo plano (clases vacías): devuelve el primer borde que alcanza p', () => {
    // cdf = [0, 0.5, 0.5, 0.5, 1] sobre bordes 0..4: P50 = 1 (no 2 ni 3)
    expect(quantileFromCdf([0, 1, 2, 3, 4], [0, 0.5, 0.5, 0.5, 1], 0.5, 'linear')).toBeCloseTo(1, 12);
    expect(quantileFromCdf([0, 1, 2, 3, 4], [0, 0.5, 0.5, 0.5, 1], 0.75, 'linear')).toBeCloseTo(3.5, 12);
  });
  it('p = 0 → primer borde; p = 1 → último; p fuera de [0, 1] o cdf NaN → NaN', () => {
    const e = [0, 1, 2];
    const f = [0, 0.4, 1];
    expect(quantileFromCdf(e, f, 0, 'linear')).toBe(0);
    expect(quantileFromCdf(e, f, 1, 'linear')).toBeCloseTo(2, 12);
    expect(quantileFromCdf(e, f, 1.1, 'linear')).toBeNaN();
    expect(quantileFromCdf(e, f, NaN, 'linear')).toBeNaN();
    expect(quantileFromCdf(e, [NaN, NaN, NaN], 0.5, 'linear')).toBeNaN();
  });
});

// ── Pozo del TP ────────────────────────────────────────────────────────────────────────────────────────────────
describe('cumulativeCurve: pozo del TP (datos/pozo_tp_perfiles.csv)', () => {
  const lines = csvText.trim().split(/\r?\n/);
  const head = lines[0]!.split(',');
  const rows = lines.slice(1).map((l) => l.split(','));
  const col = (name: string) => rows.map((r) => (r[head.indexOf(name)] === '' ? NaN : Number(r[head.indexOf(name)])));
  const h = new Float64Array(rows.length).fill(0.1524);

  // Mediana calculada aparte: ordenar y promediar los dos centrales (pesos iguales; coincide con Hazen).
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
  };

  for (const [name, scale] of [['AT90', 'log'], ['GR', 'linear'], ['ZDEN', 'linear'], ['DT', 'linear']] as const) {
    it(`${name} (${scale}): monótona, de 0 a 1, y el P50 cae en la clase de la mediana`, () => {
      const v = col(name);
      const r = autoRange(v, scale)!;
      const edges = binEdges(r.lo, r.hi, r.bins, scale);
      const c = cumulativeCurve(v, edges, scale);
      expect(c.cdf[0]).toBe(0);
      expect(c.cdf[c.cdf.length - 1]).toBe(1);
      for (let j = 1; j < c.cdf.length; j++) expect(c.cdf[j]!).toBeGreaterThanOrEqual(c.cdf[j - 1]!);
      const inRange = v.filter((x) => Number.isFinite(x) && x >= edges[0]! && x <= edges[edges.length - 1]! && (scale === 'linear' || x > 0));
      expect(c.n).toBe(inRange.length);
      const med = median(inRange);
      expect(c.exact.p50).toBeCloseTo(med, 9);
      // la interpolada por clases está en la misma clase que la mediana (o en una vecina si cae justo en un borde)
      expect(Math.abs(binIndex(edges, c.p50) - binIndex(edges, med))).toBeLessThanOrEqual(1);
      expect(c.p10).toBeLessThanOrEqual(c.p50);
      expect(c.p50).toBeLessThanOrEqual(c.p90);
    });
  }

  it('con espesores uniformes, pesar por espesor da la misma curva que sin pesos', () => {
    const v = col('AT90');
    const r = autoRange(v, 'log')!;
    const edges = binEdges(r.lo, r.hi, r.bins, 'log');
    const a = cumulativeCurve(v, edges, 'log');
    const b = cumulativeCurve(v, edges, 'log', { weights: h });
    a.cdf.forEach((y, j) => expect(b.cdf[j]).toBeCloseTo(y, 12));
    expect(b.p50).toBeCloseTo(a.p50, 9);
    expect(b.total).toBeCloseTo(a.n * 0.1524, 6);
  });
});
