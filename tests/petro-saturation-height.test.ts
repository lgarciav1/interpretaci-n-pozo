import { describe, expect, it } from 'vitest';
import { EXAMPLE_PC_CLASSES } from '../src/petro/rockTyping';
import {
  capillaryTransferFactor,
  compareExternalFwl,
  fitPressurePair,
  heightAboveFwl,
  saturationAtHeight,
  transferCapillaryModel,
  validateCapillaryModel,
} from '../src/petro/saturationHeight';
import type { CapillaryModel, PressureTest } from '../src/petro/saturationHeight';

const water: PressureTest[] = [
  { id: 'w1', depthM: 8010, pressurePa: 30_100_000 },
  { id: 'w2', depthM: 8020, pressurePa: 30_200_000 },
  { id: 'w3', depthM: 8030, pressurePa: 30_300_000 },
];

const oil: PressureTest[] = [
  { id: 'o1', depthM: 7970, pressurePa: 29_760_000 },
  { id: 'o2', depthM: 7980, pressurePa: 29_840_000 },
  { id: 'o3', depthM: 7990, pressurePa: 29_920_000 },
];

const interval = [7970, 8030] as const;
const brooksCorey: CapillaryModel = {
  kind: 'brooks-corey',
  entryPressurePa: 20_000,
  lambda: 2,
  irreducibleSw: 0.2,
  rangePa: [0, 100_000],
  entryPlateau: true,
};

describe('F21: gradientes en TVD, FWL e hipótesis de equilibrio', () => {
  it('recupera el FWL y Brooks–Corey del caso a mano del ADR 0079', () => {
    const pair = fitPressurePair(water, oil, interval);
    expect(pair.ok).toBe(true);
    if (!pair.ok) throw new Error(pair.reason);
    expect(pair.classicFwlM).toBe(8000);
    expect(pair.fwlSensitivityM).toEqual([8000, 8000]);
    expect(pair.deltaGradientSensitivityPaPerM).toEqual([2000, 2000]);
    expect(pair.deltaGradientPaPerM).toBe(2000);
    expect(pair.water.gradientPaPerM).toBe(10_000);
    expect(pair.hydrocarbon.gradientPaPerM).toBe(8000);
    expect(pair.water.densityKgPerM3).toBeCloseTo(1019.716, 3);
    expect(pair.hydrocarbon.densityKgPerM3).toBeCloseTo(815.773, 3);
    expect(pair.water.residualsPa).toEqual([0, 0, 0]);
    expect(pair.hydrocarbon.residualsPa).toEqual([0, 0, 0]);
    expect(pair.hydrocarbon.rangeM).toEqual([7970, 7990]);

    const depthsM = [8005, 8000, 7995, 7990, 7980, 7960];
    const heightsM = depthsM.map((depth) => heightAboveFwl(depth, pair.classicFwlM)!);
    expect(heightsM).toEqual([-5, 0, 5, 10, 20, 40]);
    expect(heightsM.map((height) => saturationAtHeight(height, pair.deltaGradientPaPerM, brooksCorey)))
      .toEqual([null, 1, 1, 1, 0.4, 0.25]);
  });

  it('conserva alturas y gradientes ante cambios comunes de datum y de referencia de presión', () => {
    const shift = (points: PressureTest[]) => points.map((point) => ({
      ...point,
      depthM: point.depthM - 8200,
      pressurePa: point.pressurePa + 100_000,
    }));
    const pair = fitPressurePair(shift(water), shift(oil), [-230, -170]);
    expect(pair.ok).toBe(true);
    if (!pair.ok) throw new Error(pair.reason);
    expect(pair.classicFwlM).toBe(-200);
    expect(pair.water.gradientPaPerM).toBe(10_000);
    expect(heightAboveFwl(-220, pair.classicFwlM)).toBe(20);
    expect(heightAboveFwl(NaN, pair.classicFwlM)).toBeNull();
  });

  it('reporta la presión residual con el signo P_hc menos P_agua para un FWL externo', () => {
    const pair = fitPressurePair(water, oil, interval);
    expect(pair.ok).toBe(true);
    if (!pair.ok) throw new Error(pair.reason);
    expect(compareExternalFwl(pair, 8001, 2000)).toEqual({ ok: true, residualPa: -2000 });
    expect(compareExternalFwl(pair, 7999, 1999)).toMatchObject({ ok: false, residualPa: 2000 });
    expect(compareExternalFwl(pair, 8000, NaN).ok).toBe(false);
  });

  it('bloquea pendientes paralelas, invertidas y casos sensibles a una sola prueba', () => {
    const parallel = oil.map((point) => ({ ...point, pressurePa: point.pressurePa + 2000 * (point.depthM - 8000) }));
    expect(fitPressurePair(water, parallel, interval).ok).toBe(false);
    expect(fitPressurePair(oil, water, interval).ok).toBe(false);
    const influential = water.map((point, i) => ({ ...point, pressurePa: point.pressurePa + [0, 10_000, -15_000][i]! }));
    expect(fitPressurePair(influential, oil, interval)).toMatchObject({ ok: false, reason: expect.stringContaining('w1') });
    const shifted = oil.map((point) => ({ ...point, pressurePa: point.pressurePa + 100_000 }));
    expect(fitPressurePair(water, shifted, interval).ok).toBe(false);
  });

  it('rechaza profundidades sin soporte, pruebas compartidas y valores no finitos', () => {
    expect(fitPressurePair(water.slice(0, 2), oil, interval).ok).toBe(false);
    expect(fitPressurePair(water.map((p) => ({ ...p, depthM: 8000 })), oil, interval).ok).toBe(false);
    expect(fitPressurePair(water, [{ ...oil[0]!, id: 'w1' }, ...oil.slice(1)], interval).ok).toBe(false);
    expect(fitPressurePair(water, [{ ...oil[0]!, pressurePa: Infinity }, ...oil.slice(1)], interval).ok).toBe(false);
  });
});

