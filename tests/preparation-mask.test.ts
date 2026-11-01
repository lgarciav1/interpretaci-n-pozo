import { describe, expect, it } from 'vitest';
import { createWell, type Well } from '../src/core/well';
import { createRegistry } from '../src/core/registry';
import { createProject, addWell, updateWell } from '../src/core/state/project';
import { addMaskInterval, entryPreparationPlan, restoreMaskInterval } from '../src/core/state/preparation';
import { MaskEvaluator, PreparationCancelled } from '../src/core/preparation/evaluate';
import { materializePreparation } from '../src/core/preparation/plan';
import { maskQualityCounts } from '../src/core/preparation/quality';
import { validatePreparation } from '../src/core/preparation/state';
import { serializeProject, deserializeProject } from '../src/core/state/serialize';
import { toEngineWell } from '../src/core/engine/engine';
import { createInProcessClient, type ClientResult } from '../src/core/engine/client';
import { sameComputation } from '../src/core/engine/context';
import { curve, linearModule } from './helpers';
import { createSnapshot } from '../src/core/state/snapshots';
import { snapshotRunRequest } from '../src/app/snapshots/request';
import { useProject } from '../src/app/store/project';
import { exportSources } from '../src/app/export/exportActions';
import { buildReportModel } from '../src/app/report/report';
import { calibrationKey } from '../src/core/preparation/calibrationContext';

const registry = createRegistry([linearModule('igr', 'GR', 'IGR')]);
const well = createWell({ id: 'w', name: 'Original', depth: Float64Array.of(10, 11, 12, 13, 14), curves: [{ ...curve('GR', 'GR', [10, NaN, 30, 40, 50]), origin: { kind: 'measured' } }] });
const base = () => addWell(createProject(), well);
const masked = () => addMaskInterval(base(), well.id, 'GR', { id: 'range', top: 11, base: 13 }, 'mask');
const evaluate = async (project = masked(), evaluator = new MaskEvaluator()) => {
  const entry = project.wells[0]!, plan = entryPreparationPlan(project, entry, registry);
  const payloads = await evaluator.evaluate(toEngineWell(entry.well), plan);
  return { entry, plan, payloads, data: materializePreparation(entry.well, { plan, artifacts: payloads }, plan.context, registry) };
};

