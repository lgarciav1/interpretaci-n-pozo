import { describe, expect, it } from 'vitest';
import csvText from '../datos/pozo_tp_perfiles.csv?raw';
import { readWellFile } from '../src/io';
import { Engine, toEngineWell } from '../src/core/engine/engine';
import { emptyInterpretation } from '../src/core/interpretation';
import { sampleThickness } from '../src/core/well';
import type { TableValue } from '../src/core/module';
import { registry } from '../src/modules';
import { SED_COLUMN_ID, SED_COLUMN_LAYERS, SED_COLUMN_SUMMARY } from '../src/modules/sed-column';
import { decodeSedLayers, decodeSedSummary } from '../src/modules/sed-column/model';

describe('Geo-5 integrada: mismo resultado del motor para panel y pista', () => {
  const { well, zones } = readWellFile(csvText, 'pozo_tp_perfiles.csv');
  const engine = new Engine(registry, { checkInputs: true }); engine.setWell(toEngineWell(well));
  const result = engine.run(emptyInterpretation(zones));
  const table = (port: string) => result.outputs.find(o => o.moduleId === SED_COLUMN_ID && o.port === port)?.value as TableValue | undefined;
  it('publica capas finitas y sumario del pozo y cinco zonas, con conservación de espesor por muestra', () => {
    const layers = decodeSedLayers(table(SED_COLUMN_LAYERS)), summary = decodeSedSummary(table(SED_COLUMN_SUMMARY));
    expect(layers.length).toBeGreaterThan(0); expect(summary).toHaveLength(8 * 6);
    expect(layers.every(l => Object.values(l).every(v => typeof v !== 'number' || Number.isFinite(v)))).toBe(true);
    const h = sampleThickness(well.depth.values);
    expect(layers.reduce((s, l) => s + l.thickness, 0)).toBeCloseTo(h.reduce((s, v) => s + v, 0), 7);
    for (const z of zones) {
      const expected = Array.from(h).reduce((s, v, i) => s + (well.depth.values[i]! >= z.top && well.depth.values[i]! <= z.base ? v : 0), 0);
      expect(summary.filter(r => r.zoneId === z.id).reduce((s, r) => s + r.thickness, 0)).toBeCloseTo(expected, 7);
    }
    expect(result.diagnostics.filter(d => d.level === 'error' && d.moduleId === SED_COLUMN_ID)).toEqual([]);
  });
  it('modificar el corte o el mínimo recalcula las tablas sin mutar entradas', () => {
    const interpretation = emptyInterpretation(zones);
    const changed = engine.run({ ...interpretation, params: { global: { 'sed-column.sedClayThreshold': .15, 'sed-column.sedSiltThreshold': .1, 'sed-column.sedMinThickness': 1 }, zones: {} } });
    expect(changed.outputs.find(o => o.moduleId === SED_COLUMN_ID && o.port === SED_COLUMN_LAYERS)!.value).not.toEqual(table(SED_COLUMN_LAYERS));
    expect(changed.diagnostics.filter(d => d.level === 'error')).toEqual([]);
  });
  it('el decodificador rechaza geometría inválida o clases desconocidas', () => {
    expect(decodeSedLayers({ rows: [{ top: 1, base: 0, width: .5, lithology: 'sandstone', grain: 'fine' }, { top: 1, base: 2, width: NaN, lithology: 'fake', grain: 'fine' }] })).toEqual([]);
  });
});
