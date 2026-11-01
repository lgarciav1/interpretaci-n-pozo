/** Conexión optativa de P1b. No se activa desde la UI hasta disponer de persistencia de revisiones. */
import { newInputRevisionStamp } from '../inputs/identity';
import { addInitialInputRevision, emptyInputRevisions, reviseInputRevision, validateInputRevisionState, type InputChanges, type InputRevision, type InputRevisionState, type RevisionStamp } from '../inputs/revisions';
import type { Interpretation } from '../interpretation';
import type { Well } from '../well';
import type { Project, Snapshot } from './project';
import { preparationBindings } from '../preparation/bindings';

export type RevisionStampFactory = (wellId: string, state: InputRevisionState) => RevisionStamp;
export const defaultRevisionStamp: RevisionStampFactory = (_wellId, state) => newInputRevisionStamp(state.revisions);
const own = (obj: object, key: string) => Object.hasOwn(obj, key);

/** Detecta también marcadores incoherentes para impedir una conversión v6 que pierda datos. */
export function containsInputRevisions(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (own(value, 'inputRevisions')) return true;
  const raw = value as Record<string, unknown>;
  for (const key of ['wells', 'snapshots']) if (Array.isArray(raw[key])) {
    for (const row of raw[key]) if (row && typeof row === 'object' && (own(row, 'inputRevisionId') || own(row, 'inputBinding'))) return true;
  }
  return false;
}

/** Valida grafo, aliases exactos de Well y todos los snapshots; null es el modo legado. */
export function projectInputState(project: Project): InputRevisionState | null {
  if (!containsInputRevisions(project)) {
    if ([...project.wells, ...project.snapshots].some(e => e.interpretation.preparation !== undefined)) throw new Error('La preparación requiere revisiones de entradas.');
    return null;
  }
  if (!project.inputRevisions) throw new Error('El proyecto refiere a revisiones pero no contiene su almacén.');
  const active: Record<string, string> = Object.create(null) as Record<string, string>;
  const wells = new Set<string>();
  for (const entry of project.wells) {
    const wellId = entry.well.id;
    if (wells.has(wellId)) throw new Error('Hay ids de pozo repetidos.');
    wells.add(wellId);
    if (!entry.inputRevisionId || !own(project.inputRevisions, entry.inputRevisionId)) throw new Error(`El pozo '${wellId}' no tiene una revisión válida.`);
    const revision = project.inputRevisions[entry.inputRevisionId]!;
    if (revision.wellId !== wellId || revision.well !== entry.well) throw new Error(`El alias de datos del pozo '${wellId}' no coincide con su revisión.`);
    active[wellId] = revision.id;
  }
  const state = Object.freeze({ revisions: project.inputRevisions, activeByWell: Object.freeze(active) });
  validateInputRevisionState(state);
  for (const entry of project.wells) preparationBindings(entry.interpretation, entry.well.id, state.revisions, entry.inputRevisionId);
  const snapshots = new Set<string>();
  for (const snapshot of project.snapshots) {
    if (snapshots.has(snapshot.id)) throw new Error('Hay ids de snapshot repetidos.');
    snapshots.add(snapshot.id);
    checkSnapshotRevision(project.inputRevisions, snapshot);
    preparationBindings(snapshot.interpretation, snapshot.wellId, state.revisions, snapshot.inputRevisionId);
    if (!wells.has(snapshot.wellId)) throw new Error('Un snapshot refiere a un pozo inexistente.');
  }
  return state;
}

function checkSnapshotRevision(revisions: Readonly<Record<string, InputRevision>>, snapshot: Snapshot): InputRevision {
  if (!snapshot.inputRevisionId || !own(revisions, snapshot.inputRevisionId)) throw new Error(`El snapshot '${snapshot.name}' no tiene una revisión disponible.`);
  if (snapshot.inputBinding !== 'pinned' && snapshot.inputBinding !== 'legacy-current-inputs') throw new Error('El snapshot no declara cómo se vinculó a sus datos.');
  const revision = revisions[snapshot.inputRevisionId]!;
  if (revision.wellId !== snapshot.wellId) throw new Error('El snapshot refiere a una revisión de otro pozo.');
  return revision;
}

function publishProjectInputs(project: Project, state: InputRevisionState): Project {
  const wells = project.wells.map((entry) => {
    const id = state.activeByWell[entry.well.id]!;
    const well = state.revisions[id]!.well;
    return entry.inputRevisionId === id && entry.well === well ? entry : { ...entry, well, inputRevisionId: id };
  });
  return { ...project, wells, inputRevisions: state.revisions };
}

/** Activación explícita de dominio; ningún flujo de carga/snapshot de la UI la invoca en esta entrega. */
export function enableProjectInputRevisions(project: Project, stamp: RevisionStampFactory = defaultRevisionStamp): Project {
  if (projectInputState(project)) return project;
  const ids = new Set(project.wells.map((e) => e.well.id));
  if (ids.size !== project.wells.length) throw new Error('Hay ids de pozo repetidos.');
  if (project.snapshots.some((s) => !ids.has(s.wellId))) throw new Error('Un snapshot refiere a un pozo inexistente.');
  let state = emptyInputRevisions();
  for (const entry of project.wells) state = addInitialInputRevision(state, entry.well, stamp(entry.well.id, state), undefined, 'legacy-migration');
  const next = publishProjectInputs(project, state);
  const snapshots = project.snapshots.map((s) => ({ ...s, inputRevisionId: state.activeByWell[s.wellId]!, inputBinding: 'legacy-current-inputs' as const }));
  const result = { ...next, snapshots };
  projectInputState(result);
  return result;
}

/** El proyecto previo se valida; el nuevo pozo se captura antes de publicar aliases nuevos. */
export function attachAddedWellRevision(previous: Project, added: Project, well: Well, stamp: RevisionStampFactory = defaultRevisionStamp): Project {
  const state = projectInputState(previous);
  if (!state) throw new Error('Primero se deben habilitar las revisiones.');
  const next = addInitialInputRevision(state, well, stamp(well.id, state));
  return publishProjectInputs(added, next);
}

export function reviseProjectInputs(project: Project, wellId: string, changes: InputChanges, stamp: RevisionStampFactory = defaultRevisionStamp): Project {
  const state = projectInputState(project);
  if (!state) throw new Error('Primero se deben habilitar las revisiones.');
  const next = reviseInputRevision(state, wellId, changes, () => stamp(wellId, state));
  return next === state ? project : publishProjectInputs(project, next);
}

export interface SnapshotInputs {
  well: Well;
  interpretation: Interpretation;
  inputRevisionId: string | null;
  inputBinding: 'pinned' | 'legacy-current-inputs';
}
/** Una referencia rota nunca cae silenciosamente a los datos activos. */
export function resolveSnapshotInputs(project: Project, snapshot: Snapshot): SnapshotInputs {
  const state = projectInputState(project);
  const entry = project.wells.find((e) => e.well.id === snapshot.wellId);
  if (!entry) throw new Error('El pozo del snapshot ya no existe.');
  if (!state) {
    if (snapshot.inputRevisionId !== undefined || snapshot.inputBinding !== undefined) throw new Error('El snapshot refiere a revisiones que no están disponibles.');
    return { well: entry.well, interpretation: snapshot.interpretation, inputRevisionId: null, inputBinding: 'legacy-current-inputs' };
  }
  const revision = checkSnapshotRevision(state.revisions, snapshot);
  return { well: revision.well, interpretation: snapshot.interpretation, inputRevisionId: revision.id, inputBinding: snapshot.inputBinding! };
}
