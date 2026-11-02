/**
 * Métricas y banderas de calidad, con trazos fabricados a mano (resultados esperados calculados) y con imágenes sintéticas.
 */
import { describe, expect, it } from 'vitest';
import { buildDepthCalibration } from '../../src/digitizer/calibration';
import { assessQuality, coverageOf, DEFAULT_QUALITY_THRESHOLDS } from '../../src/digitizer/quality';
import type { TracedCurve, ValueFrame } from '../../src/digitizer/types';
import { buildMask } from '../../src/digitizer/color';
import { traceCurve } from '../../src/digitizer/tracing';
import type { RasterImage } from '../../src/digitizer/types';
import { gauss, renderLog, rng } from './synth';

const cal = buildDepthCalibration({ unit: 'm', method: 'linear', ties: [{ y: 0, depth: 0 }, { y: 1000, depth: 100 }] });
const frame: ValueFrame = { leftPx: 0, rightPx: 1000, scale: { kind: 'linear', min: 0, max: 100, reversed: false } };

function trace(x: number[], conf = 1): TracedCurve {
  return {
    y0: 0,
    x: Float64Array.from(x),
    width: new Float64Array(x.length).fill(3),
    confidence: Float64Array.from(x, (v) => (Number.isNaN(v) ? 0 : conf)),
    observed: Uint8Array.from(x, (v) => (Number.isNaN(v) ? 0 : 1)),
    warnings: [],
  };
}

describe('métricas', () => {
  it('curva recta perfecta: cobertura 100 %, sin saltos, sin temblor, nivel bueno', () => {
    const q = assessQuality(trace(Array.from({ length: 200 }, () => 500)), cal, frame);
    expect(q.metrics).toMatchObject({ rows: 200, rowsWithData: 200, coverage: 1, jumps: 0, roughnessPx: 0, meanConfidence: 1 });
    expect(q.level).toBe('good');
    expect(q.isLowQuality).toBe(false);
    expect(q.flags).toEqual([]);
  });

  it('una rampa lineal (empinada) no cuenta como temblor ni como salto', () => {
    const q = assessQuality(trace(Array.from({ length: 200 }, (_, i) => 100 + 3 * i)), cal, frame);
    expect(q.metrics.roughnessPx).toBeCloseTo(0, 9);
    expect(q.metrics.jumps).toBe(0);
  });

  it('cobertura: 60 % → aviso; 30 % → mala', () => {
    const x60 = Array.from({ length: 100 }, (_, i) => (i < 60 ? 500 : NaN));
    const a = assessQuality(trace(x60), cal, frame);
    expect(a.metrics.coverage).toBe(0.6);
    expect(a.flags.map((f) => [f.code, f.level])).toEqual([['low-coverage', 'warning']]);
    expect(a.level).toBe('warning');
    expect(a.flags[0]!.message).toMatch(/60 %/);
    const x30 = Array.from({ length: 100 }, (_, i) => (i < 30 ? 500 : NaN));
    const b = assessQuality(trace(x30), cal, frame);
    expect(b.level).toBe('poor');
    expect(b.isLowQuality).toBe(true);
  });

  it('el tramo esperado mayor que el trazo reduce la cobertura (trazo de 100 filas en un tramo pedido de 200)', () => {
    const q = assessQuality(trace(Array.from({ length: 100 }, () => 500)), cal, frame, { expectedRows: { y0: 0, y1: 199 } });
    expect(q.metrics.rows).toBe(200);
    expect(q.metrics.coverage).toBe(0.5);
    expect(q.level).toBe('warning');
  });

  it('saltos: alternar entre 100 y 300 px (> 15 % de 1000 px) en cada fila', () => {
    const q = assessQuality(trace(Array.from({ length: 100 }, (_, i) => (i % 2 ? 300 : 100))), cal, frame);
    expect(q.metrics.jumps).toBe(99);
    expect(q.flags.some((f) => f.code === 'jumps' && f.level === 'poor')).toBe(true);
  });

  it('temblor: ruido gaussiano de 2 px en una recta se estima en ≈ 2 px (semilla fija)', () => {
    const r = rng(7);
    const q = assessQuality(trace(Array.from({ length: 4000 }, () => 500 + 2 * gauss(r))), cal, frame);
    expect(q.metrics.roughnessPx).toBeGreaterThan(1.8);
    expect(q.metrics.roughnessPx).toBeLessThan(2.2);
    expect(q.flags.some((f) => f.code === 'rough' && f.level === 'warning')).toBe(true);
    const r5 = rng(8);
    const q5 = assessQuality(trace(Array.from({ length: 4000 }, () => 500 + 5 * gauss(r5))), cal, frame);
    expect(q5.flags.some((f) => f.code === 'rough' && f.level === 'poor')).toBe(true);
  });

  it('confianza baja', () => {
    const q = assessQuality(trace(Array.from({ length: 100 }, () => 500), 0.4), cal, frame);
    expect(q.flags.map((f) => f.code)).toEqual(['low-confidence']);
    const p = assessQuality(trace(Array.from({ length: 100 }, () => 500), 0.2), cal, frame);
    expect(p.level).toBe('poor');
  });

  it('calibración: residuo RMS alto solo avisa con el método lineal y ≥ 3 amarres', () => {
    const ties = [{ y: 0, depth: 0 }, { y: 500, depth: 40 }, { y: 1000, depth: 100 }];
    const lin = buildDepthCalibration({ unit: 'm', method: 'linear', ties });
    const pw = buildDepthCalibration({ unit: 'm', method: 'piecewise', ties });
    const t = trace(Array.from({ length: 100 }, () => 500));
    const a = assessQuality(t, lin, frame);
    expect(a.metrics.calibrationRmsPx).toBeGreaterThan(5);
    expect(a.flags.some((f) => f.code === 'calibration' && f.level === 'poor')).toBe(true);
    expect(assessQuality(t, pw, frame).flags.some((f) => f.code === 'calibration')).toBe(false);
  });

  it('trazo vacío: cobertura 0 y calidad mala, sin excepción; umbrales editables', () => {
    const q = assessQuality(trace([]), cal, frame);
    expect(q.metrics.coverage).toBe(0);
    const q2 = assessQuality(trace(Array.from({ length: 100 }, (_, i) => (i < 60 ? 500 : NaN))), cal, frame, { thresholds: { coverageWarn: 0.5 } });
    expect(q2.level).toBe('good');
    expect(DEFAULT_QUALITY_THRESHOLDS.coverageWarn).toBe(0.8);
    expect(() => assessQuality(trace([1]), cal, { ...frame, rightPx: 0 })).toThrow(/sin ancho|ancho/);
  });

  it('coverageOf cuenta las muestras con dato', () => {
    expect(coverageOf(Float64Array.from([1, NaN, 3, NaN]))).toBe(0.5);
    expect(coverageOf(Float64Array.from([1, NaN, 3, NaN]), 0, 1)).toBe(1);
    expect(coverageOf(new Float64Array(0))).toBe(0);
  });
});

