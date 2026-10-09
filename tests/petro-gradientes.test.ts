import { describe, expect, it } from 'vitest';
import {
  G_STANDARD,
  compactionConstant,
  densityToPressureGradient,
  gradientKindOf,
  gradientReadings,
  pressureGradientToDensity,
} from '../src/petro/gradients';
import { fitTrend } from '../src/petro/regression';

const byUnit = (slope: number, unit: string) =>
  Object.fromEntries(gradientReadings(slope, unit).map((r) => [r.unit, r.value]));

describe('petro/gradients: densidad ↔ gradiente de presión', () => {
  it('g estándar = 9,80665 m/s² (CGPM 1901)', () => {
    expect(G_STANDARD).toBe(9.80665);
  });

  it('1 g/cm³ = 9,80665 kPa/m; ida y vuelta', () => {
    expect(densityToPressureGradient(1)).toBe(9.80665);
    expect(pressureGradientToDensity(9.80665)).toBe(1);
    for (const rho of [0.2, 0.78, 1.0, 1.03, 1.18]) {
      expect(pressureGradientToDensity(densityToPressureGradient(rho))).toBeCloseTo(rho, 12);
    }
  });

  it('agua dulce: 1 g/cm³ ≈ 9,81 kPa/m (Asquith y Krygowski 2004: 9,8 kPa/m)', () => {
    expect(densityToPressureGradient(1)).toBeCloseTo(9.81, 2);
  });

  it('NaN se propaga', () => {
    expect(pressureGradientToDensity(NaN)).toBeNaN();
    expect(densityToPressureGradient(NaN)).toBeNaN();
  });
});

describe('petro/gradients: lecturas de presión', () => {
  it('1 g/cm³ ↔ 9,80665 kPa/m ↔ 0,4335 psi/ft ↔ 0,0981 bar/m (Dake 1978, manuales de presiones de formación)', () => {
    const r = byUnit(9.80665, 'kPa');
    expect(r['psi/ft']).toBeCloseTo(0.4335, 4);
    expect(r['bar/m']).toBeCloseTo(0.0981, 4);
    expect(r['kPa/m']).toBeCloseTo(9.80665, 12);
    expect(r['g/cm³ (equiv.)']).toBeCloseTo(1, 12);
  });

  it('la primera lectura (primaria) es psi/ft y es la única primaria', () => {
    const lec = gradientReadings(9.80665, 'kPa');
    expect(lec[0]).toMatchObject({ unit: 'psi/ft', primary: true });
    expect(lec.filter((l) => l.primary)).toHaveLength(1);
  });

  it('agua de mar 1,03 g/cm³ → 10,10 kPa/m ≈ 0,4465 psi/ft (≈0,446)', () => {
    const r = byUnit(densityToPressureGradient(1.03), 'kPa');
    expect(r['psi/ft']).toBeCloseTo(0.4465, 4);
    expect(r['g/cm³ (equiv.)']).toBeCloseTo(1.03, 12);
  });

  it('agua dulce en psi/ft: 0,433 psi/ft (valor clásico) ↔ 0,99878 g/cm³', () => {
    // 0,433 psi/ft · 6,894757 kPa/psi / 0,3048 m/ft = 9,79468 kPa/m
    const r = byUnit(0.433 * 6.894757293168361 / 0.3048, 'kPa');
    expect(r['kPa/m']).toBeCloseTo(9.7947, 3);
    expect(r['g/cm³ (equiv.)']).toBeCloseTo(0.99878, 4);
  });

  it('entrada en otras unidades de presión da lo mismo: 1 psi/m, 0,1 bar/m, 100 kPa/m', () => {
    const a = byUnit(1, 'psi');
    expect(a['kPa/m']).toBeCloseTo(6.894757293, 8);
    expect(a['psi/ft']).toBeCloseTo(0.3048, 12);
    const b = byUnit(0.1, 'bar');
    expect(b['kPa/m']).toBeCloseTo(10, 12);
    const c = byUnit(0.01, 'MPa');
    expect(c['kPa/m']).toBeCloseTo(10, 12);
  });

  it('pendiente NaN → lecturas NaN', () => {
    for (const l of gradientReadings(NaN, 'kPa')) expect(l.value).toBeNaN();
  });
});

