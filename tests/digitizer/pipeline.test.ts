/**
 * Flujo completo sobre una imagen inclinada (el generador rota los vértices al dibujar): geometría → calibración → máscara →
 * trazado → serie → remuestreo uniforme, comparado con la verdad. Y casos de error del flujo.
 */
import { describe, expect, it } from 'vitest';
import { buildDepthCalibration, axisFromEdgeValues } from '../../src/digitizer/calibration';
import { estimateTiltAngle } from '../../src/digitizer/geometry';
import { applyGeometry, digitizeCurve, mapPoint } from '../../src/digitizer/pipeline';
import { resampleToUniform } from '../../src/digitizer/sampling';
import type { DigitizerCurveSpec, GeometryStep, RasterImage } from '../../src/digitizer/types';
import { makeTf, renderLog } from './synth';

const W = 720;
const H = 2400;
const TOP = 1000;
const DZ = 0.05;
const truth = (d: number) => 75 + 40 * Math.sin(d / 6) + 20 * Math.sin(d / 1.7 + 1);

function tiltedLog(deg: number) {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const cx = (W - 1) / 2;
  const cy = (H - 1) / 2;
  const tf = makeTf([c, s, cx - c * cx - s * cy, -s, c, cy + s * cx - c * cy, 0, 0, 1]);
  const log = renderLog({
    width: W, height: H, left: 60, right: 660, topDepthM: TOP, dzMPerPx: DZ, gridRows: 40, gridCols: 10, seed: 11, tf, textInside: 20,
    blur: true, noiseSigma: 6,
    curves: [{ id: 'GR', rgb: [30, 140, 60], thickness: 3, scale: { kind: 'linear', min: 0, max: 150, reversed: false }, valueAt: truth }],
  });
  return { log, tf };
}

describe('flujo completo con imagen inclinada 1,8°', () => {
  it('endereza, calibra, digitaliza y remuestrea: error RMS ≤ 1 % del rango, cobertura alta, calidad buena', () => {
    const { log, tf } = tiltedLog(1.8);
    const img = log.image as RasterImage;
    // 1) inclinación: dos puntos marcados sobre el borde izquierdo de la pista
    const [x1, y1] = tf(60, 100);
    const [x2, y2] = tf(60, 2300);
    const angle = estimateTiltAngle({ x: x1, y: y1 }, { x: x2, y: y2 });
    const steps: GeometryStep[] = [{ kind: 'rotate', angleRad: angle, expand: false }];
    const fixed = applyGeometry(img, steps);
    expect(fixed.image.width).toBe(W);
    // el punto del borde (60,100) marcado en la original cae en (≈60,≈100) en la corregida
    const p = mapPoint(fixed.forward, { x: x1, y: y1 });
    expect(Math.abs(p.x - 60)).toBeLessThan(0.1);
    expect(Math.abs(p.y - 100)).toBeLessThan(0.1);

    // 2) calibración: 3 amarres (± 0,5 px de error de pick) y bordes de la pista
    const depth = buildDepthCalibration({
      unit: 'm', method: 'linear',
      ties: [{ y: 200.4, depth: TOP + 200 * DZ }, { y: 1199.6, depth: TOP + 1200 * DZ }, { y: 2200.3, depth: TOP + 2200 * DZ }],
    });
    expect(depth.rmsResidualPx).toBeLessThan(1);
    const spec: DigitizerCurveSpec = {
      id: 'GR', mnemonic: 'GR', unit: 'gAPI', role: 'GR',
      frame: { leftPx: 60.3, rightPx: 659.6, scale: axisFromEdgeValues(0, 150, 'linear') },
      color: { mode: 'color', rgb: [30, 140, 60] },
      region: { x0: 68, y0: 0, x1: 652, y1: H }, mode: 'auto',
    };

    // 3) digitalización con progreso
    const seen: number[] = [];
    const r = digitizeCurve(fixed.image, depth, spec, { onProgress: (f) => seen.push(f) });
    expect(seen[seen.length - 1]).toBe(1);
    expect(r.quality.metrics.coverage).toBeGreaterThan(0.98);
    expect(r.quality.level).toBe('good');
    expect(r.series.depthM.length).toBeGreaterThan(2300);

    // 4) remuestreo uniforme a 0,25 m y comparación con la verdad
    const rmsOf = (series: typeof r.series) => {
      const u = resampleToUniform(series, { step: 0.25 });
      let ss = 0;
      let n = 0;
      for (let i = 0; i < u.depthM.length; i++) {
        if (Number.isNaN(u.values[i]!)) continue;
        ss += (u.values[i]! - truth(u.depthM[i]!)) ** 2;
        n++;
      }
      return { n, pct: (100 * Math.sqrt(ss / n)) / 150 };
    };
    const ok = rmsOf(r.series);
    expect(ok.n).toBeGreaterThan(400);
    expect(ok.pct).toBeLessThanOrEqual(1);
    // sin enderezar, la misma digitalización tiene un error varias veces mayor (la prueba tiene dientes)
    const raw = digitizeCurve(img, depth, spec);
    expect(rmsOf(raw.series).pct).toBeGreaterThan(3 * ok.pct);
    expect(rmsOf(raw.series).pct).toBeGreaterThan(1);
  });
});

