import { describe, expect, it } from 'vitest';
import { clusterElectrofacies, clusterMatrix, robustStandardize, scanClusterCount } from '../src/ml/electrofacies';
import { gmm } from '../src/ml/gmm';
import { kmeans, kmeansPseudoProbabilities } from '../src/ml/kmeans';
import { mulberry32, randNormal } from '../src/ml/rng';

/** Mezcla gaussiana sintética con solución analítica: centros, pesos y desvío conocidos. */
const CENTERS = [
  [-5, 0],
  [5, 0],
  [0, 8],
];
const WEIGHTS = [0.5, 0.3, 0.2];
const SIGMA = 0.5;

function mixture(n: number, seed: number) {
  const rng = mulberry32(seed);
  const Z = new Float64Array(n * 2);
  const truth = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const u = rng();
    const c = u < WEIGHTS[0]! ? 0 : u < WEIGHTS[0]! + WEIGHTS[1]! ? 1 : 2;
    truth[i] = c;
    Z[i * 2] = CENTERS[c]![0]! + SIGMA * randNormal(rng);
    Z[i * 2 + 1] = CENTERS[c]![1]! + SIGMA * randNormal(rng);
  }
  return { Z, truth, n };
}

/** Ordena los centros como lo hace el módulo (por la primera coordenada) para comparar con los verdaderos. */
const expectedOrder = [0, 2, 1]; // x = −5, 0, 5

describe('k-means recupera clusters gaussianos separados', () => {
  const { Z, truth, n } = mixture(3000, 1);
  const res = clusterMatrix(Z, n, 2, ['GR', 'RHOB'], { k: 3, method: 'kmeans', seed: 4, standardize: false });

  it('centros y proporciones', () => {
    expectedOrder.forEach((trueC, idx) => {
      expect(res.centers[idx * 2]).toBeCloseTo(CENTERS[trueC]![0]!, 1);
      expect(Math.abs(res.centers[idx * 2 + 1]! - CENTERS[trueC]![1]!)).toBeLessThan(0.1);
      expect(Math.abs(res.weights[idx]! - WEIGHTS[trueC]!)).toBeLessThan(0.03);
      // El desvío dentro del cluster es σ = 0,5 (la separación hace despreciable el sesgo).
      expect(Math.abs(res.stdDevs[idx * 2]! - SIGMA)).toBeLessThan(0.05);
    });
  });

  it('asignación casi perfecta y probabilidades que suman 1', () => {
    let ok = 0;
    for (let i = 0; i < n; i++) if (expectedOrder[res.labels[i]!] === truth[i]) ok++;
    expect(ok / n).toBeGreaterThan(0.999);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let c = 0; c < 3; c++) s += res.probabilities[i * 3 + c]!;
      expect(s).toBeCloseTo(1, 5);
      expect(res.probabilities[i * 3 + res.labels[i]!]).toBeCloseTo(res.confidence[i]!, 6);
    }
    expect(res.counts.reduce((a, b) => a + b, 0)).toBe(n);
  });

  it('inercia analítica: n·d·σ² con d = 2 (valores observados = 2n)', () => {
    const km = kmeans(Z, n, 2, { k: 3, seed: 4 });
    expect(km.inertia / km.nObserved).toBeCloseTo(SIGMA * SIGMA, 1);
    expect(km.converged).toBe(true);
  });

  it('pseudo-probabilidad: un punto en un centro es ≈ 1 y uno equidistante de dos centros es ≈ 0,5/0,5', () => {
    const km = kmeans(Z, n, 2, { k: 3, seed: 4 });
    const c = km.centers;
    // Punto 1: sobre un centro. Punto 2: punto medio entre los centros 0 y 1 del resultado de k-means.
    const probe = new Float64Array([c[0]!, c[1]!, (c[0]! + c[2]!) / 2, (c[1]! + c[3]!) / 2]);
    const p = kmeansPseudoProbabilities(probe, 2, 2, { ...km, valid: Uint8Array.from([1, 1]) });
    expect(p[0]).toBeGreaterThan(0.99);
    expect(p[3]).toBeCloseTo(p[4]!, 6); // mismas distancias a los centros 0 y 1 (índices 3 y 4 de la matriz 2×3)
  });
});

