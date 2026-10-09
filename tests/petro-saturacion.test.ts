import { describe, expect, it } from 'vitest';
import {
  archieSw,
  archieSwInto,
  bulkVolumeWater,
  bulkVolumeWaterInto,
  hydrocarbonSaturation,
  hydrocarbonSaturationInto,
  indonesiaSw,
  indonesiaSwInto,
  simandouxSw,
  simandouxSwInto,
} from '../src/petro/saturation';

// Los valores esperados se calcularon con un script Python independiente (python3 -I, sin importar el repo). Para
// Simandoux e Indonesia se resolvieron las ecuaciones por bisección sobre el residual (no con la forma cerrada).
// Ningún valor proviene de un ejemplo de libro: "verificado a mano, no de libro".

describe('petro/saturacion: Archie', () => {
  it('Rt 20, φ 0,15, Rw 0,05, a 1, m 2, n 2 → 1/3 (√(0,05/(0,0225·20)))', () => {
    // verificado a mano, no de libro
    expect(archieSw(20, 0.15, 0.05, 1, 2, 2)).toBeCloseTo(1 / 3, 12);
  });

  it('Rt 15, φ 0,2, Rw 0,04, a 0,81, m 2, n 2 → 0,232379000772', () => {
    // verificado a mano, no de libro
    expect(archieSw(15, 0.2, 0.04, 0.81, 2, 2)).toBeCloseTo(0.232379000772445, 12);
  });

  it('Rt 12, φ 0,18, Rw 0,06, a 0,62, m 2,15, n 2 → 0,351773325119', () => {
    // verificado a mano, no de libro
    expect(archieSw(12, 0.18, 0.06, 0.62, 2.15, 2)).toBeCloseTo(0.3517733251191804, 12);
  });

  it('n ≠ 2: Rt 30, φ 0,12, Rw 0,08, a 1, m 2, n 2,5 → 0,509380711939', () => {
    // verificado a mano, no de libro
    expect(archieSw(30, 0.12, 0.08, 1, 2, 2.5)).toBeCloseTo(0.5093807119385996, 12);
  });

  it('propiedad: Rt = a·Rw/φ^m → Sw = 1 (zona 100 % agua)', () => {
    for (const [phi, rw, a, m, n] of [
      [0.18, 0.06, 0.62, 2.15, 2],
      [0.25, 0.03, 1, 2, 2.5],
      [0.1, 0.1, 0.81, 2, 1.8],
    ] as const) {
      const rt = (a * rw) / Math.pow(phi, m);
      expect(archieSw(rt, phi, rw, a, m, n)).toBeCloseTo(1, 12);
    }
    // valor de Python: 0,62·0,06/0,18^2,15 = 1,48493366718486
    expect(archieSw(1.4849336671848554, 0.18, 0.06, 0.62, 2.15, 2)).toBeCloseTo(1, 12);
  });

  it('propiedad: Sw decrece estrictamente al subir Rt (5, 10, 20, 40 → 0,6667; 0,4714; 0,3333; 0,2357)', () => {
    const esperado = [0.6666666666666667, 0.47140452079103173, 0.33333333333333337, 0.23570226039551587];
    let prev = Infinity;
    [5, 10, 20, 40].forEach((rt, i) => {
      const sw = archieSw(rt, 0.15, 0.05, 1, 2, 2);
      expect(sw).toBeCloseTo(esperado[i]!, 12);
      expect(sw).toBeLessThan(prev);
      prev = sw;
    });
  });

  it('recorta a [0, 1]: Rt demasiado bajo → 1 (√5 sin recorte); Rt muy alto → 0 solo en el límite', () => {
    expect(archieSw(2, 0.1, 0.1, 1, 2, 2)).toBe(1);
    expect(archieSw(1e12, 0.2, 0.05, 1, 2, 2)).toBeGreaterThanOrEqual(0);
    expect(archieSw(1e12, 0.2, 0.05, 1, 2, 2)).toBeLessThan(1e-5);
  });

  it('NaN y parámetros degenerados → NaN', () => {
    expect(archieSw(NaN, 0.15, 0.05, 1, 2, 2)).toBeNaN();
    expect(archieSw(20, NaN, 0.05, 1, 2, 2)).toBeNaN();
    expect(archieSw(20, 0.15, NaN, 1, 2, 2)).toBeNaN();
    expect(archieSw(0, 0.15, 0.05, 1, 2, 2)).toBeNaN();
    expect(archieSw(-3, 0.15, 0.05, 1, 2, 2)).toBeNaN();
    expect(archieSw(20, 0, 0.05, 1, 2, 2)).toBeNaN();
    expect(archieSw(20, -0.1, 0.05, 1, 2, 2)).toBeNaN();
    expect(archieSw(20, 0.15, 0, 1, 2, 2)).toBeNaN();
    expect(archieSw(20, 0.15, -0.05, 1, 2, 2)).toBeNaN();
    expect(archieSw(20, 0.15, 0.05, 0, 2, 2)).toBeNaN();
    expect(archieSw(20, 0.15, 0.05, 1, 0, 2)).toBeNaN();
    expect(archieSw(20, 0.15, 0.05, 1, 2, 0)).toBeNaN();
    expect(archieSw(20, 0.15, 0.05, 1, 2, -2)).toBeNaN();
    expect(archieSw(Infinity, 0.15, 0.05, 1, 2, 2)).toBeNaN();
  });

  it('Into: solo [start, end), el resto intacto; out == entrada', () => {
    const rt = Float64Array.from([5, 10, 20, NaN, 40]);
    const phi = Float64Array.from([0.15, 0.15, 0.15, 0.15, 0.15]);
    const out = new Float64Array(5).fill(-9);
    archieSwInto(rt, phi, out, 0.05, 1, 2, 2, 1, 4);
    expect(out[0]).toBe(-9);
    expect(out[1]).toBeCloseTo(0.47140452079103173, 12);
    expect(out[2]).toBeCloseTo(1 / 3, 12);
    expect(out[3]).toBeNaN();
    expect(out[4]).toBe(-9);
    archieSwInto(rt, phi, rt, 0.05, 1, 2, 2);
    expect(rt[0]).toBeCloseTo(0.6666666666666667, 12);
    expect(rt[4]).toBeCloseTo(0.23570226039551587, 12);
  });
});

