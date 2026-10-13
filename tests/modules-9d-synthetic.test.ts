/** Contrato y salida del módulo acústico; exportaciones conservan el eje correcto y los huecos. */
import { describe, expect, it } from 'vitest';
import { Engine } from '../src/core/engine/engine';
import { createRegistry } from '../src/core/registry';
import { emptyInterpretation } from '../src/core/interpretation';
import { createWell } from '../src/core/well';
import synthetic from '../src/modules/synthetic-seismogram';
import { syntheticCsv, syntheticLas } from '../src/modules/synthetic-seismogram/export';
import { drawWiggle } from '../src/modules/synthetic-seismogram/draw';
import { SvgContext2D, approximateMeasure } from '../src/io/export/figures';
import { curve, well } from './helpers';

const syntheticRegistry = () => createRegistry([synthetic]);
const makeRun = (dt: number[], rho: number[]) => {
  const engine = new Engine(syntheticRegistry(), { checkInputs: true });
  engine.setWell(well([curve('DT', 'DT', dt), curve('RHOB', 'RHOB', rho)], dt.length, 1000, 10));
  return engine.run(emptyInterpretation());
};
const output = (result: ReturnType<typeof makeRun>, port: string) => result.outputs.find(output => output.key === `synthetic-seismogram:${port}`)?.value as Float64Array;

describe('módulo sintético', () => {
  it('declara los cinco roles físicos y parámetros globales', () => {
    const registry = syntheticRegistry();
    expect(registry.warnings).toEqual([]);
    expect(registry.roles.unitOf('AI')).toBe('MRayl');
    expect(registry.roles.unitOf('VELOCITY')).toBe('m/s');
    expect(registry.roles.unitOf('TWT')).toBe('ms');
    expect(synthetic.workspace).toBe('geology');
    expect(Object.values(synthetic.params).every(parameter => parameter.scope !== 'zone')).toBe(true);
  });

  it('un medio uniforme publica velocidad/impedancia conocidas y traza nula', () => {
    // V=304800/60=5080 m/s; AI=2.5*5080/1000=12.7 MRayl.
    const result = makeRun(new Array(20).fill(60), new Array(20).fill(2.5));
    expect(result.nodes.find(node => node.moduleId === synthetic.id)?.status).toBe('ok');
    for (const value of output(result, 'VELOCITY')) expect(value).toBeCloseTo(5080, 9);
    for (const value of output(result, 'AI')) expect(value).toBeCloseTo(12.7, 9);
    expect(Array.from(output(result, 'SYNTHETIC')).filter(Number.isFinite).every(value => Math.abs(value) < 1e-12)).toBe(true);
  });

  it('no prolonga el tiempo acumulado a través de la cola sin sónico', () => {
    const result = makeRun([60, 60, 60, NaN, NaN], [2.5, 2.5, 2.5, 2.5, 2.5]);
    expect(Number.isFinite(output(result, 'TWT')[2])).toBe(true);
    expect(Number.isNaN(output(result, 'TWT')[3])).toBe(true);
    expect(Number.isNaN(output(result, 'SYNTHETIC')[4])).toBe(true);
  });
});

describe('archivos y dibujo del sintético', () => {
  it('CSV temporal declara milisegundos y conserva huecos como celdas vacías', () => {
    const file = syntheticCsv('Pozo ejemplo', 'time', { rows: [{ time: 0, impedance: 12.7, reflectivity: 0, trace: 0 }, { time: 2, impedance: null, reflectivity: null, trace: null }] });
    const text = new TextDecoder().decode(file.bytes);
    expect(text).toContain('TWT_ms,AI_MRayl,RC,SYNTHETIC');
    expect(text).toContain('2,,,');
    expect(text).not.toContain('DEPTH');
  });

  it('LAS mantiene profundidad métrica y unidades físicas del sintético', () => {
    const depth = new Float64Array([1000, 1001, 1002]);
    const well = createWell({ id: 'w', name: 'Pozo ejemplo', depth, curves: [] });
    const values = new Float64Array([0, 0.1, NaN]);
    const file = syntheticLas(well, values, new Float64Array([0, 1, NaN]), new Float64Array([12, 12.7, NaN]), values);
    const text = new TextDecoder().decode(file.bytes);
    expect(text).toContain('TWT.ms');
    expect(text).toContain('AI.MRayl');
    expect(text).toContain('-999.25');
  });

  it('el wiggle corta el trazado al encontrar un hueco y rellena sólo amplitud positiva', () => {
    const ctx = new SvgContext2D({ width: 200, height: 100, measure: approximateMeasure });
    drawWiggle(ctx.asCanvas(), [0, 1, 2, 3, 4], [0, 1, NaN, -1, 0], { x: 0, width: 200, top: 0, base: 4, height: 100, yOf: value => value * 25 }, '#000000');
    const svg = ctx.toSvg('#ffffff');
    expect(svg).not.toMatch(/NaN|Infinity|undefined/);
    // Cuatro repeticiones y dos segmentos separados por hueco: cada trazo contiene otro moveTo.
    const paths = svg.match(/<path[^>]*d="[^"]*"/g) ?? [];
    expect(paths.filter(path => (path.match(/M/g) ?? []).length >= 2)).toHaveLength(4);
    expect(svg).toContain('fill-opacity="0.65"');
  });
});
