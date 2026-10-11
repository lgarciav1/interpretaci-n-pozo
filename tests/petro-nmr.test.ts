import { describe, expect, it } from 'vitest';
import {
  NMR_DEFICIT_TOLERANCE_DEFAULT,
  boundFluidFraction,
  boundFluidFractionInto,
  clayBoundWater,
  clayBoundWaterInto,
  freeFluidVolume,
  freeFluidVolumeInto,
  nmrDeficitFlag,
  nmrDeficitFlagInto,
  nmrPorosityDifference,
  nmrPorosityDifferenceInto,
} from '../src/petro/nmr';

// Valores esperados: cuentas a mano (aritmética simple, escritas en cada caso) o filas reales del CSV del TP
// (datos/pozo_tp_perfiles.csv). No hay un ejemplo numérico de libro para estas diferencias: lo de libro es la
// PARTICIÓN PHIT_NMR = CBW + BVI + FFI y PHIE_NMR = BVI + FFI (Coates, Xiao y Prammer 1999), que se verifica como identidad.

describe('petro/nmr: fluido libre (FFI = PHIE_NMR − BVI)', () => {
  it('0,20 − 0,08 = 0,12; 0,25 − 0,10 = 0,15', () => {
    expect(freeFluidVolume(0.2, 0.08)).toBeCloseTo(0.12, 12);
    expect(freeFluidVolume(0.25, 0.1)).toBeCloseTo(0.15, 12);
  });

  it('BVI = 0 es válido: todo el fluido es libre', () => {
    expect(freeFluidVolume(0.18, 0)).toBe(0.18);
  });

  it('BVI = PHIE_NMR → 0; BVI > PHIE_NMR → 0 (nunca negativo)', () => {
    expect(freeFluidVolume(0.15, 0.15)).toBe(0);
    expect(freeFluidVolume(0.15, 0.18)).toBe(0);
  });

  it('porosidad 0 con BVI 0 → 0 (lutita sin porosidad efectiva)', () => {
    expect(freeFluidVolume(0, 0)).toBe(0);
  });

  it('NaN, negativos, > 1 e infinitos → NaN (misma política que permeability.ts)', () => {
    expect(freeFluidVolume(NaN, 0.1)).toBeNaN();
    expect(freeFluidVolume(0.2, NaN)).toBeNaN();
    expect(freeFluidVolume(-0.01, 0.1)).toBeNaN();
    expect(freeFluidVolume(0.2, -0.01)).toBeNaN();
    expect(freeFluidVolume(20, 8)).toBeNaN(); // porcentaje en lugar de v/v
    expect(freeFluidVolume(Infinity, 0.1)).toBeNaN();
  });

  it('no recorta en 0,5: la porosidad del CMR del TP llega a 0,48', () => {
    expect(freeFluidVolume(0.48, 0.1)).toBeCloseTo(0.38, 12);
  });

  it('fila real del TP (7633,2588 m): PHIE_CMR 0,04, PHI_BVI 0,013 → 0,027', () => {
    expect(freeFluidVolume(0.04, 0.013)).toBeCloseTo(0.027, 12);
  });
});

