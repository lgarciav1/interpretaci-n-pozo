import { describe, expect, it } from 'vitest';
import { netFlagsInto, type Cutoffs } from '../src/petro/cutoffs';
import { cutoffSweep, sweepThresholds, type SweepGrid, type SweepVariable } from '../src/petro/sensitivity';

// Referencia independiente: fuerza bruta con netFlagsInto en cada umbral (la definición de P5).
function brute(
  vsh: number[], phi: number[], sw: number[], h: number[], cutoffs: Cutoffs, variable: SweepVariable, grid: SweepGrid,
  ranges: { start: number; end: number }[],
) {
  const t = sweepThresholds(grid);
  const netRes = new Float64Array(t.length);
  const netPay = new Float64Array(t.length);
  const hphi = new Float64Array(t.length);
  const res = new Float64Array(vsh.length);
  const pay = new Float64Array(vsh.length);
  for (let j = 0; j < t.length; j++) {
    const c = { ...cutoffs, ...(variable === 'vsh' ? { vshMax: t[j]! } : variable === 'phi' ? { phiMin: t[j]! } : { swMax: t[j]! }) };
    netFlagsInto(vsh, phi, sw, res, pay, c);
    for (const { start, end } of ranges) {
      for (let i = start; i < end; i++) {
        if (res[i] === 1) netRes[j]! += h[i]!;
        if (pay[i] === 1) {
          netPay[j]! += h[i]!;
          hphi[j]! += h[i]! * phi[i]! * (1 - sw[i]!);
        }
      }
    }
  }
  return { t, netRes, netPay, hphi };
}

const GRIDS: Record<SweepVariable, SweepGrid> = {
  vsh: { min: 0, max: 1, steps: 41 },
  phi: { min: 0, max: 0.4, steps: 41 },
  sw: { min: 0, max: 1, steps: 41 },
};
const CUT: Cutoffs = { vshMax: 0.4, phiMin: 0.08, swMax: 0.6 };

function lcg(seed: number) {
  let s = seed;
  return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
}

function closeArrays(a: Float64Array, b: Float64Array, tol = 1e-9) {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) expect(Math.abs(a[i]! - b[i]!), `índice ${i}`).toBeLessThanOrEqual(tol);
}

