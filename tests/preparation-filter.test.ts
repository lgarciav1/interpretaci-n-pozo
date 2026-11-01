import { describe, expect, it } from 'vitest';
import { curve, linearModule } from './helpers';
import { createWell } from '../src/core/well';
import { createRegistry } from '../src/core/registry';
import { addWell, createProject, updateInterpretation, updateWell } from '../src/core/state/project';
import { addMaskInterval, entryPreparationPlan, removeGapFill, removeMedianFilter, restoreMaskInterval, setGapFill, setMedianFilter } from '../src/core/state/preparation';
import { MaskEvaluator, PreparationCancelled } from '../src/core/preparation/evaluate';
import { toEngineWell } from '../src/core/engine/engine';
import { materializePreparation, validatePreparedPayloads } from '../src/core/preparation/plan';
import { stageQualityCounts } from '../src/core/preparation/quality';
import { validatePreparation } from '../src/core/preparation/state';
import { serializeProject, deserializeProject } from '../src/core/state/serialize';
import { createSnapshot, restoreSnapshot } from '../src/core/state/snapshots';
import { useProject } from '../src/app/store/project';
import { createInProcessClient, type ClientResult } from '../src/core/engine/client';
import { exportSources } from '../src/app/export/exportActions';
import { buildReportModel } from '../src/app/report/report';

