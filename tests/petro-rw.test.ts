import { describe, expect, it } from 'vitest';
import {
  apparentWaterResistivity,
  apparentWaterResistivityInto,
  equivalentMudFiltrateResistivity,
  equivalentWaterResistivityFromSp,
  pickettFit,
  pickettFitFixedM,
  spCoefficient,
  waterResistivityFromSp,
  waterResistivityFromSpInto,
} from '../src/petro/rw';

// Todos los valores esperados de este archivo se calcularon con un script Python independiente (python3 -I, sin
// importar el repo) o a mano; ninguno proviene de un ejemplo de libro: "verificado a mano, no de libro".

describe('petro/rw: Rwa = Rt·φ^m/a', () => {
  it('Rt 20, φ 0,15, a 1, m 2 → 0,45 Ω·m (20·0,0225)', () => {
    // verificado a mano, no de libro
    expect(apparentWaterResistivity(20, 0.15, 1, 2)).toBeCloseTo(0.45, 12);
  });

  it('Rt 10, φ 0,2, a 0,81, m 2 → 0,4938271604938 (Python)', () => {
    // verificado a mano, no de libro
    expect(apparentWaterResistivity(10, 0.2, 0.81, 2)).toBeCloseTo(0.4938271604938272, 12);
  });

  it('Rt 25, φ 0,18, a 0,62, m 2,15 → 1,01014613187652 (Python)', () => {
    // verificado a mano, no de libro
    expect(apparentWaterResistivity(25, 0.18, 0.62, 2.15)).toBeCloseTo(1.0101461318765217, 12);
  });

  it('en zona 100 % agua con Rt = a·Rw/φ^m devuelve Rw (propiedad)', () => {
    const rw = 0.07;
    for (const phi of [0.08, 0.15, 0.25]) {
      const rt = (0.81 * rw) / Math.pow(phi, 1.8);
      expect(apparentWaterResistivity(rt, phi, 0.81, 1.8)).toBeCloseTo(rw, 12);
    }
  });

  it('NaN y parámetros degenerados → NaN', () => {
    expect(apparentWaterResistivity(NaN, 0.15, 1, 2)).toBeNaN();
    expect(apparentWaterResistivity(20, NaN, 1, 2)).toBeNaN();
    expect(apparentWaterResistivity(0, 0.15, 1, 2)).toBeNaN();
    expect(apparentWaterResistivity(-5, 0.15, 1, 2)).toBeNaN();
    expect(apparentWaterResistivity(20, 0, 1, 2)).toBeNaN();
    expect(apparentWaterResistivity(20, 0.15, 0, 2)).toBeNaN();
    expect(apparentWaterResistivity(20, 0.15, 1, 0)).toBeNaN();
    expect(apparentWaterResistivity(20, 0.15, 1, NaN)).toBeNaN();
    expect(apparentWaterResistivity(Infinity, 0.15, 1, 2)).toBeNaN();
  });

  it('Into: escribe solo [start, end), deja el resto intacto y admite out == entrada', () => {
    const rt = Float64Array.from([20, 10, NaN, 5, 40]);
    const phi = Float64Array.from([0.15, 0.2, 0.2, 0.1, 0.25]);
    const out = new Float64Array(5).fill(-7);
    apparentWaterResistivityInto(rt, phi, out, 1, 2, 1, 4);
    expect(out[0]).toBe(-7);
    expect(out[1]).toBeCloseTo(0.4, 12); // 10·0,04
    expect(out[2]).toBeNaN();
    expect(out[3]).toBeCloseTo(0.05, 12); // 5·0,01
    expect(out[4]).toBe(-7);
    // in-place sobre rt
    apparentWaterResistivityInto(rt, phi, rt, 1, 2);
    expect(rt[0]).toBeCloseTo(0.45, 12);
    expect(rt[4]).toBeCloseTo(2.5, 12); // 40·0,0625
  });
});

