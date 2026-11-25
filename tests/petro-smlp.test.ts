/**
 * Tests puros de zonación hidráulica SMLP (Stratigraphic Modified Lorenz Plot, Gunter et al., 1997) en
 * `src/petro/flowCapacity.ts`: clasificación operativa de pendientes, sub-unidades S1..Sk y segmentador
 * lineal por tramos (`suggestSmlpBreaks`).
 */
import { describe, expect, it } from 'vitest';
import {
  classifySmlpSlope,
  flowCapacity,
  lorenzStratigraphic,
  sanitizeSmlpBreaks,
  smlpSubUnits,
  suggestSmlpBreaks,
  type FlowSamples,
  type RawFlowUnit,
} from '../src/petro/flowCapacity';

/** Construye un pozo sintético por capas homogéneas contiguas (profundidad de 1 m en 1 m por defecto). */
function layeredSamples(
  layers: readonly { count: number; h?: number; phi: number; k: number }[],
  topDepth = 2000,
): FlowSamples {
  const depth: number[] = [];
  const thickness: number[] = [];
  const phi: number[] = [];
  const k: number[] = [];
  let z = topDepth;
  for (const layer of layers) {
    const step = layer.h ?? 1;
    for (let i = 0; i < layer.count; i++) {
      depth.push(z);
      thickness.push(step);
      phi.push(layer.phi);
      k.push(layer.k);
      z += step;
    }
  }
  return { depth, thickness, phi, k };
}

describe('classifySmlpSlope (umbrales operativos SMLP)', () => {
  it('cubre exactamente las cuatro bandas y bordes sin huecos', () => {
    expect(classifySmlpSlope(Infinity)).toBe('conduit');
    expect(classifySmlpSlope(2.5)).toBe('conduit');
    expect(classifySmlpSlope(1.300001)).toBe('conduit');

    expect(classifySmlpSlope(1.3)).toBe('homogeneous');
    expect(classifySmlpSlope(1.0)).toBe('homogeneous');
    expect(classifySmlpSlope(0.7)).toBe('homogeneous');

    expect(classifySmlpSlope(0.699999)).toBe('subordinate');
    expect(classifySmlpSlope(0.5)).toBe('subordinate');
    expect(classifySmlpSlope(0.3)).toBe('subordinate');

    expect(classifySmlpSlope(0.299999)).toBe('barrier');
    expect(classifySmlpSlope(0.05)).toBe('barrier');
    expect(classifySmlpSlope(0)).toBe('barrier');

    expect(classifySmlpSlope(NaN)).toBeNull();
    expect(classifySmlpSlope(-0.1)).toBeNull();
  });
});

