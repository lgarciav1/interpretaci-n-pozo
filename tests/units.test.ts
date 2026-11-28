import { describe, expect, it } from 'vitest';
import { convert, convertArray, parseUnit, registerUnit, sameDimension } from '../src/core/units';

describe('unidades', () => {
  it('convierte longitudes m/ft/in', () => {
    expect(convert(1, 'ft', 'm')).toBeCloseTo(0.3048, 12);
    expect(convert(1000, 'm', 'ft')).toBeCloseTo(3280.839895, 6);
    expect(convert(8.5, 'in', 'mm')).toBeCloseTo(215.9, 10);
  });

  it('convierte densidad g/cm³ ↔ kg/m³', () => {
    expect(convert(2.65, 'g/cm3', 'kg/m3')).toBeCloseTo(2650, 9);
    expect(convert(1000, 'kg/m3', 'g/cm3')).toBeCloseTo(1, 12);
  });

  it('convierte lentitud µs/ft ↔ µs/m', () => {
    expect(convert(100, 'us/ft', 'us/m')).toBeCloseTo(328.0839895, 6);
    expect(convert(328.0839895, 'us/m', 'us/ft')).toBeCloseTo(100, 6);
  });

  it('convierte fracción v/v ↔ %', () => {
    expect(convert(0.25, 'v/v', '%')).toBeCloseTo(25, 12);
    expect(convert(12, '%', 'v/v')).toBeCloseTo(0.12, 12);
  });

  it('convierte temperatura (afín) °C ↔ °F ↔ K', () => {
    expect(convert(100, 'degC', 'degF')).toBeCloseTo(212, 10);
    expect(convert(32, 'degF', 'degC')).toBeCloseTo(0, 10);
    expect(convert(-40, 'degF', 'degC')).toBeCloseTo(-40, 10);
    expect(convert(0, 'degC', 'K')).toBeCloseTo(273.15, 10);
    expect(convert(300, 'K', 'degF')).toBeCloseTo(80.33, 2);
  });

  it('resistividad ohm·m es identidad', () => {
    expect(convert(2.5, 'ohm.m', 'ohm.m')).toBe(2.5);
  });

  it('ida y vuelta mantiene el valor', () => {
    for (const [a, b] of [['m', 'ft'], ['g/cm3', 'kg/m3'], ['us/ft', 'us/m'], ['degC', 'degF'], ['v/v', '%']] as const) {
      expect(convert(convert(123.456, a, b), b, a)).toBeCloseTo(123.456, 9);
    }
  });

  it('rechaza dimensiones distintas con mensaje claro', () => {
    expect(() => convert(1, 'm', 'g/cm3')).toThrow(/No se puede convertir/);
    expect(() => convert(1, 'm', 'furlong')).toThrow(/Unidad desconocida/);
    expect(sameDimension('m', 'ft')).toBe(true);
    expect(sameDimension('m', 'v/v')).toBe(false);
  });

  it('convierte arrays preservando NaN', () => {
    const out = convertArray([1, NaN, 10], '%', 'v/v');
    expect(out[0]).toBeCloseTo(0.01);
    expect(Number.isNaN(out[1]!)).toBe(true);
    expect(out[2]).toBeCloseTo(0.1);
  });

  it('interpreta alias de archivos LAS/Excel', () => {
    expect(parseUnit('G/C3')).toBe('g/cm3');
    expect(parseUnit('us/f')).toBe('us/ft');
    expect(parseUnit('OHMM')).toBe('ohm.m');
    expect(parseUnit('gAPI')).toBe('gAPI');
    expect(parseUnit(' v/v ')).toBe('v/v');
    expect(parseUnit('xyz')).toBeNull();
  });

  it('permite registrar unidades nuevas sin tocar el núcleo', () => {
    registerUnit({ id: 'kft', label: 'kft', dimension: 'length', factor: 304.8 });
    expect(convert(1, 'kft', 'm')).toBeCloseTo(304.8);
    expect(() => registerUnit({ id: 'kft', label: 'kft', dimension: 'length', factor: 1 })).toThrow(/otra definición/);
  });
});

describe('alias con micro', () => {
  it('reconoce µs/ft con micro (U+00B5) y mu griega (U+03BC)', () => {
    expect(parseUnit('µs/ft')).toBe('us/ft');
    expect(parseUnit('μs/ft')).toBe('us/ft');
    expect(parseUnit('us/m')).toBe('us/m');
  });

  it('reconoce v/v_decimal y unidades encerradas entre corchetes', () => {
    expect(parseUnit('v/v_decimal')).toBe('v/v');
    expect(parseUnit('[M]')).toBe('m');
    expect(parseUnit('[K/M3]')).toBe('kg/m3');
    expect(parseUnit('[US/M]')).toBe('us/m');
    expect(parseUnit('[OHMM]')).toBe('ohm.m');
  });
});