describe('petro/rw: SP', () => {
  it('K = 60 + 0,133·T: 150 °F → 79,95; 200 °F → 86,6; 100 °F → 73,3', () => {
    // verificado a mano, no de libro
    expect(spCoefficient(150)).toBeCloseTo(79.95, 12);
    expect(spCoefficient(200)).toBeCloseTo(86.6, 12);
    expect(spCoefficient(100)).toBeCloseTo(73.3, 12);
  });

  it('Rwe: SSP −80 mV, Rmfe 0,5, 150 °F → 0,0499280510316 (0,5·10^(−80/79,95))', () => {
    // verificado a mano, no de libro
    expect(equivalentWaterResistivityFromSp(-80, 0.5, 150)).toBeCloseTo(0.04992805103160838, 12);
  });

  it('Rwe: SSP −60, Rmfe 0,3, 200 °F → 0,060852805885; SSP −40, Rmfe 1, 100 °F → 0,284640963', () => {
    // verificado a mano, no de libro
    expect(equivalentWaterResistivityFromSp(-60, 0.3, 200)).toBeCloseTo(0.06085280588393509, 12);
    expect(equivalentWaterResistivityFromSp(-40, 1, 100)).toBeCloseTo(0.28464096815227713, 12);
  });

  it('SSP = 0 → Rwe = Rmfe; SSP positivo → Rwe > Rmfe (0,889459856 con +20 mV)', () => {
    expect(equivalentWaterResistivityFromSp(0, 0.5, 150)).toBe(0.5);
    expect(equivalentWaterResistivityFromSp(20, 0.5, 150)).toBeCloseTo(0.8894598564259935, 12);
  });

  it('consistencia con la definición SSP = −K·log10(Rmfe/Rwe) (ida y vuelta)', () => {
    const k = spCoefficient(180);
    const rwe = equivalentWaterResistivityFromSp(-70, 0.4, 180);
    expect(-k * Math.log10(0.4 / rwe)).toBeCloseTo(-70, 10);
  });

  it('Rw ≈ Rwe (aproximación documentada) y la variante Into', () => {
    expect(waterResistivityFromSp(-80, 0.5, 150)).toBe(equivalentWaterResistivityFromSp(-80, 0.5, 150));
    const ssp = Float64Array.from([-80, NaN, -60, 0]);
    const out = new Float64Array(4).fill(-1);
    waterResistivityFromSpInto(ssp, out, 0.5, 150, 0, 3);
    expect(out[0]).toBeCloseTo(0.04992805103160838, 12);
    expect(out[1]).toBeNaN();
    expect(out[2]).toBeCloseTo(0.08881799420440813, 10);
    expect(out[3]).toBe(-1);
  });

  it('degenerados → NaN: Rmfe ≤ 0, SSP NaN, T que anula K', () => {
    expect(equivalentWaterResistivityFromSp(-80, 0, 150)).toBeNaN();
    expect(equivalentWaterResistivityFromSp(-80, -1, 150)).toBeNaN();
    expect(equivalentWaterResistivityFromSp(NaN, 0.5, 150)).toBeNaN();
    expect(equivalentWaterResistivityFromSp(-80, 0.5, NaN)).toBeNaN();
    expect(equivalentWaterResistivityFromSp(-80, 0.5, -500)).toBeNaN(); // K ≤ 0
    expect(spCoefficient(-451.2)).toBeNaN();
  });
});

