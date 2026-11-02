/**
 * Prueba REALISTA con datos reales: el GR y la resistividad AT90 del pozo del TP (datos/pozo_tp_perfiles.csv, tramo de
 * 150 m) se dibujan como un registro escaneado (dos pistas, grilla, rótulos, desenfoque, ruido, artefactos JPEG, 0,7° de
 * inclinación) con el generador sintético; se digitalizan de punta a punta (inclinación → calibración con errores de pick →
 * trazado → remuestreo al índice ORIGINAL del pozo) y se comparan con las curvas verdaderas.
 */
import { describe, expect, it } from 'vitest';
import csvText from '../../datos/pozo_tp_perfiles.csv?raw';
import { readWellFile } from '../../src/io';
import { axisFromEdgeValues, buildDepthCalibration } from '../../src/digitizer/calibration';
import { estimateTiltAngle } from '../../src/digitizer/geometry';
import { addDigitizedCurveToWell } from '../../src/digitizer/integration';
import { applyGeometry, digitizeCurve } from '../../src/digitizer/pipeline';
import { resampleToIndex } from '../../src/digitizer/sampling';
import type { DigitizerCurveSpec, RasterImage } from '../../src/digitizer/types';
import { report } from './harness';
import { compareArrays, makeTf, renderLog, rng } from './synth';

const { well: tp } = readWellFile(csvText, 'pozo_tp_perfiles.csv');
const TOP_M = 7700;
const BASE_M = 7850;

const depth = tp.depth.values;
const i0 = depth.findIndex((d) => d >= TOP_M);
const i1 = depth.findIndex((d) => d > BASE_M);
const seg = { depth: depth.subarray(i0, i1), gr: tp.curves.find((c) => c.mnemonic === 'GR')!.data.subarray(i0, i1), rt: tp.curves.find((c) => c.mnemonic === 'AT90')!.data.subarray(i0, i1) };

/** Valor de una curva muestreada en una profundidad: interpolación lineal (o en log10) entre muestras vecinas. */
function interp(values: Float64Array, d: number, log: boolean): number {
  const step = seg.depth[1]! - seg.depth[0]!;
  const f = Math.min(Math.max((d - seg.depth[0]!) / step, 0), values.length - 1.000001);
  const k = Math.floor(f);
  const w = f - k;
  const a = log ? Math.log10(values[k]!) : values[k]!;
  const b = log ? Math.log10(values[k + 1]!) : values[k + 1]!;
  const v = a + w * (b - a);
  return log ? 10 ** v : v;
}

