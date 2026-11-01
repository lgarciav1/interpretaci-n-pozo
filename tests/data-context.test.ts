import { describe, expect, it } from 'vitest';
import { resolveDataContext, type PreparedArtifact } from '../src/core/preparation/projection';
import { calibrationKey, type CalibrationRequest } from '../src/core/preparation/calibrationContext';
import { preparedCurveId } from '../src/core/preparation/source';
import { createRegistry } from '../src/core/registry';
import { createWell, type Well } from '../src/core/well';
import { createPointSet } from '../src/core/pointSets';
import { Engine, toEngineWell } from '../src/core/engine/engine';
import { engineContext, sameComputation } from '../src/core/engine/context';
import { createInProcessClient, type ClientResult } from '../src/core/engine/client';
import { curve, interp, linearModule } from './helpers';
import { DEFAULT_TOOL_STRING, moduleAvailability, resolveToolString } from '../src/core/toolString';
import { resolveTracks, findCurve } from '../src/viewer/resolve';
import { plotContextOf } from '../src/app/plots/context';
import { curveSeriesProvider } from '../src/plots/trend/series';
import { buildExportColumns } from '../src/io/export/columns';
import { buildReportModel } from '../src/app/report/report';
import { serializeProject, deserializeProject } from '../src/core/state/serialize';
import { createProject, addWell } from '../src/core/state/project';
import { readWellFile } from '../src/io';
import tpText from '../datos/pozo_tp_perfiles.csv?raw';
import { registry as allModules } from '../src/modules';
import { input } from '../src/core/module';

const registry = createRegistry([linearModule('igr', 'GR', 'IGR'), linearModule('vsh', 'IGR', 'VSH')]);
const well = createWell({ id: 'w', name: 'Pozo', depth: Float64Array.of(10, 11, 12), curves: [
  { ...curve('GR', 'GR', [10, 20, 30]), origin: { kind: 'measured' } },
  { ...curve('CALI', 'CALI', [8, 9, 10]), origin: { kind: 'measured' } },
] });
const id = preparedCurveId('clean', 'GR');
const chosen = () => interp({ sources: { GR: { kind: 'curve', curveId: id } } });
function artifact(overrides: Partial<PreparedArtifact> = {}): PreparedArtifact {
  const data = resolveDataContext(well, interp(), registry, 'rev');
  return { id, mnemonic: 'GR limpio', role: 'GR', unit: 'gAPI', inputRevisionId: 'rev', depthKey: data.context.depthKey,
    recipeKey: 'mask@1:10-11', inputs: [{ curveId: 'GR', contentVersion: data.lineage.get('GR')!.contentVersion }],
    data: Float64Array.of(11, NaN, 33), quality: Uint16Array.of(0, 2, 0), ...overrides };
}
const run = (data: ReturnType<typeof resolveDataContext>, i = chosen()) => { const e = new Engine(registry, { checkInputs: true }); e.setWell(data.engineWell); return e.run(i); };