describe('petro/rw: Pickett (ajuste log–log)', () => {
  // Puntos sintéticos exactos m = 2, a = 1, Rw = 0,05: Rt = 0,05/φ². Valores de Python.
  const phiA = [0.1, 0.15, 0.2, 0.25, 0.3];
  const rtA = [5.0, 2.2222222222222223, 1.25, 0.8, 0.5555555555555556];

  it('recupera m = 2 y Rw = 0,05 exactos (a = 1), R² = 1', () => {
    const f = pickettFit(rtA, phiA, 1);
    expect(f.m).toBeCloseTo(2, 10);
    expect(f.rw).toBeCloseTo(0.05, 12);
    expect(f.r2).toBeCloseTo(1, 12);
    expect(f.count).toBe(5);
  });

  it('recupera m = 1,8 y Rw = 0,07 con a = 0,81 (Rt = a·Rw/φ^m, valores de Python)', () => {
    const phi = [0.08, 0.12, 0.18, 0.22, 0.28];
    const rt = [5.345903098157982, 2.576658222893623, 1.2419169363344718, 0.8654106459363401, 0.5606587474921366];
    const f = pickettFit(rt, phi, 0.81);
    expect(f.m).toBeCloseTo(1.8, 10);
    expect(f.rw).toBeCloseTo(0.07, 12);
    expect(f.r2).toBeCloseTo(1, 12);
  });

  it('descarta puntos basura (NaN, Rt ≤ 0, φ ≤ 0, Infinity) y el resultado no cambia', () => {
    const rt = [NaN, 5.0, 2.2222222222222223, -3, 1.25, 0.8, 0, 0.5555555555555556, 7, Infinity];
    const phi = [0.2, 0.1, 0.15, 0.2, 0.2, 0.25, 0.2, 0.3, 0, 0.2];
    const f = pickettFit(rt, phi, 1);
    expect(f.count).toBe(5);
    expect(f.m).toBeCloseTo(2, 10);
    expect(f.rw).toBeCloseTo(0.05, 12);
    // φ = NaN también se descarta
    const g = pickettFit([...rtA, 3], [...phiA, NaN], 1);
    expect(g.count).toBe(5);
    expect(g.rw).toBeCloseTo(0.05, 12);
  });

  it('datos con ruido: m 2,162867, Rw 0,0386028 (a = 1), R² 0,992798 (Python, mínimos cuadrados)', () => {
    // verificado a mano, no de libro
    const phi = [0.1, 0.15, 0.2, 0.25, 0.3];
    const rt = [5.8, 2.1, 1.4, 0.75, 0.52];
    const f = pickettFit(rt, phi, 1);
    expect(f.m).toBeCloseTo(2.16286706165242, 10);
    expect(f.rw).toBeCloseTo(0.0386028287764914, 10);
    expect(f.r2).toBeCloseTo(0.992798289121799, 10);
    // con a = 0,81 Rw escala 1/a
    expect(pickettFit(rt, phi, 0.81).rw).toBeCloseTo(0.0386028287764914 / 0.81, 10);
  });

  it('tramo [start, end): usa solo ese rango', () => {
    const rt = [99, 99, ...rtA, 99];
    const phi = [0.5, 0.5, ...phiA, 0.5];
    const f = pickettFit(rt, phi, 1, 2, 7);
    expect(f.count).toBe(5);
    expect(f.m).toBeCloseTo(2, 10);
    expect(f.rw).toBeCloseTo(0.05, 12);
  });

  it('< 2 puntos válidos → NaN; sin dispersión en φ → NaN; a ≤ 0 → NaN', () => {
    expect(pickettFit([], [], 1).rw).toBeNaN();
    expect(pickettFit([5], [0.1], 1).m).toBeNaN();
    expect(pickettFit([5, NaN, -1], [0.1, 0.2, 0.3], 1).rw).toBeNaN(); // un solo punto válido
    const same = pickettFit([5, 2, 1], [0.15, 0.15, 0.15], 1);
    expect(same.m).toBeNaN();
    expect(same.rw).toBeNaN();
    expect(same.r2).toBeNaN();
    expect(pickettFit(rtA, phiA, 0).rw).toBeNaN();
    expect(pickettFit(rtA, phiA, NaN).rw).toBeNaN();
  });

  it('Rt constante con φ variable: m = 0 y R² = NaN (sin dispersión en log Rt)', () => {
    const f = pickettFit([2, 2, 2], [0.1, 0.2, 0.3], 1);
    expect(f.m).toBeCloseTo(0, 12);
    expect(f.rw).toBeCloseTo(2, 12);
    expect(f.r2).toBeNaN();
  });
});

