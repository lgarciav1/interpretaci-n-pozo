import { describe, expect, it } from 'vitest';
import {
  POROSITY_MAX,
  clipPorosity,
  densityNeutronGasPorosity,
  densityNeutronGasPorosityInto,
  densityNeutronPorosity,
  densityNeutronPorosityInto,
  densityPorosity,
  densityPorosityInto,
  effectivePorosity,
  effectivePorosityInto,
  neutronPorosity,
  neutronPorosityInto,
  shaleCorrectedPorosity,
  shaleCorrectedPorosityInto,
  sonicPorosityRaymer,
  sonicPorosityRaymerInto,
  sonicPorosityWyllie,
  sonicPorosityWyllieInto,
} from '../src/petro/porosity';

describe('petro/porosity: densidad', () => {
  it('arenisca limpia: ρb=2,45, ρma=2,65, ρf=1,0 → 0,121 (verificado a mano, no de libro)', () => {
    // 0,20/1,65 = 0,121212 (recalculado a mano)
    expect(densityPorosity(2.45, 2.65, 1.0)).toBeCloseTo(0.12121, 4);
  });

  it('caliza: ρb=2,50, ρma=2,71, ρf=1,0 → 0,21/1,71 = 0,12281', () => {
    // verificado a mano, no de libro
    expect(densityPorosity(2.5, 2.71, 1.0)).toBeCloseTo(0.12281, 4);
  });

  it('ρb = ρma → 0; ρb = ρf → recorte a 0,5 (1,0 sin recortar)', () => {
    expect(densityPorosity(2.65, 2.65, 1.0)).toBe(0);
    expect(densityPorosity(1.0, 2.65, 1.0)).toBe(POROSITY_MAX);
  });

  it('recorta a [0, 0,5]: ρb > ρma (anhidrita, pirita) → 0; ρb muy baja → 0,5', () => {
    expect(densityPorosity(2.9, 2.65, 1.0)).toBe(0);
    expect(densityPorosity(1.5, 2.65, 1.0)).toBe(POROSITY_MAX);
  });

  it('NaN se propaga; ρma = ρf o ρma < ρf → NaN', () => {
    expect(densityPorosity(NaN, 2.65, 1.0)).toBeNaN();
    expect(densityPorosity(2.4, 1.0, 1.0)).toBeNaN();
    expect(densityPorosity(2.4, 0.9, 1.0)).toBeNaN();
    expect(densityPorosity(2.4, NaN, 1.0)).toBeNaN();
    expect(densityPorosity(2.4, 2.65, NaN)).toBeNaN();
  });

  it('versión por tramo escribe solo [start, end)', () => {
    const out = new Float64Array(4).fill(-1);
    densityPorosityInto([2.65, 2.45, NaN, 2.45], out, 2.65, 1.0, 1, 3);
    expect(out[0]).toBe(-1);
    expect(out[1]).toBeCloseTo(0.12121, 4);
    expect(out[2]).toBeNaN();
    expect(out[3]).toBe(-1);
  });
});