describe('proyección de datos', () => {
  it('sin preparación conserva referencias, contexto y resultados del TP completo', () => {
    const imported = readWellFile(tpText, 'TP.csv').well, i = interp();
    const data = resolveDataContext(imported, i, allModules);
    expect(data).toBe(resolveDataContext(imported, i, allModules));
    expect(data.well).toBe(imported); expect(data.eligible).toBe(imported.curves);
    expect(data.engineWell.curves).toBe(imported.curves);
    expect(data.context).toEqual(engineContext(toEngineWell(imported), i));
    const a = new Engine(allModules), b = new Engine(allModules);
    a.setWell(toEngineWell(imported)); b.setWell(data.engineWell);
    const scientific = (r: ReturnType<Engine['run']>) => ({ outputs: r.outputs, sources: r.sources, diagnostics: r.diagnostics, nodes: r.nodes.map(({ ms: _ms, ...n }) => n) });
    expect(scientific(b.run(i))).toEqual(scientific(a.run(i)));
  }, 30000);
  it('hereda herramientas y conserva arrays originales separados de artefactos y calidad', () => {
    const a = artifact(), data = resolveDataContext(well, chosen(), registry, 'rev', [a]);
    expect(data.well).not.toBe(well); expect(well.curves).toHaveLength(2);
    expect(data.well.curves[0]).toBe(well.curves[0]);
    expect(data.well.curves[2]!.data).toBe(a.data);
    expect(data.lineage.get(id)?.ancestorToolIds).toEqual(['gr']);
    expect(data.quality.get(id)).toBe(a.quality);
    expect(data.context.preparationKey).not.toBe('identity');
    expect(run(data).outputs.find(o => o.port === 'IGR')?.value).toEqual(a.data);
    expect(well.curves[0]!.data).toEqual(Float64Array.of(10, 20, 30));
  });
  it('no convierte una alternativa preparada en fuente por defecto', () => {
    const i = interp(), data = resolveDataContext(well, i, registry, 'rev', [artifact()]);
    expect(run(data, i).sources.GR).toEqual({ kind: 'curve', curveId: 'GR' });
    expect(run(data, i).outputs[0]?.value).toEqual(well.curves[0]!.data);
  });
  it('la misma receta/arrays mantiene contexto; valores, calidad y configuración lo cambian', () => {
    const a = artifact(), i = chosen(), initial = resolveDataContext(well, i, registry, 'rev', [a]);
    expect(resolveDataContext(well, i, registry, 'rev', [{ ...a }])).toBe(initial);
    for (const changed of [{ ...a, data: a.data.slice() }, { ...a, quality: a.quality.slice() }, { ...a, recipeKey: 'mask@2' }])
      expect(resolveDataContext(well, i, registry, 'rev', [changed]).context).not.toEqual(initial.context);
  });
  it('evalúa dependencias fuera de orden y acumula todas las herramientas sin inferirlas del rol de salida', () => {
    const a = artifact({ inputs: [...artifact().inputs, { curveId: 'CALI', contentVersion: resolveDataContext(well, interp(), registry, 'rev').lineage.get('CALI')!.contentVersion }] });
    const first = resolveDataContext(well, chosen(), registry, 'rev', [a]);
    const b = artifact({ id: 'prep:second:GR', inputs: [{ curveId: a.id, contentVersion: first.lineage.get(a.id)!.contentVersion }] });
    const both = resolveDataContext(well, chosen(), registry, 'rev', [b, a]);
    expect(both.lineage.get(b.id)?.ancestorToolIds).toEqual(['caliper', 'gr']);
    expect(both.well.curves.map(c => c.id)).toEqual(['GR', 'CALI', b.id, a.id]);
  });
  it.each([
    ['revisión', { inputRevisionId: 'otra' }], ['profundidad', { depthKey: 'otra' }],
    ['tamaño', { data: Float64Array.of(1) }], ['calidad', { quality: new Uint16Array(1) }],
    ['unidad', { unit: 'ohm.m' }], ['rol', { role: 'UNKNOWN' }], ['id', { id: 'GR' }],
    ['receta', { recipeKey: '' }], ['sin padres', { inputs: [] }],
    ['padre ausente', { inputs: [{ curveId: 'missing', contentVersion: 'x' }] }],
    ['padre obsoleto', { inputs: [{ curveId: 'GR', contentVersion: 'x' }] }],
    ['ciclo', { inputs: [{ curveId: id, contentVersion: 'x' }] }],
  ] as const)('rechaza %s antes de publicar y conserva originales', (_name, change) => {
    expect(() => resolveDataContext(well, chosen(), registry, 'rev', [artifact(change)])).toThrow();
    expect(well.curves).toHaveLength(2); expect(well.curves[0]!.data[0]).toBe(10);
  });
  it('rechaza duplicados, colisiones y preparación sin revisión', () => {
    const a = artifact();
    expect(() => resolveDataContext(well, chosen(), registry, 'rev', [a, a])).toThrow(/duplicado/);
    expect(() => resolveDataContext(well, chosen(), registry, null, [a])).toThrow(/revisión/);
    const collision: Well = { ...well, curves: [...well.curves, { ...well.curves[0]!, id }] };
    expect(() => resolveDataContext(collision, chosen(), registry, 'rev', [a])).toThrow(/duplicado/);
  });
  it('remapea ids reservados al importar y conserva el mnemónico original', () => {
    const imported = readWellFile('DEPT,prep:clean:GR\n10,12\n11,13', 'perfil.csv');
    expect(imported.well.curves[0]?.id).toBe('import:prep:clean:GR');
    expect(imported.well.curves[0]?.mnemonic).toBe('prep:clean:GR');
  });
  it('impide guardar la proyección como originales', async () => {
    const data = resolveDataContext(well, chosen(), registry, 'rev', [artifact()]);
    await expect(serializeProject(addWell(createProject(), data.well))).rejects.toThrow(/proyección/);
  });
  it.each(['origin', 'provenance'])('rechaza una proyección embebida (%s) al abrir v6 antes de activar el pozo', async field => {
    const file = JSON.parse(await serializeProject(addWell(createProject(), well)));
    const c = file.project.wells[0].well.curves[0];
    if (field === 'origin') c.origin = { kind: 'prepared' };
    else c.provenance = { origin: 'prepared' };
    await expect(deserializeProject(JSON.stringify(file))).rejects.toThrow(/proyección/);
  });
});