describe('Mezcla gaussiana (EM, covarianza diagonal)', () => {
  const { Z, truth, n } = mixture(4000, 2);
  const res = gmm(Z, n, 2, { k: 3, seed: 9 });

  it('recupera centros, pesos y varianzas', () => {
    const km = clusterMatrix(Z, n, 2, ['GR', 'RHOB'], { k: 3, method: 'gmm', seed: 9, standardize: false });
    expectedOrder.forEach((trueC, idx) => {
      expect(Math.abs(km.centers[idx * 2]! - CENTERS[trueC]![0]!)).toBeLessThan(0.08);
      expect(Math.abs(km.centers[idx * 2 + 1]! - CENTERS[trueC]![1]!)).toBeLessThan(0.08);
      expect(Math.abs(km.weights[idx]! - WEIGHTS[trueC]!)).toBeLessThan(0.025);
      // σ² = 0,25 (más el piso de 1e-3): el desvío estimado ≈ 0,5.
      expect(Math.abs(km.stdDevs[idx * 2]! - SIGMA)).toBeLessThan(0.04);
      expect(Math.abs(km.stdDevs[idx * 2 + 1]! - SIGMA)).toBeLessThan(0.04);
    });
    expect(res.converged).toBe(true);
  });

  it('responsabilidades suman 1 y no hay NaN', () => {
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let c = 0; c < 3; c++) s += res.responsibilities[i * 3 + c]!;
      expect(s).toBeCloseTo(1, 5);
    }
    expect(Array.from(res.responsibilities).some(Number.isNaN)).toBe(false);
    let ok = 0;
    const order = [0, 0, 0];
    // El componente 0 del resultado crudo no tiene orden canónico: se compara por mayoría.
    const votes = [new Int32Array(3), new Int32Array(3), new Int32Array(3)];
    for (let i = 0; i < n; i++) votes[res.labels[i]!]![truth[i]!]!++;
    for (let c = 0; c < 3; c++) {
      const v = votes[c]!;
      order[c] = v.indexOf(Math.max(...v));
      ok += Math.max(...v);
    }
    expect(ok / n).toBeGreaterThan(0.999);
    expect(new Set(order).size).toBe(3);
  });

  it('BIC elige k = 3 frente a k = 2 y k = 6', () => {
    const bic = (k: number) => gmm(Z, n, 2, { k, seed: 9 }).bic;
    expect(bic(3)).toBeLessThan(bic(2));
    expect(bic(3)).toBeLessThan(bic(6));
  });

  it('determinismo: misma semilla → resultado idéntico', () => {
    const a = gmm(Z, n, 2, { k: 3, seed: 9 });
    expect(Array.from(a.means)).toEqual(Array.from(res.means));
    expect(a.logLikelihood).toBe(res.logLikelihood);
    const k1 = kmeans(Z, n, 2, { k: 3, seed: 3 });
    const k2 = kmeans(Z, n, 2, { k: 3, seed: 3 });
    expect(Array.from(k1.labels)).toEqual(Array.from(k2.labels));
  });
});