describe('petro/porosity: sónico', () => {
  it('Wyllie: Δt=100, Δtma=55,5, Δtf=189 → 44,5/133,5 = 0,3333', () => {
    // arenisca (Δtma 55,5) y lodo dulce (Δtf 189) de Asquith y Krygowski; cuenta verificada a mano
    expect(sonicPorosityWyllie(100, 55.5, 189)).toBeCloseTo(1 / 3, 6);
  });

  it('Wyllie: Δt = Δtma → 0; Δt = Δtf → recorte a 0,5 (1,0 sin recortar)', () => {
    expect(sonicPorosityWyllie(55.5, 55.5, 189)).toBe(0);
    expect(sonicPorosityWyllie(189, 55.5, 189)).toBe(POROSITY_MAX);
  });

  it('Wyllie: Δt < Δtma (matriz más rápida) → 0', () => {
    expect(sonicPorosityWyllie(50, 55.5, 189)).toBe(0);
  });

  it('Wyllie: NaN y parámetros degenerados (Δtf = Δtma, Δtf < Δtma) → NaN', () => {
    expect(sonicPorosityWyllie(NaN, 55.5, 189)).toBeNaN();
    expect(sonicPorosityWyllie(100, 55.5, 55.5)).toBeNaN();
    expect(sonicPorosityWyllie(100, 60, 55)).toBeNaN();
    expect(sonicPorosityWyllie(100, NaN, 189)).toBeNaN();
  });

  it('Wyllie con Cp: Cp = 1 reproduce el caso sin factor (compatibilidad); Cp = 1,2 divide', () => {
    // verificado a mano: (90 − 55,5)/(189 − 55,5) = 34,5/133,5 = 0,258427; /1,2 = 0,215356
    expect(sonicPorosityWyllie(90, 55.5, 189, 1)).toBe(sonicPorosityWyllie(90, 55.5, 189));
    expect(sonicPorosityWyllie(100, 55.5, 189, 1)).toBeCloseTo(1 / 3, 6);
    expect(sonicPorosityWyllie(90, 55.5, 189, 1.2)).toBeCloseTo(0.21535580524344572, 12);
    expect(sonicPorosityWyllie(100, 55.5, 189, 1.2)).toBeCloseTo(1 / 3 / 1.2, 12);
  });

  it('Wyllie con Cp: el recorte a [0, 0,5] se aplica después de dividir; Cp ≤ 0, NaN o Infinity → NaN', () => {
    expect(sonicPorosityWyllie(189, 55.5, 189, 1.2)).toBe(POROSITY_MAX); // 1/1,2 = 0,833 → 0,5
    expect(sonicPorosityWyllie(50, 55.5, 189, 1.5)).toBe(0);
    expect(sonicPorosityWyllie(100, 55.5, 189, 0)).toBeNaN();
    expect(sonicPorosityWyllie(100, 55.5, 189, -1)).toBeNaN();
    expect(sonicPorosityWyllie(100, 55.5, 189, NaN)).toBeNaN();
    expect(sonicPorosityWyllie(100, 55.5, 189, Infinity)).toBeNaN();
    expect(sonicPorosityWyllie(NaN, 55.5, 189, 1.2)).toBeNaN();
  });

  it('Raymer-Hunt-Gardner: Δt=100, Δtma=55,5 → 0,625·44,5/100 = 0,278125', () => {
    // verificado a mano, no de libro (forma 5/8 de Asquith y Krygowski)
    expect(sonicPorosityRaymer(100, 55.5)).toBeCloseTo(0.278125, 8);
  });

  it('Raymer: Δt = Δtma → 0; Δt < Δtma → 0; Δt muy alto → recorte a 0,5', () => {
    expect(sonicPorosityRaymer(55.5, 55.5)).toBe(0);
    expect(sonicPorosityRaymer(50, 55.5)).toBe(0);
    // límite Δt→∞: 0,625 (sin recortar) → 0,5
    expect(sonicPorosityRaymer(1e6, 55.5)).toBe(POROSITY_MAX);
  });

  it('Raymer: para Δt=100 el valor RHG es menor que el de Wyllie', () => {
    expect(sonicPorosityRaymer(100, 55.5)).toBeLessThan(sonicPorosityWyllie(100, 55.5, 189));
  });

  it('Raymer: NaN, Δt ≤ 0 o Δtma ≤ 0 → NaN', () => {
    expect(sonicPorosityRaymer(NaN, 55.5)).toBeNaN();
    expect(sonicPorosityRaymer(0, 55.5)).toBeNaN();
    expect(sonicPorosityRaymer(-1, 55.5)).toBeNaN();
    expect(sonicPorosityRaymer(100, 0)).toBeNaN();
    expect(sonicPorosityRaymer(100, NaN)).toBeNaN();
  });

  it('versiones por tramo escriben solo [start, end)', () => {
    const a = new Float64Array(4).fill(-1);
    sonicPorosityWyllieInto([55.5, 100, NaN, 100], a, 55.5, 189, 1, 3);
    expect(a[0]).toBe(-1);
    expect(a[1]).toBeCloseTo(1 / 3, 6);
    expect(a[2]).toBeNaN();
    expect(a[3]).toBe(-1);

    const b = new Float64Array(4).fill(-1);
    sonicPorosityRaymerInto([55.5, 100, NaN, 100], b, 55.5, 1, 3);
    expect(b[0]).toBe(-1);
    expect(b[1]).toBeCloseTo(0.278125, 8);
    expect(b[2]).toBeNaN();
    expect(b[3]).toBe(-1);
  });
});