describe('selección preparada estricta y consumidores', () => {
  it('una selección preparada inválida bloquea también consumidores opcionales, con motivo visible', () => {
    const mod = { ...linearModule('optional', 'GR', 'VSH'), inputs: { x: input.optionalCurve('GR') } };
    const custom = createRegistry([mod]);
    const i = chosen(), data = resolveDataContext(well, i, custom);
    const engine = new Engine(custom); engine.setWell(data.engineWell);
    const result = engine.run(i);
    expect(result.nodes.find(n => n.moduleId === 'optional')?.status).toBe('blocked');
    expect(result.outputs).toHaveLength(0);
    const av = moduleAvailability(custom, well.curves, resolveToolString(well.curves, undefined, custom.tools), { sources: i.sources });
    expect(av.modules.get('optional')).toMatchObject({ status: 'unavailable', blockedPreparedPorts: ['GR'] });
  });
  it.each(['ohm.m', 'desconocida'])('una unidad preparada inválida (%s) bloquea sin elegir original', unit => {
    const data = resolveDataContext(well, chosen(), registry, 'rev', [artifact()]);
    const engine = new Engine(registry);
    engine.setWell({ ...data.engineWell, curves: data.engineWell.curves.map(c => c.id === id ? { ...c, unit } : c) });
    const result = engine.run(chosen());
    expect(result.sources.GR).toBeUndefined(); expect(result.outputs).toHaveLength(0);
  });
  it('conserva la selección legada de un original cuyo id usa el prefijo reservado', () => {
    const legacy = { ...well, curves: [{ ...well.curves[0]!, id }] };
    const data = resolveDataContext(legacy, chosen(), registry);
    expect(run(data).sources.GR).toEqual({ kind: 'curve', curveId: id });
    const off = { ...chosen(), toolString: { ...DEFAULT_TOOL_STRING, off: ['gr'] } };
    const result = run(resolveDataContext(legacy, off, registry), off);
    expect(result.diagnostics.some(d => d.message.includes('fuente por defecto'))).toBe(true);
  });
  it.each(['ausente', 'apagada', 'fuera del plan'] as const)('%s bloquea motor, disponibilidad y series sin fallback', mode => {
    const i = chosen(); i.compare = ['igr', 'vsh'];
    if (mode !== 'ausente') i.toolString = { ...DEFAULT_TOOL_STRING, ...(mode === 'apagada' ? { off: ['gr'] } : { mode: 'planning', plan: ['caliper'] }) };
    const data = resolveDataContext(well, i, registry, 'rev', mode === 'ausente' ? [] : [artifact()]);
    const r = run(data, i);
    expect(r.sources.GR).toBeUndefined(); expect(r.outputs).toHaveLength(0);
    expect(r.diagnostics.some(d => d.code === 'invalid-source' && d.message.includes('bloqueado'))).toBe(true);
    const av = moduleAvailability(registry, data.well.curves, resolveToolString(data.well.curves, i.toolString, registry.tools), { sources: i.sources });
    expect(av.modules.get('igr')?.status).toBe('unavailable'); expect(av.modules.get('vsh')?.status).toBe('unavailable');
    expect(curveSeriesProvider.resolve(plotContextOf(data.well, i, []), 'r:GR')).toBeNull();
  });
  it('una herramienta de otro ancestro también excluye el artefacto', () => {
    const a = artifact({ inputs: [...artifact().inputs, { curveId: 'CALI', contentVersion: resolveDataContext(well, interp(), registry, 'rev').lineage.get('CALI')!.contentVersion }] });
    const i = chosen(); i.toolString = { ...DEFAULT_TOOL_STRING, off: ['caliper'] };
    const data = resolveDataContext(well, i, registry, 'rev', [a]);
    expect(data.excluded.has(id)).toBe(true); expect(data.excluded.has('GR')).toBe(false);
    expect(run(data, i).outputs).toHaveLength(0);
  });
  it('visor, series y exportaciones distinguen preparada y original; los rellenos usan la elegida', () => {
    const i = chosen(), a = artifact(), data = resolveDataContext(well, i, registry, 'rev', [a]);
    const tracks = resolveTracks([{ id: 'gr', kind: 'curves', title: 'GR', curves: [{ select: { role: 'GR' } }] }], { depth: well.depth.values, curves: data.eligible, computed: [], catalog: registry.roles, sources: i.sources });
    const curves = tracks[0]!.curves;
    expect(findCurve(curves, 'GR')?.data).toBe(a.data);
    expect(curves.find(c => c.curveId === id)?.origin).toBe('prepared');
    expect(curves.find(c => c.curveId === 'GR')?.alternative).toBe(true);
    const series = plotContextOf(data.well, i, []);
    expect(curveSeriesProvider.resolve(series, 'r:GR')?.y).toBe(a.data);
    expect(curveSeriesProvider.resolve(series, 'm:GR')?.y).toBe(well.curves[0]!.data);
    const exported = buildExportColumns(data.well, null);
    expect(exported.find(c => c.id === `m:${id}`)).toMatchObject({ origin: 'prepared', description: 'Preparada', data: a.data });
  });
  it('canal real conserva valores/linaje y permite cambiar de preparación sin agotar resync', async () => {
    const client = createInProcessClient(registry);
    const calculate = (data: ReturnType<typeof resolveDataContext>, i = chosen()) => new Promise<ClientResult>((resolve, reject) => {
      const off = client.subscribe(e => { if (e.type === 'result') { off(); resolve(e.result); } if (e.type === 'error') { off(); reject(new Error(e.message)); } });
      client.syncWell(data.engineWell, data.context); client.run(i, data.context);
    });
    try {
      const a = resolveDataContext(well, chosen(), registry, 'rev', [artifact()]);
      const first = await calculate(a);
      expect(first.context).toEqual(a.context); expect(first.outputs[0]?.value).toEqual(Float64Array.of(11, NaN, 33));
      expect(buildReportModel(a.well, chosen(), first, new Date(0), registry).methods).toContainEqual({ port: 'GR', source: 'GR limpio' });
      const b = resolveDataContext(well, chosen(), registry, 'rev', [artifact({ data: Float64Array.of(41, 42, 43) })]);
      const second = await calculate(b);
      expect(second.gen).not.toBe(first.gen); expect(second.outputs[0]?.value).toEqual(Float64Array.of(41, 42, 43));
      expect(well.curves[0]!.data.buffer.byteLength).toBe(24);
    } finally { client.dispose(); }
  });
  it('rechaza contexto de originales o de otra preparación antes de sincronizar o ejecutar', () => {
    const client = createInProcessClient(registry), i = chosen();
    const a = resolveDataContext(well, i, registry, 'rev', [artifact()]);
    const original = engineContext(toEngineWell(well), i, 'rev');
    try {
      expect(() => client.syncWell(a.engineWell, original)).toThrow(/proyección/);
      const other = resolveDataContext(well, i, registry, 'rev', [artifact({ data: Float64Array.of(4, 5, 6) })]);
      expect(() => client.syncWell(a.engineWell, other.context)).toThrow(/proyección/);
      expect(() => client.syncWell(a.engineWell, a.context)).not.toThrow();
      expect(() => client.run(i, original)).toThrow(/proyección/);
      expect(() => client.run({ ...i, disabled: ['igr'] }, a.context)).toThrow(/contexto/);
    } finally { client.dispose(); }
  });
});

