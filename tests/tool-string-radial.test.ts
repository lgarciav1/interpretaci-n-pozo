import { describe, expect, it } from 'vitest';
import tpCsv from '../datos/pozo_tp_perfiles.csv?raw';
import { radialBands, type RadialLog } from '../src/app/toolString/radialProfile';
import { buildToolStringScene } from '../src/app/toolString/scene';
import { wellRadialLog } from '../src/app/toolString/wellColumn';
import { engineContext } from '../src/core/engine/context';
import type { ClientResult } from '../src/core/engine/client';
import { Engine, toEngineWell } from '../src/core/engine/engine';
import { emptyInterpretation } from '../src/core/interpretation';
import { readWellFile } from '../src/io';
import { registry } from '../src/modules';
import { THEMES } from '../src/ui/tokens';
import { invertStepProfileInto } from '../src/petro/invasion';

const array = (...values: number[]) => Float64Array.from(values);
const nominalWall = 10.795; // BS 8,5 in → radio de pared 10,795 cm.
function bandAt(log: RadialLog, md: number) {
  const bands = radialBands(log, { top: md - 0.1, base: md + 0.1 }, nominalWall);
  const hit = bands.filter(b => b.top <= md && md < b.base);
  expect(hit, `cobertura única a ${md} m`).toHaveLength(1);
  return hit[0]!;
}

describe('F24 · radios independientes y cobertura por MD', () => {
  const depth = array(100, 101, 102);
  const cal = array(10, 10, 10);
  const di = array(20, 20, 20);
  const rxo = array(0.9, 0.8, 0.7);
  it.each([
    { cal, di, measured: true, wall: 12.7, invasion: 25.4 },
    { cal, di: undefined, measured: true, wall: 12.7, invasion: null },
    { cal: undefined, di, measured: false, wall: nominalWall, invasion: 25.4 },
    { cal: undefined, di: undefined, measured: false, wall: nominalWall, invasion: null },
  ])('muestra con pared medida $measured, frente a $invasion cm', ({cal, di, measured, wall, invasion}) => {
    const sample = bandAt({ depth, step: 1, ...(cal && { cal }), ...(di && { di }), rxo }, 101);
    expect(sample.wall).toBeCloseTo(wall, 10);
    expect(sample.measured).toBe(measured);
    if (invasion === null) expect(sample.invasion).toBeNull();
    else expect(sample.invasion).toBeCloseTo(invasion, 10);
    expect(sample.rxo).toBe(di ? 0.8 : null);
  });

  it('resuelve cada hueco por separado y no extiende los vecinos a través de un salto de MD', () => {
    const log: RadialLog = {
      depth: array(100, 101, 102, 110, 111), step: 1,
      cal: array(10, NaN, 12, 14, 10), di: array(20, 20, NaN, 20, 20), rxo: array(1, 2, 3, NaN, 5),
    };
    expect(bandAt(log, 101)).toMatchObject({ measured: false, wall: nominalWall, invasion: 25.4, rxo: 2 });
    expect(bandAt(log, 102)).toMatchObject({ measured: true, invasion: null, rxo: null });
    expect(bandAt(log, 106)).toMatchObject({ measured: false, invasion: null, rxo: null });
    expect(bandAt(log, 110)).toMatchObject({ measured: true, invasion: 25.4, rxo: null });
    expect(bandAt(log, 110).wall).toBeCloseTo(17.78, 10);
  });

  it('rechaza DI dentro de la pared local del derrumbe o coincidente con ella', () => {
    const log: RadialLog = { depth: array(100, 101, 102, 103), step: 1,
      cal: array(8, 14, 12, 8), di: array(12, 12, 12, 12), rxo: array(0.9, 0.8, 0.7, 0.6) };
    expect(bandAt(log, 100)).toMatchObject({ incompatible: false, rxo: 0.9 });
    for (const md of [101, 102]) {
      expect(bandAt(log, md)).toMatchObject({ measured: true, invasion: null, rxo: null, incompatible: true });
    }
  });
});

