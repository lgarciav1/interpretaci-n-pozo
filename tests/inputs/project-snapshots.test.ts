import { afterEach, describe, expect, it, vi } from 'vitest';
import { newInputRevisionStamp } from '../../src/core/inputs/identity';
import { inputRevisionIdFromBytes } from '../../src/core/inputs/revisions';
import { enableProjectInputRevisions, projectInputState, resolveSnapshotInputs, reviseProjectInputs, type RevisionStampFactory } from '../../src/core/state/inputRevisions';
import { addWell, createProject, getWellEntry, setActiveWell, setParam, setStepMark, updateCurveMeta, updateWell, type Project } from '../../src/core/state/project';
import { createSnapshot, deleteSnapshot, restoreSnapshot } from '../../src/core/state/snapshots';
import { addPointSet, removePointSet, renamePointSet, setPointDecision } from '../../src/core/state/pointSets';
import { emptyHistory, recordChange, redo, undo } from '../../src/core/state/history';
import { deserializeProject, serializeProject } from '../../src/core/state/serialize';
import { createPointSet } from '../../src/core/pointSets';
import { createWell } from '../../src/core/well';
import { snapshotCurtainIssue, snapshotRunRequest } from '../../src/app/snapshots/request';
import { IsolatedRunner, type RunEntry } from '../../src/app/snapshots/runner';
import { EngineSupervisor } from '../../src/core/engine/supervisor';
import { createInProcessClient } from '../../src/core/engine/client';
import { createRegistry } from '../../src/core/registry';
import { linearModule } from '../helpers';
import { useProject } from '../../src/app/store/project';