describe('contexto de laboratorio', () => {
  const set = createPointSet({ id: 'lab', kind: 'drx', name: 'DRX', depth: Float64Array.of(10, 12), pointIds: ['a', 'b'], columns: { clay: { label: 'Arcilla', unit: 'v/v', values: Float64Array.of(.2, .7) } } });
  const w: Well = { ...well, pointSets: [set] };
  const spec: CalibrationRequest = { pointSetIds: ['lab'], methodVersion: 'GR-clay@1', pairing: { datum: 'MD', top: 10, base: 12, windowM: .2, aggregation: 'median' }, configuration: { density: 2.65 } };
  it('datos y decisiones de laboratorio invalidan calibración, conservando el cálculo petrofísico', () => {
    const i = interp(), data = resolveDataContext(w, i, registry, 'a'), key = calibrationKey(data, i, spec);
    const changed: Well = { ...w, pointSets: [{ ...set, columns: { clay: { label: 'Arcilla', unit: 'v/v', values: Float64Array.of(.3, .8) } } }] };
    const after = resolveDataContext(changed, i, registry, 'b');
    expect(sameComputation(data.context, after.context)).toBe(true);
    expect(calibrationKey(after, i, spec)).not.toBe(key);
    const decisions = { ...i, pointSets: { lab: { points: { a: { status: 'exclude' as const } } } } };
    expect(calibrationKey(data, decisions, spec)).not.toBe(key);
    expect(calibrationKey(data, i, { ...spec, pairing: { ...spec.pairing, windowM: 1 } })).not.toBe(key);
    expect(calibrationKey(data, i, { ...spec, configuration: { density: 2.7 } })).not.toBe(key);
  });
  it('nombre, encabezado y tendencias no invalidan evidencia científica', () => {
    const i = interp(), data = resolveDataContext(w, i, registry, 'a');
    const renamed: Well = { ...w, name: 'Otro', pointSets: [{ ...set, name: 'Otro nombre' }] };
    const after = resolveDataContext(renamed, i, registry, 'b');
    expect(calibrationKey(after, { ...i, trends: [] }, spec)).toBe(calibrationKey(data, i, spec));
  });
  it('rechaza laboratorio ausente, ventana inválida o contexto de cálculo obsoleto', () => {
    const i = interp(), data = resolveDataContext(w, i, registry);
    expect(() => calibrationKey(data, i, { ...spec, pointSetIds: ['missing'] })).toThrow(/disponible/);
    expect(() => calibrationKey(data, i, { ...spec, pairing: { ...spec.pairing, windowM: -1 } })).toThrow();
    expect(() => calibrationKey(data, { ...i, disabled: ['igr'] }, spec)).toThrow(/obsoleto/);
  });
});