describe('suggestSmlpBreaks y smlpSubUnits: reservorio sintético de 3 capas', () => {
  // 3 capas de 10 m cada una (h = 1 m por muestra, 30 muestras, 2000..2029 m):
  //   Capa 1 (Conducto):   φ = 0,20, k = 180 mD → φ·h = 2,0 m (1/3 = 33,333%), k·h = 1800 mD·m (60%), pend. = 1,80
  //   Capa 2 (Barrera):    φ = 0,20, k = 20 mD  → φ·h = 2,0 m (1/3 = 33,333%), k·h = 200 mD·m (6,667%), pend. = 0,20
  //   Capa 3 (Homogéneo):  φ = 0,20, k = 100 mD → φ·h = 2,0 m (1/3 = 33,333%), k·h = 1000 mD·m (33,333%), pend. = 1,00
  // Totales: Σφ·h = 6,0 m, Σk·h = 3000 mD·m. Quiebres exactos en índices 10 (2010 m) y 20 (2020 m).
  const threeLayers = flowCapacity(
    layeredSamples([
      { count: 10, h: 1, phi: 0.2, k: 180 },
      { count: 10, h: 1, phi: 0.2, k: 20 },
      { count: 10, h: 1, phi: 0.2, k: 100 },
    ]),
  );

  it('recupera exactamente los 2 quiebres aun con maxSegments > 3 y las sumas de %φ·h y %k·h dan 100 %', () => {
    const sug = suggestSmlpBreaks(threeLayers.units, { maxSegments: 6, tolerance: 0.02 });
    expect(sug.breaks).toEqual([10, 20]);
    expect(sug.maxError).toBeCloseTo(0, 12);
    expect(sug.rmsError).toBeCloseTo(0, 12);

    const subs = smlpSubUnits(threeLayers.units, sug.breaks);
    expect(subs).toHaveLength(3);
    expect(subs.map((s) => s.label)).toEqual(['S1', 'S2', 'S3']);
    expect(subs.map((s) => [s.top, s.base, s.h])).toEqual([
      [2000, 2009, 10],
      [2010, 2019, 10],
      [2020, 2029, 10],
    ]);

    // Fracciones exactas a mano:
    expect(subs[0]!.phiHFrac).toBeCloseTo(1 / 3, 12);
    expect(subs[0]!.kHFrac).toBeCloseTo(0.6, 12);
    expect(subs[0]!.slope).toBeCloseTo(1.8, 12);
    expect(subs[0]!.character).toBe('conduit');

    expect(subs[1]!.phiHFrac).toBeCloseTo(1 / 3, 12);
    expect(subs[1]!.kHFrac).toBeCloseTo(2 / 30, 12);
    expect(subs[1]!.slope).toBeCloseTo(0.2, 12);
    expect(subs[1]!.character).toBe('barrier');

    expect(subs[2]!.phiHFrac).toBeCloseTo(1 / 3, 12);
    expect(subs[2]!.kHFrac).toBeCloseTo(1 / 3, 12);
    expect(subs[2]!.slope).toBeCloseTo(1.0, 12);
    expect(subs[2]!.character).toBe('homogeneous');

    // Sumas exactamente 100 % (1,0 en fracción) y acumulados continuos de 0 a 1:
    const sumPhiPct = subs.reduce((acc, s) => acc + 100 * s.phiHFrac, 0);
    const sumKPct = subs.reduce((acc, s) => acc + 100 * s.kHFrac, 0);
    expect(sumPhiPct).toBeCloseTo(100, 12);
    expect(sumKPct).toBeCloseTo(100, 12);
    expect(subs[0]!.startPhiH).toBe(0);
    expect(subs[0]!.startKH).toBe(0);
    expect(subs[2]!.endPhiH).toBe(1);
    expect(subs[2]!.endKH).toBe(1);
    expect(subs[0]!.endPhiH).toBeCloseTo(subs[1]!.startPhiH, 12);
    expect(subs[1]!.endKH).toBeCloseTo(subs[2]!.startKH, 12);
  });

  it('recupera exactamente los 2 quiebres también en curvas largas (> 250 muestras, ruta con candidatos y refinamiento)', () => {
    // 450 muestras de 0,1524 m (150 por capa), simulando paso de perfil real:
    const fine = flowCapacity(
      layeredSamples([
        { count: 150, h: 0.1524, phi: 0.22, k: 220 },
        { count: 150, h: 0.1524, phi: 0.18, k: 4 },
        { count: 150, h: 0.1524, phi: 0.20, k: 75 },
      ], 7800),
    );
    const sug = suggestSmlpBreaks(fine.units, { maxSegments: 6, tolerance: 0.015 });
    expect(sug.breaks).toEqual([150, 300]);
    expect(sug.maxError).toBeCloseTo(0, 12);

    const subs = smlpSubUnits(fine.units, sug.breaks);
    expect(subs.map((s) => s.character)).toEqual(['conduit', 'barrier', 'homogeneous']);
    expect(subs.reduce((a, s) => a + s.phiHFrac, 0)).toBeCloseTo(1, 12);
    expect(subs.reduce((a, s) => a + s.kHFrac, 0)).toBeCloseTo(1, 12);
  });

  it('recupera una zona ladrona delgada (conducto de pocas muestras con mucho k·h)', () => {
    // 2 muestras de conducto en un reservorio de 42 muestras:
    const thief = flowCapacity(
      layeredSamples([
        { count: 20, h: 1, phi: 0.2, k: 10 },
        { count: 2, h: 1, phi: 0.2, k: 500 },
        { count: 20, h: 1, phi: 0.2, k: 10 },
      ]),
    );
    const sug = suggestSmlpBreaks(thief.units, { maxSegments: 5, tolerance: 0.02 });
    expect(sug.breaks).toEqual([20, 22]);
    const subs = smlpSubUnits(thief.units, sug.breaks);
    expect(subs[1]!.character).toBe('conduit');
    expect(subs[1]!.unitCount).toBe(2);
    expect(subs[1]!.kHFrac).toBeCloseTo(1000 / 1400, 12);
  });
});

