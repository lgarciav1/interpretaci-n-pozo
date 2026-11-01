import { describe, expect, it } from 'vitest';
import { scanSuspects } from '../src/core/preparation/suspects';
import { PreparationCancelled } from '../src/core/preparation/evaluate';
import { addMaskIntervals, entryPreparationPlan, restoreMaskInterval } from '../src/core/state/preparation';
import { addWell, createProject } from '../src/core/state/project';
import { createWell } from '../src/core/well';
import { curve } from './helpers';
import { createRegistry } from '../src/core/registry';
import { MaskEvaluator } from '../src/core/preparation/evaluate';
import { toEngineWell } from '../src/core/engine/engine';
import { serializeProject, deserializeProject } from '../src/core/state/serialize';
import { useProject } from '../src/app/store/project';

const opts = { top: 0, base: 100000, minDeviation: 1, maxGapM: 1 };
const scan = (data: number[], options = opts) => scanSuspects(Float64Array.from(data, (_, i) => i), Float64Array.from(data), options);
describe('propuestas locales de espurios v1', () => {
  it('calcula mediana y MAD de seis vecinos sin incluir el centro; caso numérico independiente', async () => {
    const result = await scan([1, 2, 3, 50, 4, 5, 6]);
    expect(result.evaluated).toBe(1);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ index: 3, depth: 3, value: 50, median: 3.5 });
    expect(result.candidates[0]!.threshold).toBeCloseTo(6.6717, 10);
  });
  it('MAD cero exige superar estrictamente el piso explícito, con escala y signo conservados', async () => {
    expect((await scan([10, 10, 10, 11, 10, 10, 10])).candidates).toHaveLength(0);
    expect((await scan([10, 10, 10, -50, 10, 10, 10])).candidates[0]!.value).toBe(-50);
    expect((await scan([10, 10, 10, 11.01, 10, 10, 10])).candidates).toHaveLength(1);
    expect((await scan([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])).candidates).toHaveLength(0);
    expect((await scan([0, 0, 0, 0, 10, 10, 10, 10])).candidates).toHaveLength(0);
  });
  it('no cruza NaN, máscaras, saltos MD ni bordes del tramo; no evalúa extremos', async () => {
    const values = Float64Array.of(0, 0, 0, 50, 0, 0, 0), depth = Float64Array.of(0, 1, 2, 3, 4, 5, 6);
    expect((await scanSuspects(depth, values, opts, [{ top: 3, base: 3 }])).evaluated).toBe(0);
    expect((await scan([0, 0, NaN, 50, 0, 0, 0])).evaluated).toBe(0);
    expect((await scanSuspects(Float64Array.of(0, 1, 2, 10, 11, 12, 13), values, opts)).evaluated).toBe(0);
    expect((await scan([...values], { ...opts, top: 1 })).evaluated).toBe(0);
    expect((await scan([50, 0, 0, 0, 0, 0, 50])).candidates).toHaveLength(0);
    expect((await scan([1, 2, 3])).evaluated).toBe(0);
  });
  it('rechaza parámetros inválidos e índice inconsistente sin modificar arrays', async () => {
    for (const extra of [{ minDeviation: 0 }, { maxGapM: -1 }, { top: NaN }, { top: 8, base: 2 }]) await expect(scan([0, 0, 0, 50, 0, 0, 0], { ...opts, ...extra })).rejects.toThrow();
    await expect(scanSuspects(Float64Array.of(0, 0), Float64Array.of(1, 2), opts)).rejects.toThrow(/creciente/);
    await expect(scan([0, 0, Infinity, 0])).rejects.toThrow(/infinitos/);
    await expect(scanSuspects(Float64Array.of(0), new Float64Array(0), opts)).rejects.toThrow();
    const values = Float64Array.of(-0, 0, 0, 50, 0, 0, NaN), before = new Uint8Array(values.buffer).slice();
    await scanSuspects(Float64Array.from(values, (_, i) => i), values, opts);
    expect(new Uint8Array(values.buffer)).toEqual(before);
  });
  it('cancela por bloques y acota candidatos, indicando truncamiento', async () => {
    const data = Float64Array.from({ length: 9000 }, (_, i) => i % 10 === 3 ? 50 : 0), depth = Float64Array.from(data, (_, i) => i);
    const result = await scanSuspects(depth, data, opts);
    expect(result.truncated).toBe(true); expect(result.candidates).toHaveLength(256);
    let cancelled = false;
    await expect(scanSuspects(depth, new Float64Array(9000), opts, [], () => cancelled, async () => { cancelled = true; })).rejects.toBeInstanceOf(PreparationCancelled);
  });
  it('el lote elegido conserva originales y persiste como exclusiones manuales reversibles, en un undo', async () => {
    const well = createWell({ id: 'w', name: 'W', depth: Float64Array.from({ length: 15 }, (_, i) => i), curves: [{ ...curve('GR', 'GR', [0, 0, 0, 50, 0, 0, 0, 0, 0, 0, -50, 0, 0, 0, 0]), origin: { kind: 'measured' } }] });
    const original = addWell(createProject(), well), registry = createRegistry([]);
    const found = await scanSuspects(well.depth.values, well.curves[0]!.data, opts);
    expect(found.candidates.map(c => c.index)).toEqual([3, 10]);
    const store = useProject.getState(); store.replace(original);
    store.commit('Excluir elegidas', p => addMaskIntervals(p, 'w', 'GR', found.candidates.map((c, i) => ({ id: `r${i}`, top: c.depth, base: c.depth })), 'mask'), { group: 'batch' });
    const accepted = useProject.getState().project;
    store.undo(); expect(useProject.getState().project).toBe(original);
    store.redo(); expect(useProject.getState().project).toBe(accepted);
    const restored = await deserializeProject(await serializeProject(accepted)), entry = restored.wells[0]!;
    const plan = entryPreparationPlan(restored, entry, registry);
    const [payload] = await new MaskEvaluator().evaluate(toEngineWell(entry.well), plan);
    expect(payload!.quality[3]).toBe(2); expect(payload!.quality[10]).toBe(2);
    expect(Number.isNaN(payload!.data[3])).toBe(true);
    expect(entry.well.curves[0]!.data[3]).toBe(50);
    const single = restoreMaskInterval(restored, 'w', 'mask', 'r0');
    expect(single.wells[0]!.interpretation.preparation!.nodes[0]!.intervals).toHaveLength(1);
    expect(() => addMaskIntervals(original, 'w', 'GR', [{ id: 'r', top: 3, base: 3 }, { id: 'r', top: 10, base: 10 }], 'm')).toThrow();
    expect(() => addMaskIntervals(original, 'w', 'GR', [], 'm')).toThrow();
    expect(original.inputRevisions).toBeUndefined(); store.replace(createProject());
  });
});
