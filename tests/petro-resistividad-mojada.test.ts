/**
 * Resistividad mojada R0 = a·Rw/φ^m (F16): la resistividad de la roca con Sw = 1 (Archie). Los valores se calcularon a
 * mano (ninguno proviene de un ejemplo de libro con R0 impresa); la consistencia con la Sw de Archie se verifica
 * contra la función ya validada `archieSw`.
 */
import { describe, expect, it } from 'vitest';
import { archieSw, wetResistivity } from '../src/petro/saturation';

describe('petro/saturation: resistividad mojada R0', () => {
  it('φ 0,2, Rw 0,05, a 1, m 2 → R0 = 0,05/0,04 = 1,25 Ω·m (a mano)', () => {
    expect(wetResistivity(0.2, 0.05, 1, 2)).toBeCloseTo(1.25, 12);
  });

  it('φ 0,15, Rw 0,05, a 1, m 2 → 0,05/0,0225 = 2,2222…; con Rt 20 la Sw de Archie es 1/3 (mismo caso que el test de Archie)', () => {
    const r0 = wetResistivity(0.15, 0.05, 1, 2);
    expect(r0).toBeCloseTo(0.05 / 0.0225, 12);
    expect(archieSw(20, 0.15, 0.05, 1, 2, 2)).toBeCloseTo(Math.sqrt(r0 / 20), 12);
    expect(Math.sqrt(r0 / 20)).toBeCloseTo(1 / 3, 12);
  });

  it('a 0,81, m 2, φ 0,2, Rw 0,04 → 0,81 Ω·m (el factor 0,81 de arenisca multiplica a Rw/φ²)', () => {
    expect(wetResistivity(0.2, 0.04, 0.81, 2)).toBeCloseTo(0.81, 12);
  });

  it('m no entero: φ 0,25, Rw 0,1, a 0,62, m 2,15 → 0,62·0,1/0,25^2,15 (a mano)', () => {
    expect(wetResistivity(0.25, 0.1, 0.62, 2.15)).toBeCloseTo(0.062 / Math.pow(0.25, 2.15), 12);
    expect(wetResistivity(0.25, 0.1, 0.62, 2.15)).toBeCloseTo(1.2213, 4); // 0,062 / 0,050756 (cálculo independiente en Python)
  });

  it('con Sw = 1 por Archie, R0 = Rt: Rt = a·Rw/φ^m ⇒ archieSw = 1 y wetResistivity = Rt (cualquier n)', () => {
    for (const [phi, rw, a, m] of [
      [0.08, 0.03, 1, 2],
      [0.2, 0.05, 0.81, 2],
      [0.3, 0.012, 0.62, 2.15],
      [0.12, 0.4, 1, 1.85],
      [0.45, 1.5, 1.2, 3],
    ] as const) {
      const rt = (a * rw) / Math.pow(phi, m);
      expect(wetResistivity(phi, rw, a, m)).toBeCloseTo(rt, 9);
      for (const n of [1.5, 2, 2.5, 3]) expect(archieSw(rt, phi, rw, a, m, n)).toBeCloseTo(1, 12);
    }
  });

  it('en general (Rt ≥ R0): archieSw(Rt) = (R0/Rt)^(1/n)', () => {
    const phi = 0.18;
    const rw = 0.06;
    const a = 0.81;
    const m = 2.1;
    const r0 = wetResistivity(phi, rw, a, m);
    for (const k of [1, 1.7, 4, 25, 400]) {
      for (const n of [1.8, 2, 2.4]) {
        expect(archieSw(k * r0, phi, rw, a, m, n)).toBeCloseTo(Math.pow(1 / k, 1 / n), 12);
      }
    }
    // Rt < R0 (resistividad menor que la mojada): Sw de Archie recortada a 1; R0 no se recorta.
    expect(archieSw(0.5 * r0, phi, rw, a, m, 2)).toBe(1);
    expect(r0).toBeGreaterThan(0.5 * r0);
  });

  it('escalas: lineal en Rw y en a; ×2^m al partir φ a la mitad; decrece con φ', () => {
    const base = wetResistivity(0.2, 0.05, 1, 2);
    expect(wetResistivity(0.2, 0.1, 1, 2)).toBeCloseTo(2 * base, 12);
    expect(wetResistivity(0.2, 0.05, 0.81, 2)).toBeCloseTo(0.81 * base, 12);
    expect(wetResistivity(0.1, 0.05, 1, 2)).toBeCloseTo(4 * base, 12);
    expect(wetResistivity(0.1, 0.05, 1, 1.85)).toBeCloseTo(Math.pow(2, 1.85) * wetResistivity(0.2, 0.05, 1, 1.85), 12);
    let prev = Infinity;
    for (const phi of [0.02, 0.05, 0.1, 0.2, 0.3, 0.5]) {
      const r = wetResistivity(phi, 0.05, 1, 2);
      expect(r).toBeLessThan(prev);
      prev = r;
    }
  });

  it('no recorta: φ muy baja da una R0 enorme pero finita (la escala de la pista la acota)', () => {
    expect(wetResistivity(0.001, 0.05, 1, 2)).toBeCloseTo(50000, 6);
  });

  it('sin dato o parámetros degenerados → NaN', () => {
    expect(wetResistivity(NaN, 0.05, 1, 2)).toBeNaN();
    expect(wetResistivity(0.2, NaN, 1, 2)).toBeNaN();
    expect(wetResistivity(0.2, 0.05, NaN, 2)).toBeNaN();
    expect(wetResistivity(0.2, 0.05, 1, NaN)).toBeNaN();
    expect(wetResistivity(0, 0.05, 1, 2)).toBeNaN(); // φ = 0
    expect(wetResistivity(-0.1, 0.05, 1, 2)).toBeNaN();
    expect(wetResistivity(0.2, 0, 1, 2)).toBeNaN(); // Rw = 0
    expect(wetResistivity(0.2, -0.05, 1, 2)).toBeNaN();
    expect(wetResistivity(0.2, 0.05, 0, 2)).toBeNaN(); // a = 0
    expect(wetResistivity(0.2, 0.05, 1, 0)).toBeNaN(); // m = 0
    expect(wetResistivity(0.2, 0.05, -1, 2)).toBeNaN();
    expect(wetResistivity(Infinity, 0.05, 1, 2)).toBeNaN();
    expect(wetResistivity(0.2, Infinity, 1, 2)).toBeNaN();
    expect(wetResistivity(1e-200, 0.05, 1, 2)).toBeNaN(); // φ^m desborda a 0: R0 = Infinity → sin valor
  });
});
