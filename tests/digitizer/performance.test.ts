/**
 * Rendimiento: una pista de ~1.500 × 12.000 px (18 millones de píxeles). Objetivo orientativo: < 3 s en Node para
 * máscara + trazado. Los milisegundos medidos se imprimen en la salida estándar y se anotan en docs/decisiones/0062.
 */
import { describe, expect, it } from 'vitest';
import { buildMask } from '../../src/digitizer/color';
import { rotateImage } from '../../src/digitizer/geometry';
import { traceCurve } from '../../src/digitizer/tracing';
import type { RasterImage } from '../../src/digitizer/types';
import { evaluate, report } from './harness';
import { renderLog } from './synth';

const now = () => performance.now();

describe('rendimiento en una pista de 1.500 × 12.000 px', () => {
  it('máscara de color + trazado automático en menos de 3 s, sin copiar la imagen', { timeout: 120_000 }, () => {
    const W = 1500;
    const H = 12000;
    const log = renderLog({
      width: W, height: H, left: 100, right: 1400, topDepthM: 0, dzMPerPx: 0.0125, gridRows: 60, gridCols: 10, seed: 9,
      textInside: 200, saltPepper: 0.002,
      curves: [{
        id: 'GR', rgb: [30, 140, 60], thickness: 4, scale: { kind: 'linear', min: 0, max: 150, reversed: false },
        valueAt: (d) => 75 + 40 * Math.sin(d / 3) + 20 * Math.sin(d / 0.9 + 1) + 10 * Math.sin(d * 7),
      }],
    });
    const img = log.image as RasterImage;
    const before = img.data.slice(0, 100000);
    const region = { x0: 106, y0: 0, x1: 1395, y1: H };
    const t0 = now();
    const mask = buildMask(img, region, { mode: 'color', rgb: [30, 140, 60] });
    const t1 = now();
    const trace = traceCurve(mask);
    const t2 = now();
    const e = evaluate(log, 'GR', trace);
    report(`[rendimiento] ${W}x${H}: máscara ${(t1 - t0).toFixed(0)} ms, trazado ${(t2 - t1).toFixed(0)} ms, total ${(t2 - t0).toFixed(0)} ms; cobertura ${(100 * e.coverage).toFixed(1)} %, RMS ${e.rmsPct.toFixed(3)} %`);
    expect(t2 - t0).toBeLessThan(3000);
    expect(e.coverage).toBeGreaterThan(0.99);
    expect(e.rmsPct).toBeLessThanOrEqual(1);
    // el motor no modifica la imagen de entrada
    expect(Array.from(img.data.subarray(0, 100000))).toEqual(Array.from(before));
  });

  it('modo oscuro sobre la misma pista', { timeout: 120_000 }, () => {
    const W = 1500;
    const H = 12000;
    const log = renderLog({
      width: W, height: H, left: 100, right: 1400, topDepthM: 0, dzMPerPx: 0.0125, gridRows: 60, gridCols: 10, seed: 10, textInside: 200,
      curves: [{ id: 'GR', rgb: [15, 15, 15], thickness: 4, scale: { kind: 'linear', min: 0, max: 150, reversed: false }, valueAt: (d) => 75 + 40 * Math.sin(d / 3) + 20 * Math.sin(d / 0.9 + 1) }],
    });
    const t0 = now();
    const mask = buildMask(log.image as RasterImage, { x0: 106, y0: 0, x1: 1395, y1: H }, { mode: 'dark' });
    const trace = traceCurve(mask);
    const dt = now() - t0;
    const e = evaluate(log, 'GR', trace);
    report(`[rendimiento] modo oscuro: ${dt.toFixed(0)} ms; cobertura ${(100 * e.coverage).toFixed(1)} %, RMS ${e.rmsPct.toFixed(3)} %`);
    expect(dt).toBeLessThan(3000);
    expect(e.rmsPct).toBeLessThanOrEqual(1);
  });

  it('rotar una imagen de 1.500 × 12.000 (corrección de inclinación) en un tiempo razonable', { timeout: 120_000 }, () => {
    const img: RasterImage = { width: 1500, height: 12000, data: new Uint8ClampedArray(1500 * 12000 * 4).fill(255) };
    const t0 = now();
    const r = rotateImage(img, 0.02);
    const dt = now() - t0;
    report(`[rendimiento] rotación 1500x12000: ${dt.toFixed(0)} ms`);
    expect(r.image.width).toBe(1500);
    expect(dt).toBeLessThan(5000);
  });
});
