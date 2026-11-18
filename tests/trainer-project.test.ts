import { describe, expect, it } from 'vitest';
import { trainerCorrection } from '../src/app/trainer/correction';
import type { ClientResult } from '../src/core/engine/client';
import { computeOnce, toEngineWell } from '../src/core/engine/engine';
import { enableProjectInputRevisions } from '../src/core/state/inputRevisions';
import { entryPreparationPlan } from '../src/core/state/preparation';
import { activeWellEntry, addWell, createProject, setModuleEnabled, setParam, setSource, type Project } from '../src/core/state/project';
import { deserializeProject, serializeProject } from '../src/core/state/serialize';
import { createSnapshot, restoreSnapshot } from '../src/core/state/snapshots';
import { registry } from '../src/modules';
import { generateTrainerWell, type TrainerRecipe } from '../src/petro/trainer';

const recipe: TrainerRecipe = { version: 1, seed: 73154, noise: true };

function exercise(): Project {
  const { well, zones } = generateTrainerWell(recipe);
  const project = addWell(createProject(), { ...well, id: well.id + '-exercise' }, zones);
  return { ...project, wells: project.wells.map(entry => ({ ...entry, trainerRecipe: recipe })) };
}

function calculate(project: Project): ClientResult {
  const entry = activeWellEntry(project)!;
  const { context } = entryPreparationPlan(project, entry, registry);
  return {
    ...computeOnce(registry, toEngineWell(entry.well), entry.interpretation),
    context, wellId: entry.well.id, seq: 1, gen: 1, roundTripMs: 0, coalesced: 0,
  };
}

describe('Contrato del ejercicio', () => {
  it.each([6, 7] as const)('conserva solo la receta en v%s y el snapshot sigue guardando la interpretación', async version => {
    let project = exercise();
    if (version === 7) project = enableProjectInputRevisions(project);
    const id = project.activeWellId!;
    const { project: saved, snapshot } = createSnapshot(project, id, 'Antes de corregir');
    const text = await serializeProject(saved, { version });
    const archive = JSON.parse(text);
    expect(archive.project.wells[0].trainerRecipe).toEqual(recipe);
    expect(text).not.toMatch(/"truth"|"trainerRecipe"[^}]*"(phi|sw|vsh)"/i);
    expect(archive.project.snapshots[0]).not.toHaveProperty('trainerRecipe');

    const opened = await deserializeProject(text);
    expect(activeWellEntry(opened)?.trainerRecipe).toEqual(recipe);
    expect(activeWellEntry(opened)?.well.curves.map(c => c.role)).toEqual(['GR', 'RHOB', 'NPHI', 'RT']);
    const restored = restoreSnapshot(opened, snapshot.id);
    const result = calculate(restored);
    const corrected = trainerCorrection(restored, activeWellEntry(restored)!, result);
    expect(corrected.metrics.every(row => row.phi.valid === 400 && row.sw.valid === 400)).toBe(true);
    expect(activeWellEntry(restored)?.trainerRecipe).toEqual(recipe);
    expect(await serializeProject(restored, { version, savedAt: archive.savedAt })).toBe(text);
  });

  it('verifica el resultado vigente y usa la fuente que resolvió el motor', () => {
    const original = exercise();
    const id = original.activeWellId!;
    const stale = calculate(original);
    let changed = setParam(original, id, 'm', 2.1);
    changed = setSource(changed, id, 'SW', { kind: 'module', moduleId: 'sw-archie' });
    changed = setModuleEnabled(changed, id, 'sw-archie', false);
    const entry = activeWellEntry(changed)!;
    expect(() => trainerCorrection(changed, entry, stale)).toThrow(/interpretación vigente/);
    const current = calculate(changed);
    expect(current.sources.SW).toBeDefined();
    expect(current.sources.SW).not.toEqual(entry.interpretation.sources.SW);
    expect(trainerCorrection(changed, entry, current).sw).not.toBeNull();
  });
});
