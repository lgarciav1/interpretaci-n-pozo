import { describe, expect, it } from 'vitest';
import { readCalibration, type TrackCalibration } from './calibration';

const base: TrackCalibration = {
  left: 100, right: 500, top: { x: 100, y: 50 }, bottom: { x: 500, y: 850 },
  topDepthM: 2000, bottomDepthM: 2100,
  scale: { kind: 'linear', min: 0, max: 150, reversed: false },
};

describe('log digitizer calibration', () => {
  it('maps image pixels to depth and linear values', () => {
    expect(readCalibration({ x: 300, y: 450 }, base)).toEqual({ depthM: 2050, value: 75 });
  });
  it('handles logarithmic and reversed axes', () => {
    const scale = { kind: 'log' as const, min: 1, max: 100, reversed: true };
    expect(readCalibration({ x: 100, y: 450 }, { ...base, scale }).value).toBeCloseTo(100);
    expect(readCalibration({ x: 500, y: 450 }, { ...base, scale }).value).toBeCloseTo(1);
  });
  it('rejects invalid depth markers', () => {
    expect(() => readCalibration({ x: 300, y: 450 }, { ...base, bottomDepthM: 1990 })).toThrow();
  });
});
