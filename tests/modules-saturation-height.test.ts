import { describe, expect, it } from 'vitest';
import { entryContext } from '../src/app/preparation/data';
import { computeOnce, toEngineWell } from '../src/core/engine/engine';
import type { ClientResult } from '../src/core/engine/client';
import { emptyHistory, recordChange, redo, undo } from '../src/core/state/history';
import { getWellEntry, setSource, type Project } from '../src/core/state/project';
import { addPointSet, removePointSet } from '../src/core/state/pointSets';
import { deserializeProject, serializeProject } from '../src/core/state/serialize';
import { restoreSnapshot } from '../src/core/state/snapshots';
import { registry } from '../src/modules';
import { tpMdtSet } from '../src/modules/mdt/tp';
import { readHeightLab } from '../src/modules/saturation-height/lab';
import { applyHeightScenario, heightDecisionKey, heightPreview } from '../src/app/saturationHeight/model';
import { readHeightScenario, type HeightScenario } from '../src/modules/saturation-height/scenario';
import { saturationHeightFixture as fixture, saturationHeightLab, saturationHeightWellId as id } from './fixtures/saturation-height';

function run(project: Project) {
  const entry = getWellEntry(project, id);
  const result: ClientResult = {
    ...computeOnce(registry, toEngineWell(entry.well), entry.interpretation),
    context: entryContext(entry, project)!, seq: 1, gen: 1, wellId: id, roundTripMs: 0, coalesced: 0,
  };
  return { entry, result };
}

describe('Integración de saturación por altura', () => {
  it('usa selección MDT y unidades del perfil, conserva alturas negativas y reestima en TVD', () => {
    const { p, scenario } = fixture();
    const { entry, result } = run(p);
    const base = heightPreview(entry, result, readHeightScenario(scenario));
    expect(base.fwlM).toBeCloseTo(8000, 10);
    expect(base.tests).toEqual({ water: ['W1', 'W2', 'W3'], hydrocarbon: ['O1', 'O2', 'O3'] });
    expect(base.points.find(q => q.md === 7980)).toMatchObject({ h: 20, sw: 0.4, zoneId: 'upper' });
    expect(base.points.find(q => q.md === 8005)).toMatchObject({ h: -5, sw: 1, zoneId: 'lower' });
    const vertical = heightPreview(entry, result, { ...scenario, domainM: [7900, 8000],
      geometry: { kind: 'tvd', curveId: 'TVD', direction: 'down', offsetM: 0, maxGapM: 2, evidence: 'Trayectoria sintética del caso' } });
    expect(vertical.fwlM).toBeCloseTo(7950, 10);
    expect(vertical.points.find(q => q.md === 7980)?.h).toBeCloseTo(20, 10);
  });

  it('bloquea el eje MDT sin dos fases y deja el perfil con un FWL externo documentado', () => {
    const { p, scenario } = fixture();
    const real = addPointSet(removePointSet(p, id, 'fixture-mdt'), id, tpMdtSet('tp-mdt'));
    const { entry, result } = run(real);
    const unavailable = heightPreview(entry, result, scenario);
    expect(unavailable.fwlM).toBeNull();
    expect(unavailable.points).toHaveLength(0);
    const external = heightPreview(entry, result, { ...scenario, mdt: null,
      fwl: { kind: 'external', depthM: 8000, reference: 'Referencia externa del caso', uncertaintyM: 1, tolerancePa: null, toleranceReference: null, acceptEquality: false } });
    expect(external.points).toHaveLength(101);
    expect(external.lines).toHaveLength(0);
    expect(external.issues.join()).toMatch(/gradientes MDT/);
  });

  it('aplica un ensayo por clase, reproduce tras serialización y fija la revisión en una sola operación', async () => {
    const { p, scenario } = fixture();
    const lab = readHeightLab(JSON.stringify(saturationHeightLab), 'caso.json', 'capillary-1');
    const withLab = addPointSet(p, id, lab);
    const { entry, result } = run(withLab);
    const rockType = heightPreview(entry, result, scenario).points[0]?.rockType;
    expect(rockType).not.toBeNull();
    scenario.classes = [{ rockType: rockType!, reference: 'Ensayo del caso', conditions: 'Drenaje en reservorio',
      assignment: 'Igual clase y geometría', basis: { kind: 'reservoir', drainage: 'primary', phase: 'oil' }, saturationBasis: 'Agua mojante, base v/v', model: { kind: 'point-set', setId: lab.id, sample: 'plug-1' } }];
    const preview = heightPreview(entry, result, scenario);
    expect(preview.lines).toHaveLength(1);
    expect(preview.lines[0]?.h[1]).toBeCloseTo(20, 10);
    expect(preview.lines[0]?.sw[1]).toBeCloseTo(0.4, 10);
    const accepted = applyHeightScenario(withLab, entry, result, scenario, { zone: 'upper', rock: String(rockType) });
    expect(accepted.snapshots[0]?.inputBinding).toBe('pinned');
    expect(accepted.snapshots[0]?.inputRevisionId).toBe(getWellEntry(accepted, id).inputRevisionId);
    expect(getWellEntry(accepted, id).interpretation.sources).toEqual(entry.interpretation.sources);
    const history = recordChange(emptyHistory(), withLab, 'Aplicar escenario', 0);
    const undone = undo(history, accepted)!;
    expect(undone.project).toBe(withLab);
    expect(redo(undone.history, withLab)?.project).toBe(accepted);
    const reopened = await deserializeProject(await serializeProject(accepted));
    expect(heightDecisionKey(getWellEntry(reopened, id))).toBe(heightDecisionKey(entry));
    const edited = removePointSet(reopened, id, lab.id);
    const restored = restoreSnapshot(edited, accepted.snapshots[0]!.id);
    const rerun = run(restored);
    expect(heightPreview(rerun.entry, rerun.result, scenario).lines).toEqual(preview.lines);
    expect(() => applyHeightScenario(restored, entry, result, scenario, { zone: '*', rock: '*' })).toThrow(/cambiaron/);
  });

  it('rechaza laboratorio sin transferencia y un FWL externo sin sustento para combinarlo', () => {
    const { p, scenario } = fixture();
    const { entry, result } = run(p);
    const combined: HeightScenario = { ...scenario, fwl: {
      kind: 'external', depthM: 8000, reference: 'Referencia externa', uncertaintyM: 1, tolerancePa: 1000,
      toleranceReference: null, acceptEquality: true,
    } };
    const preview = heightPreview(entry, result, combined);
    expect(preview.fwlM).toBe(8000);
    expect(preview.admissible).toBe(false);
    expect(preview.issues.join()).toMatch(/tolerancia sustentada/);
    expect(() => readHeightScenario({ ...scenario, classes: [{
      rockType: 0, reference: 'Informe', conditions: 'MICP', assignment: 'Clase', saturationBasis: 'Equivalencia propuesta',
      basis: { kind: 'lab', drainage: 'primary', phase: 'oil', wetting: 'aire', nonWetting: 'mercurio', angleConvention: 'En Hg' },
      model: { kind: 'point-set', setId: 'test', sample: 'plug' },
    }] })).toThrow(/transferencia de laboratorio/);
  });

  it('respeta fuentes explícitas que dejaron de estar disponibles', () => {
    const { p, scenario } = fixture();
    const broken = setSource(p, id, 'SW', { kind: 'curve', curveId: 'missing-prepared-sw' });
    const { entry, result } = run(broken);
    const preview = heightPreview(entry, result, scenario);
    expect(preview.points).toHaveLength(0);
    expect(preview.issues.join()).toMatch(/fuente efectiva.*Sw/);
  });
});