describe('petro/saturacion: Simandoux (n = 2)', () => {
  it('Rt 10, φ 0,2, Vsh 0,3, Rw 0,05, Rsh 4, a 0,81, m 2 → 0,282486591626', () => {
    // verificado a mano, no de libro (bisección en Python)
    expect(simandouxSw(10, 0.2, 0.3, 0.05, 4, 0.81, 2)).toBeCloseTo(0.28248659162588474, 11);
  });

  it('mismos datos con a = 1 → 0,309772256574', () => {
    // verificado a mano, no de libro
    expect(simandouxSw(10, 0.2, 0.3, 0.05, 4, 1, 2)).toBeCloseTo(0.30977225657854146, 11);
  });

  it('Rt 5, φ 0,18, Vsh 0,25, Rw 0,08, Rsh 3, a 1, m 2 → 0,607338737507', () => {
    // verificado a mano, no de libro
    expect(simandouxSw(5, 0.18, 0.25, 0.08, 3, 1, 2)).toBeCloseTo(0.6073387375071073, 11);
  });

  it('m ≠ 2: Rt 20, φ 0,15, Vsh 0,4, Rw 0,06, Rsh 5, a 0,62, m 2,15 → 0,255034517285', () => {
    // verificado a mano, no de libro
    expect(simandouxSw(20, 0.15, 0.4, 0.06, 5, 0.62, 2.15)).toBeCloseTo(0.2550345172852787, 11);
  });

  it('Vsh = 1: Rt 3, φ 0,2, Rw 0,05, Rsh 2, a 1, m 2 → 0,404663103252', () => {
    // verificado a mano, no de libro
    expect(simandouxSw(3, 0.2, 1, 0.05, 2, 1, 2)).toBeCloseTo(0.4046631032524377, 11);
  });

  it('a = 0,81 reproduce la forma 0,4/5 de A&K con diferencia < 1 % (0,28094348 vs 0,28248659)', () => {
    // forma de libro evaluada en Python: 0,4·Rw/φ²·(√((Vsh/Rsh)² + 5φ²/(Rw·Rt)) − Vsh/Rsh)
    const ak = 0.28094348007142494;
    const sw = simandouxSw(10, 0.2, 0.3, 0.05, 4, 0.81, 2);
    expect(Math.abs(sw - ak) / ak).toBeLessThan(0.01);
  });

  it('Vsh = 0 coincide con Archie n = 2 (con Rsh cualquiera, incluso NaN)', () => {
    expect(simandouxSw(20, 0.15, 0, 0.05, 4, 1, 2)).toBeCloseTo(archieSw(20, 0.15, 0.05, 1, 2, 2), 12);
    expect(simandouxSw(20, 0.15, 0, 0.05, NaN, 1, 2)).toBeCloseTo(1 / 3, 12);
    expect(simandouxSw(12, 0.18, 0, 0.06, 4, 0.62, 2.15)).toBeCloseTo(0.3517733251191804, 12);
    expect(simandouxSw(15, 0.2, -0.1, 0.04, 4, 0.81, 2)).toBeCloseTo(0.232379000772445, 12); // Vsh < 0 se recorta a 0
  });

  it('Vsh se recorta a [0, 1]: 1,5 equivale a 1', () => {
    expect(simandouxSw(3, 0.2, 1.5, 0.05, 2, 1, 2)).toBe(simandouxSw(3, 0.2, 1, 0.05, 2, 1, 2));
  });

  it('Sw decrece al subir Rt', () => {
    let prev = Infinity;
    for (const rt of [3, 5, 10, 20, 50, 200]) {
      const sw = simandouxSw(rt, 0.2, 0.3, 0.05, 4, 1, 2);
      expect(sw).toBeLessThan(prev);
      prev = sw;
    }
  });

  it('recorta a 1 con Rt muy bajo (Rt 0,5, φ 0,05, Vsh 0,1, Rw 0,1, Rsh 4)', () => {
    expect(simandouxSw(0.5, 0.05, 0.1, 0.1, 4, 1, 2)).toBe(1);
  });

  it('estable con arcilla muy conductiva (Rsh pequeña) y Rt alto: no da NaN ni negativo', () => {
    const sw = simandouxSw(1e6, 0.1, 0.9, 0.05, 0.5, 1, 2);
    expect(sw).toBeGreaterThan(0);
    expect(sw).toBeLessThan(1e-5);
  });

  it('NaN y degenerados → NaN (Rsh ≤ 0 solo cuando Vsh > 0)', () => {
    expect(simandouxSw(NaN, 0.2, 0.3, 0.05, 4, 1, 2)).toBeNaN();
    expect(simandouxSw(10, NaN, 0.3, 0.05, 4, 1, 2)).toBeNaN();
    expect(simandouxSw(10, 0.2, NaN, 0.05, 4, 1, 2)).toBeNaN();
    expect(simandouxSw(10, 0.2, 0.3, NaN, 4, 1, 2)).toBeNaN();
    expect(simandouxSw(0, 0.2, 0.3, 0.05, 4, 1, 2)).toBeNaN();
    expect(simandouxSw(10, 0, 0.3, 0.05, 4, 1, 2)).toBeNaN();
    expect(simandouxSw(10, 0.2, 0.3, 0, 4, 1, 2)).toBeNaN();
    expect(simandouxSw(10, 0.2, 0.3, 0.05, 0, 1, 2)).toBeNaN();
    expect(simandouxSw(10, 0.2, 0.3, 0.05, -4, 1, 2)).toBeNaN();
    expect(simandouxSw(10, 0.2, 0.3, 0.05, NaN, 1, 2)).toBeNaN();
    expect(simandouxSw(10, 0.2, 0.3, 0.05, 4, 0, 2)).toBeNaN();
    expect(simandouxSw(10, 0.2, 0.3, 0.05, 4, 1, 0)).toBeNaN();
    expect(simandouxSw(Infinity, 0.2, 0, 0.05, 4, 1, 2)).toBeNaN();
  });

  it('Into: solo [start, end), el resto intacto; out == entrada', () => {
    const rt = Float64Array.from([10, 5, 10, NaN, 99]);
    const phi = Float64Array.from([0.2, 0.18, 0.2, 0.2, 0.2]);
    const vsh = Float64Array.from([0.3, 0.25, 0, 0.3, 0.3]);
    const out = new Float64Array(5).fill(-9);
    simandouxSwInto(rt, phi, vsh, out, 0.05, 4, 1, 2, 1, 4);
    expect(out[0]).toBe(-9);
    expect(out[1]).toBeCloseTo(simandouxSw(5, 0.18, 0.25, 0.05, 4, 1, 2), 12);
    expect(out[2]).toBeCloseTo(Math.sqrt(0.05 / (0.04 * 10)), 12); // Vsh = 0 → Archie
    expect(out[3]).toBeNaN();
    expect(out[4]).toBe(-9);
    simandouxSwInto(rt, phi, vsh, rt, 0.05, 4, 1, 2);
    expect(rt[0]).toBeCloseTo(0.30977225657854146, 11);
  });
});

