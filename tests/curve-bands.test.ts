import { expect, it } from 'vitest';
import csv from '../datos/pozo_tp_perfiles.csv?raw';
import { bandSettings } from "../src/app/curveBands/settings";
import { activeOutput, computeOnce } from '../src/core/engine/engine';
import { emptyInterpretation } from '../src/core/interpretation';
import { readWellFile } from '../src/io';
import { registry } from '../src/modules';
import { SHARED_PARAMS } from '../src/modules/sharedParams';
import { BAND_ROLES, curveBand } from '../src/petro/curveBands';
import { fixedDist, type Dist } from '../src/petro/uncertainty';

it.each([
  ['uniform', 0.92, 1.08],
  ['triangular', 0.9447213595500042, 1.0552786404499958],
  ['normal', 0.9574859258844141, 1.0425140741155858],
] as const)('propaga los cuantiles de referencia de la distribución %s', (kind, low, high) => {
  const { p90, p10 } = curveBand({ values: Float64Array.of(0.4, 0.99, NaN, Infinity, -0.1), multiplier: {
    kind, min: 0.9, mode: 1, max: 1.1,
  } });
  expect(p90[0]).toBeCloseTo(0.4 * low, 9);
  expect(p10[0]).toBeCloseTo(0.4 * high, 9);
  expect(p90[1]).toBeCloseTo(0.99 * low, 9);
  expect(p10[1]).toBe(1);
  expect(Array.from(p90.slice(2))).toEqual([NaN, NaN, 0]);
  expect(Array.from(p10.slice(2))).toEqual([NaN, NaN, 0]);
});

it('colapsa a la curva original con multiplicador fijo en uno', () => {
  const values = Float64Array.of(0, 0.3, 1, 1.2, -0.1, NaN);
  expect(curveBand({ values, multiplier: fixedDist(1) })).toEqual({ p90: values, p10: values });
});

it('propaga SW y PHIE del TP y encuentra una corrida que cruza el cutoff de Sw', () => {
  const { well, zones } = readWellFile(csv, 'pozo_tp_perfiles.csv');
  const result = computeOnce(registry, { id: well.id, depth: well.depth.values, curves: well.curves }, emptyInterpretation(zones));
  const multiplier: Dist = { kind: 'triangular', min: 0.9, mode: 1, max: 1.1 };
  const low = 0.9 + Math.sqrt(0.1 * 0.2 * 0.1);
  const high = 1.1 - Math.sqrt(0.1 * 0.2 * 0.1);
  const cutoff = SHARED_PARAMS.swCutoff.default;
  for (const role of BAND_ROLES) {
    const values = activeOutput(result.outputs, role)?.value;
    expect(values).toBeInstanceOf(Float64Array);
    if (!(values instanceof Float64Array)) throw Error(role);
    const band = curveBand({ values, multiplier });
    expect(values.length).toBe(5810);
    let finite = 0;
    let widestCrossing = 0;
    let crossing = 0;
    for (const [i, value] of values.entries()) {
      if (!Number.isFinite(value)) {
        expect(band.p90[i]).toBeNaN();
        expect(band.p10[i]).toBeNaN();
        crossing = 0;
        continue;
      }
      finite++;
      expect(band.p90[i]).toBeCloseTo(Math.max(0, Math.min(1, value * low)), 12);
      expect(band.p10[i]).toBeCloseTo(Math.max(0, Math.min(1, value * high)), 12);
      crossing = band.p90[i]! < cutoff && cutoff < band.p10[i]! ? crossing + 1 : 0;
      widestCrossing = Math.max(widestCrossing, crossing);
    }
    expect(finite).toBeGreaterThan(5500);
    if (role === 'SW') expect(widestCrossing).toBeGreaterThan(1);
  }
});

it('usa límites válidos para los valores cargados fuera del rango de los controles', () => {
  const settings = bandSettings({ global: {
    'uncertainty.distribution': 'uniform',
    'uncertainty.phiLow': 1.3,
    'uncertainty.phiHigh': 0.9,
    'uncertainty.swLow': 1,
    'uncertainty.swHigh': 1,
  }, zones: {} });
  expect(settings).toEqual({ distribution: 'uniform', phiLow: 0.9, phiHigh: 1.1, swLow: 1, swHigh: 1 });
});
