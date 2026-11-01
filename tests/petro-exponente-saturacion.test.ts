/**
 * Exponente de saturación n desde el índice de resistividad de corona (docs/decisiones/0053): motor puro
 * `src/petro/coreCalibration.ts` contra casos sintéticos exactos y contra los datos de la cátedra
 * (tests/fixtures/tp-corona-electrica-scal.json, valores esperados calculados con numpy FUERA del código TS).
 */
import { describe, expect, it } from 'vitest';
import { fitSaturationExponent, resistivityIndex, saturationExponentPerPlug } from '../src/petro/coreCalibration';
import scal from './fixtures/tp-corona-electrica-scal.json';

const swOf = (pairs: number[][]) => pairs.map((p) => p[0]!);
const riOf = (pairs: number[][]) => pairs.map((p) => p[1]!);

describe('petro/coreCalibration: índice de resistividad', () => {
  it('RI = Rt/Ro; sin dato con resistividades no positivas o infinitas', () => {
    expect(resistivityIndex(6.52515, 1.80525)).toBeCloseTo(3.614541, 6);
    expect(resistivityIndex(2, 2)).toBe(1);
    for (const [rt, ro] of [[0, 1], [1, 0], [-1, 2], [NaN, 1], [1, Infinity], [Infinity, 1]] as const) expect(resistivityIndex(rt, ro)).toBeNaN();
  });
});

describe('petro/coreCalibration: ajuste de n (sintético exacto)', () => {
  const sw = [1, 0.9, 0.75, 0.6, 0.45, 0.32, 0.22];

  it('RI = Sw^−2,1 por el origen ⇒ n = 2,1 (±1e-9), R² = 1, RMSE 0', () => {
    const ri = sw.map((s) => s ** -2.1);
    const r = fitSaturationExponent(sw, ri);
    expect(r.count).toBe(7);
    expect(r.origin!.n).toBeCloseTo(2.1, 9);
    expect(r.origin!.intercept).toBe(1);
    expect(r.origin!.r2).toBeCloseTo(1, 12);
    expect(r.origin!.rmseLog10RI).toBeLessThan(1e-12);
    // El libre también lo recupera, con RI(Sw = 1) = 1.
    expect(r.free!.n).toBeCloseTo(2.1, 9);
    expect(r.free!.intercept).toBeCloseTo(1, 9);
  });

  it('con ordenada: RI = 1,2·Sw^−2,1 ⇒ el libre recupera n = 2,1 y RI(1) = 1,2; el del origen no', () => {
    const ri = sw.map((s) => 1.2 * s ** -2.1);
    const r = fitSaturationExponent(sw, ri);
    expect(r.free!.n).toBeCloseTo(2.1, 9);
    expect(r.free!.intercept).toBeCloseTo(1.2, 9);
    expect(r.free!.r2).toBeCloseTo(1, 12);
    expect(r.origin!.n).toBeGreaterThan(2.1);
  });

  it('un punto ⇒ por el origen = n puntual; el libre necesita 3', () => {
    const r = fitSaturationExponent([0.5], [0.5 ** -2.3]);
    expect(r.origin!.n).toBeCloseTo(2.3, 12);
    expect(r.origin!.n).toBeCloseTo(saturationExponentPerPlug(0.5, 0.5 ** -2.3), 12);
    expect(r.free).toBeNull();
  });

  it('cuenta a mano (no de libro): Sw 0,5 y 0,25 con RI 4 y 20 ⇒ n = −Σxy/Σx²', () => {
    const x = [Math.log(0.5), Math.log(0.25)];
    const y = [Math.log(4), Math.log(20)];
    const expected = -(x[0]! * y[0]! + x[1]! * y[1]!) / (x[0]! ** 2 + x[1]! ** 2);
    expect(fitSaturationExponent([0.5, 0.25], [4, 20]).origin!.n).toBeCloseTo(expected, 12);
  });

  it('degenerados: sin puntos válidos, todos con Sw = 1, Sw fuera de (0, 1], RI no positivo', () => {
    expect(fitSaturationExponent([], [])).toEqual({ count: 0, origin: null, free: null });
    expect(fitSaturationExponent([1, 1, 1], [1, 1.1, 0.9])).toMatchObject({ count: 3, origin: null, free: null });
    expect(fitSaturationExponent([0, -0.2, 1.3, NaN], [2, 3, 1, 4])).toEqual({ count: 0, origin: null, free: null });
    expect(fitSaturationExponent([0.5, 0.4], [0, -1])).toEqual({ count: 0, origin: null, free: null });
    // Los inválidos se ignoran y no cambian el resultado de los válidos.
    const a = fitSaturationExponent([0.5, 0.3, 0.8, 2, 0.4], [0.5 ** -2, 0.3 ** -2, 0.8 ** -2, 5, NaN]);
    expect(a.count).toBe(3);
    expect(a.origin!.n).toBeCloseTo(2, 12);
  });

  it('los pasos con Sw = 1 cuentan en el R² pero no en la pendiente por el origen', () => {
    const a = fitSaturationExponent([0.5, 0.25], [0.5 ** -2, 0.25 ** -2]);
    const b = fitSaturationExponent([1, 1, 0.5, 0.25], [1, 1, 0.5 ** -2, 0.25 ** -2]);
    expect(b.count).toBe(4);
    expect(b.origin!.n).toBeCloseTo(a.origin!.n, 12);
  });

  it('n puntual: −ln RI / ln Sw; NaN con Sw = 1, Sw ≤ 0, Sw > 1 o RI ≤ 0', () => {
    expect(saturationExponentPerPlug(0.559, 0.559 ** -2.2)).toBeCloseTo(2.2, 12);
    for (const [s, r] of [[1, 1], [0, 2], [1.2, 2], [0.5, 0], [0.5, -1], [NaN, 2], [0.5, Infinity]] as const) expect(saturationExponentPerPlug(s, r)).toBeNaN();
  });
});

