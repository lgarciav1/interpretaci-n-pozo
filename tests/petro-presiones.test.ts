import { describe, expect, it } from 'vitest';
import {
  FLUID_DENSITY_RANGES,
  PSI_PER_FT_PER_G_CM3,
  classifyFluidByDensity,
  densityFromKPaPerM,
  densityFromPsiPerFt,
  hydrostaticPressureKPa,
  psiPerFtFromDensity,
} from '../src/petro/pressure';
import { gradientReadings } from '../src/petro/gradients';

describe('petro/pressure: densidad ↔ gradiente en psi/ft', () => {
  it('1 g/cm³ = 0,4335 psi/ft (agua dulce 0,433 psi/ft: Bourgoyne et al. 1986)', () => {
    expect(PSI_PER_FT_PER_G_CM3).toBeCloseTo(0.4335275, 6);
    expect(psiPerFtFromDensity(1)).toBeCloseTo(0.4335, 4);
    expect(densityFromPsiPerFt(0.433)).toBeCloseTo(0.9988, 4);
  });

  it('gradientes del ejemplo de Dake (1978, §1.4): agua 0,45 → 1,038; petróleo 0,35 → 0,807; gas 0,08 → 0,185 g/cm³', () => {
    expect(densityFromPsiPerFt(0.45)).toBeCloseTo(1.038, 3);
    expect(densityFromPsiPerFt(0.35)).toBeCloseTo(0.807, 3);
    expect(densityFromPsiPerFt(0.08)).toBeCloseTo(0.1845, 4);
  });

  it('coincide con la lectura «g/cm³ (equiv.)» de gradientReadings', () => {
    const psiPerM = 0.465 / 0.3048; // agua de formación típica, Bourgoyne et al. (1986)
    const equiv = gradientReadings(psiPerM, 'psi').find((r) => r.unit === 'g/cm³ (equiv.)')!.value;
    expect(densityFromPsiPerFt(0.465)).toBeCloseTo(equiv, 12);
    expect(equiv).toBeCloseTo(1.0726, 4);
    expect(densityFromKPaPerM(9.80665)).toBe(1);
  });

  it('ida y vuelta', () => {
    for (const rho of [0.1, 0.25, 0.7, 1.0, 1.15]) expect(densityFromPsiPerFt(psiPerFtFromDensity(rho))).toBeCloseTo(rho, 12);
  });
});

describe('petro/pressure: clasificación del fluido por densidad', () => {
  it('los rangos están ordenados y no se superponen', () => {
    const r = FLUID_DENSITY_RANGES;
    expect(r.gas[0]).toBeLessThan(r.gas[1]);
    expect(r.gas[1]).toBeLessThan(r.oil[0]);
    expect(r.oil[1]).toBeLessThan(r.water[0]);
    expect(r.water[0]).toBeLessThan(r.water[1]);
  });

  it('gradientes de libro → fluido esperado dentro de su rango', () => {
    expect(classifyFluidByDensity(densityFromPsiPerFt(0.08))).toMatchObject({ fluid: 'gas', inRange: true, between: null });
    expect(classifyFluidByDensity(densityFromPsiPerFt(0.33))).toMatchObject({ fluid: 'oil', inRange: true });
    expect(classifyFluidByDensity(densityFromPsiPerFt(0.35))).toMatchObject({ fluid: 'oil', inRange: true });
    expect(classifyFluidByDensity(densityFromPsiPerFt(0.433))).toMatchObject({ fluid: 'water', inRange: true });
    expect(classifyFluidByDensity(densityFromPsiPerFt(0.45))).toMatchObject({ fluid: 'water', inRange: true });
    expect(classifyFluidByDensity(densityFromPsiPerFt(0.5))).toMatchObject({ fluid: 'water', inRange: true });
  });

  it('entre rangos: el más cercano, con los dos candidatos', () => {
    // 0,40 g/cm³: condensado o petróleo volátil, más cerca del gas (0,35) que del petróleo (0,55).
    expect(classifyFluidByDensity(0.4)).toEqual({ fluid: 'gas', between: ['gas', 'oil'], inRange: false, density: 0.4 });
    expect(classifyFluidByDensity(0.52)).toMatchObject({ fluid: 'oil', between: ['oil', 'gas'], inRange: false });
    expect(classifyFluidByDensity(0.97)).toMatchObject({ fluid: 'water', between: ['water', 'oil'], inRange: false });
  });

  it('fuera de los extremos pero física: gas muy liviano o salmuera muy densa', () => {
    expect(classifyFluidByDensity(0.02)).toMatchObject({ fluid: 'gas', inRange: false, between: null });
    expect(classifyFluidByDensity(1.3)).toMatchObject({ fluid: 'water', inRange: false });
  });

  it('densidades no físicas → sin fluido (gradiente negativo, nulo, enorme o NaN)', () => {
    for (const d of [-0.2, 0, 1.9, NaN, Infinity]) expect(classifyFluidByDensity(d).fluid).toBeNull();
  });
});

describe('petro/pressure: presión hidrostática', () => {
  it('columna de agua de 1 g/cm³: 9,80665 kPa por metro', () => {
    expect(hydrostaticPressureKPa(101.325, 0, 1, 1000)).toBeCloseTo(101.325 + 9806.65, 9);
  });

  it('ejemplo de Dake (1978, §1.4) en unidades de campo: 15 psia + 0,45 psi/ft × 5500 ft = 2490 psia', () => {
    const psi = 6.894757293168361;
    const rhoW = densityFromPsiPerFt(0.45);
    const p = hydrostaticPressureKPa(15 * psi, 0, rhoW, 5500 * 0.3048) / psi;
    expect(p).toBeCloseTo(2490, 9);
  });
});