describe('petro/porosity: neutrón', () => {
  it('sin offset devuelve NPHI; con offset suma', () => {
    expect(neutronPorosity(0.2)).toBeCloseTo(0.2, 12);
    // 0,20 + 0,04 = 0,24 ; 0,20 − 0,04 = 0,16 (aritmética directa)
    expect(neutronPorosity(0.2, 0.04)).toBeCloseTo(0.24, 12);
    expect(neutronPorosity(0.2, -0.04)).toBeCloseTo(0.16, 12);
  });

  it('recorta a [0, 0,5] (NPHI levemente negativo → 0)', () => {
    expect(neutronPorosity(-0.02)).toBe(0);
    expect(neutronPorosity(0.6)).toBe(POROSITY_MAX);
    expect(neutronPorosity(0.48, 0.04)).toBe(POROSITY_MAX);
  });

  it('NaN en NPHI u offset → NaN', () => {
    expect(neutronPorosity(NaN)).toBeNaN();
    expect(neutronPorosity(0.2, NaN)).toBeNaN();
  });

  it('versión por tramo (offset por defecto 0)', () => {
    const out = new Float64Array(4).fill(-1);
    neutronPorosityInto([0.1, 0.2, NaN, 0.3], out, 0, 1, 3);
    expect([out[0], out[1]]).toEqual([-1, 0.2]);
    expect(out[2]).toBeNaN();
    expect(out[3]).toBe(-1);
    const o2 = new Float64Array(2);
    neutronPorosityInto([0.1, 0.2], o2);
    expect([...o2]).toEqual([0.1, 0.2]);
  });
});

describe('petro/porosity: densidad–neutrón', () => {
  it('promedio simple: (0,20 + 0,10)/2 = 0,15', () => {
    expect(densityNeutronPorosity(0.2, 0.1)).toBeCloseTo(0.15, 12);
  });

  it('gas (raíz cuadrática): √((0,20² + 0,10²)/2) = √0,025 = 0,158114', () => {
    // verificado a mano, no de libro: 0,04 + 0,01 = 0,05 ; /2 = 0,025 ; √0,025 = 0,1581139
    expect(densityNeutronGasPorosity(0.2, 0.1)).toBeCloseTo(0.158114, 6);
  });

  it('gas ≥ promedio simple, e iguales cuando φD = φN', () => {
    expect(densityNeutronGasPorosity(0.25, 0.1)).toBeGreaterThan(densityNeutronPorosity(0.25, 0.1));
    expect(densityNeutronGasPorosity(0.18, 0.18)).toBeCloseTo(0.18, 12);
    expect(densityNeutronPorosity(0.18, 0.18)).toBeCloseTo(0.18, 12);
  });

  it('entradas negativas se recortan a 0 antes de combinar (un φN < 0 no suma por el cuadrado)', () => {
    // φN = −0,10 → 0 : promedio (0,2+0)/2 = 0,1 ; gas √(0,04/2) = 0,141421
    expect(densityNeutronPorosity(0.2, -0.1)).toBeCloseTo(0.1, 12);
    expect(densityNeutronGasPorosity(0.2, -0.1)).toBeCloseTo(Math.sqrt(0.02), 12);
  });

  it('recorta a 0,5 y propaga NaN', () => {
    expect(densityNeutronPorosity(0.9, 0.9)).toBe(POROSITY_MAX);
    expect(densityNeutronGasPorosity(0.9, 0.9)).toBe(POROSITY_MAX);
    expect(densityNeutronPorosity(NaN, 0.1)).toBeNaN();
    expect(densityNeutronPorosity(0.1, NaN)).toBeNaN();
    expect(densityNeutronGasPorosity(NaN, 0.1)).toBeNaN();
    expect(densityNeutronGasPorosity(0.1, NaN)).toBeNaN();
  });

  it('versiones por tramo escriben solo [start, end)', () => {
    const a = new Float64Array(4).fill(-1);
    densityNeutronPorosityInto([0.2, 0.2, 0.2, 0.2], [0.1, 0.1, NaN, 0.1], a, 1, 3);
    expect(a[0]).toBe(-1);
    expect(a[1]).toBeCloseTo(0.15, 12);
    expect(a[2]).toBeNaN();
    expect(a[3]).toBe(-1);

    const b = new Float64Array(4).fill(-1);
    densityNeutronGasPorosityInto([0.2, 0.2, 0.2, 0.2], [0.1, 0.1, NaN, 0.1], b, 1, 3);
    expect(b[0]).toBe(-1);
    expect(b[1]).toBeCloseTo(0.158114, 6);
    expect(b[2]).toBeNaN();
    expect(b[3]).toBe(-1);
  });
});