describe('GR y AT90 del pozo del TP, de punta a punta', () => {
  it('el tramo tiene los datos esperados', () => {
    expect(seg.depth.length).toBeGreaterThan(980);
    expect(seg.gr.every(Number.isFinite)).toBe(true);
    expect(seg.rt.every((v) => v > 0)).toBe(true);
  });

  it('digitalización completa: RMSE y correlación contra las curvas verdaderas', { timeout: 120_000 }, () => {
    const DZ = 0.04; // m por píxel (≈ 3,8 filas por muestra)
    const TOP_IMG = TOP_M - 2;
    const H = Math.ceil((BASE_M + 2 - TOP_IMG) / DZ);
    const W = 1020;
    const tracks = [{ left: 80, right: 480 }, { left: 540, right: 940 }];
    const GR_SCALE = { kind: 'linear' as const, min: 0, max: 150, reversed: false };
    const RT_SCALE = { kind: 'log' as const, min: 0.2, max: 2000, reversed: false };

    // el escaneo está inclinado 0,7° alrededor del centro
    const a = (0.7 * Math.PI) / 180;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const cx = (W - 1) / 2;
    const cy = (H - 1) / 2;
    const tf = makeTf([c, s, cx - c * cx - s * cy, -s, c, cy + s * cx - c * cy, 0, 0, 1]);

    const log = renderLog({
      width: W, height: H, left: 80, right: 480, tracks, topDepthM: TOP_IMG, dzMPerPx: DZ, gridRows: 50, gridCols: 10, seed: 21, tf,
      textOutside: 30, textInside: 30, blur: true, noiseSigma: 6, saltPepper: 0.002, jpegQ: 5,
      curves: [
        { id: 'GR', rgb: [30, 140, 60], thickness: 3, scale: GR_SCALE, valueAt: (d) => interp(seg.gr, d, false), track: 0 },
        { id: 'RT', rgb: [200, 30, 30], thickness: 3, scale: RT_SCALE, valueAt: (d) => interp(seg.rt, d, true), track: 1 },
      ],
    });
    const img = log.image as RasterImage;

    // el usuario marca (con ±0,5 px de error): dos puntos del borde izquierdo de la pista 1, 4 amarres de profundidad, bordes
    const r = rng(99);
    const pick = (v: number) => v + (r() - 0.5);
    const [ax, ay] = tf(80, 200);
    const [bx, by] = tf(80, H - 200);
    const angle = estimateTiltAngle({ x: pick(ax), y: pick(ay) }, { x: pick(bx), y: pick(by) });
    expect(Math.abs(angle - a)).toBeLessThan(0.001); // 0,06°
    const fixed = applyGeometry(img, [{ kind: 'rotate', angleRad: angle, expand: false }]);

    const rows = [300, 1300, 2500, H - 300];
    const calDepth = buildDepthCalibration({ unit: 'm', method: 'linear', ties: rows.map((y) => ({ y: pick(y), depth: TOP_IMG + y * DZ })) });
    expect(calDepth.rmsResidualPx).toBeLessThan(1);

    const specs: DigitizerCurveSpec[] = [
      {
        id: 'GR', mnemonic: 'GR', unit: 'gAPI', role: 'GR',
        frame: { leftPx: pick(80), rightPx: pick(480), scale: axisFromEdgeValues(0, 150, 'linear') },
        color: { mode: 'color', rgb: [30, 140, 60] }, region: { x0: 86, y0: 0, x1: 474, y1: H }, mode: 'auto',
      },
      {
        id: 'RT', mnemonic: 'AT90', unit: 'ohm.m', role: 'RT',
        frame: { leftPx: pick(540), rightPx: pick(940), scale: axisFromEdgeValues(0.2, 2000, 'log') },
        color: { mode: 'color', rgb: [200, 30, 30] }, region: { x0: 546, y0: 0, x1: 934, y1: H }, mode: 'auto',
      },
    ];

    // pozo "destino": mismas profundidades que el original, solo con los datos del tramo (el índice original completo)
    const results: Record<string, { rmse: number; r: number; n: number; cov: number; rmseLog?: number }> = {};
    for (const spec of specs) {
      const out = digitizeCurve(fixed.image, calDepth, spec);
      expect(out.quality.level).not.toBe('poor');
      const resampled = resampleToIndex(out.series, seg.depth);
      const truth = spec.id === 'GR' ? seg.gr : seg.rt;
      const st = compareArrays(resampled, truth);
      let cov = 0;
      for (const v of resampled) if (!Number.isNaN(v)) cov++;
      results[spec.id] = { rmse: st.rmse, r: st.correlation, n: st.n, cov: cov / resampled.length };
      if (spec.id === 'RT') {
        const la = Array.from(resampled, (v) => Math.log10(v));
        const lb = Array.from(truth, (v) => Math.log10(v));
        results['RT']!.rmseLog = compareArrays(la, lb).rmse;
      }
    }
    // Cotas basadas en lo medido (ver docs/decisiones/0062): GR sobre una escala de 150 gAPI, RT en décadas (4 décadas de escala)
    const gr = results['GR']!;
    const rt = results['RT']!;
    report(`[realista] GR: RMSE ${gr.rmse.toFixed(3)} gAPI (${((100 * gr.rmse) / 150).toFixed(2)} % de 150), r=${gr.r.toFixed(5)}, n=${gr.n}, cobertura ${(100 * gr.cov).toFixed(1)} %`);
    report(`[realista] AT90: RMSE ${rt.rmse.toFixed(4)} ohm.m, ${rt.rmseLog!.toFixed(4)} décadas (${((100 * rt.rmseLog!) / 4).toFixed(2)} % de 4), r=${rt.r.toFixed(5)}, n=${rt.n}, cobertura ${(100 * rt.cov).toFixed(1)} %`);
    expect(gr.cov).toBeGreaterThan(0.97);
    expect(rt.cov).toBeGreaterThan(0.97);
    expect((100 * gr.rmse) / 150).toBeLessThanOrEqual(1);
    expect(gr.r).toBeGreaterThan(0.99);
    expect((100 * rt.rmseLog!) / 4).toBeLessThanOrEqual(1);
    expect(rt.r).toBeGreaterThan(0.99);

    // la curva digitalizada entra al pozo original (índice completo de 5.810 muestras): NaN fuera del tramo
    const out = digitizeCurve(fixed.image, calDepth, specs[0]!);
    const added = addDigitizedCurveToWell(tp, out.series, { id: 'GR_DIG', mnemonic: 'GR_DIG', unit: 'gAPI', role: null });
    expect(added.curve.data.length).toBe(tp.depth.values.length);
    expect(added.coverage).toBeLessThan(0.2);
    expect(added.curve.data[0]).toBeNaN();
    expect(added.curve.data[tp.depth.values.length - 1]).toBeNaN();
    expect(added.topM).toBeGreaterThanOrEqual(TOP_M - 3); // el margen de la imagen (2 m) también se digitaliza
  });
});