describe('petro/coreCalibration: n con los datos de la cátedra (TP)', () => {
  const e = scal.expected;

  it('muestra 1-6R2, 2 terminales: n por el origen = 2,223465', () => {
    const p = scal.riSw_1_6R2.twoTerminal;
    expect(fitSaturationExponent(swOf(p), riOf(p)).origin!.n).toBeCloseTo(e.n_1_6R2_twoTerminal_origin, 5);
  });

  it('muestra 1-6R2, 4 terminales: n por el origen = 2,223784', () => {
    const p = scal.riSw_1_6R2.fourTerminal;
    expect(fitSaturationExponent(swOf(p), riOf(p)).origin!.n).toBeCloseTo(e.n_1_6R2_fourTerminal_origin, 5);
  });

  it('586 pares compuestos: n por el origen = 2,210858', () => {
    const p = scal.riSwPooled;
    const r = fitSaturationExponent(swOf(p), riOf(p));
    expect(r.count).toBe(586);
    expect(r.origin!.n).toBeCloseTo(e.n_pooled_origin, 5);
    expect(r.origin!.r2).toBeGreaterThan(0.9);
  });

  it('media del n puntual de los 12 plugs (RI = Rt/Ro) = 2,230010; positivo, cerca del |n| medio del laboratorio', () => {
    const ns = scal.formationFactor.map((f) => saturationExponentPerPlug(f.Sw, resistivityIndex(f.Rt, f.Ro)));
    expect(ns.every(Number.isFinite)).toBe(true);
    const mean = ns.reduce((s, v) => s + v, 0) / ns.length;
    expect(mean).toBeCloseTo(e.n_meanPerSample, 5);
    // Convención: el laboratorio informa la pendiente (negativa) de su propio ajuste; la app, n positivo.
    expect(scal.formationFactor.every((f) => f.nLab < 0)).toBe(true);
    const labMean = scal.formationFactor.reduce((s, f) => s + Math.abs(f.nLab), 0) / ns.length;
    expect(Math.abs(mean - labMean)).toBeLessThan(0.02);
  });
});