const date = '2026-10-29T00:00:00.000Z';
function stampFactory(): RevisionStampFactory {
  let n = 0;
  return () => { const bytes = new Uint8Array(16); new DataView(bytes.buffer).setUint32(12, ++n); return { id: inputRevisionIdFromBytes(bytes), createdAt: date }; };
}
function core(id = 'core', value = 0.2) {
  return createPointSet({ id, name: id, kind: 'core', depth: Float64Array.from([1000.25]), pointIds: ['plug'], columns: { phi: { label: 'Porosidad', unit: 'v/v', values: Float64Array.from([value]) } } });
}
function well(id = 'w') {
  return createWell({ id, name: 'Pozo', depth: Float64Array.from([1000, 1000.5, 1001]), curves: [{ id: 'GR', mnemonic: 'GR', role: 'GR', unit: 'gAPI', data: Float64Array.from([10, 20, 30]), origin: { kind: 'measured' } }], pointSets: [core()] });
}
const legacy = () => addWell(createProject('Proyecto'), well(), [{ id: 'a', name: 'A', top: 1000, base: 1001, color: '#888888', kind: 'formation' }]);
const entry = (p: Project, id = 'w') => getWellEntry(p, id);
const versioned = () => enableProjectInputRevisions(legacy(), stampFactory());
const snapshot = (p: Project, id = 'snap-a') => createSnapshot(p, 'w', 'Base', { id, createdAt: date });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('Project y revisiones optativas', () => {
  it('los proyectos y snapshots normales siguen en v6 sin activación automática', async () => {
    const { project: p } = snapshot(legacy());
    expect(projectInputState(p)).toBeNull();
    expect(p).not.toHaveProperty('inputRevisions');
    expect(p.snapshots[0]).not.toHaveProperty('inputRevisionId');
    expect(JSON.parse(await serializeProject(p, { codec: 'f64le-b64' })).version).toBe(6);
  });
  it('la activación captura aliases, conserva decisiones y marca el límite de snapshots antiguos', () => {
    const { project: old } = snapshot(legacy());
    const p = enableProjectInputRevisions(old, stampFactory());
    expect(entry(p).well).not.toBe(entry(old).well);
    expect(entry(p).well).toBe(p.inputRevisions![entry(p).inputRevisionId!]!.well);
    expect(entry(p).interpretation).toBe(entry(old).interpretation);
    expect(entry(p).progress).toBe(entry(old).progress);
    expect(p.display).toBe(old.display);
    expect(p.snapshots[0]!.inputBinding).toBe('legacy-current-inputs');
    expect(resolveSnapshotInputs(p, p.snapshots[0]!).well).toBe(entry(p).well);
    expect(old.snapshots[0]).not.toHaveProperty('inputRevisionId');
    expect(enableProjectInputRevisions(p, () => { throw new Error('No generar'); })).toBe(p);
  });
  it('un proyecto vacío puede activarse y agregar pozos con revisiones sin mezclar aliases', () => {
    const stamps = stampFactory();
    let p = enableProjectInputRevisions(createProject(), stamps);
    p = addWell(p, well(), [], stamps);
    p = addWell(p, well('w2'), [], stamps);
    expect(Object.keys(p.inputRevisions!)).toHaveLength(2);
    for (const e of p.wells) expect(e.well).toBe(p.inputRevisions![e.inputRevisionId!]!.well);
    expect(() => projectInputState(p)).not.toThrow();
  });
  it('una edición de datos crea hija sin mutar el padre; cambiar parámetros no crea revisión', () => {
    const p = versioned();
    const old = entry(p);
    const changed = updateWell(p, 'w', (draft) => { draft.curves[0]!.data[0] = 99; return draft; });
    expect(entry(changed).inputRevisionId).not.toBe(old.inputRevisionId);
    expect(changed.inputRevisions![entry(changed).inputRevisionId!]!.parentRevisionId).toBe(old.inputRevisionId);
    expect(old.well.curves[0]!.data[0]).toBe(10);
    expect(entry(changed).well.curves[0]!.data[0]).toBe(99);
    const param = setParam(changed, 'w', 'grClean', 45);
    expect(param.inputRevisions).toBe(changed.inputRevisions);
    expect(entry(param).inputRevisionId).toBe(entry(changed).inputRevisionId);
  });
  it('no-op por contenido no consume ids ni reloj y no registra un proyecto nuevo', () => {
    const p = versioned(); const stamps = vi.fn(() => { throw new Error('No generar'); });
    expect(updateWell(p, 'w', (draft) => draft, stamps)).toBe(p);
    expect(reviseProjectInputs(p, 'w', {}, stamps)).toBe(p);
    expect(updateCurveMeta(p, 'w', 'GR', { role: 'GR' })).toBe(p);
    expect(stamps).not.toHaveBeenCalled();
  });
  it('asignar rol o cambiar laboratorio por las recetas existentes produce revisiones', () => {
    const p = versioned();
    const meta = updateCurveMeta(p, 'w', 'GR', { role: null });
    expect(entry(meta).inputRevisionId).not.toBe(entry(p).inputRevisionId);
    expect(entry(meta).well.curves[0]!.data).toBe(entry(p).well.curves[0]!.data);
    const added = addPointSet(meta, 'w', core('otra', 0.3));
    const renamed = renamePointSet(added, 'w', 'otra', 'Corona nueva');
    const removed = removePointSet(renamed, 'w', 'core');
    expect(new Set([p, meta, added, renamed, removed].map((x) => entry(x).inputRevisionId)).size).toBe(5);
    expect(entry(p).well.pointSets.map((x) => x.id)).toEqual(['core']);
    expect(entry(removed).well.pointSets.map((x) => x.name)).toEqual(['Corona nueva']);
  });
  it('un callback que muta y falla no publica ni altera datos del proyecto', () => {
    const p = versioned();
    expect(() => updateWell(p, 'w', (draft) => { draft.curves[0]!.data[0] = 999; throw new Error('Fallo'); })).toThrow('Fallo');
    expect(entry(p).well.curves[0]!.data[0]).toBe(10);
    expect(Object.keys(p.inputRevisions!)).toHaveLength(1);
    expect(() => updateWell(p, 'w', (draft) => ({ ...draft, id: 'otro' }))).toThrow(/id del pozo/);
  });
  it('cambiar adquisición crea revisión sin duplicar Well', () => {
    const p = versioned(); const s = projectInputState(p)!;
    const previous = s.revisions[entry(p).inputRevisionId!]!;
    const a = structuredClone(previous.acquisition); a.depth.datum = 'KB';
    const changed = reviseProjectInputs(p, 'w', { acquisition: a });
    expect(entry(changed).well).toBe(entry(p).well);
    expect(entry(changed).inputRevisionId).not.toBe(entry(p).inputRevisionId);
    a.depth.datum = 'DF';
    expect(projectInputState(changed)!.revisions[entry(changed).inputRevisionId!]!.acquisition.depth.datum).toBe('KB');
  });
  it('el store rechaza aliases inconsistentes antes de publicar o registrar historial', () => {
    const p = versioned(); useProject.getState().replace(p);
    const history = useProject.getState().history;
    expect(() => useProject.getState().commit('Cambio inválido', (x) => ({ ...x, wells: [{ ...entry(x), well: structuredClone(entry(x).well) }] }))).toThrow(/alias/);
    expect(useProject.getState().project).toBe(p);
    expect(useProject.getState().history).toBe(history);
    expect(() => useProject.getState().replace({ ...p, inputRevisions: undefined })).toThrow(/almacén/);
    expect(useProject.getState().project).toBe(p);
    useProject.getState().replace(createProject());
  });
  it('commit y undo/redo conservan juntos la revisión y el Well activo', () => {
    const p = versioned(); useProject.getState().replace(p);
    useProject.getState().commit('Editar curva', (x) => updateWell(x, 'w', (draft) => { draft.curves[0]!.data[0] = 77; return draft; }));
    const edited = useProject.getState().project;
    expect(entry(edited).inputRevisionId).not.toBe(entry(p).inputRevisionId);
    useProject.getState().undo(); expect(useProject.getState().project).toBe(p);
    useProject.getState().redo(); expect(useProject.getState().project).toBe(edited);
    expect(() => projectInputState(edited)).not.toThrow();
    useProject.getState().replace(createProject());
  });
});