describe('Orden canónico, NaN, empates y degeneraciones', () => {
  it('el orden de los clusters no depende de la semilla (ordenados por la primera característica)', () => {
    const { Z, n } = mixture(1500, 3);
    for (const method of ['kmeans', 'gmm'] as const) {
      const runs = [1, 2, 3].map(seed => clusterMatrix(Z, n, 2, ['GR', 'RHOB'], { k: 3, method, seed, standardize: false }));
      for (const r of runs) {
        expect(r.centers[0]!).toBeLessThan(r.centers[2]!);
        expect(r.centers[2]!).toBeLessThan(r.centers[4]!);
        expect(Math.abs(r.centers[0]! - runs[0]!.centers[0]!)).toBeLessThan(0.05);
      }
    }
  });

  it('con 15 % de NaN aleatorios los centros se siguen recuperando y la salida no tiene NaN', () => {
    const { Z, n } = mixture(3000, 4);
    const rng = mulberry32(8);
    for (let i = 0; i < Z.length; i++) if (rng() < 0.15) Z[i] = NaN;
    for (const method of ['kmeans', 'gmm'] as const) {
      const r = clusterMatrix(Z, n, 2, ['GR', 'RHOB'], { k: 3, method, seed: 5, standardize: false });
      expectedOrder.forEach((trueC, idx) => {
        expect(Math.abs(r.centers[idx * 2]! - CENTERS[trueC]![0]!)).toBeLessThan(0.2);
        expect(Math.abs(r.centers[idx * 2 + 1]! - CENTERS[trueC]![1]!)).toBeLessThan(0.3);
      });
      expect(Array.from(r.probabilities).some(Number.isNaN)).toBe(false);
      expect(Array.from(r.centers).some(Number.isNaN)).toBe(false);
    }
  });

  it('filas completamente NaN son inválidas: reciben el cluster más poblado y probabilidades = pesos', () => {
    const { Z, n } = mixture(600, 5);
    Z[0] = NaN;
    Z[1] = NaN;
    for (const method of ['kmeans', 'gmm'] as const) {
      const r = clusterMatrix(Z, n, 2, ['GR', 'RHOB'], { k: 3, method, seed: 5, standardize: false });
      expect(r.valid[0]).toBe(0);
      expect(r.valid[1]).toBe(1);
      let s = 0;
      for (let c = 0; c < 3; c++) s += r.probabilities[c]!;
      expect(s).toBeCloseTo(1, 5);
      expect(r.counts.reduce((a, b) => a + b, 0)).toBe(n - 1);
    }
  });

  it('datos idénticos (empates totales) y una dimensión constante no producen NaN ni errores', () => {
    const n = 50;
    const same = new Float64Array(n * 2).fill(1);
    for (const method of ['kmeans', 'gmm'] as const) {
      const r = clusterMatrix(same, n, 2, ['GR', 'RHOB'], { k: 2, method, seed: 1, standardize: false });
      expect(Array.from(r.probabilities).some(Number.isNaN)).toBe(false);
      expect(Array.from(r.centers).some(Number.isNaN)).toBe(false);
    }
    // Una dimensión constante con estandarización: escala 1, no división por cero.
    const { Z } = mixture(300, 6);
    const flat = new Float64Array(300 * 3);
    for (let i = 0; i < 300; i++) {
      flat[i * 3] = Z[i * 2]!;
      flat[i * 3 + 1] = Z[i * 2 + 1]!;
      flat[i * 3 + 2] = 7;
    }
    const std = robustStandardize(flat, 300, 3);
    expect(std.scale[2]).toBe(1);
    const r = clusterMatrix(flat, 300, 3, ['GR', 'RHOB', 'DTC'], { k: 3, method: 'gmm', seed: 2 });
    expect(Array.from(r.probabilities).some(Number.isNaN)).toBe(false);
  });

  it('piden más clusters que filas válidas → error claro', () => {
    expect(() => kmeans(new Float64Array([1, 2, 3, 4]), 2, 2, { k: 3 })).toThrow(/filas válidas/);
    expect(() => gmm(new Float64Array([1, 2, 3, 4]), 2, 2, { k: 3 })).toThrow(/filas válidas/);
    expect(() => kmeans(new Float64Array(4), 2, 2, { k: 0 })).toThrow();
  });
});

describe('Estandarización robusta', () => {
  it('mediana ≈ media y escala ≈ σ en datos normales; resiste picos', () => {
    const rng = mulberry32(12);
    const n = 20000;
    const X = new Float64Array(n);
    for (let i = 0; i < n; i++) X[i] = 40 + 7 * randNormal(rng);
    X[0] = 1e6; // pico espurio
    X[1] = NaN;
    const { location, scale, Z } = robustStandardize(X, n, 1);
    expect(location[0]).toBeCloseTo(40, 0);
    expect(scale[0]).toBeCloseTo(7, 0);
    expect(Number.isNaN(Z[1])).toBe(true);
  });
});

