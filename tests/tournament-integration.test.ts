import { describe, expect, it } from 'vitest';
import { createWell } from '../src/core/well';
import { curve } from './helpers';
import { addWell, createProject, setParam } from '../src/core/state/project';
import { entryPreparationPlan, addMaskInterval } from '../src/core/state/preparation';
import { toEngineWell, computeOnce } from '../src/core/engine/engine';
import { curveProvenance } from '../src/core/engine/context';
import { runTournamentTask } from '../src/core/tournament/run';
import { applyTournament } from '../src/core/tournament/recipe';
import { tournamentInterpretation, evaluateTournament, type TournamentObservation } from '../src/petro/modelTournament';
import { registry } from '../src/modules';
import { resolveSnapshotInputs } from '../src/core/state/inputRevisions';
import { MaskEvaluator } from '../src/core/preparation/evaluate';
import { projectedEngineCurves } from '../src/core/preparation/plan';
import { serializeProject, deserializeProject } from '../src/core/state/serialize';

const build = () => {
  const n = 8;
  const values = (v: number) => Array<number>(n).fill(v);
  const well = createWell({ id: 'tournament', name: 'Sintético F22', depth: Float64Array.from({ length: n }, (_, i) => 1000 + i), curves: [
    curve('GR', 'GR', values(35)), curve('RHOB', 'RHOB', values(2.32)), curve('NPHI', 'NPHI', values(0.2)), curve('DT', 'DT', values(80)), curve('RT', 'RT', values(20)),
  ].map(c => ({ ...c, origin: { kind: 'measured' as const } })) });
  return addWell(createProject(), well);
};
const observations: TournamentObservation[] = Array.from({ length: 8 }, (_, i) => ({ id: `core:${i}`, depth: 1000 + i, value: 0.2, usage: 'evaluation' }));
const request = (project: ReturnType<typeof build>) => {
  const entry = project.wells[0]!, preparation = entryPreparationPlan(project, entry, registry), raw = toEngineWell(entry.well);
  return { well: { ...raw, curves: raw.curves.map(c => ({ ...c, provenance: curveProvenance(c, preparation.context.depthKey) })) }, interpretation: entry.interpretation, preparation, observations };
};

describe('F22 integración aislada y aplicación', () => {
  it('reconstruye plan tras structured clone como worker y aplica la cadena exacta con snapshot fijado', async () => {
    const original = build();
    const project = addMaskInterval(original, 'tournament', 'GR', { id: 'mask', top: 1000, base: 1000 }, 'gr-mask');
    const entry = project.wells[0]!, captured = request(project);
    const before = entry.well.curves.map(c => Array.from(c.data));
    const inconsistent = structuredClone(captured);
    inconsistent.interpretation.params.global.m = 2.5;
    await expect(runTournamentTask(inconsistent, registry)).rejects.toThrow(/contexto/);
    const result = await runTournamentTask(structuredClone(captured), registry);
    const row = result.rows.find(r => r.applicable)!;
    expect(row).toBeDefined();
    const accepted = applyTournament(project, entry.well.id, entry, row.candidate, result);
    const appliedEntry = accepted.wells[0]!;
    expect(appliedEntry.interpretation.preparation).toBe(entry.interpretation.preparation);
    expect(appliedEntry.well.curves.map(c => Array.from(c.data))).toEqual(before);
    expect(project.snapshots).toHaveLength(0);
    expect(accepted.snapshots).toHaveLength(1);
    expect(accepted.snapshots[0]!.inputBinding).toBe('pinned');
    const inputs = resolveSnapshotInputs(accepted, accepted.snapshots[0]!);
    expect(inputs.well).toBe(appliedEntry.well);
    const plan = entryPreparationPlan(accepted, appliedEntry, registry);
    const payload = await new MaskEvaluator().evaluate(toEngineWell(appliedEntry.well), plan);
    const engineWell = { ...toEngineWell(appliedEntry.well), curves: projectedEngineCurves(toEngineWell(appliedEntry.well), plan, payload) };
    const rerun = evaluateTournament(registry, engineWell, appliedEntry.interpretation, observations);
    expect(rerun.rows.find(r => r.candidate.id === row.candidate.id)?.phi).toEqual(row.phi);
    const preview = computeOnce(registry, engineWell, tournamentInterpretation(entry.interpretation, row.candidate));
    const applied = computeOnce(registry, engineWell, appliedEntry.interpretation);
    for (const port of ['VSH', 'PHIT', 'PHIE', 'SW']) expect(applied.outputs.find(o => o.active && o.port === port)?.value).toEqual(preview.outputs.find(o => o.active && o.port === port)?.value);
    const reopened = await deserializeProject(await serializeProject(accepted));
    expect(reopened.snapshots[0]!.inputBinding).toBe('pinned');
  });
  it('rechaza cambios de contexto y soporte común insuficiente sin modificar proyecto', async () => {
    const project = build(), entry = project.wells[0]!;
    const result = await runTournamentTask(request(project), registry), row = result.rows.find(r => r.applicable)!;
    expect(() => applyTournament(project, entry.well.id, entry, row.candidate, { ...result, executionContext: { ...result.executionContext!, wellId: 'other' } })).toThrow(/contexto/);
    const changed = setParam(project, entry.well.id, 'm', 2.1);
    expect(() => applyTournament(changed, entry.well.id, entry, row.candidate, result)).toThrow(/obsoleto/);
    const unsupported = { ...result, rows: result.rows.map(r => ({ ...r, commonPhi: { ...r.commonPhi, n: 4, supported: false } })) };
    expect(() => applyTournament(project, entry.well.id, entry, row.candidate, unsupported)).toThrow(/soporte/);
    expect(project.snapshots).toHaveLength(0);
  });
});