describe('errores del flujo', () => {
  const { log } = tiltedLog(0);
  const depth = buildDepthCalibration({ unit: 'm', method: 'linear', ties: [{ y: 0, depth: TOP }, { y: 2000, depth: TOP + 2000 * DZ }] });
  const base: DigitizerCurveSpec = {
    id: 'GR', mnemonic: 'GR', unit: 'gAPI',
    frame: { leftPx: 60, rightPx: 660, scale: axisFromEdgeValues(0, 150, 'linear') },
    color: { mode: 'color', rgb: [30, 140, 60] }, region: { x0: 68, y0: 0, x1: 652, y1: H }, mode: 'auto',
  };
  const img = log.image as RasterImage;

  it('escala log con mínimo ≤ 0, marco invertido, modo guiado sin guía, región vacía: errores de DigitizerError en español', () => {
    expect(() => digitizeCurve(img, depth, { ...base, frame: { ...base.frame, scale: { kind: 'log', min: 0, max: 100, reversed: false } } })).toThrow(/positivos/);
    expect(() => digitizeCurve(img, depth, { ...base, frame: { ...base.frame, rightPx: 10 } })).toThrow(/a la derecha/);
    expect(() => digitizeCurve(img, depth, { ...base, mode: 'guided' })).toThrow(/sin polilínea guía|guiado/);
    expect(() => digitizeCurve(img, depth, { ...base, region: { x0: 900, y0: 0, x1: 950, y1: 10 } })).toThrow(/región/);
    expect(() => digitizeCurve({ width: 0, height: 0, data: new Uint8ClampedArray(0) }, depth, base)).toThrow(/imagen/);
  });

  it('imagen sin trazo: resultado vacío con calidad mala, sin excepción', () => {
    const blank = renderLog({ width: W, height: 800, left: 60, right: 660, topDepthM: TOP, dzMPerPx: DZ, curves: [], gridRows: 40, seed: 2 });
    const r = digitizeCurve(blank.image as RasterImage, depth, { ...base, region: { x0: 68, y0: 0, x1: 652, y1: 800 } });
    expect(r.series.depthM.length).toBe(0);
    expect(r.quality.level).toBe('poor');
    expect(r.trace.warnings.length).toBeGreaterThan(0);
  });

  it('cancelación a mitad del flujo', () => {
    const ctl = new AbortController();
    ctl.abort();
    expect(() => digitizeCurve(img, depth, base, { signal: ctl.signal })).toThrow(/se canceló/);
  });

  it('modo guiado desde la especificación de la curva', () => {
    const gx = (y: number) => 60 + (truth(TOP + y * DZ) / 150) * 600;
    const guide = { points: Array.from({ length: 60 }, (_, k) => ({ x: gx(k * 20) + 4, y: k * 20 })), corridor: 18 };
    const r = digitizeCurve(img, depth, { ...base, mode: 'guided', guide });
    expect(r.trace.x.length).toBe(1180 + 1);
    expect(r.quality.metrics.coverage).toBeGreaterThan(0.97);
  });
});