describe('petro/gradients: lecturas de temperatura (sin offset)', () => {
  it('3 °C/100 m = 1,646 °F/100 ft (3·1,8·0,3048; sin los 32 °F)', () => {
    const r = byUnit(0.03, 'degC');
    expect(r['°C/100 m']).toBeCloseTo(3, 12);
    expect(r['°F/100 ft']).toBeCloseTo(1.64592, 5);
  });

  it('entrada en °F por metro: 0,054 °F/m = 3 °C/100 m; K se trata como °C', () => {
    const f = byUnit(0.054, 'degF');
    expect(f['°C/100 m']).toBeCloseTo(3, 10);
    const k = byUnit(0.03, 'K');
    expect(k['°C/100 m']).toBeCloseTo(3, 12);
  });

  it('gradiente geotérmico de 0,015 °F/ft → 2,74 °C/100 m (≈ 0,027 °C/m)', () => {
    // 0,015 °F/ft = 0,015/1,8/0,3048 °C/m = 0,027340 °C/m
    const slopePerM = 0.015 / 0.3048; // °F por m
    const r = byUnit(slopePerM, 'degF');
    expect(r['°C/100 m']).toBeCloseTo(2.734, 3);
    expect(r['°F/100 ft']).toBeCloseTo(1.5, 10);
  });

  it('primaria: °C/100 m', () => {
    expect(gradientReadings(0.03, 'degC')[0]).toMatchObject({ unit: '°C/100 m', primary: true });
  });
});

describe('petro/gradients: lecturas de lentitud (compactación)', () => {
  it('0,02 µs/ft por m = 6,096 µs/ft por 1000 ft', () => {
    const r = byUnit(0.02, 'us/ft');
    expect(r['µs/ft por m']).toBeCloseTo(0.02, 12);
    expect(r['µs/ft por 1000 ft']).toBeCloseTo(6.096, 10);
  });

  it('entrada en µs/m: 1 µs/m por m = 0,3048 µs/ft por m', () => {
    expect(byUnit(1, 'us/m')['µs/ft por m']).toBeCloseTo(0.3048, 12);
  });
});

describe('petro/gradients: clase y otras dimensiones', () => {
  it('gradientKindOf por dimensión de la unidad', () => {
    expect(gradientKindOf('psi')).toBe('pressure');
    expect(gradientKindOf('kPa')).toBe('pressure');
    expect(gradientKindOf('degC')).toBe('temperature');
    expect(gradientKindOf('degF')).toBe('temperature');
    expect(gradientKindOf('us/ft')).toBe('slowness');
    expect(gradientKindOf('g/cm3')).toBe('density');
    expect(gradientKindOf('ohm.m')).toBe('resistivity');
    expect(gradientKindOf('gAPI')).toBe('generic');
    expect(gradientKindOf('v/v')).toBe('generic');
    expect(gradientKindOf('unidad-inventada')).toBe('generic');
  });

  it('otras dimensiones: unidad/m, sin conversión', () => {
    expect(gradientReadings(0.0001, 'g/cm3')).toEqual([{ value: 0.0001, unit: 'g/cm³/m', primary: true }]);
    expect(gradientReadings(0.5, 'gAPI')).toEqual([{ value: 0.5, unit: 'gAPI/m', primary: true }]);
    expect(gradientReadings(2, 'unidad-inventada')).toEqual([{ value: 2, unit: 'unidad-inventada/m', primary: true }]);
  });
});

describe('petro/gradients: constante de compactación', () => {
  it('exp: b = −0,0004 1/m → longitud de escala 2500 m', () => {
    const c = compactionConstant({ model: 'exp', a: 180, b: -0.0004 })!;
    expect(c.perM).toBe(-0.0004);
    expect(c.scaleLengthM).toBeCloseTo(2500, 9);
  });

  it('no exponencial o b = 0 → null', () => {
    expect(compactionConstant({ model: 'linear', a: 1, b: 2 })).toBeNull();
    expect(compactionConstant({ model: 'exp', a: 1, b: 0 })).toBeNull();
  });
});

describe('petro/gradients: integración con el ajuste de tendencias', () => {
  it('presión MDT sintética con densidad 1,03 g/cm³ ajustada en kPa vs z (m) → 0,4465 psi/ft', () => {
    const z: number[] = [];
    const p: number[] = [];
    for (let i = 0; i < 15; i++) {
      z.push(2000 + i * 7);
      p.push(101.325 + densityToPressureGradient(1.03) * z[i]!);
    }
    const f = fitTrend(z, p, 'linear')!;
    const psiFt = gradientReadings(f.b, 'kPa').find((r) => r.primary)!;
    expect(psiFt.value).toBeCloseTo(0.4465, 4);
  });

  it('temperatura sintética T = 15 + 0,027·z (°C, m) → 2,7 °C/100 m', () => {
    const z = [1000, 1500, 2000, 2500, 3000];
    const t = z.map((v) => 15 + 0.027 * v);
    const f = fitTrend(z, t, 'linear')!;
    expect(gradientReadings(f.b, 'degC')[0]!.value).toBeCloseTo(2.7, 10);
  });
});
