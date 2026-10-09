import { describe, expect, it } from 'vitest';
import {
  TIMUR_COATES_C_DEFAULT,
  timurCoatesPermeability,
  timurCoatesPermeabilityInto,
  timurPermeability,
  timurPermeabilityInto,
} from '../src/petro/permeability';

// Valores esperados calculados con Python independiente (python3 -I, sin importar el repo). Ninguno proviene de un
// ejemplo de libro: "verificado a mano, no de libro".

describe('petro/permeabilidad: Timur', () => {
  it('φ 0,2, Swirr 0,25 → 114,486680448 mD ((100·0,2^2,25/0,25)²)', () => {
    // verificado a mano, no de libro
    expect(timurPermeability(0.2, 0.25)).toBeCloseTo(114.48668044798926, 8);
  });

  it('φ 0,15, Swirr 0,3 → 21,7855313 mD; φ 0,1, Swirr 0,5 → 1,26491106 mD', () => {
    // verificado a mano, no de libro
    expect(timurPermeability(0.15, 0.3)).toBeCloseTo(21.785531322416716, 8);
    expect(timurPermeability(0.1, 0.5)).toBeCloseTo(1.2649110640673522, 8);
  });

  it('φ 0,25, Swirr 0,2 → 488,28125 mD (0,25^2,25 = 2^−4,5, valor exacto)', () => {
    // verificado a mano, no de libro
    expect(timurPermeability(0.25, 0.2)).toBeCloseTo(488.28125, 8);
  });

  it('cercana a la forma original de Timur (0,136·φ%^4,4/Swirr%²): 114,5 vs 115,4 mD, dif. < 2 %', () => {
    const original = 115.39603106770912; // Python: 0,136·(20)^4,4/(25)²
    expect(Math.abs(timurPermeability(0.2, 0.25) - original) / original).toBeLessThan(0.02);
  });

  it('k crece con φ y decrece con Swirr', () => {
    let prev = 0;
    for (const phi of [0.05, 0.1, 0.15, 0.2, 0.3]) {
      const k = timurPermeability(phi, 0.3);
      expect(k).toBeGreaterThan(prev);
      prev = k;
    }
    expect(timurPermeability(0.2, 0.2)).toBeGreaterThan(timurPermeability(0.2, 0.4));
    // Swirr × 2 → k ÷ 4 (k ∝ 1/Swirr²)
    expect(timurPermeability(0.2, 0.2) / timurPermeability(0.2, 0.4)).toBeCloseTo(4, 12);
  });

  it('k ≥ 0 siempre; no se recorta por arriba', () => {
    expect(timurPermeability(0.3, 0.05)).toBeGreaterThan(1e4);
    expect(timurPermeability(1e-6, 0.3)).toBeGreaterThanOrEqual(0);
  });

  it('NaN y degenerados → NaN (φ ≤ 0, Swirr ≤ 0)', () => {
    expect(timurPermeability(NaN, 0.25)).toBeNaN();
    expect(timurPermeability(0.2, NaN)).toBeNaN();
    expect(timurPermeability(0, 0.25)).toBeNaN();
    expect(timurPermeability(-0.1, 0.25)).toBeNaN();
    expect(timurPermeability(0.2, 0)).toBeNaN();
    expect(timurPermeability(0.2, -0.25)).toBeNaN();
    expect(timurPermeability(0.2, Infinity)).toBeNaN();
  });

  it('Into: solo [start, end), el resto intacto; out == entrada', () => {
    const phi = Float64Array.from([0.2, 0.15, NaN, 0.1, 0.25]);
    const out = new Float64Array(5).fill(-9);
    timurPermeabilityInto(phi, out, 0.3, 1, 4);
    expect(out[0]).toBe(-9);
    expect(out[1]).toBeCloseTo(21.785531322416716, 8);
    expect(out[2]).toBeNaN();
    expect(out[3]).toBeCloseTo(timurPermeability(0.1, 0.3), 12);
    expect(out[4]).toBe(-9);
    timurPermeabilityInto(phi, phi, 0.5);
    expect(phi[3]).toBeCloseTo(1.2649110640673522, 8);
  });
});

