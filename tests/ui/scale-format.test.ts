import { describe, expect, it } from 'vitest';
import { decimalsForStep, formatNumber, formatParamValue, parseDecimal } from '../../src/ui/format';
import { positionToValue, roundSignificant, snapToStep, stepValue, valueToPosition } from '../../src/ui/scale';

describe('escala de sliders', () => {
  const lin = { min: 0, max: 150, step: 0.5 };
  const log = { min: 0.01, max: 100, scale: 'log' as const };

  it('lineal: posición ↔ valor, redondeado al paso desde el mínimo', () => {
    expect(valueToPosition(75, lin)).toBe(0.5);
    expect(positionToValue(0.5, lin)).toBe(75);
    expect(positionToValue(0.3337, lin)).toBe(50); // 50.055 → 50
    expect(positionToValue(-1, lin)).toBe(0);
    expect(positionToValue(2, lin)).toBe(150);
    expect(positionToValue(0.1, { min: 20, max: 300, step: 0.5 })).toBe(48); // origen en min
  });

  it('log: cada década ocupa el mismo largo y el valor se redondea a 3 cifras', () => {
    expect(valueToPosition(0.01, log)).toBe(0);
    expect(valueToPosition(100, log)).toBe(1);
    expect(valueToPosition(1, log)).toBeCloseTo(0.5, 12);
    expect(valueToPosition(0.1, log)).toBeCloseTo(0.25, 12);
    expect(positionToValue(0.5, log)).toBe(1);
    expect(positionToValue(0.6, log)).toBe(2.51); // 10^0.4 = 2.5119
    for (const v of [0.0123, 0.05, 0.731, 4.56, 77.7]) expect(positionToValue(valueToPosition(v, log), log)).toBeCloseTo(v, 10);
  });

  it('log sin rango válido cae a lineal (min ≤ 0)', () => {
    expect(valueToPosition(5, { min: 0, max: 10, scale: 'log' })).toBe(0.5);
  });

  it('pasos de teclado: lineal ± paso (×10 con big), log proporcional, siempre dentro del rango', () => {
    expect(stepValue(30, 1, lin)).toBe(30.5);
    expect(stepValue(30, -1, lin, true)).toBe(25);
    expect(stepValue(149.8, 1, lin)).toBe(150);
    expect(stepValue(0.2, -1, { min: 0, max: 1 })).toBe(0.19); // sin paso: 1 % del rango
    const up = stepValue(1, 1, log);
    expect(up).toBeGreaterThan(1);
    expect(up).toBeLessThan(1.2);
    expect(stepValue(up, -1, log)).toBeCloseTo(1, 2);
    expect(stepValue(100, 1, log)).toBe(100);
    // nunca se queda trabado por el redondeo
    let v = 0.0123;
    for (let i = 0; i < 50; i++) {
      const next = stepValue(v, 1, log);
      expect(next).toBeGreaterThan(v);
      v = next;
    }
  });

  it('redondeos auxiliares', () => {
    expect(snapToStep(0.30000000000000004, 0.1)).toBe(0.3);
    expect(roundSignificant(0.0123456, 3)).toBe(0.0123);
    expect(roundSignificant(0, 3)).toBe(0);
  });
});

describe('formato y parseo de números (es-AR)', () => {
  it('formatea con coma decimal, miles con punto y — para no finitos', () => {
    expect(formatNumber(7633.2588)).toBe('7.633,26');
    expect(formatNumber(7633.2588, { grouping: false })).toBe('7633,26');
    expect(formatNumber(0.0123456, { significant: 3 })).toBe('0,0123');
    expect(formatNumber(NaN)).toBe('—');
    expect(formatNumber(null)).toBe('—');
  });

  it('decimales según el paso del parámetro', () => {
    expect(decimalsForStep(0.01)).toBe(2);
    expect(decimalsForStep(0.5)).toBe(1);
    expect(decimalsForStep(5)).toBe(0);
    expect(decimalsForStep(1e-7)).toBe(7);
    expect(decimalsForStep(undefined)).toBe(0);
    expect(formatParamValue(30, { step: 0.5 })).toBe('30,0');
    expect(formatParamValue(0.0523, { scale: 'log' })).toBe('0,0523');
  });

  it('parsea coma o punto, miles, exponentes y el signo menos tipográfico', () => {
    expect(parseDecimal('0,35')).toBe(0.35);
    expect(parseDecimal('0.35')).toBe(0.35);
    expect(parseDecimal(' -1,5e-3 ')).toBe(-0.0015);
    expect(parseDecimal('1.234,5')).toBe(1234.5);
    expect(parseDecimal('1,234.5')).toBe(1234.5);
    expect(parseDecimal('− 2')).toBe(-2);
    expect(parseDecimal(',5')).toBe(0.5);
    expect(parseDecimal('')).toBeNull();
    expect(parseDecimal('abc')).toBeNull();
    expect(parseDecimal('1,2,3')).toBeNull();
    expect(parseDecimal('1e')).toBeNull();
  });
});