describe('petro/nmr: agua ligada a la arcilla (CBW = PHIT_NMR − PHIE_NMR)', () => {
  it('0,25 − 0,20 = 0,05', () => {
    expect(clayBoundWater(0.25, 0.2)).toBeCloseTo(0.05, 12);
  });

  it('fila real del TP (7633,2588 m): PHIT_CMR 0,197, PHIE_CMR 0,04 → 0,157 (lutita: casi todo es agua de arcilla)', () => {
    expect(clayBoundWater(0.197, 0.04)).toBeCloseTo(0.157, 12);
  });

  it('PHIT_NMR = PHIE_NMR → 0; PHIT_NMR < PHIE_NMR → 0 (ruido), nunca negativo', () => {
    expect(clayBoundWater(0.2, 0.2)).toBe(0);
    expect(clayBoundWater(0.18, 0.2)).toBe(0);
  });

  it('NaN y fuera de dominio → NaN', () => {
    expect(clayBoundWater(NaN, 0.2)).toBeNaN();
    expect(clayBoundWater(0.25, NaN)).toBeNaN();
    expect(clayBoundWater(-0.1, 0.2)).toBeNaN();
    expect(clayBoundWater(25, 20)).toBeNaN();
  });

  it('partición de libro: CBW + BVI + FFI = PHIT_NMR y BVI + FFI = PHIE_NMR (con BVI ≤ PHIE ≤ PHIT)', () => {
    const cases: [number, number, number][] = [
      [0.3, 0.24, 0.1],
      [0.21, 0.19, 0.19],
      [0.12, 0.05, 0],
      [0.23, 0.23, 0.07],
    ];
    for (const [phit, phie, bvi] of cases) {
      const ffi = freeFluidVolume(phie, bvi);
      const cbw = clayBoundWater(phit, phie);
      expect(cbw + bvi + ffi).toBeCloseTo(phit, 12);
      expect(bvi + ffi).toBeCloseTo(phie, 12);
    }
  });
});

describe('petro/nmr: fracción de fluido ligado (BVI / PHIE_NMR ≈ Swirr de RMN)', () => {
  it('0,08 / 0,20 = 0,4; 0,05 / 0,25 = 0,2; BVI = 0 → 0', () => {
    expect(boundFluidFraction(0.08, 0.2)).toBeCloseTo(0.4, 12);
    expect(boundFluidFraction(0.05, 0.25)).toBeCloseTo(0.2, 12);
    expect(boundFluidFraction(0, 0.2)).toBe(0);
  });

  it('BVI = PHIE_NMR → 1; BVI > PHIE_NMR → 1 (recortada, coherente con FFI = 0)', () => {
    expect(boundFluidFraction(0.15, 0.15)).toBe(1);
    expect(boundFluidFraction(0.18, 0.15)).toBe(1);
  });

  it('fila real del TP: 0,013 / 0,04 = 0,325', () => {
    expect(boundFluidFraction(0.013, 0.04)).toBeCloseTo(0.325, 12);
  });

  it('PHIE_NMR = 0 → NaN (0/0); NaN y fuera de dominio → NaN', () => {
    expect(boundFluidFraction(0, 0)).toBeNaN();
    expect(boundFluidFraction(0.01, 0)).toBeNaN();
    expect(boundFluidFraction(NaN, 0.2)).toBeNaN();
    expect(boundFluidFraction(0.1, NaN)).toBeNaN();
    expect(boundFluidFraction(-0.1, 0.2)).toBeNaN();
    expect(boundFluidFraction(0.1, -0.2)).toBeNaN();
    expect(boundFluidFraction(10, 20)).toBeNaN();
  });

  it('FFI + BVI = PHIE_NMR y Swirr = 1 − FFI / PHIE_NMR', () => {
    const phie = 0.22;
    const bvi = 0.09;
    expect(boundFluidFraction(bvi, phie)).toBeCloseTo(1 - freeFluidVolume(phie, bvi) / phie, 12);
  });
});