describe('petro/permeabilidad: Timur–Coates', () => {
  it('constante por defecto C = 10', () => {
    expect(TIMUR_COATES_C_DEFAULT).toBe(10);
  });

  it('φ 0,20, BVI 0,05 (FFI 0,15), C 10 → 144 mD ((20/10)^4·(0,15/0,05)² = 16·9)', () => {
    // verificado a mano, no de libro
    expect(timurCoatesPermeability(0.2, 0.05)).toBeCloseTo(144, 9);
    expect(timurCoatesPermeability(0.2, 0.05, 10)).toBeCloseTo(144, 9);
  });

  it('φ 0,15, BVI 0,09, C 10 → 2,25 mD ((1,5)^4·(0,06/0,09)²)', () => {
    // verificado a mano, no de libro
    expect(timurCoatesPermeability(0.15, 0.09)).toBeCloseTo(2.25, 9);
  });

  it('C calibrable: φ 0,25, BVI 0,05, C 8 → 1525,87890625 mD; k ∝ 1/C^4', () => {
    // verificado a mano, no de libro
    expect(timurCoatesPermeability(0.25, 0.05, 8)).toBeCloseTo(1525.87890625, 6);
    expect(timurCoatesPermeability(0.2, 0.05, 5) / timurCoatesPermeability(0.2, 0.05, 10)).toBeCloseTo(16, 9);
  });

  it('BVI ≥ φ (FFI ≤ 0) → k = 0, nunca negativo', () => {
    expect(timurCoatesPermeability(0.2, 0.2)).toBe(0);
    expect(timurCoatesPermeability(0.2, 0.25)).toBe(0);
  });

  it('k crece con φ (BVI fijo) y decrece al subir BVI (φ fijo)', () => {
    let prev = 0;
    for (const phi of [0.1, 0.15, 0.2, 0.25, 0.3]) {
      const k = timurCoatesPermeability(phi, 0.05);
      expect(k).toBeGreaterThan(prev);
      prev = k;
    }
    let prevB = Infinity;
    for (const bvi of [0.02, 0.04, 0.08, 0.12]) {
      const k = timurCoatesPermeability(0.2, bvi);
      expect(k).toBeLessThan(prevB);
      prevB = k;
    }
  });

  it('NaN y degenerados → NaN: φ ≤ 0, BVI ≤ 0 (BVI = 0 daría k infinito), C ≤ 0', () => {
    expect(timurCoatesPermeability(NaN, 0.05)).toBeNaN();
    expect(timurCoatesPermeability(0.2, NaN)).toBeNaN();
    expect(timurCoatesPermeability(0.2, 0.05, NaN)).toBeNaN();
    expect(timurCoatesPermeability(0, 0.05)).toBeNaN();
    expect(timurCoatesPermeability(-0.2, 0.05)).toBeNaN();
    expect(timurCoatesPermeability(0.2, 0)).toBeNaN();
    expect(timurCoatesPermeability(0.2, -0.05)).toBeNaN();
    expect(timurCoatesPermeability(0.2, 0.05, 0)).toBeNaN();
    expect(timurCoatesPermeability(0.2, 0.05, -10)).toBeNaN();
    expect(timurCoatesPermeability(0.2, Infinity)).toBeNaN();
  });

  it('Into: solo [start, end), el resto intacto; out == entrada; C por defecto y explícito', () => {
    const phi = Float64Array.from([0.2, 0.15, NaN, 0.25, 0.3]);
    const bvi = Float64Array.from([0.05, 0.09, 0.05, 0.05, 0.05]);
    const out = new Float64Array(5).fill(-9);
    timurCoatesPermeabilityInto(phi, bvi, out, 10, 0, 4);
    expect(out[0]).toBeCloseTo(144, 9);
    expect(out[1]).toBeCloseTo(2.25, 9);
    expect(out[2]).toBeNaN();
    expect(out[3]).toBeCloseTo(timurCoatesPermeability(0.25, 0.05), 9);
    expect(out[4]).toBe(-9);
    const out2 = new Float64Array(5).fill(-9);
    timurCoatesPermeabilityInto(phi, bvi, out2); // C por defecto = 10
    expect(out2[0]).toBeCloseTo(144, 9);
    timurCoatesPermeabilityInto(phi, bvi, phi, 8, 3, 4);
    expect(phi[3]).toBeCloseTo(1525.87890625, 6);
    expect(phi[0]).toBe(0.2);
  });
});