describe('petro/sensitivity: umbrales', () => {
  it('t_j = min + j·(max − min)/(steps − 1); el último es exactamente max', () => {
    const t = sweepThresholds({ min: 0, max: 1, steps: 5 });
    expect(Array.from(t)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    const u = sweepThresholds({ min: 0, max: 0.4, steps: 41 });
    expect(u[0]).toBe(0);
    expect(u[40]).toBe(0.4);
    expect(u[10]).toBeCloseTo(0.1, 12);
  });

  it('grilla inválida (steps < 2, min ≥ max, no finitos) lanza RangeError', () => {
    expect(() => sweepThresholds({ min: 0, max: 1, steps: 1 })).toThrow(RangeError);
    expect(() => sweepThresholds({ min: 0, max: 1, steps: 2.5 })).toThrow(RangeError);
    expect(() => sweepThresholds({ min: 1, max: 1, steps: 5 })).toThrow(RangeError);
    expect(() => sweepThresholds({ min: 0, max: NaN, steps: 5 })).toThrow(RangeError);
  });
});

describe('petro/sensitivity: contra fuerza bruta', () => {
  // 1500 muestras con NaN dispersos, espesores variables y dos rangos (más una muestra fuera de ambos).
  const rnd = lcg(2026);
  const n = 1500;
  const pick = (x: number, pNaN: number) => (rnd() < pNaN ? NaN : x);
  const vsh = Array.from({ length: n }, () => pick(rnd(), 0.03));
  const phi = Array.from({ length: n }, () => pick(rnd() * 0.4, 0.03));
  const sw = Array.from({ length: n }, () => pick(rnd(), 0.05));
  const h = Array.from({ length: n }, () => 0.1 + rnd() * 0.2);
  const ranges = [
    { start: 0, end: 600 },
    { start: 700, end: n },
  ];

  for (const variable of ['vsh', 'phi', 'sw'] as const) {
    it(`variable ${variable}: netRes, netPay y h·φ·Sh coinciden en los 41 umbrales (tol 1e-9)`, () => {
      const got = cutoffSweep(vsh, phi, sw, h, CUT, variable, GRIDS[variable], ranges);
      const ref = brute(vsh, phi, sw, h, CUT, variable, GRIDS[variable], ranges);
      closeArrays(got.thresholds, ref.t, 0);
      closeArrays(got.netRes, ref.netRes);
      closeArrays(got.netPay, ref.netPay);
      closeArrays(got.hphiShPay, ref.hphi);
      expect(got.netPay[Math.round(GRIDS[variable].steps * 0.5)]).toBeGreaterThan(0);
    });
  }

  it('monotonía: endurecer un corte no aumenta netRes, netPay ni h·φ·Sh (Vsh y Sw suben → crecen; φ sube → decrecen)', () => {
    for (const variable of ['vsh', 'phi', 'sw'] as const) {
      const g = cutoffSweep(vsh, phi, sw, h, CUT, variable, GRIDS[variable], ranges);
      const sign = variable === 'phi' ? -1 : 1; // en φ el umbral crece = más estricto
      for (let j = 1; j < g.thresholds.length; j++) {
        expect(sign * (g.netRes[j]! - g.netRes[j - 1]!), `${variable} netRes ${j}`).toBeGreaterThanOrEqual(-1e-12);
        expect(sign * (g.netPay[j]! - g.netPay[j - 1]!), `${variable} netPay ${j}`).toBeGreaterThanOrEqual(-1e-12);
        expect(sign * (g.hphiShPay[j]! - g.hphiShPay[j - 1]!), `${variable} hphi ${j}`).toBeGreaterThanOrEqual(-1e-12);
      }
      // y pay ⊆ reservorio en todos los umbrales
      for (let j = 0; j < g.thresholds.length; j++) expect(g.netPay[j]!).toBeLessThanOrEqual(g.netRes[j]! + 1e-12);
    }
  });

  it('en el cutoff actual (si cae sobre la grilla) coincide con sumar netFlagsInto con los cortes vigentes', () => {
    // vshMax 0,4, phiMin 0,08 y swMax 0,6 son umbrales de las grillas de 41 pasos (j = 16, 8 y 24)
    const res = new Float64Array(n);
    const pay = new Float64Array(n);
    netFlagsInto(vsh, phi, sw, res, pay, CUT);
    let netRes = 0;
    let netPay = 0;
    let hphi = 0;
    for (const { start, end } of ranges) {
      for (let i = start; i < end; i++) {
        if (res[i] === 1) netRes += h[i]!;
        if (pay[i] === 1) {
          netPay += h[i]!;
          hphi += h[i]! * phi[i]! * (1 - sw[i]!);
        }
      }
    }
    const at: [SweepVariable, number][] = [['vsh', 16], ['phi', 8], ['sw', 24]];
    for (const [variable, j] of at) {
      const g = cutoffSweep(vsh, phi, sw, h, CUT, variable, GRIDS[variable], ranges);
      expect(Math.abs(g.thresholds[j]! - { vsh: 0.4, phi: 0.08, sw: 0.6 }[variable]), variable).toBeLessThan(1e-12);
      // los umbrales de la grilla pueden diferir del cutoff en ~1e-17: se compara con la tolerancia del barrido
      expect(g.netRes[j]!).toBeCloseTo(netRes, 9);
      expect(g.netPay[j]!).toBeCloseTo(netPay, 9);
      expect(g.hphiShPay[j]!).toBeCloseTo(hphi, 9);
    }
  });
});

describe('petro/sensitivity: bordes y casos a mano', () => {
  it('muestras exactamente sobre cada umbral (y a ±1 ulp) quedan del lado correcto, para las tres variables', () => {
    for (const variable of ['vsh', 'phi', 'sw'] as const) {
      const grid: SweepGrid = variable === 'phi' ? { min: 0, max: 0.4, steps: 11 } : { min: 0, max: 1, steps: 11 };
      const t = sweepThresholds(grid);
      const vsh: number[] = [];
      const phi: number[] = [];
      const sw: number[] = [];
      const h: number[] = [];
      const ulp = (x: number) => Math.max(Math.abs(x) * Number.EPSILON, Number.MIN_VALUE);
      for (const tj of t) {
        for (const v of [tj - ulp(tj), tj, tj + ulp(tj)]) {
          // la variable barrida toma v; las otras dos pasan sus cortes
          vsh.push(variable === 'vsh' ? v : 0.1);
          phi.push(variable === 'phi' ? v : 0.2);
          sw.push(variable === 'sw' ? v : 0.3);
          h.push(1);
        }
      }
      const ranges = [{ start: 0, end: vsh.length }];
      const got = cutoffSweep(vsh, phi, sw, h, CUT, variable, grid, ranges);
      const ref = brute(vsh, phi, sw, h, CUT, variable, grid, ranges);
      closeArrays(got.netRes, ref.netRes, 0);
      closeArrays(got.netPay, ref.netPay, 0);
      closeArrays(got.hphiShPay, ref.hphi, 1e-12);
    }
  });

  it('caso a mano, Vsh: 4 muestras de 1 m con Vsh 0,1/0,25/0,5/0,9; φ 0,2; Sw 0,3 (grilla 0, 0,5, 1)', () => {
    const grid = { min: 0, max: 1, steps: 3 }; // umbrales 0, 0,5, 1
    const g = cutoffSweep([0.1, 0.25, 0.5, 0.9], [0.2, 0.2, 0.2, 0.2], [0.3, 0.3, 0.3, 0.3], [1, 1, 1, 1], CUT, 'vsh', grid, [{ start: 0, end: 4 }]);
    // t = 0 → ninguna (0,1 > 0); t = 0,5 → 0,1/0,25/0,5 (el borde cuenta) = 3 m; t = 1 → 4 m
    expect(Array.from(g.netRes)).toEqual([0, 3, 4]);
    expect(Array.from(g.netPay)).toEqual([0, 3, 4]);
    // h·φ·(1 − Sw) por muestra = 0,2·0,7 = 0,14
    expect(g.hphiShPay[1]).toBeCloseTo(0.42, 12);
    expect(g.hphiShPay[2]).toBeCloseTo(0.56, 12);
  });

  it('caso a mano, Sw: el reservorio es constante y el pay crece con el umbral', () => {
    const grid = { min: 0, max: 1, steps: 3 };
    // Sw 0,2/0,5/0,8/NaN en reservorio; una quinta muestra no reservorio (Vsh alto) con Sw 0,1
    const g = cutoffSweep([0.1, 0.1, 0.1, 0.1, 0.9], [0.2, 0.2, 0.2, 0.2, 0.2], [0.2, 0.5, 0.8, NaN, 0.1], [1, 2, 1, 1, 1], CUT, 'sw', grid, [{ start: 0, end: 5 }]);
    expect(Array.from(g.netRes)).toEqual([5, 5, 5]); // 1+2+1+1 = 5 m
    expect(Array.from(g.netPay)).toEqual([0, 3, 4]); // t=0,5: 1 + 2 m; t=1: + 1 m
    expect(g.hphiShPay[1]).toBeCloseTo(1 * 0.2 * 0.8 + 2 * 0.2 * 0.5, 12); // 0,16 + 0,2
  });

  it('caso a mano, φ: el reservorio y el pay decrecen al subir el umbral', () => {
    const grid = { min: 0, max: 0.4, steps: 3 }; // 0, 0,2, 0,4
    const g = cutoffSweep([0.1, 0.1, 0.1], [0.05, 0.2, 0.3], [0.3, 0.3, 0.7], [1, 1, 1], CUT, 'phi', grid, [{ start: 0, end: 3 }]);
    expect(Array.from(g.netRes)).toEqual([3, 2, 0]); // t=0: todas; t=0,2: 0,2 (borde) y 0,3; t=0,4: ninguna
    expect(Array.from(g.netPay)).toEqual([2, 1, 0]); // la tercera tiene Sw 0,7 > 0,6
    expect(g.hphiShPay[0]).toBeCloseTo(0.05 * 0.7 + 0.2 * 0.7, 12);
  });

  it('NaN: Vsh o φ NaN no cuenta nunca; Sw NaN cuenta en reservorio pero no en pay; sin rangos → ceros', () => {
    const grid = { min: 0, max: 1, steps: 3 };
    const g = cutoffSweep([NaN, 0.1, 0.1], [0.2, NaN, 0.2], [0.1, 0.1, NaN], [1, 1, 1], CUT, 'vsh', grid, [{ start: 0, end: 3 }]);
    expect(Array.from(g.netRes)).toEqual([0, 1, 1]);
    expect(Array.from(g.netPay)).toEqual([0, 0, 0]);
    const e = cutoffSweep([0.1], [0.2], [0.3], [1], CUT, 'phi', { min: 0, max: 0.4, steps: 3 }, []);
    expect(Array.from(e.netRes)).toEqual([0, 0, 0]);
  });

  it('una zona y el total: las curvas del total son la suma de las de cada zona', () => {
    const rnd = lcg(7);
    const n = 300;
    const v = Array.from({ length: n }, rnd);
    const p = Array.from({ length: n }, () => rnd() * 0.4);
    const w = Array.from({ length: n }, rnd);
    const h = Array.from({ length: n }, () => 0.15);
    const a = { start: 0, end: 120 };
    const b = { start: 120, end: n };
    for (const variable of ['vsh', 'phi', 'sw'] as const) {
      const grid = GRIDS[variable];
      const ga = cutoffSweep(v, p, w, h, CUT, variable, grid, [a]);
      const gb = cutoffSweep(v, p, w, h, CUT, variable, grid, [b]);
      const gt = cutoffSweep(v, p, w, h, CUT, variable, grid, [a, b]);
      for (let j = 0; j < grid.steps; j++) {
        expect(gt.netRes[j]!).toBeCloseTo(ga.netRes[j]! + gb.netRes[j]!, 9);
        expect(gt.netPay[j]!).toBeCloseTo(ga.netPay[j]! + gb.netPay[j]!, 9);
        expect(gt.hphiShPay[j]!).toBeCloseTo(ga.hphiShPay[j]! + gb.hphiShPay[j]!, 9);
      }
    }
  });
});
