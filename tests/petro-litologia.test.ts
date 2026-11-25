/**
 * Índices de litología (docs/decisiones/0059). Valores esperados calculados a mano FUERA del código con las constantes
 * del Appendix B de Schlumberger (2013) (slides 20–21 de la Clase 8):
 *   cuarzo  ρ 2,64 · Pe 1,8 · Δt 56 · φN −0,02 → U = 1,8·(2,64+0,1883)/1,0704 = 4,7561; M = 1,33/1,64 = 0,81098; N = 1,02/1,64 = 0,62195
 *   calcita ρ 2,71 · Pe 5,1 · Δt 49 · φN 0     → U = 13,8092; M = 1,40/1,71 = 0,81871; N = 1/1,71 = 0,58480
 *   dolomita ρ 2,85 · Pe 3,1 · Δt 44 · φN 0,01 → U = 8,7993;  M = 1,45/1,85 = 0,78378; N = 0,99/1,85 = 0,53514
 *   mezcla 70 % cuarzo + 30 % calcita, φ = 0,2 con agua dulce (Uf 0,398): ρb = 2,3288; Pe = 2,57584 → ρmaa 2,661; Umaa 7,4720
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DT_FLUID, DEFAULT_RHO_FLUID, DEFAULT_U_FLUID, LITHOLOGY_MATRICES, LITH1_BOXES, MID_CHART_RANGE, MID_TRIANGLE, MID_VERTICES, UMAA_TRIANGLE,
  apparentMatrixTransitTime, apparentMatrixTransitTimeInto, boxVertices, lithologyMatrix, mIndex, midTernaryGrid, midTernaryPoint, mnPoint, nIndex,
  photoelectricU, porosityLine, rhomaa, ternaryGrid, ternaryPoint, thkRatio, umaa,
} from '../src/petro/lithologyIndices';
import { MINERALS } from '../src/petro/mineralogy';

describe('U volumétrico contra el Appendix B', () => {
  it('cuarzo ≈ 4,8 y calcita ≈ 13,8 (chequeo de cordura del brief)', () => {
    expect(photoelectricU(1.8, 2.64)).toBeCloseTo(4.7561, 4);
    expect(photoelectricU(1.8, 2.64)).toBeCloseTo(4.8, 1);
    expect(photoelectricU(5.1, 2.71)).toBeCloseTo(13.8092, 4);
    expect(photoelectricU(5.1, 2.71)).toBeCloseTo(13.8, 1);
  });
  it('dolomita da 8,80 con Pe 3,1 (el Appendix B tabula U 9,0: Pe redondeado)', () => {
    expect(photoelectricU(3.1, 2.85)).toBeCloseTo(8.7993, 4);
  });
  it('Umaa de una matriz pura sin porosidad es su U', () => {
    expect(umaa(1.8, 2.64, 0)).toBeCloseTo(4.7561, 4);
    expect(umaa(5.1, 2.71, 0)).toBeCloseTo(13.8092, 4);
  });
  it('mezcla 70 % cuarzo + 30 % calcita con 20 % de agua dulce recupera la matriz', () => {
    expect(umaa(2.57584, 2.3288, 0.2)).toBeCloseTo(7.472, 3);
    expect(rhomaa(2.3288, 0.2)).toBeCloseTo(2.661, 6);
    expect(DEFAULT_U_FLUID).toBe(0.398);
  });
});

describe('M y N', () => {
  it.each([
    ['cuarzo', 56, 2.64, -0.02, 0.81098, 0.62195],
    ['calcita', 49, 2.71, 0, 0.81871, 0.5848],
    ['dolomita', 44, 2.85, 0.01, 0.78378, 0.53514],
  ] as const)('%s puro', (_n, dt, rho, nphi, m, n) => {
    expect(mIndex(dt, rho)).toBeCloseTo(m, 5);
    expect(nIndex(nphi, rho)).toBeCloseTo(n, 5);
  });
  it('no dependen de la porosidad: arenisca con 25 % de agua dulce da los mismos M y N que el cuarzo', () => {
    // ρb = 2,64·0,75 + 0,25 = 2,23; Δt = 56 + 0,25·133 = 89,25; φN = −0,02·0,75 + 0,25 = 0,235
    expect(mIndex(89.25, 2.23)).toBeCloseTo(0.81098, 5);
    expect(nIndex(0.235, 2.23)).toBeCloseTo(0.62195, 5);
  });
  it('los puntos de matriz de M–N salen de la tabla', () => {
    const q = mnPoint(lithologyMatrix('quartz'));
    expect(q.m).toBeCloseTo(0.81098, 5);
    expect(q.n).toBeCloseTo(0.62195, 5);
    const d = mnPoint(lithologyMatrix('dolomite'));
    expect(d.m).toBeCloseTo(0.78378, 5);
  });
});

describe('dominio: NaN sin excepciones', () => {
  it('M y N con ρb ≤ ρf o entradas no finitas', () => {
    expect(mIndex(80, 1)).toBeNaN();
    expect(mIndex(80, 0.9)).toBeNaN();
    expect(mIndex(0, 2.4)).toBeNaN();
    expect(mIndex(NaN, 2.4)).toBeNaN();
    expect(nIndex(0.2, 1)).toBeNaN();
    expect(nIndex(Infinity, 2.4)).toBeNaN();
  });
  it('U y Umaa con Pe ≤ 0, φ ≥ 1 o φ < 0', () => {
    expect(photoelectricU(0, 2.4)).toBeNaN();
    expect(photoelectricU(-1, 2.4)).toBeNaN();
    expect(umaa(3, 2.4, 1)).toBeNaN();
    expect(umaa(3, 2.4, 1.2)).toBeNaN();
    expect(umaa(3, 2.4, -0.01)).toBeNaN();
    expect(umaa(3, 2.4, NaN)).toBeNaN();
    expect(rhomaa(2.4, 1)).toBeNaN();
  });
  it('Th/K con K ≤ 0 o Th < 0', () => {
    expect(thkRatio(12, 2.5)).toBeCloseTo(4.8, 12);
    expect(thkRatio(12, 0)).toBeNaN();
    expect(thkRatio(12, -1)).toBeNaN();
    expect(thkRatio(-1, 2)).toBeNaN();
    expect(thkRatio(0, 2)).toBe(0);
  });
});

describe('matrices y líneas guía', () => {
  it('reusa densidad, Pe y neutrón de MINERALS y agrega Δt y U del Appendix B', () => {
    for (const m of LITHOLOGY_MATRICES) {
      const ref = MINERALS.find((x) => x.id === m.id)!;
      expect([m.rho, m.pe, m.phiN]).toEqual([ref.rho, ref.pe, ref.nphi]);
    }
    expect(['quartz', 'calcite', 'dolomite'].map((id) => lithologyMatrix(id as 'quartz').dt)).toEqual([56, 49, 44]);
    expect(['quartz', 'calcite', 'dolomite'].map((id) => lithologyMatrix(id as 'quartz').u)).toEqual([4.8, 13.8, 9]);
  });
  it('recta de Wyllie de la arenisca: matriz en φ = 0 y Δt = 56 + φ·133', () => {
    const l = porosityLine(lithologyMatrix('quartz'));
    expect(l.phi[0]).toBe(0);
    expect(l.phi.at(-1)).toBeCloseTo(0.45, 12);
    expect([l.dt[0], l.nphi[0], l.rhob[0]]).toEqual([56, -0.02, 2.64]);
    const k = l.phi.indexOf(0.3);
    expect(l.dt[k]).toBeCloseTo(95.9, 10);
    expect(l.nphi[k]).toBeCloseTo(0.286, 10);
    expect(l.rhob[k]).toBeCloseTo(2.148, 10);
  });
  it('grilla ternaria: 12 líneas internas cada 20 % y puntos de mezcla por volumen', () => {
    const g = ternaryGrid(0.2);
    expect(g).toHaveLength(12);
    const p = ternaryPoint(0.2, 0.4, 0.4);
    expect(p.u).toBeCloseTo(0.2 * 4.8 + 0.4 * 13.8 + 0.4 * 9, 12);
    expect(p.rho).toBeCloseTo(0.2 * 2.65 + 0.4 * 2.71 + 0.4 * 2.87, 12);
    expect(UMAA_TRIANGLE.map((v) => v.id)).toEqual(['quartz', 'calcite', 'dolomite']);
  });
  it('cajas de Lith-1 cerradas, con Pe dentro de 0–10', () => {
    for (const b of LITH1_BOXES) {
      expect(b.pe[0]).toBeLessThan(b.pe[1]);
      expect(b.pe[1]).toBeLessThanOrEqual(10);
      const v = boxVertices(b.thk ?? b.k!, b.pe);
      expect(v).toHaveLength(5);
      expect(v[0]).toEqual(v[4]);
    }
  });
});

describe('carta MID: Δtmaa y geometría ρmaa–Δtmaa (Clavier y Rust, 1976; G04)', () => {
  const porosities = [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35];

  it.each(MID_VERTICES.map((v) => [v.label, v.dt, v.rho] as const))(
    '%s puro con agua dulce: (Δtmaa, ρmaa) cae exacto sobre el vértice para φ ∈ [0; 0,35]',
    (_label, dtMa, rhoMa) => {
      for (const phi of porosities) {
        const dt = dtMa + phi * (DEFAULT_DT_FLUID - dtMa);
        const rhob = rhoMa * (1 - phi) + DEFAULT_RHO_FLUID * phi;
        expect(apparentMatrixTransitTime(dt, phi)).toBeCloseTo(dtMa, 10);
        expect(rhomaa(rhob, phi)).toBeCloseTo(rhoMa, 10);
      }
    },
  );

  it('mezclas ternarias sintéticas cuarzo–calcita–dolomita: invariantes a la porosidad (agua dulce y salada)', () => {
    const mixes: readonly [number, number, number][] = [
      [0.5, 0.5, 0],
      [0.4, 0.3, 0.3],
      [0.2, 0.5, 0.3],
      [0.1, 0.2, 0.7],
    ];
    for (const [q, c, d] of mixes) {
      const target = midTernaryPoint(q, c, d);
      for (const [dtFl, rhoFl] of [[189, 1.0], [185, 1.1]] as const) {
        for (const phi of porosities) {
          const dt = target.dt + phi * (dtFl - target.dt);
          const rhob = target.rho * (1 - phi) + rhoFl * phi;
          expect(apparentMatrixTransitTime(dt, phi, dtFl)).toBeCloseTo(target.dt, 10);
          expect(rhomaa(rhob, phi, rhoFl)).toBeCloseTo(target.rho, 10);
        }
      }
    }
  });

  it('apparentMatrixTransitTimeInto escribe solo en [start, end), respeta entradas y trata largos distintos en forma simétrica', () => {
    const dt = new Float64Array([55.5, 82.2, 75.8, 99.9]);
    const phi = new Float64Array([0, 0.2, 0.2, 0.3]);
    const dtSnap = Array.from(dt);
    const phiSnap = Array.from(phi);
    const out = new Float64Array(4).fill(-1);
    apparentMatrixTransitTimeInto(dt, phi, out, 189, 1, 3);
    expect(out[0]).toBe(-1);
    expect(out[1]).toBeCloseTo(55.5, 10);
    expect(out[2]).toBeCloseTo(47.5, 10);
    expect(out[3]).toBe(-1);
    expect(Array.from(dt)).toEqual(dtSnap);
    expect(Array.from(phi)).toEqual(phiSnap);

    const outShortPhi = new Float64Array(4).fill(99);
    apparentMatrixTransitTimeInto(new Float64Array([55.5, 82.2, 75.8, 99.9]), new Float64Array([0, 0.2]), outShortPhi);
    expect(outShortPhi[0]).toBeCloseTo(55.5, 10);
    expect(outShortPhi[1]).toBeCloseTo(55.5, 10);
    expect(outShortPhi[2]).toBeNaN();
    expect(outShortPhi[3]).toBeNaN();

    const outShortDt = new Float64Array(4).fill(99);
    apparentMatrixTransitTimeInto(new Float64Array([55.5, 82.2]), new Float64Array([0, 0.2, 0.2, 0.3]), outShortDt);
    expect(outShortDt[0]).toBeCloseTo(55.5, 10);
    expect(outShortDt[1]).toBeCloseTo(55.5, 10);
    expect(outShortDt[2]).toBeNaN();
    expect(outShortDt[3]).toBeNaN();
  });

  it('dominio de Δtmaa: NaN sin excepciones fuera de rango físico', () => {
    expect(apparentMatrixTransitTime(0, 0.1)).toBeNaN();
    expect(apparentMatrixTransitTime(-50, 0.1)).toBeNaN();
    expect(apparentMatrixTransitTime(80, 0.1, 0)).toBeNaN();
    expect(apparentMatrixTransitTime(80, 0.1, -189)).toBeNaN();
    expect(apparentMatrixTransitTime(80, -0.01)).toBeNaN();
    expect(apparentMatrixTransitTime(80, 1)).toBeNaN();
    expect(apparentMatrixTransitTime(80, 1.2)).toBeNaN();
    expect(apparentMatrixTransitTime(NaN, 0.2)).toBeNaN();
    expect(apparentMatrixTransitTime(80, Infinity)).toBeNaN();
    // Δt ≤ φ·Δtf → Δtmaa ≤ 0 (no físico, incluyendo cancelación IEEE-754) → NaN.
    expect(apparentMatrixTransitTime(94.5, 0.5, 189)).toBeNaN();
    expect(apparentMatrixTransitTime(56.7, 0.3, 189)).toBeNaN();
    expect(apparentMatrixTransitTime(50, 0.3, 189)).toBeNaN();
  });

  it('geometría MID: 5 vértices, triángulo cuarzo–calcita–dolomita y grilla de 12 líneas internas cada 20 %', () => {
    expect(MID_VERTICES.map((v) => v.id)).toEqual(['quartz', 'calcite', 'dolomite', 'anhydrite', 'gypsum']);
    expect(MID_TRIANGLE.map((v) => v.id)).toEqual(['quartz', 'calcite', 'dolomite']);
    expect(MID_CHART_RANGE).toEqual({ dt: [35, 70], rho: [2.2, 3.1] });
    const g = midTernaryGrid(0.2);
    expect(g).toHaveLength(12);
    expect(midTernaryGrid(0)).toEqual([]);
    expect(midTernaryGrid(-0.2)).toEqual([]);
    expect(midTernaryGrid(1)).toEqual([]);
    expect(midTernaryGrid(NaN)).toEqual([]);
    expect(midTernaryPoint(Infinity, 0, 0)).toEqual({ dt: NaN, rho: NaN });
    expect(midTernaryPoint(-Infinity, 1, 0)).toEqual({ dt: NaN, rho: NaN });
    expect(midTernaryPoint(NaN, 0, 1)).toEqual({ dt: NaN, rho: NaN });
  });
});