describe('petro/saturacion: Indonesia (Poupon–Leveaux)', () => {
  it('Rt 10, φ 0,2, Vsh 0,3, Rw 0,05, Rsh 4, a 1, m 2, n 2 → 0,294407231096', () => {
    // verificado a mano, no de libro (bisección en Python)
    expect(indonesiaSw(10, 0.2, 0.3, 0.05, 4, 1, 2, 2)).toBeCloseTo(0.29440723109608247, 11);
  });

  it('Rt 5, φ 0,18, Vsh 0,25, Rw 0,08, Rsh 3, a 1, m 2, n 2 → 0,553452469060', () => {
    // verificado a mano, no de libro
    expect(indonesiaSw(5, 0.18, 0.25, 0.08, 3, 1, 2, 2)).toBeCloseTo(0.5534524690598337, 11);
  });

  it('Rt 20, φ 0,15, Vsh 0,4, Rw 0,06, Rsh 5, a 0,62, m 2,15, n 2 → 0,251403738352', () => {
    // verificado a mano, no de libro
    expect(indonesiaSw(20, 0.15, 0.4, 0.06, 5, 0.62, 2.15, 2)).toBeCloseTo(0.25140373835132046, 11);
  });

  it('n ≠ 2: Rt 10, φ 0,2, Vsh 0,3, Rw 0,05, Rsh 4, a 1, m 2, n 2,3 → 0,345315492454', () => {
    // verificado a mano, no de libro
    expect(indonesiaSw(10, 0.2, 0.3, 0.05, 4, 1, 2, 2.3)).toBeCloseTo(0.3453154924548538, 11);
  });

  it('Vsh = 1: Rt 3, φ 0,2, Rw 0,05, Rsh 2, a 1, m 2, n 2 → 0,360498296768', () => {
    // verificado a mano, no de libro
    expect(indonesiaSw(3, 0.2, 1, 0.05, 2, 1, 2, 2)).toBeCloseTo(0.36049829676819756, 11);
  });

  it('Vsh = 0 coincide con Archie con el mismo n (n = 2 y n = 2,5), con Rsh cualquiera', () => {
    expect(indonesiaSw(20, 0.15, 0, 0.05, 4, 1, 2, 2)).toBeCloseTo(1 / 3, 12);
    expect(indonesiaSw(30, 0.12, 0, 0.08, 4, 1, 2, 2.5)).toBeCloseTo(0.5093807119385996, 12);
    expect(indonesiaSw(30, 0.12, 0, 0.08, NaN, 1, 2, 2.5)).toBeCloseTo(0.5093807119385996, 12);
    expect(indonesiaSw(12, 0.18, 0, 0.06, 4, 0.62, 2.15, 2)).toBeCloseTo(0.3517733251191804, 12);
  });

  it('Vsh se recorta a [0, 1]', () => {
    expect(indonesiaSw(3, 0.2, 1.5, 0.05, 2, 1, 2, 2)).toBe(indonesiaSw(3, 0.2, 1, 0.05, 2, 1, 2, 2));
    expect(indonesiaSw(20, 0.15, -0.2, 0.05, 4, 1, 2, 2)).toBeCloseTo(1 / 3, 12);
  });

  it('Sw decrece al subir Rt', () => {
    let prev = Infinity;
    for (const rt of [3, 5, 10, 20, 50, 200]) {
      const sw = indonesiaSw(rt, 0.2, 0.3, 0.05, 4, 1, 2, 2);
      expect(sw).toBeLessThan(prev);
      prev = sw;
    }
  });

  it('recorta a 1 con Rt muy bajo', () => {
    expect(indonesiaSw(0.5, 0.05, 0.1, 0.1, 4, 1, 2, 2)).toBe(1);
  });

  it('NaN y degenerados → NaN (incluye n ≤ 0 y Rsh ≤ 0 con Vsh > 0)', () => {
    expect(indonesiaSw(NaN, 0.2, 0.3, 0.05, 4, 1, 2, 2)).toBeNaN();
    expect(indonesiaSw(10, NaN, 0.3, 0.05, 4, 1, 2, 2)).toBeNaN();
    expect(indonesiaSw(10, 0.2, NaN, 0.05, 4, 1, 2, 2)).toBeNaN();
    expect(indonesiaSw(10, 0.2, 0.3, NaN, 4, 1, 2, 2)).toBeNaN();
    expect(indonesiaSw(0, 0.2, 0.3, 0.05, 4, 1, 2, 2)).toBeNaN();
    expect(indonesiaSw(10, 0, 0.3, 0.05, 4, 1, 2, 2)).toBeNaN();
    expect(indonesiaSw(10, 0.2, 0.3, 0, 4, 1, 2, 2)).toBeNaN();
    expect(indonesiaSw(10, 0.2, 0.3, 0.05, 0, 1, 2, 2)).toBeNaN();
    expect(indonesiaSw(10, 0.2, 0.3, 0.05, -4, 1, 2, 2)).toBeNaN();
    expect(indonesiaSw(10, 0.2, 0.3, 0.05, 4, 0, 2, 2)).toBeNaN();
    expect(indonesiaSw(10, 0.2, 0.3, 0.05, 4, 1, 0, 2)).toBeNaN();
    expect(indonesiaSw(10, 0.2, 0.3, 0.05, 4, 1, 2, 0)).toBeNaN();
    expect(indonesiaSw(10, 0.2, 0.3, 0.05, 4, 1, 2, -2)).toBeNaN();
    expect(indonesiaSw(10, 0.2, 0.3, 0.05, 4, 1, 2, NaN)).toBeNaN();
  });

  it('Into: solo [start, end), el resto intacto; out == entrada', () => {
    const rt = Float64Array.from([10, 5, 10, NaN, 99]);
    const phi = Float64Array.from([0.2, 0.18, 0.2, 0.2, 0.2]);
    const vsh = Float64Array.from([0.3, 0.25, 0, 0.3, 0.3]);
    const out = new Float64Array(5).fill(-9);
    indonesiaSwInto(rt, phi, vsh, out, 0.05, 4, 1, 2, 2, 1, 4);
    expect(out[0]).toBe(-9);
    expect(out[1]).toBeCloseTo(indonesiaSw(5, 0.18, 0.25, 0.05, 4, 1, 2, 2), 12);
    expect(out[2]).toBeCloseTo(Math.sqrt(0.05 / (0.04 * 10)), 12);
    expect(out[3]).toBeNaN();
    expect(out[4]).toBe(-9);
    indonesiaSwInto(rt, phi, vsh, rt, 0.05, 4, 1, 2, 2);
    expect(rt[0]).toBeCloseTo(0.29440723109608247, 11);
  });
});

