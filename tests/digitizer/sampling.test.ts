/**
 * Muestreo: del trazo a una serie física y su remuestreo. Casos calculados a mano.
 */
import { describe, expect, it } from 'vitest';
import { buildDepthCalibration } from '../../src/digitizer/calibration';
import { DigitizerError } from '../../src/digitizer/errors';
import {
  buildSeries,
  emptySeries,
  medianFilter,
  medianSpacing,
  pointsToSeries,
  removeSpikes,
  resampleSeries,
  resampleToIndex,
  resampleToUniform,
  traceToSeries,
  uniformDepthGrid,
} from '../../src/digitizer/sampling';
import type { DigitizedSeries, TracedCurve, ValueFrame } from '../../src/digitizer/types';

const LIN = { kind: 'linear', min: 0, max: 100, reversed: false } as const;
const LOG = { kind: 'log', min: 0.2, max: 2000, reversed: false } as const;
const mk = (depth: number[], values: number[], scale: typeof LIN | typeof LOG = LIN): DigitizedSeries => buildSeries(depth, values, null, scale);
const arr = (a: Float64Array) => Array.from(a);

describe('serie digitalizada', () => {
  it('ordena, promedia los puntos con la misma profundidad y descarta no finitos', () => {
    const s = buildSeries([11, 10, 10, NaN, 12], [300, 100, 200, 5, Infinity], [0.5, 1, 0.5, 1, 1], LIN);
    expect(arr(s.depthM)).toEqual([10, 11]);
    expect(arr(s.values)).toEqual([150, 300]);
    expect(arr(s.confidence)).toEqual([0.75, 0.5]);
  });

  it('en escala log los duplicados se promedian geométricamente (10 y 1000 → 100) y los valores ≤ 0 se descartan', () => {
    const s = buildSeries([5, 5, 6, 7], [10, 1000, 0, -3], null, LOG);
    expect(arr(s.depthM)).toEqual([5]);
    expect(s.values[0]).toBeCloseTo(100, 9);
  });

  it('trazo → serie con la calibración: y0=100 → 10 m (0,1 m/px) y x → valor (0–100 en 1000 px)', () => {
    const cal = buildDepthCalibration({ unit: 'm', method: 'linear', ties: [{ y: 0, depth: 0 }, { y: 1000, depth: 100 }] });
    const frame: ValueFrame = { leftPx: 0, rightPx: 1000, scale: LIN };
    const trace: TracedCurve = {
      y0: 100,
      x: Float64Array.from([100, 200, NaN, 400]),
      width: Float64Array.from([3, 3, NaN, 3]),
      confidence: Float64Array.from([1, 0.5, 0, 1]),
      observed: Uint8Array.from([1, 1, 0, 1]),
      warnings: [],
    };
    const s = traceToSeries(trace, cal, frame);
    expect(arr(s.depthM).map((v) => +v.toFixed(9))).toEqual([10, 10.1, 10.3]);
    expect(arr(s.values)).toEqual([10, 20, 40]);
    // filtros por confianza / observados
    expect(traceToSeries(trace, cal, frame, { minConfidence: 0.8 }).values.length).toBe(2);
    const t2 = { ...trace, observed: Uint8Array.from([1, 0, 0, 1]) };
    expect(traceToSeries(t2, cal, frame, { observedOnly: true }).values.length).toBe(2);
  });

  it('puntos sueltos (marcados a mano) → serie', () => {
    const cal = buildDepthCalibration({ unit: 'ft', method: 'linear', ties: [{ y: 0, depth: 1000 }, { y: 100, depth: 1100 }] });
    const frame: ValueFrame = { leftPx: 0, rightPx: 200, scale: LIN };
    const s = pointsToSeries([{ x: 100, y: 50 }, { x: 50, y: 0 }], cal, frame);
    expect(s.depthM[0]).toBeCloseTo(1000 * 0.3048, 9);
    expect(s.values[0]).toBe(25);
    expect(s.depthM[1]).toBeCloseTo(1050 * 0.3048, 9);
    expect(s.values[1]).toBe(50);
  });

  it('longitudes distintas: error', () => {
    expect(() => buildSeries([1, 2], [1], null, LIN)).toThrow(DigitizerError);
  });
});