describe('máscara v1', () => {
  it('excluye extremos cerrados, conserva filas/originales y distingue faltantes previos', async () => {
    const { entry, payloads, data } = await evaluate();
    expect(payloads[0]!.data).toEqual(Float64Array.of(10, NaN, NaN, NaN, 50));
    expect(payloads[0]!.quality).toEqual(Uint16Array.of(0, 3, 2, 2, 0));
    expect(maskQualityCounts(payloads[0]!.quality)).toEqual({ excluded: 3, originallyMissing: 1, newlyExcluded: 2 });
    expect(entry.well.curves[0]!.data).toEqual(well.curves[0]!.data);
    expect(data.well.depth).toBe(entry.well.depth); expect(data.well.curves).toHaveLength(2);
    expect(data.well.curves[1]!.provenance?.ancestorToolIds).toEqual(['gr']);
  });
  it('restaurar una exclusión solapada preserva las otras; restaurar la última vuelve explícitamente al original', async () => {
    const a = masked(), b = addMaskInterval(a, well.id, 'GR', { id: 'other', top: 12, base: 14 }, 'ignored');
    const restored = restoreMaskInterval(b, well.id, 'mask', 'range');
    expect((await evaluate(restored)).payloads[0]!.data).toEqual(Float64Array.of(10, NaN, NaN, NaN, NaN));
    const original = restoreMaskInterval(restored, well.id, 'mask');
    expect(original.wells[0]!.interpretation.preparation).toBeUndefined();
    expect(original.wells[0]!.interpretation.sources.GR).toEqual({ kind: 'curve', curveId: 'GR' });
    expect(original.wells[0]!.well.curves).toHaveLength(1);
  });
  it('un cambio de ids de intervalo sin cambiar alcance conserva firma y caché de arrays', async () => {
    const p = masked(), evaluator = new MaskEvaluator(), a = await evaluate(p, evaluator);
    const b = await evaluate(addMaskInterval(p, well.id, 'GR', { id: 'same', top: 11, base: 13 }, 'ignored'), evaluator);
    expect(sameComputation(a.plan.context, b.plan.context)).toBe(true);
    expect(a.payloads[0]!.data).toBe(b.payloads[0]!.data);
    const twoWell = createWell({ id: well.id, name: 'Dos curvas', depth: well.depth.values, curves: [...well.curves, { ...curve('CGR', 'CGR', [1, 2, 3, 4, 5]), origin: { kind: 'measured' } }] });
    const one = addMaskInterval(addWell(createProject(), twoWell), well.id, 'GR', { id: 'first', top: 11, base: 13 }, 'first');
    const two = addMaskInterval(one, well.id, 'CGR', { id: 'second', top: 12, base: 14 }, 'second');
    const same = addMaskInterval(two, well.id, 'GR', { id: 'duplicate', top: 11, base: 13 }, 'ignored');
    expect(entryPreparationPlan(same, same.wells[0]!, registry).context).toEqual(entryPreparationPlan(two, two.wells[0]!, registry).context);
    expect(same.wells[0]!.interpretation.preparation!.nodes.map(n => n.id)).toEqual(['first', 'second']);
  });
  it('cambiar solo encabezado/laboratorio comparte orígenes; reemplazar curva bloquea la receta fijada', async () => {
    const p = masked(), before = await evaluate(p);
    const renamed = updateWell(p, well.id, w => ({ ...w, name: 'Otro' }));
    const after = await evaluate(renamed);
    expect(sameComputation(before.plan.context, after.plan.context)).toBe(true);
    const changed = updateWell(p, well.id, w => ({ ...w, curves: w.curves.map(c => ({ ...c, data: Float64Array.of(1, 2, 3, 4, 5) })) }));
    const blocked = await evaluate(changed);
    expect(blocked.plan.artifacts).toHaveLength(0); expect(blocked.plan.diagnostics[0]?.status).toBe('needs-input');
    expect(() => addMaskInterval(changed, well.id, 'GR', { id: 'new', top: 10, base: 11 }, 'new')).toThrow(/otros datos/);
  });
  it('rechaza estructura/método futuro y referencias a otro pozo sin reparar silenciosamente', () => {
    const p = masked(), state = p.wells[0]!.interpretation.preparation!;
    for (const invalid of [{ ...state, schemaVersion: 2 }, { ...state, nodes: [{ ...state.nodes[0], methodVersion: 2 }] }, { ...state, hidden: true }]) expect(() => validatePreparation(invalid)).toThrow();
    expect(() => entryPreparationPlan({ ...p, inputRevisions: {} }, p.wells[0]!, registry)).toThrow(/revisión/);
    for (const range of [{ top: 8, base: 11 }, { top: 12, base: 11 }, { top: 10.2, base: 10.3 }]) expect(() => addMaskInterval(base(), well.id, 'GR', { id: 'x', ...range }, 'n')).toThrow();
  });
  it('guarda solo decisiones y originales en v7; reabrir reproduce calidad/datos y snapshots', async () => {
    const p = createSnapshot(masked(), well.id, 'Preparado', { id: 'snapshot' }).project;
    const text = await serializeProject(p), raw = JSON.parse(text);
    expect(raw.version).toBe(7); expect(raw.project.inputRevisions[p.wells[0]!.inputRevisionId!].well.curves).toHaveLength(1);
    const reopened = await deserializeProject(text), data = await evaluate(reopened);
    expect(data.payloads[0]!.data).toEqual(Float64Array.of(10, NaN, NaN, NaN, 50));
    expect(reopened.snapshots[0]!.interpretation.preparation).toEqual(p.snapshots[0]!.interpretation.preparation);
    expect(snapshotRunRequest(reopened, reopened.snapshots[0]!).preparation?.artifacts).toHaveLength(1);
  });
  it('rechaza el paquete incompleto y un contexto de otra receta', async () => {
    const { entry, plan, payloads } = await evaluate();
    expect(() => materializePreparation(entry.well, { plan, artifacts: [] }, plan.context, registry)).toThrow(/incompleto/);
    expect(() => materializePreparation(entry.well, { plan, artifacts: payloads }, { ...plan.context, preparationKey: 'wrong' }, registry)).toThrow(/corresponde/);
  });
  it('una puesta en profundidad distinta bloquea la receta, sin remuestrear ni desplazar originales', async () => {
    const p = masked(), source = p.wells[0]!.well.depth.values;
    const changed = updateWell(p, well.id, w => ({ ...w, depth: { ...w.depth, values: Float64Array.from(source, d => d + 1) } }));
    expect((await evaluate(changed)).plan.diagnostics[0]?.status).toBe('needs-input');
    expect(source).toEqual(Float64Array.of(10, 11, 12, 13, 14));
  });
  it.each(['version', 'reference', 'interval'])('rechaza %s inválido al abrir v7', async fault => {
    const file = JSON.parse(await serializeProject(masked())), state = file.project.wells[0].interpretation.preparation;
    if (fault === 'version') state.nodes[0].methodVersion = 2;
    if (fault === 'reference') state.nodes[0].input.inputRevisionId = 'missing';
    if (fault === 'interval') state.nodes[0].intervals[0].base = 0;
    await expect(deserializeProject(JSON.stringify(file))).rejects.toThrow();
  });
  it('aceptar migración, receta y fuente es un solo deshacer/rehacer; restaurar también es reversible', () => {
    const store = useProject.getState(); store.replace(base());
    const original = useProject.getState().project;
    store.commit('Excluir', p => addMaskInterval(p, well.id, 'GR', { id: 'range', top: 11, base: 13 }, 'mask'), { group: 'apply' });
    const accepted = useProject.getState().project;
    expect(accepted.inputRevisions).toBeDefined(); expect(accepted.wells[0]!.interpretation.sources.GR).toEqual({ kind: 'curve', curveId: 'prep:mask:masked' });
    store.undo(); expect(useProject.getState().project).toBe(original);
    store.redo(); expect(useProject.getState().project).toBe(accepted);
    store.commit('Restaurar', p => restoreMaskInterval(p, well.id, 'mask'), { group: 'restore' });
    expect(useProject.getState().project.wells[0]!.interpretation.preparation).toBeUndefined();
    store.undo(); expect(useProject.getState().project).toBe(accepted);
    store.replace(createProject());
  });
  it('LRU por bytes y cancelación por bloques no publican arrays parciales', async () => {
    const evaluator = new MaskEvaluator(50);
    const p = masked(); await evaluate(p, evaluator); expect(evaluator.retainedBytes).toBe(50);
    const q = addMaskInterval(p, well.id, 'GR', { id: 'extra', top: 14, base: 14 }, 'ignored');
    await evaluate(q, evaluator); expect(evaluator.retainedBytes).toBe(50);
    await expect(evaluate(p, new MaskEvaluator(49))).rejects.toThrow(/presupuesto/);
    const n = 33000;
    const big: Well = createWell({ id: 'big', name: 'B', depth: Float64Array.from({ length: n }, (_, k) => k), curves: [{ ...curve('GR', 'GR', new Float64Array(n)), origin: { kind: 'measured' } }] });
    const bp = addMaskInterval(addWell(createProject(), big), big.id, 'GR', { id: 'r', top: 1, base: 2 }, 'n');
    const e = bp.wells[0]!, plan = entryPreparationPlan(bp, e, registry); let cancel = false;
    const ev = new MaskEvaluator();
    await expect(ev.evaluate(toEngineWell(e.well), plan, () => cancel, async () => { cancel = true; })).rejects.toBeInstanceOf(PreparationCancelled);
    expect(ev.retainedBytes).toBe(0);
  });
  it('canal real publica preparación y motor juntos; quitar recetas vuelve a originales', async () => {
    const p = masked(), entry = p.wells[0]!, plan = entryPreparationPlan(p, entry, registry), client = createInProcessClient(registry);
    const run = (project: typeof p) => new Promise<ClientResult>((resolve, reject) => {
      const e = project.wells[0]!, next = entryPreparationPlan(project, e, registry);
      const off = client.subscribe(event => { if (event.type === 'result') { off(); resolve(event.result); } else if (event.type === 'error') { off(); reject(new Error(event.message)); } });
      client.syncWell(toEngineWell(e.well), next.context); client.run(e.interpretation, next.context, e.interpretation.preparation?.nodes.length ? next : undefined);
    });
    try {
      const result = await run(p);
      expect(result.context).toEqual(plan.context); expect(result.preparation?.artifacts[0]!.data).toEqual(Float64Array.of(10, NaN, NaN, NaN, 50));
      expect(result.outputs[0]?.value).toEqual(result.preparation?.artifacts[0]!.data);
      const columns = exportSources(entry.well, result, false, plan.context).columns;
      expect(columns.find(c => c.id.startsWith('q:'))?.data).toEqual(Float64Array.of(0, 3, 2, 2, 0));
      expect(columns.find(c => c.id === 'm:GR')?.data).toEqual(well.curves[0]!.data);
      expect(buildReportModel(entry.well, entry.interpretation, result, new Date(0), registry).warnings.some(w => w.includes('mediciones excluidas'))).toBe(true);
      const changed = addMaskInterval(p, well.id, 'GR', { id: 'more', top: 14, base: 14 }, 'ignored');
      const changedEntry = changed.wells[0]!, changedContext = entryPreparationPlan(changed, changedEntry, registry).context;
      expect(exportSources(entry.well, result, false, changedContext).columns.some(c => c.origin === 'prepared')).toBe(false);
      expect(buildReportModel(entry.well, changedEntry.interpretation, result, new Date(0), registry).methods).toHaveLength(0);
      const data = materializePreparation(entry.well, result.preparation!, result.context, registry);
      expect(() => calibrationKey(data, changedEntry.interpretation, { pointSetIds: ['lab'], methodVersion: 'test@1', pairing: { datum: 'MD', top: 10, base: 14, windowM: 1, aggregation: 'mean' }, configuration: {} })).toThrow(/obsoleto/);
      const original = await run(restoreMaskInterval(p, well.id, 'mask'));
      expect(original.preparation).toBeUndefined(); expect(original.outputs[0]?.value).toEqual(well.curves[0]!.data);
      expect(entry.well.curves[0]!.data.byteLength).toBe(40);
    } finally { client.dispose(); }
  });
});