describe('snapshots fijados y restauración', () => {
  it('recupera curvas, laboratorio y decisiones juntos; conserva progreso, display y pozo activo', () => {
    let p = setPointDecision(versioned(), 'w', 'core', 'plug', { status: 'exclude' });
    p = setParam(p, 'w', 'grClean', 20);
    const saved = snapshot(p);
    const id = saved.snapshot.inputRevisionId!;
    expect(saved.snapshot.inputBinding).toBe('pinned');
    let changed = updateWell(saved.project, 'w', (draft) => { draft.curves[0]!.data[0] = 88; draft.pointSets = [core('nueva', 0.4)]; return draft; });
    changed = setParam(changed, 'w', 'grClean', 50);
    changed = setStepMark(changed, 'w', 'qc', 'done');
    changed = setActiveWell(addWell(changed, well('w2')), 'w2');
    const restored = restoreSnapshot(changed, saved.snapshot.id);
    expect(entry(restored).inputRevisionId).toBe(id);
    expect(entry(restored).well).toBe(restored.inputRevisions![id]!.well);
    expect(entry(restored).well.curves[0]!.data[0]).toBe(10);
    expect(entry(restored).well.pointSets[0]!.id).toBe('core');
    expect(entry(restored).interpretation.params.global['grClean']).toBe(20);
    expect(entry(restored).interpretation.pointSets['core']!.points['plug']!.status).toBe('exclude');
    expect(entry(restored).progress).toBe(entry(changed).progress);
    expect(restored.display).toBe(changed.display);
    expect(restored.activeWellId).toBe('w2');
    expect(entry(restored, 'w2')).toBe(entry(changed, 'w2'));
    expect(restored.inputRevisions).toBe(changed.inputRevisions);
    expect(entry(changed).well.curves[0]!.data[0]).toBe(88);
  });
  it('quitar laboratorio y restaurar recupera también las decisiones eliminadas', () => {
    const saved = snapshot(setPointDecision(versioned(), 'w', 'core', 'plug', { status: 'exclude' }));
    const changed = removePointSet(saved.project, 'w', 'core');
    expect(entry(changed).interpretation.pointSets['core']).toBeUndefined();
    const restored = restoreSnapshot(changed, saved.snapshot.id);
    expect(entry(restored).well.pointSets[0]!.id).toBe('core');
    expect(entry(restored).interpretation.pointSets['core']!.points['plug']!.status).toBe('exclude');
  });
  it('deshacer/rehacer restaura proyectos completos y permite ramificar desde un snapshot anterior', () => {
    const saved = snapshot(versioned());
    const edited = updateWell(saved.project, 'w', (w) => ({ ...w, name: 'Editado' }));
    const history = recordChange(emptyHistory(), saved.project, 'Editar datos', 1000);
    const back = undo(history, edited)!;
    expect(back.project).toBe(saved.project);
    expect(redo(back.history, back.project)!.project).toBe(edited);
    const restored = restoreSnapshot(edited, saved.snapshot.id);
    const branched = updateWell(restored, 'w', (w) => ({ ...w, name: 'Otra rama' }));
    expect(branched.inputRevisions![entry(branched).inputRevisionId!]!.parentRevisionId).toBe(saved.snapshot.inputRevisionId);
    expect(Object.keys(branched.inputRevisions!)).toHaveLength(3);
    expect(() => projectInputState(branched)).not.toThrow();
  });
  it('borrar un snapshot no borra revisiones ni altera otro snapshot', () => {
    const a = snapshot(versioned()); const b = snapshot(a.project, 'snap-b');
    const removed = deleteSnapshot(b.project, 'snap-a');
    expect(removed.inputRevisions).toBe(b.project.inputRevisions);
    expect(removed.snapshots).toEqual([b.snapshot]);
  });
  it.each(['alias', 'missing', 'binding', 'foreign', 'partial'])('rechaza %s y nunca usa el Well activo como respaldo', (fault) => {
    const saved = snapshot(versioned());
    let p: Project = saved.project;
    if (fault === 'alias') p = { ...p, wells: [{ ...entry(p), well: structuredClone(entry(p).well) }] };
    if (fault === 'missing') p = { ...p, snapshots: [{ ...saved.snapshot, inputRevisionId: 'input-' + 'f'.repeat(32) }] };
    if (fault === 'binding') p = { ...p, snapshots: [{ ...saved.snapshot, inputBinding: undefined }] };
    if (fault === 'foreign') p = { ...p, snapshots: [{ ...saved.snapshot, wellId: 'otro' }] };
    if (fault === 'partial') p = { ...p, inputRevisions: undefined };
    expect(() => restoreSnapshot(p, saved.snapshot.id)).toThrow();
    expect(() => snapshotRunRequest(p, p.snapshots[0]!)).toThrow();
    expect(entry(saved.project).well.curves[0]!.data[0]).toBe(10);
  });
});

