import { fractionToValue, validScale, type AxisScale } from '../viewer/scale';

export interface ImagePoint { x: number; y: number }
export interface TrackCalibration {
  left: number;
  right: number;
  top: ImagePoint;
  bottom: ImagePoint;
  topDepthM: number;
  bottomDepthM: number;
  scale: AxisScale;
}

/** Coordinates are in source-image pixels, independent of zoom. */
export function readCalibration(point: ImagePoint, calibration: TrackCalibration): { depthM: number; value: number } {
  const { left, right, top, bottom, topDepthM, bottomDepthM, scale } = calibration;
  if (![left, right, top.y, bottom.y, topDepthM, bottomDepthM].every(Number.isFinite)
    || !(right > left) || !(bottom.y > top.y) || !(bottomDepthM > topDepthM) || !validScale(scale)) {
    throw new Error('Calibración inválida: revisá los límites, las profundidades y la escala.');
  }
  const depthM = topDepthM + (point.y - top.y) / (bottom.y - top.y) * (bottomDepthM - topDepthM);
  const value = fractionToValue((point.x - left) / (right - left), scale);
  return { depthM, value };
}