describe('petro/porosity: arcilla y porosidad efectiva', () => {
  it('corrección: φ=0,25, Vsh=0,2, φsh=0,30 → 0,25 − 0,06 = 0,19', () => {
    // verificado a mano, no de libro
    expect(shaleCorrectedPorosity(0.25, 0.2, 0.3)).toBeCloseTo(0.19, 12);
  });

  it('corrección: Vsh=0 no cambia φ; sobrecorrección (φ < Vsh·φsh) → 0', () => {
    expect(shaleCorrectedPorosity(0.2, 0, 0.3)).toBeCloseTo(0.2, 12);
    // 0,05 − 0,5·0,3 = −0,10 → 0
    expect(shaleCorrectedPorosity(0.05, 0.5, 0.3)).toBe(0);
  });

  it('corrección: Vsh fuera de [0, 1] se recorta; NaN en cualquier entrada → NaN', () => {
    // Vsh=1,5 → 1 : 0,4 − 0,3 = 0,1 ; Vsh=−0,5 → 0 : φ sin cambios
    expect(shaleCorrectedPorosity(0.4, 1.5, 0.3)).toBeCloseTo(0.1, 12);
    expect(shaleCorrectedPorosity(0.2, -0.5, 0.3)).toBeCloseTo(0.2, 12);
    expect(shaleCorrectedPorosity(NaN, 0.2, 0.3)).toBeNaN();
    expect(shaleCorrectedPorosity(0.2, NaN, 0.3)).toBeNaN();
    expect(shaleCorrectedPorosity(0.2, 0.2, NaN)).toBeNaN();
  });

  it('efectiva: φt=0,25, Vsh=0,2 → 0,25·0,8 = 0,20 (Asquith y Krygowski, φe = φt·(1 − Vsh))', () => {
    // cuenta verificada a mano
    expect(effectivePorosity(0.25, 0.2)).toBeCloseTo(0.2, 12);
    expect(effectivePorosity(0.25, 0)).toBeCloseTo(0.25, 12);
    expect(effectivePorosity(0.25, 1)).toBe(0);
  });

  it('efectiva coincide con la corrección cuando φsh = φt', () => {
    expect(effectivePorosity(0.25, 0.3)).toBeCloseTo(shaleCorrectedPorosity(0.25, 0.3, 0.25), 12);
  });

  it('efectiva: recorta, Vsh fuera de rango, NaN', () => {
    expect(effectivePorosity(0.8, 0)).toBe(POROSITY_MAX);
    // φt se recorta antes de multiplicar: 0,5·(1−0,5) = 0,25 (verificado a mano, no de libro)
    expect(effectivePorosity(0.8, 0.5)).toBeCloseTo(0.25, 12);
    expect(effectivePorosity(0.25, 2)).toBe(0);
    expect(effectivePorosity(0.25, -1)).toBeCloseTo(0.25, 12);
    expect(effectivePorosity(NaN, 0.2)).toBeNaN();
    expect(effectivePorosity(0.25, NaN)).toBeNaN();
  });

  it('versiones por tramo escriben solo [start, end)', () => {
    const a = new Float64Array(4).fill(-1);
    shaleCorrectedPorosityInto([0.25, 0.25, 0.25, 0.25], [0.2, 0.2, NaN, 0.2], a, 0.3, 1, 3);
    expect(a[0]).toBe(-1);
    expect(a[1]).toBeCloseTo(0.19, 12);
    expect(a[2]).toBeNaN();
    expect(a[3]).toBe(-1);

    const b = new Float64Array(4).fill(-1);
    effectivePorosityInto([0.25, 0.25, 0.25, 0.25], [0.2, 0.2, NaN, 0.2], b, 1, 3);
    expect(b[0]).toBe(-1);
    expect(b[1]).toBeCloseTo(0.2, 12);
    expect(b[2]).toBeNaN();
    expect(b[3]).toBe(-1);
  });
});

describe('petro/porosity: recorte', () => {
  it('clipPorosity limita a [0, 0,5] y propaga NaN', () => {
    expect(clipPorosity(-0.1)).toBe(0);
    expect(clipPorosity(0.3)).toBe(0.3);
    expect(clipPorosity(0.7)).toBe(0.5);
    expect(clipPorosity(NaN)).toBeNaN();
  });
});