describe('petro/nmr: diferencia de porosidades (Δφ = PHIE_NMR − PHIE) e indicador de déficit', () => {
  it('signo: RMN − densidad–neutrón (0,18 − 0,22 = −0,04; 0,25 − 0,20 = +0,05)', () => {
    expect(nmrPorosityDifference(0.18, 0.22)).toBeCloseTo(-0.04, 12);
    expect(nmrPorosityDifference(0.25, 0.2)).toBeCloseTo(0.05, 12);
  });

  it('NaN y fuera de dominio → NaN', () => {
    expect(nmrPorosityDifference(NaN, 0.2)).toBeNaN();
    expect(nmrPorosityDifference(0.2, NaN)).toBeNaN();
    expect(nmrPorosityDifference(-0.01, 0.2)).toBeNaN();
    expect(nmrPorosityDifference(0.2, 20)).toBeNaN();
  });

  it('tolerancia por defecto: 0,03 v/v', () => {
    expect(NMR_DEFICIT_TOLERANCE_DEFAULT).toBe(0.03);
  });

  it('Δφ = −0,04 con tolerancia 0,03 → 1; Δφ = −0,02 → 0; Δφ positiva → 0', () => {
    expect(nmrDeficitFlag(-0.04, 0.03)).toBe(1);
    expect(nmrDeficitFlag(-0.02, 0.03)).toBe(0);
    expect(nmrDeficitFlag(0.05, 0.03)).toBe(0);
    expect(nmrDeficitFlag(0, 0.03)).toBe(0);
  });

  it('borde ESTRICTO: Δφ = −tolerancia no marca, ni siquiera con el redondeo binario (0,24 − 0,27)', () => {
    expect(nmrDeficitFlag(-0.03, 0.03)).toBe(0);
    const d = nmrPorosityDifference(0.24, 0.27);
    expect(d).toBeLessThan(-0.03); // −0,030000000000000027 en binario
    expect(nmrDeficitFlag(d, 0.03)).toBe(0);
    expect(nmrDeficitFlag(-0.0301, 0.03)).toBe(1);
  });

  it('tolerancia 0: cualquier déficit apreciable marca, el empate no', () => {
    expect(nmrDeficitFlag(-0.001, 0)).toBe(1);
    expect(nmrDeficitFlag(0, 0)).toBe(0);
  });

  it('sin dato o tolerancia inválida → NaN', () => {
    expect(nmrDeficitFlag(NaN, 0.03)).toBeNaN();
    expect(nmrDeficitFlag(-0.05, NaN)).toBeNaN();
    expect(nmrDeficitFlag(-0.05, -0.01)).toBeNaN();
    expect(nmrDeficitFlag(-0.05, Infinity)).toBeNaN();
  });

  it('caso de gas: RMN 0,16 contra densidad–neutrón 0,24 (Δφ = −0,08) marca; zona limpia 0,23 contra 0,22 no', () => {
    expect(nmrDeficitFlag(nmrPorosityDifference(0.16, 0.24), 0.03)).toBe(1);
    expect(nmrDeficitFlag(nmrPorosityDifference(0.23, 0.22), 0.03)).toBe(0);
  });
});

describe('petro/nmr: variantes Into por tramo', () => {
  const phit = [0.3, 0.25, 0.2, NaN, 0.1];
  const phie = [0.2, 0.2, 0.2, 0.2, 0.12];
  const bvi = [0.08, 0.05, 0.25, 0.1, 0];
  const phiDn = [0.25, 0.2, 0.21, 0.18, NaN];

  it('solo escriben en [start, end) y dejan el resto intacto', () => {
    const out = new Float64Array(5).fill(-9);
    freeFluidVolumeInto(phie, bvi, out, 1, 4);
    expect(Array.from(out)).toEqual([-9, 0.15000000000000002, 0, 0.1, -9]);
    const out2 = new Float64Array(5).fill(-9);
    clayBoundWaterInto(phit, phie, out2, 0, 3);
    expect(out2[0]).toBeCloseTo(0.1, 12);
    expect(out2[1]).toBeCloseTo(0.05, 12);
    expect(out2[2]).toBe(0);
    expect(out2[3]).toBe(-9);
  });

  it('recorren todo el arreglo por defecto y propagan NaN por muestra', () => {
    const sw = boundFluidFractionInto(bvi, phie, new Float64Array(5));
    expect(Array.from(sw).map((v) => Math.round(v * 1e6) / 1e6)).toEqual([0.4, 0.25, 1, 0.5, 0]);
    const d = nmrPorosityDifferenceInto(phie, phiDn, new Float64Array(5));
    expect(d[0]).toBeCloseTo(-0.05, 12);
    expect(d[1]).toBeCloseTo(0, 12);
    expect(d[2]).toBeCloseTo(-0.01, 12);
    expect(d[3]).toBeCloseTo(0.02, 12);
    expect(d[4]).toBeNaN();
    const f = nmrDeficitFlagInto(d, new Float64Array(5), 0.03);
    expect(Array.from(f.slice(0, 4))).toEqual([1, 0, 0, 0]);
    expect(f[4]).toBeNaN();
  });
});