describe('suggestSmlpBreaks y smlpSubUnits: casos límite e invariantes', () => {
  it('reservorio homogéneo (k/φ constante): 0 quiebres y 1 sola sub-unidad homogénea con pendiente 1', () => {
    const homo = flowCapacity(
      layeredSamples([
        { count: 10, h: 1, phi: 0.1, k: 10 },
        { count: 10, h: 1, phi: 0.2, k: 20 },
        { count: 10, h: 1, phi: 0.3, k: 30 },
      ]),
    );
    const sug = suggestSmlpBreaks(homo.units, { maxSegments: 6, tolerance: 0.001 });
    expect(sug.breaks).toEqual([]);
    expect(sug.maxError).toBeCloseTo(0, 12);
    const subs = smlpSubUnits(homo.units, sug.breaks);
    expect(subs).toHaveLength(1);
    expect(subs[0]!.slope).toBeCloseTo(1, 12);
    expect(subs[0]!.character).toBe('homogeneous');
  });

  it('respeta maxSegments y sensibilidad (tolerancia)', () => {
    // 4 capas con quiebres claros en 5, 10 y 15:
    const four = flowCapacity(
      layeredSamples([
        { count: 5, h: 1, phi: 0.2, k: 200 }, // conducto
        { count: 5, h: 1, phi: 0.2, k: 5 },   // barrera
        { count: 5, h: 1, phi: 0.2, k: 60 },  // subordinado / homogéneo
        { count: 5, h: 1, phi: 0.2, k: 150 }, // conducto
      ]),
    );
    expect(suggestSmlpBreaks(four.units, { maxSegments: 6, tolerance: 0.01 }).breaks).toEqual([5, 10, 15]);
    expect(suggestSmlpBreaks(four.units, { maxSegments: 2, tolerance: 0.01 }).breaks).toHaveLength(1);
    expect(suggestSmlpBreaks(four.units, { maxSegments: 1, tolerance: 0.01 }).breaks).toEqual([]);
    // Con tolerancia enorme (1,0), 1 segmento alcanza:
    expect(suggestSmlpBreaks(four.units, { maxSegments: 6, tolerance: 1 }).breaks).toEqual([]);
  });

  it('curva no normalizable (Σk·h = 0 o vacía): sin errores, quiebres vacíos y NaN coherente', () => {
    const zeroK = flowCapacity(layeredSamples([{ count: 5, h: 1, phi: 0.2, k: 0 }]));
    const sug = suggestSmlpBreaks(zeroK.units);
    expect(sug.breaks).toEqual([]);
    expect(sug.maxError).toBeNaN();
    expect(sug.rmsError).toBeNaN();

    const subs = smlpSubUnits(zeroK.units, [2]);
    expect(subs).toHaveLength(2);
    expect(subs[0]!.phiHFrac).toBeCloseTo(0.4, 12);
    expect(subs[0]!.kHFrac).toBeNaN();
    expect(subs[0]!.slope).toBeNaN();
    expect(subs[0]!.character).toBeNull();

    expect(smlpSubUnits([], [])).toEqual([]);
    expect(suggestSmlpBreaks([]).breaks).toEqual([]);
  });

  it('tramo con φ = 0 y k > 0 (pendiente ∞ → Conducto) y tramo sin aporte (φ = 0, k = 0 → null)', () => {
    const raw: RawFlowUnit[] = [
      { top: 1000, base: 1000, h: 1, phi: 0, k: 50, phiH: 0, kH: 50 },
      { top: 1001, base: 1001, h: 1, phi: 0, k: 0, phiH: 0, kH: 0 },
      { top: 1002, base: 1002, h: 1, phi: 0.2, k: 50, phiH: 0.2, kH: 50 },
    ];
    const subs = smlpSubUnits(raw, [1, 2]);
    expect(subs[0]!.slope).toBe(Infinity);
    expect(subs[0]!.character).toBe('conduit');
    expect(subs[1]!.slope).toBeNaN();
    expect(subs[1]!.character).toBeNull();
    expect(subs[2]!.slope).toBeCloseTo(0.5, 12);
    expect(subs[2]!.character).toBe('subordinate');
    expect(subs.reduce((a, s) => a + s.phiHFrac, 0)).toBeCloseTo(1, 12);
    expect(subs.reduce((a, s) => a + s.kHFrac, 0)).toBeCloseTo(1, 12);
  });

  it('sanea quiebres duplicados, desordenados o fuera de rango y no muta las entradas', () => {
    expect(sanitizeSmlpBreaks([10, -1, 0, 5, 5, 2.5, NaN, Infinity, 3], 10)).toEqual([3, 5]);
    const raw: RawFlowUnit[] = [
      { top: 100, base: 100, h: 1, phi: 0.2, k: 100, phiH: 0.2, kH: 100 },
      { top: 101, base: 101, h: 1, phi: 0.2, k: 10, phiH: 0.2, kH: 10 },
      { top: 102, base: 102, h: 1, phi: 0.2, k: 50, phiH: 0.2, kH: 50 },
    ];
    const rawCopy = raw.map((u) => ({ ...u }));
    const breaks = [2, 0, 2, 1, 99];
    const breaksCopy = [...breaks];
    const subs = smlpSubUnits(raw, breaks);
    expect(subs).toHaveLength(3);
    expect(raw).toEqual(rawCopy);
    expect(breaks).toEqual(breaksCopy);
  });

  it('curvas simétricas en «S» (N = 3 y N = 302): no aborta en k = 2 y recupera los 2 quiebres exactos', () => {
    const mid = flowCapacity(
      layeredSamples([
        { count: 1, h: 1, phi: 0.2, k: 0 },
        { count: 1, h: 1, phi: 0.2, k: 100 },
        { count: 1, h: 1, phi: 0.2, k: 0 },
      ]),
    );
    const sugMid = suggestSmlpBreaks(mid.units, { maxSegments: 5, tolerance: 0.02 });
    expect(sugMid.breaks).toEqual([1, 2]);
    expect(sugMid.maxError).toBeCloseTo(0, 12);

    const ends = flowCapacity(
      layeredSamples([
        { count: 1, h: 1, phi: 0.2, k: 100 },
        { count: 1, h: 1, phi: 0.2, k: 0 },
        { count: 1, h: 1, phi: 0.2, k: 100 },
      ]),
    );
    expect(suggestSmlpBreaks(ends.units, { maxSegments: 5, tolerance: 0.02 }).breaks).toEqual([1, 2]);

    const longS = flowCapacity(
      layeredSamples([
        { count: 1, h: 1, phi: 0.2, k: 100 },
        { count: 300, h: 1, phi: 0.2, k: 0 },
        { count: 1, h: 1, phi: 0.2, k: 100 },
      ]),
    );
    const sugLong = suggestSmlpBreaks(longS.units, { maxSegments: 5, tolerance: 0.02 });
    expect(sugLong.breaks).toEqual([1, 301]);
    expect(sugLong.maxError).toBeCloseTo(0, 12);
    expect(sugLong.rmsError).toBeCloseTo(0, 12);
  });

  it('lorenzStratigraphic y suggestSmlpBreaks sanean Infinity y valores negativos en RawFlowUnit[] directos', () => {
    const infOnly: RawFlowUnit[] = [{ top: 100, base: 100, h: 1, phi: 0.2, k: 10, phiH: Infinity, kH: 10 }];
    expect(lorenzStratigraphic(infOnly)).toEqual([]);
    const sugInf = suggestSmlpBreaks(infOnly);
    expect(sugInf.breaks).toEqual([]);
    expect(sugInf.maxError).toBeNaN();
    expect(sugInf.rmsError).toBeNaN();

    const negK: RawFlowUnit[] = [
      { top: 100, base: 100, h: 1, phi: 0.2, k: -50, phiH: 0.2, kH: -50 },
      { top: 101, base: 101, h: 1, phi: 0.2, k: 100, phiH: 0.2, kH: 100 },
    ];
    const pts = lorenzStratigraphic(negK);
    expect(pts).toEqual([{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 1, y: 1 }]);
    const subs = smlpSubUnits(negK, [1]);
    expect(subs[0]!.kHFrac).toBe(0);
    expect(subs[1]!.kHFrac).toBe(1);
  });
});
