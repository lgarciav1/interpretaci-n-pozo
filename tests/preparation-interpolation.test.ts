import { describe, expect, it } from 'vitest';
import { createWell } from '../src/core/well';
import { curve, linearModule } from './helpers';
import { createRegistry } from '../src/core/registry';
import { addWell, createProject, updateInterpretation, updateWell } from '../src/core/state/project';
import { addMaskInterval, entryPreparationPlan, removeGapFill, restoreMaskInterval, setGapFill } from '../src/core/state/preparation';
import { MaskEvaluator, PreparationCancelled } from '../src/core/preparation/evaluate';
import { toEngineWell } from '../src/core/engine/engine';
import { materializePreparation, validatePreparedPayloads } from '../src/core/preparation/plan';
import { preparationQualityCounts } from '../src/core/preparation/quality';
import { preparationStateKey, validatePreparation } from '../src/core/preparation/state';
import { serializeProject, deserializeProject } from '../src/core/state/serialize';
import { createInProcessClient, type ClientResult } from '../src/core/engine/client';
import { createSnapshot, restoreSnapshot } from '../src/core/state/snapshots';
import { useProject } from '../src/app/store/project';
import { exportSources } from '../src/app/export/exportActions';
import { buildReportModel } from '../src/app/report/report';

const registry = createRegistry([linearModule('igr', 'GR', 'IGR')]);
function fixture(data = [10, NaN, NaN, 22], depth = [0, 1, 3, 6]) {
  const well = createWell({ id: 'w', name: 'W', depth: Float64Array.from(depth), curves: [{ ...curve('GR', 'GR', data), origin: { kind: 'measured' } }] });
  return addWell(createProject(), well);
}
const fill = (project = fixture(), maxGapM = 6, top = 0, base = 6) => setGapFill(project, 'w', 'GR', { top, base, maxGapM }, 'fill');
async function evaluate(project = fill(), evaluator = new MaskEvaluator()) {
  const entry = project.wells[0]!, plan = entryPreparationPlan(project, entry, registry);
  const artifacts = await evaluator.evaluate(toEngineWell(entry.well), plan);
  return { entry, plan, artifacts, payload: artifacts[0]!, data: materializePreparation(entry.well, { plan, artifacts }, plan.context, registry) };
}
describe('interpolación lineal en MD v1', () => {
  it('usa distancia real en grilla irregular; caso numérico independiente, calidad y originales intactos', async () => {
    const project = fill(), original = project.wells[0]!.well.curves[0]!.data;
    const before = new Uint8Array(original.buffer).slice();
    const result = await evaluate(project);
    expect(result.payload.data).toEqual(Float64Array.of(10, 12, 16, 22));
    expect(result.payload.quality).toEqual(Uint16Array.of(0, 9, 9, 0));
    expect(preparationQualityCounts(result.payload.quality)).toEqual({ excluded: 0, originallyMissing: 2, newlyExcluded: 0, interpolated: 2 });
    expect(new Uint8Array(original.buffer)).toEqual(before);
    expect(result.data.well.depth).toBe(project.wells[0]!.well.depth);
    expect(result.data.lineage.get('prep:fill:masked')!.ancestorToolIds).toEqual(['gr']);
  });
  it('el máximo es distancia entre anclajes, inclusive, y no longitud de muestras faltantes', async () => {
    expect((await evaluate(fill(fixture(), 6))).payload.data).toEqual(Float64Array.of(10, 12, 16, 22));
    expect((await evaluate(fill(fixture(), 5.999))).payload.data).toEqual(Float64Array.of(10, NaN, NaN, 22));
    expect((await evaluate(fill(fixture(), 2))).payload.quality).toEqual(Uint16Array.of(0, 1, 1, 0));
  });
  it('no extrapola ni usa anclajes fuera del tramo', async () => {
    expect((await evaluate(fill(fixture(), 10, 1, 6))).payload.data).toEqual(Float64Array.of(10, NaN, NaN, 22));
    const project = fixture([NaN, 10, NaN, 20, NaN], [0, 1, 2, 3, 4]);
    expect((await evaluate(fill(project, 4, 0, 4))).payload.data).toEqual(Float64Array.of(NaN, 10, 15, 20, NaN));
    expect((await evaluate(fill(fixture([NaN, NaN, NaN, NaN])))).payload.data.every(Number.isNaN)).toBe(true);
  });
  it('las exclusiones bloquean un hueco entero, incluso sobre faltantes originales', async () => {
    const masked = addMaskInterval(fixture(), 'w', 'GR', { id: 'excluded', top: 1, base: 1 }, 'mask');
    const result = await evaluate(fill(masked));
    expect(result.payload.data).toEqual(Float64Array.of(10, NaN, NaN, 22));
    expect(result.payload.quality).toEqual(Uint16Array.of(0, 3, 1, 0));
    expect(result.payload.id).toBe('prep:mask:masked');
    const restored = restoreMaskInterval(fill(masked), 'w', 'mask', 'excluded');
    expect(restored.wells[0]!.interpretation.preparation!.schemaVersion).toBe(2);
    expect(restored.wells[0]!.interpretation.sources.GR).toEqual({ kind: 'curve', curveId: 'prep:mask:masked' });
    expect((await evaluate(restored)).payload.data).toEqual(Float64Array.of(10, 12, 16, 22));
    const finiteMasked = addMaskInterval(fill(fixture([10, NaN, 16, 22])), 'w', 'GR', { id: 'r', top: 3, base: 3 }, 'unused');
    expect((await evaluate(finiteMasked)).payload.data).toEqual(Float64Array.of(10, NaN, NaN, 22));
  });
  it('preserva mediciones finitas, ceros con signo y valores extremos; no depende de escala log de pantalla', async () => {
    const result = await evaluate(fill(fixture([-0, NaN, 1, 2])));
    expect(Object.is(result.payload.data[0], -0)).toBe(true);
    expect(result.payload.data[2]).toBe(1);
    const extreme = await evaluate(fill(fixture([-1e308, NaN, NaN, 1e308])));
    expect(extreme.payload.data.every(Number.isFinite)).toBe(true);
    expect(extreme.payload.data[2]).toBe(0);
  });
  it('rechaza configuración/esquema futuros sin cambiar el proyecto; conserva v1 exacto para máscaras', async () => {
    const original = fixture();
    for (const config of [{ maxGapM: 0 }, { maxGapM: Infinity }, { top: 7 }, { base: -1 }, { top: -1 }]) expect(() => setGapFill(original, 'w', 'GR', { top: 0, base: 6, maxGapM: 6, ...config }, 'f')).toThrow();
    const state = fill().wells[0]!.interpretation.preparation!;
    for (const value of [{ ...state, schemaVersion: 1 }, { ...state, schemaVersion: 3 }, { ...state, nodes: [{ ...state.nodes[0], methodVersion: 2 }] }, { ...state, nodes: [{ ...state.nodes[0], gapFill: { top: 0, base: 6, maxGapM: 6, hidden: true } }] }]) expect(() => validatePreparation(value)).toThrow();
    expect(original.inputRevisions).toBeUndefined();
    const mask = addMaskInterval(original, 'w', 'GR', { id: 'r', top: 1, base: 1 }, 'mask');
    expect(mask.wells[0]!.interpretation.preparation!.schemaVersion).toBe(1);
    const text = JSON.parse(await serializeProject(mask));
    expect(text.project.wells[0].interpretation.preparation.schemaVersion).toBe(1);
  });
  it('quitar sólo interpolación conserva máscara/identidad; quitar todo vuelve explícitamente a original', () => {
    const masked = addMaskInterval(fixture(), 'w', 'GR', { id: 'r', top: 1, base: 1 }, 'mask');
    const prepared = fill(masked), removed = removeGapFill(prepared, 'w', 'mask');
    expect(removed.wells[0]!.interpretation).toEqual(masked.wells[0]!.interpretation);
    expect(removeGapFill(removed, 'w', 'mask')).toBe(removed);
    const project = fill();
    expect(removeGapFill(project, 'w', 'fill').wells[0]!.interpretation.preparation).toBeUndefined();
    expect(restoreMaskInterval(prepared, 'w', 'mask').wells[0]!.interpretation.sources.GR).toEqual({ kind: 'curve', curveId: 'GR' });
  });
  it('guardar/reabrir y restaurar snapshot reproducen método, calidad y estimaciones sin blobs derivados', async () => {
    const saved = createSnapshot(fill(), 'w', 'Estimado', { id: 's' }).project;
    const text = await serializeProject(saved), raw = JSON.parse(text);
    expect(raw.version).toBe(7);
    expect(raw.project.inputRevisions[saved.wells[0]!.inputRevisionId!].well.curves).toHaveLength(1);
    const reopened = await deserializeProject(text), current = await evaluate(reopened);
    expect(current.payload.data).toEqual(Float64Array.of(10, 12, 16, 22));
    const changed = removeGapFill(reopened, 'w', 'fill');
    const restored = restoreSnapshot(changed, 's');
    expect((await evaluate(restored)).payload.quality).toEqual(Uint16Array.of(0, 9, 9, 0));
    raw.project.wells[0].interpretation.preparation.nodes[0].gapFill.maxGapM = -1;
    await expect(deserializeProject(JSON.stringify(raw))).rejects.toThrow();
  });
  it('aceptar método, migración y fuente es un solo undo/redo; las búsquedas idénticas son no-op', () => {
    const store = useProject.getState(), original = fixture(); store.replace(original);
    store.commit('Interpolar', p => fill(p), { group: 'fill' });
    const accepted = useProject.getState().project;
    expect(fill(accepted)).toBe(accepted);
    store.undo(); expect(useProject.getState().project).toBe(original);
    store.redo(); expect(useProject.getState().project).toBe(accepted);
    store.commit('Quitar', p => removeGapFill(p, 'w', 'fill'), { group: 'remove' });
    expect(useProject.getState().project.wells[0]!.interpretation.preparation).toBeUndefined();
    store.undo(); expect(useProject.getState().project).toBe(accepted); store.replace(createProject());
  });
  it('invalida caché/contexto por límites y rechaza mezcla de versiones o calidad/valor incoherentes', async () => {
    const evaluator = new MaskEvaluator(), project = fill();
    const first = await evaluate(project, evaluator), same = await evaluate(fill(project), evaluator);
    expect(first.payload.data).toBe(same.payload.data);
    const short = await evaluate(fill(project, 5), evaluator);
    expect(short.plan.context).not.toEqual(first.plan.context);
    expect(preparationStateKey(short.entry.interpretation.preparation)).not.toBe(preparationStateKey(first.entry.interpretation.preparation));
    expect(() => materializePreparation(first.entry.well, { plan: short.plan, artifacts: first.artifacts }, short.plan.context, registry)).toThrow();
    for (const [quality, data] of [[Uint16Array.of(0, 8, 9, 0), first.payload.data], [first.payload.quality, Float64Array.of(10, NaN, 16, 22)], [Uint16Array.of(0, 1, 9, 0), first.payload.data]] as const) expect(() => validatePreparedPayloads(first.plan, [{ ...first.payload, quality, data }], 4)).toThrow();
    const changed = updateWell(project, 'w', w => ({ ...w, curves: w.curves.map(c => ({ ...c, data: Float64Array.of(1, 2, 3, 4) })) }));
    expect((await evaluate(changed)).plan.diagnostics[0]!.status).toBe('needs-input');
    expect(() => fill(changed)).toThrow(/otros datos/);
  });
  it('cancela durante el rellenado de un hueco grande sin cachear ni publicar arrays parciales', async () => {
    const n = 50000, values = Array<number>(n).fill(NaN); values[0] = 10; values[n - 1] = 20;
    const project = fill(fixture(values, Array.from({ length: n }, (_, i) => i)), n, 0, n - 1);
    const entry = project.wells[0]!, plan = entryPreparationPlan(project, entry, registry), evaluator = new MaskEvaluator();
    let checkpoints = 0;
    await expect(evaluator.evaluate(toEngineWell(entry.well), plan, () => checkpoints >= 7, async () => { checkpoints++; })).rejects.toBeInstanceOf(PreparationCancelled);
    expect(checkpoints).toBe(7); expect(evaluator.retainedBytes).toBe(0);
    expect(entry.well.curves[0]!.data[20000]).toBeNaN();
  });
  it('canal real publica estimaciones con motor, QC exportado e informe del mismo contexto', async () => {
    const project = fill(), entry = project.wells[0]!, plan = entryPreparationPlan(project, entry, registry), client = createInProcessClient(registry);
    try {
      const response = new Promise<ClientResult>((resolve, reject) => { const off = client.subscribe(event => { if (event.type === 'result') { off(); resolve(event.result); } else if (event.type === 'error') { off(); reject(new Error(event.message)); } }); });
      client.syncWell(toEngineWell(entry.well), plan.context); client.run(entry.interpretation, plan.context, plan);
      const result = await response;
      expect(result.outputs[0]!.value).toEqual(Float64Array.of(10, 12, 16, 22));
      const columns = exportSources(entry.well, result, false, plan.context).columns;
      expect(columns.find(c => c.id.startsWith('q:'))!.data).toEqual(Float64Array.of(0, 9, 9, 0));
      expect(columns.find(c => c.id.startsWith('q:'))!.description).toContain('9=');
      expect(buildReportModel(entry.well, entry.interpretation, result, new Date(0), registry).warnings.some(w => w.includes('2 muestras estimadas'))).toBe(true);
    } finally { client.dispose(); }
  });
  it('el worker rechaza límites alterados en el plan sin publicar un resultado', async () => {
    const project = fill(), entry = project.wells[0]!, plan = entryPreparationPlan(project, entry, registry), client = createInProcessClient(registry);
    const altered = { ...plan, artifacts: plan.artifacts.map(a => ({ ...a, gapFill: { ...a.gapFill!, maxGapM: 999 } })) };
    try {
      const error = new Promise<string>((resolve, reject) => { const off = client.subscribe(event => {
        if (event.type === 'error') { off(); resolve(event.message); }
        else if (event.type === 'result') { off(); reject(new Error('No debe publicar el plan alterado.')); }
      }); });
      client.syncWell(toEngineWell(entry.well), plan.context); client.run(entry.interpretation, plan.context, altered);
      expect(await error).toMatch(/plan.*no corresponde/i);
    } finally { client.dispose(); }
  });
  it('las fronteras de zona bloquean el relleno y sus cambios invalidan arrays cacheados', async () => {
    const project = fill(), evaluator = new MaskEvaluator(), before = await evaluate(project, evaluator);
    const zone = { id: 'z', name: 'Capa delgada', top: 2, base: 10, color: '#fff', kind: 'formation' as const };
    const blocked = updateInterpretation(project, 'w', i => ({ ...i, zones: [zone] }));
    const after = await evaluate(blocked, evaluator);
    expect(after.payload.data).toEqual(Float64Array.of(10, NaN, NaN, 22));
    expect(after.plan.context.preparationKey).not.toBe(before.plan.context.preparationKey);
    expect(after.payload.data).not.toBe(before.payload.data);
    // [a,b): el anclaje izquierdo puede ser un tope, el derecho en una frontera cruza de zona.
    const sameZone = updateInterpretation(project, 'w', i => ({ ...i, zones: [{ ...zone, top: 0 }] }));
    expect((await evaluate(sameZone)).payload.data).toEqual(Float64Array.of(10, 12, 16, 22));
    const rightBoundary = updateInterpretation(project, 'w', i => ({ ...i, zones: [{ ...zone, top: 6 }] }));
    expect((await evaluate(rightBoundary)).payload.data).toEqual(Float64Array.of(10, NaN, NaN, 22));
  });
  it('rechaza banderas/categorías y roles desconocidos sin inferir continuidad por valores numéricos', () => {
    for (const role of ['NET_PAY', 'LITHO', 'CLAY_TYPE', 'ROCK_TYPE', 'UNRECOGNIZED', null]) {
      const project = updateWell(fixture(), 'w', w => ({ ...w, curves: w.curves.map(c => ({ ...c, role, unit: 'unitless' })) }));
      expect(() => fill(project)).toThrow(/rol.*catálogo|banderas/i);
      expect(project.inputRevisions).toBeUndefined();
    }
    const badUnit = updateWell(fixture(), 'w', w => ({ ...w, curves: w.curves.map(c => ({ ...c, unit: 'm' })) }));
    expect(() => fill(badUnit)).toThrow(/unidad/i);
  });
});