const registry = createRegistry([linearModule('igr', 'GR', 'IGR')]);
function fixture(data = [0, 10, 100, 20, 30], depth = data.map((_, i) => i)) {
  return addWell(createProject(), createWell({ id: 'w', name: 'W', depth: Float64Array.from(depth), curves: [{ ...curve('GR', 'GR', data), origin: { kind: 'measured' } }] }));
}
function filtered(project = fixture(), radiusM = 1, maxStepM = 1, top = 0, base = project.wells[0]!.well.depth.values.at(-1)!) {
  return setMedianFilter(project, 'w', 'GR', { top, base, radiusM, maxStepM }, 'filter');
}
async function evaluate(project = filtered(), evaluator = new MaskEvaluator()) {
  const entry = project.wells[0]!, plan = entryPreparationPlan(project, entry, registry), artifacts = await evaluator.evaluate(toEngineWell(entry.well), plan);
  return { entry, plan, artifacts, payload: artifacts[0]!, data: materializePreparation(entry.well, { plan, artifacts }, plan.context, registry) };
}
describe('mediana física v1', () => {
  it('usa entradas fijas, no realimenta el filtro, y conserva los bordes sin soporte completo', async () => {
    const original = fixture(), before = new Uint8Array(original.wells[0]!.well.curves[0]!.data.buffer).slice();
    const { payload } = await evaluate(filtered(original));
    expect(payload.data).toEqual(Float64Array.of(0, 10, 20, 30, 30));
    expect(payload.quality).toEqual(Uint16Array.of(0, 16, 16, 16, 0));
    expect(new Uint8Array(original.wells[0]!.well.curves[0]!.data.buffer)).toEqual(before);
  });
  it('selecciona por distancia MD irregular y promedia los dos centrales en soporte par, en valores lineales', async () => {
    const original = fixture([0, 10, 100, 20, 40, 0], [0, 1, 1.4, 2, 3, 4]);
    const { payload } = await evaluate(filtered(original, 1.5, 1.1));
    expect(payload.data).toEqual(Float64Array.of(0, 10, 100, 30, 40, 0));
    expect(payload.quality).toEqual(Uint16Array.of(0, 0, 0, 16, 0, 0));
    for (const value of [Number.MIN_VALUE, Number.MAX_VALUE, -Number.MIN_VALUE, -Number.MAX_VALUE]) {
      const constant = await evaluate(filtered(fixture(Array<number>(6).fill(value), [0, 1, 1.4, 2, 3, 4]), 1.5, 1.1));
      expect(constant.payload.data[3]).toBe(value);
    }
    const opposite = await evaluate(filtered(fixture([0, -1e308, -1e308, 1e308, 1e308, 0], [0, 1, 1.4, 2, 3, 4]), 1.5, 1.1));
    expect(opposite.payload.data[3]).toBe(0);
    const tiny = await evaluate(filtered(fixture([0, Number.MIN_VALUE, Number.MIN_VALUE, Number.MIN_VALUE * 2, Number.MIN_VALUE * 2, 0], [0, 1, 1.4, 2, 3, 4]), 1.5, 1.1));
    expect(tiny.payload.data[3]).toBe(Number.MIN_VALUE * 2);
  });
  it('coincide con una referencia independiente por ventanas y ordenación, sin algoritmo deslizante', async () => {
    const values = [5, 20, 1, 18, 3, 8, 14, 2, 25], depth = [0, 0.3, 0.8, 1.1, 1.6, 2.1, 2.4, 2.9, 3.4], radius = 0.8;
    const expected = values.map((value, i) => {
      if (depth[i]! - radius < depth[0]! || depth[i]! + radius > depth.at(-1)!) return value;
      const indices = depth.flatMap((d, k) => d >= depth[i]! - radius && d <= depth[i]! + radius ? [k] : []);
      if (indices.length < 3 || indices[0]! >= i || indices.at(-1)! <= i) return value;
      const samples = indices.map(k => values[k]!).sort((a, b) => a - b), mid = Math.floor(samples.length / 2);
      return samples.length % 2 ? samples[mid]! : (samples[mid - 1]! + samples[mid]!) / 2;
    });
    expect((await evaluate(filtered(fixture(values, depth), radius, 1))).payload.data).toEqual(Float64Array.from(expected));
  });
  it('faltantes y exclusiones cortan segmentos, sin rellenar ni acercar valores a través de ellos', async () => {
    const original = fixture([0, 10, NaN, 20, 30, 40]);
    expect((await evaluate(filtered(original))).payload.quality).toEqual(Uint16Array.of(0, 0, 1, 0, 16, 0));
    const masked = addMaskInterval(fixture(), 'w', 'GR', { id: 'r', top: 2, base: 2 }, 'mask');
    const payload = (await evaluate(filtered(masked))).payload;
    expect(payload.data).toEqual(Float64Array.of(0, 10, NaN, 20, 30));
    expect(payload.quality).toEqual(Uint16Array.of(0, 0, 2, 0, 0));
    expect(restoreMaskInterval(filtered(masked), 'w', 'mask', 'r').wells[0]!.interpretation.preparation!.schemaVersion).toBe(3);
  });
  it('respeta tramo, separación máxima y fronteras zonales, invalidando la caché al moverlas', async () => {
    expect((await evaluate(filtered(fixture(), 1, 0.5))).payload.quality).toEqual(Uint16Array.of(0, 0, 0, 0, 0));
    expect((await evaluate(filtered(fixture(), 1, 1, 1, 3))).payload.quality).toEqual(Uint16Array.of(0, 0, 16, 0, 0));
    const evaluator = new MaskEvaluator(), project = filtered(), before = await evaluate(project, evaluator);
    const zoned = updateInterpretation(project, 'w', i => ({ ...i, zones: [{ id: 'z', name: 'Z', top: 2, base: 10, kind: 'formation', color: '#fff' }] }));
    const after = await evaluate(zoned, evaluator);
    expect(after.payload.quality).toEqual(Uint16Array.of(0, 0, 0, 16, 0));
    expect(after.plan.context.preparationKey).not.toBe(before.plan.context.preparationKey);
  });
  it('aplica interpolación antes del filtro y propaga influencia sin inventar faltantes originales', async () => {
    const interpolated = setGapFill(fixture([0, NaN, 100, 20, 30]), 'w', 'GR', { top: 0, base: 4, maxGapM: 2 }, 'fill');
    const project = filtered(interpolated), { payload } = await evaluate(project);
    expect(payload.data).toEqual(Float64Array.of(0, 50, 50, 30, 30));
    expect(payload.quality).toEqual(Uint16Array.of(0, 25, 24, 16, 0));
    expect(stageQualityCounts(payload.quality)).toEqual({ excluded: 0, originallyMissing: 1, newlyExcluded: 0, interpolated: 1, filtered: 3, estimatedInfluence: 1 });
    const noFill = removeGapFill(project, 'w', 'fill');
    expect((await evaluate(noFill)).payload.data).toEqual(Float64Array.of(0, NaN, 100, 30, 30));
    expect(noFill.wells[0]!.interpretation.preparation!.schemaVersion).toBe(3);
    expect(removeMedianFilter(project, 'w', 'fill').wells[0]!.interpretation).toEqual(interpolated.wells[0]!.interpretation);
    // Editar el método de interpolación no elimina el filtro aceptado.
    expect(setGapFill(project, 'w', 'GR', { top: 0, base: 4, maxGapM: 1 }, 'unused').wells[0]!.interpretation.preparation!.nodes[0]!.kind).toBe('median-filter');
  });
  it('quitar filtro conserva máscara o interpolación; restaurar todo vuelve al original explícito', () => {
    const masked = addMaskInterval(fixture(), 'w', 'GR', { id: 'r', top: 2, base: 2 }, 'mask');
    expect(removeMedianFilter(filtered(masked), 'w', 'mask').wells[0]!.interpretation).toEqual(masked.wells[0]!.interpretation);
    const plain = filtered();
    expect(removeMedianFilter(plain, 'w', 'filter').wells[0]!.interpretation.preparation).toBeUndefined();
    expect(restoreMaskInterval(plain, 'w', 'filter').wells[0]!.interpretation.sources.GR).toEqual({ kind: 'curve', curveId: 'GR' });
    expect(filtered(plain)).toBe(plain);
  });
  it('valida versión/configuración/roles y no activa migración al fallar', () => {
    const original = fixture();
    for (const bad of [{ radiusM: 0 }, { radiusM: Infinity }, { maxStepM: -1 }, { top: -1 }, { base: 99 }]) expect(() => setMedianFilter(original, 'w', 'GR', { top: 0, base: 4, radiusM: 1, maxStepM: 1, ...bad }, 'f')).toThrow();
    for (const role of ['NET_PAY', 'LITHO', null]) expect(() => filtered(updateWell(original, 'w', w => ({ ...w, curves: w.curves.map(c => ({ ...c, role, unit: 'unitless' })) })))).toThrow(/banderas|catálogo/);
    const state = filtered().wells[0]!.interpretation.preparation!;
    for (const bad of [{ ...state, schemaVersion: 2 }, { ...state, schemaVersion: 4 }, { ...state, nodes: [{ ...state.nodes[0], filter: { top: 0, base: 4, radiusM: 1, maxStepM: 1, exec: 'no' } }] }]) expect(() => validatePreparation(bad)).toThrow();
    expect(original.inputRevisions).toBeUndefined();
  });
  it('limita soporte a 255 y reserva scratch en el presupuesto sin cachear fallos', async () => {
    const evaluator = new MaskEvaluator(100); await evaluate(filtered(), evaluator); expect(evaluator.retainedBytes).toBe(50);
    await expect(evaluate(filtered(), new MaskEvaluator(99))).rejects.toThrow(/presupuesto/);
    const large = filtered(fixture(Array<number>(300).fill(1)), 130, 1);
    const ev = new MaskEvaluator(); await expect(evaluate(large, ev)).rejects.toThrow(/255/); expect(ev.retainedBytes).toBe(0);
  });
  it('cancela durante el filtrado y conserva buffers originales y caché sin arrays parciales', async () => {
    const n = 10000, project = filtered(fixture(Array<number>(n).fill(1))), entry = project.wells[0]!, plan = entryPreparationPlan(project, entry, registry), evaluator = new MaskEvaluator();
    let checkpoints = 0;
    await expect(evaluator.evaluate(toEngineWell(entry.well), plan, () => checkpoints >= 3, async () => { checkpoints++; })).rejects.toBeInstanceOf(PreparationCancelled);
    expect(checkpoints).toBe(3); expect(evaluator.retainedBytes).toBe(0); expect(entry.well.curves[0]!.data.every(v => v === 1)).toBe(true);
  });
  it('guardar/reabrir y snapshots reproducen receta/orden/calidad sin datos derivados persistidos', async () => {
    const project = createSnapshot(filtered(), 'w', 'Filtrado', { id: 's' }).project, text = await serializeProject(project), raw = JSON.parse(text);
    expect(raw.project.inputRevisions[project.wells[0]!.inputRevisionId!].well.curves).toHaveLength(1);
    const reopened = await deserializeProject(text), restored = restoreSnapshot(removeMedianFilter(reopened, 'w', 'filter'), 's');
    expect((await evaluate(restored)).payload.quality).toEqual(Uint16Array.of(0, 16, 16, 16, 0));
    raw.project.wells[0].interpretation.preparation.nodes[0].filter.radiusM = 0;
    await expect(deserializeProject(JSON.stringify(raw))).rejects.toThrow();
  });
  it('aceptación y retirada son unidades de undo/redo', () => {
    const store = useProject.getState(), original = fixture(); store.replace(original);
    store.commit('Filtrar', p => filtered(p), { group: 'f' }); const accepted = useProject.getState().project;
    store.undo(); expect(useProject.getState().project).toBe(original); store.redo(); expect(useProject.getState().project).toBe(accepted);
    store.commit('Quitar', p => removeMedianFilter(p, 'w', 'filter'), { group: 'q' }); store.undo(); expect(useProject.getState().project).toBe(accepted); store.replace(createProject());
  });
  it('rechaza calidad inventada, mezcla de versiones y valores no finitos', async () => {
    const first = await evaluate(), other = await evaluate(filtered(fixture(), 2));
    expect(() => materializePreparation(first.entry.well, { plan: other.plan, artifacts: first.artifacts }, other.plan.context, registry)).toThrow();
    for (const q of [8, 17, 24, 25, 64]) expect(() => validatePreparedPayloads(first.plan, [{ ...first.payload, quality: Uint16Array.of(0, q, 16, 16, 0) }], 5)).toThrow();
    expect(() => validatePreparedPayloads(first.plan, [{ ...first.payload, data: Float64Array.of(0, NaN, 20, 30, 30) }], 5)).toThrow();
  });
  it('el worker publica motor, filtro, informe y QC juntos; rechaza un plan alterado', async () => {
    const project = filtered(), entry = project.wells[0]!, plan = entryPreparationPlan(project, entry, registry), client = createInProcessClient(registry);
    const run = (altered = false) => new Promise<ClientResult>((resolve, reject) => { const off = client.subscribe(event => { if (event.type === 'result') { off(); resolve(event.result); } else if (event.type === 'error') { off(); reject(new Error(event.message)); } }); client.syncWell(toEngineWell(entry.well), plan.context); client.run(entry.interpretation, plan.context, altered ? { ...plan, artifacts: plan.artifacts.map(a => ({ ...a, filter: { ...a.filter!, radiusM: 99 } })) } : plan); });
    try {
      const result = await run(); expect(result.outputs[0]!.value).toEqual(Float64Array.of(0, 10, 20, 30, 30));
      expect(exportSources(entry.well, result, false, plan.context).columns.find(c => c.id.startsWith('q:'))!.data).toEqual(Float64Array.of(0, 16, 16, 16, 0));
      expect(buildReportModel(entry.well, entry.interpretation, result, new Date(0), registry).warnings.some(w => w.includes('3 muestras filtradas'))).toBe(true);
      await expect(run(true)).rejects.toThrow(/plan.*no corresponde/i);
    } finally { client.dispose(); }
  });
});