describe('F21: transferencia capilar y dominios', () => {
  const source = { tensionNPerM: 0.060, angleDeg: 0, angleUncertaintyDeg: 1 };
  const destination = { tensionNPerM: 0.030, angleDeg: 0, angleUncertaintyDeg: 1 };

  it('transforma 40 kPa a 20 kPa en la misma roca y a 10 kPa con transferencia J', () => {
    const simple = capillaryTransferFactor(source, destination, 0.02);
    expect(simple).toMatchObject({ ok: true, factor: 0.5 });
    const geometry = {
      source: { permeabilityMd: 100, porosity: 0.2 },
      destination: { permeabilityMd: 400, porosity: 0.2 },
    };
    const transferred = capillaryTransferFactor(source, destination, 0.02, geometry);
    expect(transferred.ok).toBe(true);
    if (!transferred.ok) throw new Error(transferred.reason);
    expect(40_000 * transferred.factor).toBeCloseTo(10_000, 10);
    expect(transferCapillaryModel(brooksCorey, transferred.factor))
      .toMatchObject({ entryPressurePa: 5000, rangePa: [0, 25_000] });
    expect(brooksCorey.entryPressurePa).toBe(20_000);
  });

  it('reproduce la clase A ilustrativa según los cálculos independientes del ADR', () => {
    const example = EXAMPLE_PC_CLASSES.find((entry) => entry.id === 'A')!;
    expect(example.bookExample).toBe(true);
    expect(Math.abs(example.pd / 5.36829967683 - 1)).toBeLessThan(1e-5);
    expect(example.pd).toBeCloseTo(5.368272090747, 10);
    const transfer = capillaryTransferFactor(
      { tensionNPerM: 0.48, angleDeg: 140, angleUncertaintyDeg: 1 },
      destination,
      0.02,
    );
    expect(transfer.ok).toBe(true);
    if (!transfer.ok) throw new Error(transfer.reason);
    const model = transferCapillaryModel({
      kind: 'brooks-corey',
      entryPressurePa: example.pd * 6894.757293168,
      lambda: example.lambda,
      irreducibleSw: example.swirr,
      rangePa: [0, 200_000],
      entryPlateau: true,
    }, transfer.factor);
    if (!model || model.kind !== 'brooks-corey') throw new Error('Ejemplo inválido');
    expect(model.entryPressurePa).toBeCloseTo(3019.80954573, 6);
    const entryHeightM = model.entryPressurePa / 2000;
    expect(entryHeightM).toBeCloseTo(1.50990477286, 10);
    expect(saturationAtHeight(entryHeightM, 2000, model)).toBeCloseTo(1, 12);
    expect(saturationAtHeight(entryHeightM * 2, 2000, model)).toBeCloseTo(0.195, 12);
    expect(saturationAtHeight(entryHeightM * 4, 2000, model)).toBeCloseTo(0.094375, 12);
  });

  it('bloquea incertidumbre angular que toca 90°, exceso de incertidumbre y geometría inválida', () => {
    for (const angleDeg of [89, 90, 91]) {
      expect(capillaryTransferFactor({ ...source, angleDeg }, destination, 0.1).ok).toBe(false);
    }
    expect(capillaryTransferFactor({ ...source, angleUncertaintyDeg: 0 }, destination, 0.1).ok).toBe(false);
    expect(capillaryTransferFactor(source, { ...destination, angleDeg: 85 }, 0.1).ok).toBe(false);
    expect(capillaryTransferFactor(source, { ...destination, tensionNPerM: 0 }, 0.1).ok).toBe(false);
    expect(capillaryTransferFactor(source, destination, 0.02, {
      source: { permeabilityMd: 100, porosity: 0.2 },
      destination: { permeabilityMd: 400, porosity: 0 },
    }).ok).toBe(false);
  });

  it('interpola una tabla sin extrapolar ni ordenar originales inválidos', () => {
    const points = [{ pressurePa: 10_000, sw: 0.9 }, { pressurePa: 20_000, sw: 0.5 }, { pressurePa: 30_000, sw: 0.4 }];
    const model: CapillaryModel = { kind: 'table', points };
    expect(saturationAtHeight(4, 2000, model)).toBeNull();
    expect(saturationAtHeight(5, 2000, model)).toBeCloseTo(0.9, 12);
    expect(saturationAtHeight(7.5, 2000, model)).toBeCloseTo(0.7, 12);
    expect(saturationAtHeight(15, 2000, model)).toBeCloseTo(0.4, 12);
    expect(saturationAtHeight(15.01, 2000, model)).toBeNull();
    for (const invalid of [
      [{ pressurePa: -1, sw: 1 }, points[1]!],
      [points[0]!, { pressurePa: 10_000, sw: 0.5 }],
      [points[2]!, points[1]!],
      [points[0]!, { pressurePa: 20_000, sw: 1 }],
      [points[0]!, { pressurePa: 20_000, sw: Infinity }],
    ]) expect(validateCapillaryModel({ kind: 'table', points: invalid })).toBe(false);
  });

  it('restringe la meseta a cuando está autorizada y excluye altura negativa y presión no finita', () => {
    const model = { ...brooksCorey, entryPlateau: false };
    expect(saturationAtHeight(5, 2000, model)).toBeNull();
    expect(saturationAtHeight(10, 2000, model)).toBe(1);
    expect(saturationAtHeight(51, 2000, model)).toBeNull();
    expect(saturationAtHeight(1, 0, model)).toBeNull();
    expect(saturationAtHeight(Infinity, 2000, model)).toBeNull();
    expect(saturationAtHeight(-0.1, 2000, brooksCorey)).toBeNull();
    expect(validateCapillaryModel({ ...brooksCorey, entryPressurePa: 0 })).toBe(false);
    expect(validateCapillaryModel({ ...brooksCorey, lambda: Infinity })).toBe(false);
  });
});

it('conserva los extremos de una tabla tras convertir Pc a altura y viceversa', () => {
  const model = { kind: 'table' as const, points: [{ pressurePa: 8009, sw: 1 }, { pressurePa: 16018, sw: 0.5 }] };
  expect(saturationAtHeight(8009 / 1001, 1001, model)).toBe(1);
  expect(saturationAtHeight(16018 / 1001, 1001, model)).toBe(0.5);
  expect(saturationAtHeight(8008 / 1001, 1001, model)).toBeNull();
});
