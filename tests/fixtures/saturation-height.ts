import { createPointSet } from '../../src/core/pointSets';
import { addWell, createProject, setParam, setSource } from '../../src/core/state/project';
import { addPointSet } from '../../src/core/state/pointSets';
import { addTrend } from '../../src/core/state/trends';
import { createWell } from '../../src/core/well';
import { MDT_PROVIDER_ID, mdtSeriesKey } from '../../src/modules/mdt/model';
import type { HeightScenario } from '../../src/modules/saturation-height/scenario';
import { curve, depthRange, zone } from '../helpers';

export const saturationHeightWellId = 'w21';
const id = saturationHeightWellId;

export function saturationHeightFixture() {
  const depth = depthRange(101, 7950, 1);
  const well = createWell({
    id, name: 'Caso conocido', depth,
    curves: [
      { ...curve('SW_LOG', 'SW', depth.map(z => z >= 7990 ? 100 : 100 * (0.2 + 0.8 * (10 / (8000 - z)) ** 2)), '%'), origin: { kind: 'measured' } },
      { ...curve('PHIE', 'PHIE', depth.map(() => 0.2)), origin: { kind: 'measured' } },
      { ...curve('K', 'PERM', depth.map(() => 4)), origin: { kind: 'measured' } },
      { ...curve('TVD', null, depth.map(z => z - 50), 'm'), origin: { kind: 'measured' } },
    ],
  });
  let p = addWell(createProject(), well, [zone('upper', 7950, 7999), zone('lower', 8000, 8050)]);
  p = setSource(p, id, 'SW', { kind: 'curve', curveId: 'SW_LOG' });
  p = setSource(p, id, 'PHIE', { kind: 'curve', curveId: 'PHIE' });
  p = setSource(p, id, 'PERM', { kind: 'curve', curveId: 'K' });
  p = setParam(p, id, 'rock-typing.method', 'winland');
  p = addPointSet(p, id, createPointSet({
    id: 'fixture-mdt', name: 'Presiones de verificación', kind: 'pressure',
    depth: Float64Array.of(7970, 7980, 7990, 8010, 8020, 8030),
    pointIds: ['O1', 'O2', 'O3', 'W1', 'W2', 'W3'],
    columns: { pressure: { label: 'P', unit: 'kPa', values: Float64Array.of(29760, 29840, 29920, 30100, 30200, 30300) } },
  }));
  for (const [fluid, xMin, xMax] of [['oil', 7970, 7990], ['water', 8010, 8030]] as const) {
    p = addTrend(p, id, { id: fluid, name: fluid, series: { provider: MDT_PROVIDER_ID, key: mdtSeriesKey('fixture-mdt', fluid) },
      visible: true, extend: true, model: 'linear', mode: 'fit', selection: { xMin, xMax, excluded: [] } });
  }
  const scenario: HeightScenario = {
    version: 1, datum: 'Datum de la prueba', geometry: { kind: 'vertical-md', maxMdTvdDriftM: 0, evidence: 'Caso exacto vertical' },
    domainM: [7950, 8050], phase: 'oil', compartment: 'Caso exacto', fwl: { kind: 'mdt' },
    mdt: { waterId: 'water', hydrocarbonId: 'oil', review: 'Pruebas exactas de entrada', pressureBasis: 'Presión absoluta común' },
    classification: { method: 'winland', bounds: [] }, classes: [],
  };
  return { p, scenario };
}

export const saturationHeightLab = {
  version: 1, reference: 'Tabla sintética de verificación', pressureUnit: 'kPa', saturationUnit: '%',
  rows: [
    { sample: 'plug-1', mdM: 7980, pc: 20, sw: 100 },
    { sample: 'plug-1', mdM: 7980, pc: 40, sw: 40 },
    { sample: 'plug-1', mdM: 7980, pc: 80, sw: 25 },
  ],
};
