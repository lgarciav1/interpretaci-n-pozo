import { describe, expect, it } from 'vitest';
import csvText from '../datos/pozo_tp_perfiles.csv?raw';
import { readWellFile } from '../src/io';
import { buildSedColumn, classifySedSample, estimateSedGrain, SED_GRAIN_ORDER, type SedColumnInput } from '../src/petro/sedColumn';
import { sampleThickness } from '../src/core/well';

const f = (...v: number[]) => new Float64Array(v);
const depth = (n: number, step = .1) => Float64Array.from({ length: n }, (_, i) => 100 + i * step);
const mineral = (q: number, c: number, d: number, a: number) => ({ quartz: f(q), calcite: f(c), dolomite: f(d), clay: f(a) });
describe('Columna sedimentológica: clasificación desde perfiles', () => {
  it('extremos minerales puros y desempate determinista', () => {
    expect(classifySedSample(mineral(1, 0, 0, 0), 0).lithology).toBe('sandstone');
    expect(classifySedSample(mineral(0, 1, 0, 0), 0).lithology).toBe('limestone');
    expect(classifySedSample(mineral(0, 0, 1, 0), 0).lithology).toBe('dolomite');
    expect(classifySedSample(mineral(.5, .5, 0, 0), 0).lithology).toBe('sandstone');
  });
  it('la arcilla manda estrictamente por encima del corte', () => {
    expect(classifySedSample(mineral(.55, 0, 0, .45), 0).lithology).toBe('sandstone');
    expect(classifySedSample(mineral(.54, 0, 0, .46), 0).lithology).toBe('shale');
    expect(classifySedSample(mineral(.6, 0, 0, .4), 0, { sedClayThreshold: .35 }).lithology).toBe('shale');
  });
  it('el carbón tiene prioridad y el Vsh intermedio no transforma carbonatos en limolita', () => {
    expect(classifySedSample({ ...mineral(0, 1, 0, 0), coal: f(1), vsh: f(.3) }, 0).lithology).toBe('coal');
    expect(classifySedSample({ ...mineral(0, 1, 0, 0), vsh: f(.3) }, 0).lithology).toBe('limestone');
    expect(classifySedSample({ ...mineral(1, 0, 0, 0), vsh: f(.3) }, 0).lithology).toBe('siltstone');
  });
  it('fallback con Vsh o GR; entradas parciales/negativas no se toman por inversión válida', () => {
    expect([.1, .3, .8].map(v => classifySedSample({ vsh: f(v) }, 0).lithology)).toEqual(['sandstone', 'siltstone', 'shale']);
    expect([25, 55, 125].map(v => classifySedSample({ gr: f(v) }, 0).lithology)).toEqual(['sandstone', 'siltstone', 'shale']);
    expect(classifySedSample({ quartz: f(1), calcite: f(NaN), vsh: f(.8) }, 0)).toMatchObject({ lithology: 'shale', source: 'vsh' });
    expect(classifySedSample({ ...mineral(-1, 1, 0, 0), gr: f(25) }, 0)).toMatchObject({ lithology: 'sandstone', source: 'gr' });
    expect(classifySedSample({}, 0)).toEqual({ lithology: 'unknown', source: 'unknown', vsh: null });
    expect(classifySedSample({ shale: f(1) }, 0).lithology).toBe('shale');
  });
  it('el grano y el ancho son monótonos al aumentar Vsh, sin usar corona', () => {
    const estimates = Array.from({ length: 101 }, (_, i) => estimateSedGrain(i / 100));
    for (let i = 1; i < estimates.length; i++) expect(estimates[i]!.width).toBeLessThanOrEqual(estimates[i - 1]!.width);
    expect(estimates[0]!.grain).toBe('coarse'); expect(estimates.at(-1)!.grain).toBe('clay');
    expect(estimateSedGrain(.3, 1, [{ depth: 5, diameterMm: 40 }])).toEqual(estimateSedGrain(.3));
    expect(estimateSedGrain(null)).toEqual({ grain: 'unknown', width: .12 });
  });
});
describe('Bloqueo sin pérdida de cobertura', () => {
  it('conserva una capa de carbón de 0,3 m con mínimo de 0,5 m', () => {
    const coal = new Float64Array(23); coal.fill(1, 10, 13);
    const layers = buildSedColumn({ depth: depth(23), vsh: new Float64Array(23).fill(.1), coal });
    const coalLayer = layers.find(l => l.lithology === 'coal')!;
    expect(coalLayer.thickness).toBeCloseTo(.3, 10); expect(coalLayer.belowMinimum).toBe(true);
    expect(layers.filter(l => l.lithology !== 'coal').every(l => l.thickness >= .5 - 1e-9)).toBe(true);
  });
  it('fusiona capas cortas y conserva la suma de espesores y el promedio ponderado', () => {
    const z = depth(40); const vsh = Float64Array.from({ length: 40 }, (_, i) => i % 8 === 0 ? .8 : .1);
    const input: SedColumnInput = { depth: z, vsh };
    const snapshot = Array.from(vsh);
    const layers = buildSedColumn(input);
    expect(layers.every(l => l.thickness >= .5 - 1e-9)).toBe(true);
    expect(layers.reduce((sum, l) => sum + l.thickness, 0)).toBeCloseTo(sampleThickness(z).reduce((a, b) => a + b, 0), 10);
    const mean = layers.reduce((s, l) => s + l.thickness * l.vsh!, 0) / layers.reduce((s, l) => s + l.thickness, 0);
    expect(mean).toBeCloseTo(vsh.reduce((s, v) => s + v, 0) / vsh.length, 10);
    expect(Array.from(vsh)).toEqual(snapshot);
  });
  it('no cruza huecos desconocidos, saltos de profundidad ni límites de zona; señala mínimos imposibles', () => {
    const unknown = buildSedColumn({ depth: depth(9), vsh: f(.1, .1, .1, NaN, NaN, NaN, .8, .8, .8) });
    expect(unknown.map(l => l.lithology)).toEqual(['sandstone', 'unknown', 'shale']);
    expect(unknown.every(l => l.belowMinimum)).toBe(true);
    const gap = buildSedColumn({ depth: f(0, .1, .2, 10, 10.1, 10.2), vsh: new Float64Array(6).fill(.1) });
    expect(gap).toHaveLength(2); expect(gap[0]!.base).toBeCloseTo(.25, 10); expect(gap[1]!.top).toBeCloseTo(9.95, 10);
    const zoned = buildSedColumn({ depth: depth(6), vsh: new Float64Array(6).fill(.1), zoneIds: ['a', 'a', 'a', 'b', 'b', 'b'] });
    expect(zoned.map(l => l.zoneId)).toEqual(['a', 'b']); expect(zoned.every(l => l.belowMinimum)).toBe(true);
  });
  it('muestra faltantes como null y nunca inventa volúmenes o grano', () => {
    const layers = buildSedColumn({ depth: depth(10) });
    expect(layers).toHaveLength(1); expect(layers[0]).toMatchObject({ lithology: 'unknown', grain: 'unknown', quartz: null, vsh: null });
    expect(Object.values(layers[0]!).some(v => typeof v === 'number' && !Number.isFinite(v))).toBe(false);
  });
  it('retiene variaciones de grano dentro de una litología homogénea sin crear capas finas', () => {
    const n = 50, constant = (v: number) => new Float64Array(n).fill(v);
    const vsh = Float64Array.from({ length: n }, (_, i) => i < 25 ? .05 : .8);
    const layers = buildSedColumn({ depth: depth(n), quartz: constant(0), calcite: constant(1), dolomite: constant(0), clay: constant(0), vsh });
    expect(layers).toHaveLength(2); expect(layers.every(l => l.lithology === 'limestone' && l.thickness >= .5)).toBe(true);
    expect(layers[0]!.width).toBeGreaterThan(layers[1]!.width);
    expect(layers.every(l => l.width === SED_GRAIN_ORDER.indexOf(l.grain) / 6)).toBe(true);
  });
  it('CSV completo del TP con GR fallback y sin NaN espurios', () => {
    const { well } = readWellFile(csvText, 'pozo_tp_perfiles.csv');
    const gr = well.curves.find(c => c.role === 'GR')!.data;
    const layers = buildSedColumn({ depth: well.depth.values, gr });
    expect(layers.length).toBeGreaterThan(1);
    expect(layers.every(l => l.lithology !== 'unknown' && l.source === 'gr')).toBe(true);
    expect(layers.every(l => Object.values(l).every(v => typeof v !== 'number' || Number.isFinite(v)))).toBe(true);
    expect(layers.reduce((s, l) => s + l.thickness, 0)).toBeCloseTo(sampleThickness(well.depth.values).reduce((s, h) => s + h, 0), 7);
  });
});