describe('remuestreo', () => {
  it('lineal: nodos [0,1,2] valores [0,10,30]; sin extrapolar fuera del tramo', () => {
    const s = mk([0, 1, 2], [0, 10, 30]);
    // a mano: 0,5 → 5; 1,5 → 20; 2,5 y -0,1 fuera → NaN; 2 → 30 (nodo exacto)
    const r = resampleSeries(s, [0.5, 1.5, 2.5, -0.1, 2, 0]);
    expect(arr(r)).toEqual([5, 20, NaN, NaN, 30, 0]);
  });

  it('log: interpola en log10 (1 y 100 a mitad de camino → 10), no linealmente (50,5)', () => {
    const s = mk([0, 1], [1, 100], LOG);
    expect(resampleSeries(s, [0.5])[0]).toBeCloseTo(10, 9);
    expect(resampleSeries(s, [0.5], { interpolation: 'linear' })[0]).toBeCloseTo(50.5, 9);
  });

  it('huecos mayores que maxGapM dan NaN (los nodos exactos se conservan)', () => {
    const s = mk([0, 1, 5], [0, 10, 50]);
    const r = resampleSeries(s, [0.5, 1, 3, 5], { maxGapM: 2 });
    expect(arr(r)).toEqual([5, 10, NaN, 50]);
    // por defecto el máximo es 5 × espaciado mediano (= 5 × 4 = 20): el hueco de 4 m se interpola
    expect(resampleSeries(s, [3])[0]).toBe(30);
    expect(medianSpacing(s.depthM)).toBe(4);
  });

  it('al índice de un pozo existente: irregular, con tramo parcial', () => {
    const s = mk([100, 101, 102, 103], [0, 10, 20, 30]);
    const index = Float64Array.from([99.5, 100.25, 100.5, 102.75, 103, 103.1]);
    expect(arr(resampleToIndex(s, index))).toEqual([NaN, 2.5, 5, 27.5, 30, NaN]);
  });

  it('grilla uniforme en pies, alineada a múltiplos del paso: 0,5 ft entre 100 y 110 m', () => {
    // 100 m = 328,0840 ft → primer múltiplo de 0,5 ft: 328,5 ft = 100,1268 m. 110 m = 360,892 ft → último 360,5 ft = 109,8804 m → 65 muestras
    const g = uniformDepthGrid({ step: 0.5, unit: 'ft', topM: 100, baseM: 110 });
    expect(g.length).toBe(65);
    expect(g[0]).toBeCloseTo(100.1268, 9);
    expect(g[64]).toBeCloseTo(109.8804, 9);
    expect(g[1]! - g[0]!).toBeCloseTo(0.1524, 9);
    const m = uniformDepthGrid({ step: 0.25, topM: 10.05, baseM: 11 });
    expect(arr(m)).toEqual([10.25, 10.5, 10.75, 11]);
    const raw = uniformDepthGrid({ step: 0.25, topM: 10.05, baseM: 11, align: false });
    expect(raw[0]).toBe(10.05);
  });

  it('resampleToUniform: paso en ft, valores y stepM', () => {
    const s = mk([0, 10], [0, 100]);
    const r = resampleToUniform(s, { step: 5, unit: 'ft', maxGapM: 20 });
    // 5 ft = 1,524 m; grilla desde 0: 0, 1,524, … hasta 9,144 (6 pasos) → valores 10·z
    expect(r.stepM).toBeCloseTo(1.524, 12);
    expect(r.depthM.length).toBe(7);
    expect(r.values[1]).toBeCloseTo(15.24, 9);
    expect(r.values[6]).toBeCloseTo(91.44, 9);
  });

  it('serie vacía y de un solo punto: sin excepciones', () => {
    expect(resampleToUniform(emptySeries(LIN), { step: 1 }).depthM.length).toBe(0);
    expect(arr(resampleSeries(emptySeries(LIN), [1, 2]))).toEqual([NaN, NaN]);
    const one = mk([5], [42]);
    expect(arr(resampleSeries(one, [4.9, 5, 5.1]))).toEqual([NaN, 42, NaN]);
    const u = resampleToUniform(one, { step: 1, align: false });
    expect(arr(u.values)).toEqual([42]);
  });

  it('entradas inválidas: error en español', () => {
    expect(() => uniformDepthGrid({ step: 0, topM: 0, baseM: 1 })).toThrow(/paso de remuestreo/);
    expect(() => uniformDepthGrid({ step: NaN, topM: 0, baseM: 1 })).toThrow(/paso de remuestreo/);
    expect(() => uniformDepthGrid({ step: 1, topM: 5, baseM: 1 })).toThrow(/tramo/);
    expect(() => uniformDepthGrid({ step: 1, unit: 'yd' as 'm', topM: 0, baseM: 1 })).toThrow(/unidad/);
    expect(() => uniformDepthGrid({ step: 1e-6, topM: 0, baseM: 100 })).toThrow(/aumentá el paso/);
    expect(() => resampleSeries(mk([0, 1], [0, 1]), [0.5], { maxGapM: -1 })).toThrow(/no negativo/);
    expect(() => resampleToUniform(emptySeries(LIN), { step: -1 })).toThrow(/paso/);
  });

  it('con NaN o infinitos en la grilla: NaN en esa posición', () => {
    const s = mk([0, 1], [0, 10]);
    expect(arr(resampleSeries(s, [NaN, 0.5, Infinity]))).toEqual([NaN, 5, NaN]);
  });
});

describe('suavizado y picos', () => {
  it('mediana móvil de 3 elimina un punto aislado y conserva un escalón', () => {
    const s = mk([0, 1, 2, 3, 4], [1, 1, 50, 1, 1]);
    expect(arr(medianFilter(s, 3).values)).toEqual([1, 1, 1, 1, 1]);
    const step = mk([0, 1, 2, 3, 4, 5], [0, 0, 0, 10, 10, 10]);
    expect(arr(medianFilter(step, 3).values)).toEqual([0, 0, 0, 10, 10, 10]);
    expect(medianFilter(s, 1)).toBe(s);
    expect(() => medianFilter(s, 4)).toThrow(/impar/);
  });

  it('picos aislados: se eliminan o se reemplazan; un escalón real no se toca; por defecto no se hace nada', () => {
    const s = mk([0, 1, 2, 3, 4], [10, 12, 90, 11, 13]);
    // 90 se aparta 78 y 79 (> 25 % de 100) de sus vecinos 12 y 11, que coinciden entre sí
    expect(arr(removeSpikes(s).values)).toEqual([10, 12, 11, 13]);
    expect(arr(removeSpikes(s).depthM)).toEqual([0, 1, 3, 4]);
    // reemplazo por interpolación: (12 + 11)/2
    expect(arr(removeSpikes(s, { mode: 'replace' }).values)).toEqual([10, 12, 11.5, 11, 13]);
    const stepSeries = mk([0, 1, 2, 3, 4], [10, 10, 90, 90, 90]);
    expect(arr(removeSpikes(stepSeries).values)).toEqual([10, 10, 90, 90, 90]);
    expect(() => removeSpikes(s, { threshold: 0 })).toThrow(/umbral/);
    expect(removeSpikes(mk([0, 1], [1, 100]))).toBeDefined();
  });
});
