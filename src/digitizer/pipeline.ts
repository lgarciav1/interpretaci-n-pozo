/**
 * Flujo completo del motor: geometría → máscara → trazado → serie → calidad. Puro (sin DOM); pensado para llamarse
 * desde un Web Worker con la imagen como `RasterImage` (los resultados son objetos simples y arrays tipados transferibles).
 */
import { assertValueFrame } from './calibration';
import { buildMask } from './color';
import { DigitizerError, type ProgressOptions } from './errors';
import { applyHomography, multiplyHomography, rectifyQuad, rotateImage, IDENTITY, type Homography } from './geometry';
import { assessQuality, type AssessOptions, type QualityReport } from './quality';
import { traceToSeries, type TraceToSeriesOptions } from './sampling';
import { traceCurve } from './tracing';
import type { DepthCalibration, DigitizedSeries, DigitizerCurveSpec, GeometryStep, PixelPoint, RasterImage, TracedCurve } from './types';

export interface GeometryApplied {
  image: RasterImage;
  /** Original → corregida (composición de todos los pasos). */
  forward: Homography;
}

/** Aplica en orden los pasos de corrección geométrica de la sesión. Sin pasos devuelve la misma imagen (sin copiar). */
export function applyGeometry(image: RasterImage, steps: readonly GeometryStep[], opts: ProgressOptions = {}): GeometryApplied {
  let img = image;
  let forward: Homography = IDENTITY;
  for (const s of steps) {
    const r = s.kind === 'rotate' ? rotateImage(img, s.angleRad, { ...opts, expand: s.expand }) : rectifyQuad(img, s.quad, s.outWidth, s.outHeight, opts);
    img = r.image;
    forward = multiplyHomography(r.forward, forward);
  }
  return { image: img, forward };
}

/** Lleva un punto de la imagen original a la corregida. */
export function mapPoint(forward: Readonly<Homography>, p: PixelPoint): PixelPoint {
  return applyHomography(forward, p);
}

export interface DigitizeCurveOptions extends ProgressOptions {
  quality?: AssessOptions;
  series?: TraceToSeriesOptions;
}

export interface DigitizeCurveResult {
  trace: TracedCurve;
  series: DigitizedSeries;
  quality: QualityReport;
}

/**
 * Digitaliza una curva sobre la imagen YA CORREGIDA: máscara según su color, trazado (automático o guiado según
 * `spec.mode`), conversión a unidades físicas con la calibración y evaluación de calidad.
 */
export function digitizeCurve(image: RasterImage, depth: DepthCalibration, spec: DigitizerCurveSpec, opts: DigitizeCurveOptions = {}): DigitizeCurveResult {
  assertValueFrame(spec.frame);
  if (spec.mode === 'guided' && !spec.guide) throw new DigitizerError('invalid-options', `La curva '${spec.id}' está en modo guiado pero no tiene polilínea guía.`);
  const sub = (a: number, b: number): ProgressOptions => ({
    ...(opts.signal ? { signal: opts.signal } : {}),
    ...(opts.onProgress ? { onProgress: (f: number) => opts.onProgress!(a + (b - a) * f) } : {}),
  });
  const mask = buildMask(image, spec.region, spec.color, sub(0, 0.4));
  const trace = traceCurve(mask, {
    ...sub(0.4, 0.95),
    ...(spec.settings ? { settings: spec.settings } : {}),
    ...(spec.mode === 'guided' && spec.guide ? { guide: spec.guide } : {}),
    ...(spec.prior ? { prior: spec.prior } : {}),
  });
  const series = traceToSeries(trace, depth, spec.frame, opts.series);
  const quality = assessQuality(trace, depth, spec.frame, opts.quality);
  opts.onProgress?.(1);
  return { trace, series, quality };
}