describe('F24 · geometría con datos del pozo del TP', () => {
  const [header, ...rows] = tpCsv.trim().split(/\r?\n/).map(line => line.split(','));
  const column = (name: string) => {
    const ix = header!.indexOf(name);
    return Float64Array.from(rows, row => row[ix] ? Number(row[ix]) : NaN);
  };
  const depth = column('DEPTH');
  const out = { di: new Float64Array(depth.length), rxo: new Float64Array(depth.length),
    rt: new Float64Array(depth.length), misfit: new Float64Array(depth.length) };
  invertStepProfileInto([10, 30, 60, 90].map(r50 => ({ r50, data: column('AT' + r50) })), out, { bitSizes: column('BS') });
  const log = { depth, step: 0.1524, cal: column('CAL'), di: out.di, rxo: out.rxo };

  it('la pared se ensancha de 8,520 a 12,960 pulgadas y conserva el respaldo de invasión local', () => {
    const stable = bandAt(log, 7695.2856);
    const washout = bandAt(log, 7708.392);
    expect(stable.wall).toBeCloseTo(10.8204, 6);
    expect(washout.wall).toBeCloseTo(16.4592, 6);
    for (const sample of [stable, washout]) expect(sample).toMatchObject({ measured: true, invasion: null });
  });

  it('ubica el frente de invasión del TP desde el eje y lee RXO en la misma muestra', () => {
    // MD 8089,392 m: CAL 8,137 in, DI 30,0929553 in, RXO 6,7950651 Ω·m.
    const sample = bandAt(log, 8089.392);
    expect(sample.wall).toBeCloseTo(10.33399, 6);
    expect(sample.invasion).toBeCloseTo(38.218053, 5);
    expect(sample.rxo).toBeCloseTo(6.7950651, 6);
  });
});


it('selecciona el calibre medido elegido en cm y las salidas del ajuste, aunque RXO medida gane en el motor', () => {
  // Dos muestras reales, alrededor de la lectura con DI y RXO publicados.
  const lines = tpCsv.trim().split(/\r?\n/);
  const first = lines.findIndex(line => line.startsWith('8089.392,'));
  const { well } = readWellFile([lines[0], ...lines.slice(first, first + 2)].join('\n'), 'tramo.csv');
  const cal = well.curves.find(c => c.role === 'CALI')!;
  well.curves.push(
    { ...cal, id: 'segundo-calibre', unit: 'cm', data: array(25.4, 30.48) },
    { ...cal, id: 'micro', role: 'RXO', unit: 'ohm.m', data: array(99, 99) },
  );
  const interpretation = emptyInterpretation();
  interpretation.sources.CALI = { kind: 'curve', curveId: 'segundo-calibre' };
  const engine = new Engine(registry, { targetModuleIds: ['invasion-step'] });
  const input = toEngineWell(well);
  engine.setWell(input);
  const result: ClientResult = { ...engine.run(interpretation), context: engineContext(input, interpretation),
    seq: 1, wellId: well.id, gen: 1, coalesced: 0, roundTripMs: 0 };
  expect(result.sources.RXO).toEqual({ kind: 'curve', curveId: 'micro' });
  const log = wellRadialLog(well, interpretation, result);
  expect(log.cal![0]).toBeCloseTo(10, 9);
  // La preferencia guardada puede estar suspendida. La escena sigue la fuente vigente.
  const suspended = { ...interpretation, sources: { CALI: { kind: 'curve' as const, curveId: 'suspendida' } } };
  expect(wellRadialLog(well, suspended, result).cal![0]).toBeCloseTo(10, 9);
  expect(log.di![0]).toBeCloseTo(30.0929553, 6);
  expect(log.rxo![0]).toBeCloseTo(6.7950651, 6);
  expect(well.curves.find(c => c.id === 'segundo-calibre')!.data[0]).toBe(25.4);
  const foreign = wellRadialLog({ ...well, id: 'otro-pozo' }, interpretation, result);
  expect(foreign.di).toBeUndefined();
  expect(foreign.rxo).toBeUndefined();
});

it('traslada la ventana con el navegador de profundidad aunque falten GR y facies', () => {
  const depth = Float64Array.from({ length: 101 }, (_, i) => 1000 + i);
  const log: RadialLog = { depth, step: 1, cal: depth.map(md => md < 1050 ? 8 : 16), di: depth.map(() => 40) };
  const scene = (center: number) => buildToolStringScene({
    entries: [], mode: 'data', borehole: { diameterIn: 8.5, schematic: true },
    colors: THEMES.light.scene, accent: '#000', curveColor: () => '#000', radial: { center, log },
  });
  for (const [center, expectedWall] of [[1020, 10.16], [1080, 20.32]]) {
    const { environment, ruler } = scene(center);
    expect(environment.source).toBe('neutral');
    expect((environment.depth!.top + environment.depth!.base) / 2).toBeCloseTo(center, 9);
    expect(ruler.rWall).toBeCloseTo(expectedWall, 9);
    expect(environment.radial!.every(band => band.measured && band.invasion === 50.8)).toBe(true);
    expect(environment.rOuter).toBeGreaterThan(50.8);
  }
});