describe('petro/rw: Pickett con m fijo', () => {
  const phiA = [0.1, 0.15, 0.2, 0.25, 0.3];
  const rtA = [5.0, 2.2222222222222223, 1.25, 0.8, 0.5555555555555556];

  it('con datos exactos y m correcto recupera Rw = 0,05 y R² = 1', () => {
    const f = pickettFitFixedM(rtA, phiA, 1, 2);
    expect(f.rw).toBeCloseTo(0.05, 12);
    expect(f.m).toBe(2);
    expect(f.r2).toBeCloseTo(1, 12);
  });

  it('datos con ruido y m = 2: Rw 0,0507506 (a = 1), R² 0,987169 (Python)', () => {
    // verificado a mano, no de libro
    const rt = [5.8, 2.1, 1.4, 0.75, 0.52];
    const f = pickettFitFixedM(rt, phiA, 1, 2);
    expect(f.rw).toBeCloseTo(0.050750578074476325, 10);
    expect(f.r2).toBeCloseTo(0.9871688141996058, 10);
    expect(pickettFitFixedM(rt, phiA, 0.81, 2).rw).toBeCloseTo(0.062655034, 8); // 10^b/0,81
  });

  it('con m erróneo el R² cae por debajo del ajuste libre', () => {
    const rt = [5.8, 2.1, 1.4, 0.75, 0.52];
    expect(pickettFitFixedM(rt, phiA, 1, 3).r2).toBeLessThan(pickettFit(rt, phiA, 1).r2);
  });

  it('un solo punto válido da Rw (b = y + m·x) pero R² = NaN; basura descartada', () => {
    const f = pickettFitFixedM([NaN, 5.0, -1], [0.1, 0.1, 0.2], 1, 2);
    expect(f.count).toBe(1);
    expect(f.rw).toBeCloseTo(0.05, 12);
    expect(f.r2).toBeNaN();
    const g = pickettFitFixedM([...rtA, NaN, 4], [...phiA, 0.2, 0], 1, 2);
    expect(g.count).toBe(5);
    expect(g.rw).toBeCloseTo(0.05, 12);
  });

  it('sin puntos válidos, a ≤ 0 o m ≤ 0 → NaN', () => {
    expect(pickettFitFixedM([], [], 1, 2).rw).toBeNaN();
    expect(pickettFitFixedM([NaN], [0.1], 1, 2).rw).toBeNaN();
    expect(pickettFitFixedM(rtA, phiA, 0, 2).rw).toBeNaN();
    expect(pickettFitFixedM(rtA, phiA, 1, 0).rw).toBeNaN();
    expect(pickettFitFixedM(rtA, phiA, 1, NaN).rw).toBeNaN();
  });

  it('tramo [start, end)', () => {
    const f = pickettFitFixedM([99, ...rtA, 99], [0.4, ...phiA, 0.4], 1, 2, 1, 6);
    expect(f.count).toBe(5);
    expect(f.rw).toBeCloseTo(0.05, 12);
  });
});

describe('petro/rw: valores no finitos en el SP', () => {
  it('SSP = ±Infinity → NaN (no Rwe = 0 ni Infinity)', () => {
    expect(equivalentWaterResistivityFromSp(Infinity, 0.5, 150)).toBeNaN();
    expect(equivalentWaterResistivityFromSp(-Infinity, 0.5, 150)).toBeNaN();
  });
});

describe('petro/rw: Rmfe (Asquith y Krygowski 2004, cap. SP)', () => {
  // Rmf(Tf) por Arps: 0,5 Ω·m a 75 °F → a 150 °F: 0,5·(75 + 6,77)/(150 + 6,77) = 0,2607960706767876 (Python)
  it('Rmf(75 °F) = 0,5 > 0,1: Rmfe = 0,85·Rmf(Tf) = 0,85·0,260796 = 0,221677 (verificado a mano)', () => {
    expect(equivalentMudFiltrateResistivity(0.2607960706767876, 0.5)).toBeCloseTo(0.22167666007526945, 12);
  });

  it('el umbral es estricto: Rmf(75 °F) = 0,1 usa Rmfe ≈ Rmf(Tf); 0,1000001 aplica 0,85', () => {
    expect(equivalentMudFiltrateResistivity(0.05, 0.1)).toBe(0.05);
    expect(equivalentMudFiltrateResistivity(0.05, 0.1000001)).toBeCloseTo(0.0425, 12);
  });

  it('Rmf(75 °F) bajo (0,04, lodo salado): aproximación Rmfe ≈ Rmf(Tf)', () => {
    expect(equivalentMudFiltrateResistivity(0.02, 0.04)).toBe(0.02);
  });

  it('Rmf ≤ 0, NaN o no finita → NaN', () => {
    expect(equivalentMudFiltrateResistivity(0, 0.5)).toBeNaN();
    expect(equivalentMudFiltrateResistivity(-1, 0.5)).toBeNaN();
    expect(equivalentMudFiltrateResistivity(NaN, 0.5)).toBeNaN();
    expect(equivalentMudFiltrateResistivity(0.2, NaN)).toBeNaN();
    expect(equivalentMudFiltrateResistivity(Infinity, 0.5)).toBeNaN();
  });

  it('cadena SP a mano: Rmfe = 0,221677, T = 150 °F (K = 79,95), SSP = −80 mV → Rw = 0,0221358 Ω·m', () => {
    // K = 60 + 0,133·150 = 79,95; Rwe = 0,221677·10^(−80/79,95) = 0,0221358 (Python)
    const rmfe = equivalentMudFiltrateResistivity(0.2607960706767876, 0.5);
    expect(waterResistivityFromSp(-80, rmfe, 150)).toBeCloseTo(0.022135767193509112, 12);
  });
});