describe('calidad sobre imágenes sintéticas', () => {
  const sc = { kind: 'linear' as const, min: 0, max: 150, reversed: false };
  const make = (over = {}) =>
    renderLog({
      width: 720, height: 1500, left: 60, right: 660, topDepthM: 0, dzMPerPx: 0.05, gridRows: 40, gridCols: 10, seed: 3, ...over,
      curves: [{ id: 'GR', rgb: [30, 140, 60], thickness: 3, scale: sc, valueAt: (d: number) => 75 + 40 * Math.sin(d / 6) }],
    });
  const f: ValueFrame = { leftPx: 60, rightPx: 660, scale: sc };
  const region = { x0: 66, y0: 0, x1: 655, y1: 1500 };

  it('imagen limpia → buena; imagen sin la curva → mala (cobertura 0)', () => {
    const t = traceCurve(buildMask(make().image as RasterImage, region, { mode: 'color', rgb: [30, 140, 60] }));
    const good = assessQuality(t, cal, f);
    expect(good.level).toBe('good');
    expect(good.metrics.coverage).toBeGreaterThan(0.99);
    const none = renderLog({ width: 720, height: 1500, left: 60, right: 660, topDepthM: 0, dzMPerPx: 0.05, curves: [], gridRows: 40, seed: 3 });
    const t2 = traceCurve(buildMask(none.image as RasterImage, region, { mode: 'color', rgb: [30, 140, 60] }));
    const bad = assessQuality(t2, cal, f);
    expect(bad.metrics.coverage).toBe(0);
    expect(bad.level).toBe('poor');
  });
});