describe('petro/saturacion: arcilla frente a Archie (propiedad numérica)', () => {
  // Con Vsh > 0 la arcilla conduce: para el mismo Rt hace falta MENOS agua. Por lo tanto
  // Sw(Simandoux) ≤ Sw(Archie, n = 2) y Sw(Indonesia, n = 2) ≤ Sw(Archie, n = 2) (NO ≥).
  // La grilla se verificó también en Python (1008 combinaciones, 0 violaciones).
  it('Sw(Simandoux) ≤ Sw(Archie) y Sw(Indonesia) ≤ Sw(Archie) en una grilla de parámetros', () => {
    let casos = 0;
    let estrictos = 0;
    for (const rt of [0.5, 1, 2, 5, 10, 50, 200]) {
      for (const phi of [0.05, 0.1, 0.2, 0.3]) {
        for (const vsh of [0.05, 0.2, 0.5, 0.9]) {
          for (const rsh of [1, 3, 10]) {
            for (const [rw, a, m] of [
              [0.05, 1, 2],
              [0.1, 0.62, 2.15],
              [0.03, 0.81, 2],
            ] as const) {
              const ar = archieSw(rt, phi, rw, a, m, 2);
              const sim = simandouxSw(rt, phi, vsh, rw, rsh, a, m);
              const ind = indonesiaSw(rt, phi, vsh, rw, rsh, a, m, 2);
              expect(sim).toBeLessThanOrEqual(ar + 1e-12);
              expect(ind).toBeLessThanOrEqual(ar + 1e-12);
              casos++;
              if (ar < 1 && sim < ar && ind < ar) estrictos++;
            }
          }
        }
      }
    }
    expect(casos).toBe(1008);
    expect(estrictos).toBeGreaterThan(500); // en los casos sin recorte la desigualdad es estricta
  });

  it('valor puntual: Archie 0,35355 > Simandoux 0,30977 > Indonesia 0,29441 (Rt 10, φ 0,2, Vsh 0,3, Rsh 4)', () => {
    expect(archieSw(10, 0.2, 0.05, 1, 2, 2)).toBeCloseTo(0.35355339059327373, 12);
    expect(simandouxSw(10, 0.2, 0.3, 0.05, 4, 1, 2)).toBeCloseTo(0.30977225657854146, 11);
    expect(indonesiaSw(10, 0.2, 0.3, 0.05, 4, 1, 2, 2)).toBeCloseTo(0.29440723109608247, 11);
  });

  it('más arcilla (misma Rsh) → menos Sw', () => {
    let prevS = Infinity;
    let prevI = Infinity;
    for (const vsh of [0, 0.1, 0.3, 0.6]) {
      const s = simandouxSw(10, 0.2, vsh, 0.05, 4, 1, 2);
      const i = indonesiaSw(10, 0.2, vsh, 0.05, 4, 1, 2, 2);
      expect(s).toBeLessThan(prevS);
      expect(i).toBeLessThan(prevI);
      prevS = s;
      prevI = i;
    }
  });
});

