import { distQuantile, type Dist } from './uncertainty';

export const BAND_ROLES = ['PHIE', 'SW'] as const;
export type BandRole = (typeof BAND_ROLES)[number];

export interface CurveBand {
  p90: Float64Array;
  p10: Float64Array;
}

export interface CurveBandInput {
  values: Float64Array;
  multiplier: Dist;
}

export type CurveBandRequest = Partial<Record<BandRole, CurveBandInput>>;
export type CurveBands = Partial<Record<BandRole, CurveBand>>;

/** Cuantiles marginales de excedencia para multiplicadores globales positivos (ADR 0082). */
export function curveBand({ values, multiplier }: CurveBandInput): CurveBand {
  const low = distQuantile(multiplier, 0.10);
  const high = distQuantile(multiplier, 0.90);
  const neutral = multiplier.min === 1 && multiplier.max === 1;
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  const p90 = new Float64Array(values.length);
  const p10 = new Float64Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const value = values[i]!;
    if (!Number.isFinite(value)) {
      p90[i] = p10[i] = NaN;
    } else if (neutral) {
      p90[i] = p10[i] = value;
    } else {
      // Para valores negativos los dos cuantiles caen en el límite inferior.
      p90[i] = clamp(value * low);
      p10[i] = clamp(value * high);
    }
  }
  return { p90, p10 };
}
