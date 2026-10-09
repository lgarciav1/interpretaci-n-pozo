/** Editor de escalas y colores (fase 4b): validación en español, alcances y armado de overrides. */
import { describe, expect, it } from 'vitest';
import { defaultScope, patchOverride, scopeOptions, shadowedFields, validateScale, validateWidth } from '../../src/viewer/curveEdit';

describe('validación de la escala', () => {
  it('acepta escalas válidas', () => {
    expect(validateScale({ scale: 'linear', min: 0, max: 150 })).toBeNull();
    expect(validateScale({ scale: 'linear', min: -15, max: 45 })).toBeNull();
    expect(validateScale({ scale: 'log', min: 0.2, max: 2000 })).toBeNull();
  });

  it('log exige mínimo y máximo > 0', () => {
    expect(validateScale({ scale: 'log', min: 0, max: 2000 })).toEqual({ min: 'En escala logarítmica el mínimo tiene que ser mayor que 0.' });
    expect(validateScale({ scale: 'log', min: -1, max: -0.5 })?.max).toContain('mayor que 0');
  });

  it('mínimo ≠ máximo y en orden (la inversión es aparte)', () => {
    expect(validateScale({ scale: 'linear', min: 5, max: 5 })).toEqual({ max: 'El mínimo y el máximo no pueden ser iguales.' });
    expect(validateScale({ scale: 'log', min: 10, max: 10 })?.max).toBe('El mínimo y el máximo no pueden ser iguales.');
    expect(validateScale({ scale: 'linear', min: 150, max: 0 })?.max).toContain('Invertir');
  });

  it('rechaza valores no numéricos', () => {
    expect(validateScale({ scale: 'linear', min: NaN, max: 1 })).toEqual({ min: 'Escribí un número.' });
    expect(validateScale({ scale: 'linear', min: 0, max: Infinity })).toEqual({ max: 'Escribí un número.' });
  });

  it('grosor entre 0,5 y 6 px', () => {
    expect(validateWidth(1.5)).toBeNull();
    expect(validateWidth(0.2)).toBe('El grosor va de 0,5 a 6 px.');
    expect(validateWidth(NaN)).toBe('Escribí un número.');
  });
});

describe('alcance del cambio', () => {
  it('medida con rol: las dos; por defecto esta curva', () => {
    const c = { origin: 'measured' as const, role: 'GR', name: 'GR', curveId: 'GR' };
    expect(scopeOptions(c).map((o) => [o.label, !!o.disabled])).toEqual([
      ['Esta curva', false],
      ['Todas las GR', false],
    ]);
    expect(defaultScope(c)).toBe('curve');
  });

  it('calculada: solo por rol; sin rol: solo esta curva', () => {
    expect(defaultScope({ origin: 'computed', role: 'VSH', name: 'VSH' })).toBe('role');
    expect(scopeOptions({ origin: 'computed', role: 'VSH', name: 'VSH' })[0]!.disabled).toBeTruthy();
    const noRole = scopeOptions({ origin: 'measured', role: null, name: 'AT10', curveId: 'AT10' });
    expect(noRole[1]!.disabled).toBe('La curva no tiene rol asignado.');
    expect(defaultScope({ origin: 'measured', role: null, name: 'AT10', curveId: 'AT10' })).toBe('curve');
  });

  it('arma el override sobre el actual; undefined quita campos; vacío = null', () => {
    expect(patchOverride({ color: '#ff0000' }, { min: 0, max: 200 })).toEqual({ color: '#ff0000', min: 0, max: 200 });
    expect(patchOverride({ color: '#ff0000' }, { color: undefined })).toBeNull();
    expect(patchOverride(undefined, { scale: 'log' })).toEqual({ scale: 'log' });
    expect(shadowedFields({ color: '#ff0000', min: undefined })).toEqual(['color']);
  });
});