describe('frontera de persistencia', () => {
  it('rechaza guardar revisiones como v6 antes de descartar datos', async () => {
    await expect(serializeProject(snapshot(versioned()).project)).rejects.toThrow(/copia incompleta/);
    await expect(serializeProject(enableProjectInputRevisions(createProject()))).rejects.toThrow(/v6/);
  });
  it.each(['root', 'well', 'snapshot'])('rechaza un archivo v6 con marcador de revisiones en %s', async (where) => {
    const p = snapshot(legacy()).project;
    const raw = JSON.parse(await serializeProject(p, { codec: 'f64le-b64' }));
    if (where === 'root') raw.project.inputRevisions = {};
    if (where === 'well') raw.project.wells[0].inputRevisionId = 'falta';
    if (where === 'snapshot') raw.project.snapshots[0].inputBinding = 'pinned';
    await expect(deserializeProject(JSON.stringify(raw))).rejects.toThrow(/referencias/);
    expect(projectInputState(p)).toBeNull();
  });
});

describe('identidad y fallback offline', () => {
  it('usa 16 bytes de entropía y un reloj explícito', () => {
    const s = newInputRevisionStamp({}, { entropy: (b) => b.fill(0x21), now: () => new Date(date) });
    expect(s).toEqual({ id: 'input-' + '21'.repeat(16), createdAt: date });
  });
  it('funciona sin crypto y sin fecha como fuente de id', () => {
    vi.stubGlobal('crypto', undefined);
    expect(newInputRevisionStamp({}, { random: () => 0.25, now: () => new Date(date) }).id).toBe('input-' + '40'.repeat(16));
  });
  it('usa fallback si la plataforma expone crypto pero falla al invocarlo', () => {
    expect(newInputRevisionStamp({}, { entropy: () => { throw new Error('No disponible'); }, random: () => 0.5 }).id).toBe('input-' + '80'.repeat(16));
  });
  it('reintenta colisiones y solo lee el reloj al obtener un id nuevo', () => {
    const s = projectInputState(versioned())!;
    const first = entry(versioned()).inputRevisionId!;
    let attempts = 0; const now = vi.fn(() => new Date(date));
    const stamp = newInputRevisionStamp(s.revisions, { entropy: (b) => { if (++attempts === 1) b[15] = 1; else b.fill(3); }, now });
    expect(stamp.id).not.toBe(first); expect(attempts).toBe(2); expect(now).toHaveBeenCalledTimes(1);
  });
  it('ocho colisiones terminan en error sin bucle infinito', () => {
    const state = projectInputState(versioned())!; const entropy = vi.fn((b: Uint8Array) => { b[15] = 1; });
    expect(() => newInputRevisionStamp(state.revisions, { entropy })).toThrow(/ocho/);
    expect(entropy).toHaveBeenCalledTimes(8);
  });
  it.each([NaN, Infinity, -0.1, 1])('rechaza fallback inválido %s', (value) => {
    expect(() => newInputRevisionStamp({}, { entropy: null, random: () => value })).toThrow(/fuente de identidad/);
  });
});