describe('petro/saturacion: BVW y Sh', () => {
  it('BVW = φ·Sw: 0,2·0,35 = 0,07; 0,15·1 = 0,15; 0,1·0 = 0', () => {
    expect(bulkVolumeWater(0.2, 0.35)).toBeCloseTo(0.07, 12);
    expect(bulkVolumeWater(0.15, 1)).toBeCloseTo(0.15, 12);
    expect(bulkVolumeWater(0.1, 0)).toBe(0);
  });

  it('recortes: φ > 0,5 → 0,5; φ < 0 → 0; Sw > 1 → 1; Sw < 0 → 0', () => {
    expect(bulkVolumeWater(0.6, 0.4)).toBeCloseTo(0.2, 12);
    expect(bulkVolumeWater(-0.1, 0.4)).toBe(0);
    expect(bulkVolumeWater(0.2, 1.3)).toBeCloseTo(0.2, 12);
    expect(bulkVolumeWater(0.2, -0.3)).toBe(0);
  });

  it('NaN en cualquier entrada → NaN', () => {
    expect(bulkVolumeWater(NaN, 0.5)).toBeNaN();
    expect(bulkVolumeWater(0.2, NaN)).toBeNaN();
  });

  it('Sh = 1 − Sw con recorte y NaN', () => {
    expect(hydrocarbonSaturation(0.35)).toBeCloseTo(0.65, 12);
    expect(hydrocarbonSaturation(1)).toBe(0);
    expect(hydrocarbonSaturation(1.2)).toBe(0);
    expect(hydrocarbonSaturation(-0.2)).toBe(1);
    expect(hydrocarbonSaturation(NaN)).toBeNaN();
  });

  it('Into: solo [start, end), el resto intacto; out == entrada', () => {
    const phi = Float64Array.from([0.2, 0.15, NaN, 0.1, 0.25]);
    const sw = Float64Array.from([0.35, 1, 0.5, 0.4, 0.2]);
    const out = new Float64Array(5).fill(-9);
    bulkVolumeWaterInto(phi, sw, out, 1, 4);
    expect(out[0]).toBe(-9);
    expect(out[1]).toBeCloseTo(0.15, 12);
    expect(out[2]).toBeNaN();
    expect(out[3]).toBeCloseTo(0.04, 12);
    expect(out[4]).toBe(-9);
    bulkVolumeWaterInto(phi, sw, sw);
    expect(sw[0]).toBeCloseTo(0.07, 12);
    expect(sw[4]).toBeCloseTo(0.05, 12);

    const s = Float64Array.from([0.3, 0.8, NaN, 1]);
    const h = new Float64Array(4).fill(-9);
    hydrocarbonSaturationInto(s, h, 1, 3);
    expect(h[0]).toBe(-9);
    expect(h[1]).toBeCloseTo(0.2, 12);
    expect(h[2]).toBeNaN();
    expect(h[3]).toBe(-9);
    hydrocarbonSaturationInto(s, s);
    expect(s[0]).toBeCloseTo(0.7, 12);
  });
});

describe('petro/saturation: Vsh, φ y Sw no finitos', () => {
  it('Vsh = ±Infinity → NaN en Simandoux e Indonesia (no se recorta a 0 o 1)', () => {
    expect(simandouxSw(10, 0.2, Infinity, 0.05, 4, 1, 2)).toBeNaN();
    expect(simandouxSw(10, 0.2, -Infinity, 0.05, 4, 1, 2)).toBeNaN();
    expect(indonesiaSw(10, 0.2, Infinity, 0.05, 4, 1, 2, 2)).toBeNaN();
    expect(indonesiaSw(10, 0.2, -Infinity, 0.05, 4, 1, 2, 2)).toBeNaN();
  });

  it('BVW y Sh con entradas ±Infinity → NaN', () => {
    expect(bulkVolumeWater(Infinity, 0.5)).toBeNaN();
    expect(bulkVolumeWater(0.2, Infinity)).toBeNaN();
    expect(hydrocarbonSaturation(Infinity)).toBeNaN();
    expect(hydrocarbonSaturation(-Infinity)).toBeNaN();
  });
});
