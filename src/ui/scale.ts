/**
 * Escalas de controles numéricos (slider lineal y log, pasos con teclado). Puro y testeado.
 *
 * El slider trabaja con una posición t ∈ [0, 1]:
 * - lineal: valor = min + t·(max − min), redondeado al paso (contado desde min);
 * - log:    valor = exp(ln min + t·(ln max − ln min)), redondeado a 3 cifras significativas (o al paso, si hay).
 */

export interface NumericScale {
  min: number;
  max: number;
  step?: number;
  scale?: 'linear' | 'log';
}

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Quita el ruido de punto flotante (0.1 + 0.2 → 0.3). */
export const cleanFloat = (v: number): number => +v.toPrecision(12);

export function roundSignificant(v: number, digits = 3): number {
  if (v === 0 || !Number.isFinite(v)) return v;
  return +v.toPrecision(digits);
}

export function snapToStep(v: number, step: number, origin = 0): number {
  if (!(step > 0)) return v;
  return cleanFloat(origin + Math.round((v - origin) / step) * step);
}

const isLog = (s: NumericScale) => s.scale === 'log' && s.min > 0 && s.max > s.min;

/** Valor → posición en [0, 1] (fuera de rango se recorta). */
export function valueToPosition(v: number, s: NumericScale): number {
  if (!Number.isFinite(v) || s.max === s.min) return 0;
  if (isLog(s)) {
    const [a, b] = [Math.log(s.min), Math.log(s.max)];
    return clamp((Math.log(clamp(v, s.min, s.max)) - a) / (b - a), 0, 1);
  }
  return clamp((v - s.min) / (s.max - s.min), 0, 1);
}

/** Posición en [0, 1] → valor redondeado según la escala. */
export function positionToValue(t: number, s: NumericScale): number {
  const u = clamp(t, 0, 1);
  if (isLog(s)) {
    const raw = Math.exp(Math.log(s.min) + u * (Math.log(s.max) - Math.log(s.min)));
    const v = s.step ? snapToStep(raw, s.step) : roundSignificant(raw, 3);
    return clamp(v, s.min, s.max);
  }
  const raw = s.min + u * (s.max - s.min);
  return clamp(s.step ? snapToStep(raw, s.step, s.min) : cleanFloat(raw), s.min, s.max);
}

/**
 * Un paso con teclado (flechas; `big` = Re Pág / Mayús+flecha).
 * Lineal: ± paso (por defecto 1 % del rango; big = ×10). Log: × factor de 1 % de la década-rango (big = 10 %).
 */
export function stepValue(v: number, direction: 1 | -1, s: NumericScale, big = false): number {
  if (isLog(s)) {
    const frac = big ? 0.1 : 0.01;
    const factor = Math.exp(frac * (Math.log(s.max) - Math.log(s.min)));
    const raw = direction > 0 ? v * factor : v / factor;
    let next = s.step ? snapToStep(raw, s.step) : roundSignificant(raw, 3);
    // Si el redondeo devuelve el mismo valor, forzar el avance mínimo representable.
    if (next === v) next = roundSignificant(v * (direction > 0 ? 1.01 : 1 / 1.01), 4);
    return clamp(next, s.min, s.max);
  }
  const step = s.step ?? (s.max - s.min) / 100;
  const raw = v + direction * step * (big ? 10 : 1);
  return clamp(s.step ? snapToStep(raw, s.step, s.min) : cleanFloat(raw), s.min, s.max);
}