const smallRegistry = createRegistry([linearModule('igr', 'GR', 'IGR')]);
function settled(runner: IsolatedRunner, key: string): Promise<RunEntry> {
  return new Promise((resolve) => {
    const check = () => { const e = runner.get(key); if (e && e.status !== 'pending') { off(); resolve(e); } };
    const off = runner.subscribe(check); check();
  });
}
describe('comparación aislada sobre la revisión correcta', () => {
  it('calcula el snapshot con sus curvas originales después de editar las activas', async () => {
    const saved = snapshot(versioned());
    const current = updateWell(saved.project, 'w', (draft) => { draft.curves[0]!.data.fill(99); return draft; });
    const request = snapshotRunRequest(current, saved.snapshot);
    const runner = new IsolatedRunner(() => new EngineSupervisor({ createInProcess: () => createInProcessClient(smallRegistry) }));
    const release = runner.acquire(request.key, request.engineWell, request.interpretation);
    const result = await settled(runner, request.key);
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw new Error('Falta corrida');
    expect(Array.from(result.result.outputs.find((o) => o.key === 'igr:IGR')!.value as Float64Array)).toEqual([10, 20, 30]);
    expect(Array.from(entry(current).well.curves[0]!.data)).toEqual([99, 99, 99]);
    expect(request.well).toBe(current.inputRevisions![saved.snapshot.inputRevisionId!]!.well);
    release();
  });
  it('la clave cambia con la revisión aunque el Well y la interpretación sean los mismos', () => {
    const saved = snapshot(versioned()); const old = snapshotRunRequest(saved.project, saved.snapshot);
    const a = structuredClone(projectInputState(saved.project)!.revisions[saved.snapshot.inputRevisionId!]!.acquisition); a.depth.datum = 'KB';
    const changed = reviseProjectInputs(saved.project, 'w', { acquisition: a });
    const request = snapshotRunRequest(changed, { ...saved.snapshot, inputRevisionId: entry(changed).inputRevisionId });
    expect(request.well).toBe(old.well);
    expect(request.interpretation).toBe(old.interpretation);
    expect(request.key).not.toBe(old.key);
  });
  it('resuelve el índice propio del snapshot y bloquea su cortina con otra grilla', () => {
    const saved = snapshot(versioned());
    const changed = updateWell(saved.project, 'w', (w) => createWell({ ...w, depth: Float64Array.from([1000, 1001, 1002, 1003]), curves: [{ ...w.curves[0]!, data: Float64Array.from([1, 2, 3, 4]) }] }));
    const request = snapshotRunRequest(changed, saved.snapshot);
    expect(request.engineWell.depth).toHaveLength(3);
    expect(entry(changed).well.depth.values).toHaveLength(4);
    expect(snapshotCurtainIssue(entry(changed).well, request.well)).toMatch(/índices/);
  });
  it('permite grillas/laboratorio iguales por contenido y bloquea laboratorio distinto', () => {
    const w = well();
    expect(snapshotCurtainIssue(w, structuredClone(w))).toBeNull();
    const other = structuredClone(w); other.pointSets = [core('core', 0.4)];
    expect(snapshotCurtainIssue(w, other)).toMatch(/datos puntuales/);
  });
});

const files = import.meta.glob<string>('../fixtures/projects/v*.pozo.json', { query: '?raw', import: 'default', eager: true });
describe.each(Object.entries(files))('activación de corpus: %s', (_, text) => {
  it('conserva todos los datos/decisiones y liga snapshots antiguos sin inventar historia', async () => {
    const old = await deserializeProject(text);
    const p = enableProjectInputRevisions(old, stampFactory());
    expect(p.wells.map((e) => e.well)).toEqual(old.wells.map((e) => e.well));
    expect(p.wells.map((e) => e.interpretation)).toEqual(old.wells.map((e) => e.interpretation));
    for (const s of p.snapshots) {
      expect(s.inputBinding).toBe('legacy-current-inputs');
      expect(resolveSnapshotInputs(p, s).well).toBe(entry(p, s.wellId).well);
    }
    expect(projectInputState(old)).toBeNull();
    await expect(serializeProject(p)).rejects.toThrow(/v6/);
  });
});