describe('clusterElectrofacies sobre curvas', () => {
  // Dos facies: «arena» (GR 40, RHOB 2,30, NPHI 0,20, DTC 90, Rt 20 ohm·m) y «lutita» (GR 110, RHOB 2,55, NPHI 0,38, DTC 105, Rt 2).
  function wellCurves(n: number) {
    const rng = mulberry32(21);
    const GR = new Float64Array(n);
    const RHOB = new Float64Array(n);
    const NPHI = new Float64Array(n);
    const DTC = new Float64Array(n);
    const RDEP = new Float64Array(n);
    const truth = new Int8Array(n);
    for (let i = 0; i < n; i++) {
      const shale = rng() < 0.6 ? 1 : 0;
      truth[i] = shale;
      GR[i] = (shale ? 110 : 40) + 6 * randNormal(rng);
      RHOB[i] = (shale ? 2.55 : 2.3) + 0.03 * randNormal(rng);
      NPHI[i] = (shale ? 0.38 : 0.2) + 0.02 * randNormal(rng);
      DTC[i] = (shale ? 105 : 90) + 3 * randNormal(rng);
      RDEP[i] = Math.pow(10, Math.log10(shale ? 2 : 20) + 0.1 * randNormal(rng));
    }
    return { curves: { GR, RHOB, NPHI, DTC, RDEP }, truth, n };
  }

  it('devuelve centros en unidades originales (RDEP en log10) y separa las dos facies', () => {
    const { curves, truth, n } = wellCurves(2000);
    const r = clusterElectrofacies(curves, { k: 2, method: 'gmm', seed: 3 });
    expect(r.featureNames).toEqual(['GR', 'RHOB', 'NPHI', 'DTC', 'LOG_RDEP']);
    // Orden canónico por GR ascendente: cluster 0 = arena.
    expect(r.centers[0]).toBeCloseTo(40, -0.5);
    expect(r.centers[5]).toBeCloseTo(110, -0.5);
    expect(r.centers[1]).toBeCloseTo(2.3, 1);
    expect(r.centers[4]).toBeCloseTo(Math.log10(20), 1);
    expect(r.centers[9]).toBeCloseTo(Math.log10(2), 1);
    let ok = 0;
    for (let i = 0; i < n; i++) if (r.labels[i] === truth[i]) ok++;
    expect(ok / n).toBeGreaterThan(0.99);
    // El peso de lutita ≈ 0,6.
    expect(Math.abs(r.weights[1]! - 0.6)).toBeLessThan(0.04);
  });

  it('funciona con una curva faltante (columna NaN) y con k-means', () => {
    const { curves, n } = wellCurves(800);
    const partial = { GR: curves.GR, RHOB: curves.RHOB, RDEP: curves.RDEP, NPHI: curves.NPHI };
    const r = clusterElectrofacies(partial, { k: 2, method: 'kmeans', seed: 3 });
    expect(r.n).toBe(n);
    expect(Array.from(r.probabilities).some(Number.isNaN)).toBe(false);
  });

  it('scanClusterCount: BIC mínimo en k = 2 para dos facies', () => {
    const { curves } = wellCurves(1500);
    const rows = scanClusterCount(curves, [1, 2, 3, 5], { method: 'gmm', seed: 3 });
    const best = rows.reduce((a, b) => (b.bic! < a.bic! ? b : a));
    expect(best.k).toBe(2);
    const km = scanClusterCount(curves, [1, 2, 3], { method: 'kmeans', seed: 3 });
    expect(km[0]!.inertia!).toBeGreaterThan(km[1]!.inertia!);
    expect(km[1]!.inertia!).toBeGreaterThan(km[2]!.inertia!);
  });
});
