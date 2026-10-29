/**
 * Primera parte de P1: almacén puro independiente de Project, snapshots, motor y serialización.
 * Metadatos y contenedores congelados; Float64Array inmutable por contrato, como en Well.
 */
import type { Well } from '../well';
import { unknownAcquisition, validateAcquisition, type AcquisitionMetadata } from './acquisition';
import { requireObject, requireShape, requireText, validateInputWell } from './validation';

export type InputRevisionId = string;
export interface InputRevision {
  readonly id: InputRevisionId;
  readonly wellId: string;
  readonly parentRevisionId?: InputRevisionId;
  readonly schemaVersion: 1;
  readonly createdAt: string;
  readonly reason: 'import' | 'edit-input' | 'legacy-migration';
  /** Alias de lectura compatible con los consumidores de Well. Para editar: copyInputWellForEdit. */
  readonly well: Well;
  readonly acquisition: AcquisitionMetadata;
}
export interface InputRevisionState {
  readonly revisions: Readonly<Record<InputRevisionId, InputRevision>>;
  readonly activeByWell: Readonly<Record<string, InputRevisionId>>;
}
export interface RevisionStamp { id: InputRevisionId; createdAt: string }
export interface InputChanges { well?: Well; acquisition?: AcquisitionMetadata }

const own = (obj: object, key: string) => Object.hasOwn(obj, key);
const ID = /^input-[0-9a-f]{32}$/;
function checkId(id: unknown): asserts id is InputRevisionId {
  if (typeof id !== 'string' || !ID.test(id)) throw new Error('Id de revisión inválido: se requieren input- y 128 bits en hexadecimal.');
}
function checkDate(value: unknown): void {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error('Fecha de revisión inválida: se requiere ISO UTC con milisegundos.');
}

/** Formato puro; la fuente de entropía y su fallback pertenecen a la futura integración. */
export function inputRevisionIdFromBytes(bytes: Uint8Array): InputRevisionId {
  if (!(bytes instanceof Uint8Array) || bytes.length !== 16) throw new Error('El id requiere exactamente 16 bytes.');
  return `input-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

const dictionary = <T>(entries: readonly (readonly [string, T])[]): Readonly<Record<string, T>> => Object.freeze(Object.assign(Object.create(null) as Record<string, T>, Object.fromEntries(entries)));
export function emptyInputRevisions(): InputRevisionState {
  return Object.freeze({ revisions: dictionary<InputRevision>([]), activeByWell: dictionary<InputRevisionId>([]) });
}

/** Valida el modelo en memoria; no es un lector del archivo v7. No modifica ni repara la entrada. */
export function validateInputRevisionState(value: unknown): asserts value is InputRevisionState {
  const state = requireShape(value, 'Revisiones', ['revisions', 'activeByWell']);
  const revisions = requireObject(state.revisions, 'Revisiones por id');
  const active = requireObject(state.activeByWell, 'Revisión activa por pozo');
  for (const [id, raw] of Object.entries(revisions)) {
    checkId(id);
    const r = requireShape(raw, `Revisión ${id}`, ['id', 'wellId', 'schemaVersion', 'createdAt', 'reason', 'well', 'acquisition'], ['parentRevisionId']);
    if (r.id !== id || r.schemaVersion !== 1) throw new Error(`Revisión ${id}: id o esquema inconsistente.`);
    requireText(r.wellId, 'Id de pozo');
    checkDate(r.createdAt);
    if (!['import', 'edit-input', 'legacy-migration'].includes(r.reason as string)) throw new Error('Motivo de revisión desconocido.');
    validateInputWell(r.well);
    if (r.well.id !== r.wellId) throw new Error('La revisión y el pozo tienen ids distintos.');
    validateAcquisition(r.acquisition, r.well);
  }
  // Comprobar enlaces solo después de validar la forma de todas las revisiones.
  const roots = new Set<string>();
  for (const raw of Object.values(revisions)) {
    const r = raw as InputRevision;
    if (r.reason === 'edit-input') {
      checkId(r.parentRevisionId);
      if (!own(revisions, r.parentRevisionId)) throw new Error('La revisión padre no existe.');
      if ((revisions[r.parentRevisionId] as InputRevision).wellId !== r.wellId) throw new Error('La revisión padre pertenece a otro pozo.');
    } else {
      if (own(r, 'parentRevisionId')) throw new Error('Una revisión inicial no puede tener padre.');
      if (roots.has(r.wellId)) throw new Error('Un pozo no puede tener dos revisiones iniciales.');
      roots.add(r.wellId);
    }
  }
  // Recorrido iterativo: también admite cadenas largas sin desbordar la pila.
  const done = new Set<string>();
  for (const id of Object.keys(revisions)) {
    const path = new Set<string>();
    let cursor: string | undefined = id;
    while (cursor !== undefined && !done.has(cursor)) {
      if (path.has(cursor)) throw new Error('Hay un ciclo entre revisiones.');
      path.add(cursor);
      cursor = (revisions[cursor] as InputRevision).parentRevisionId;
    }
    for (const visited of path) done.add(visited);
  }
  for (const [wellId, id] of Object.entries(active)) {
    requireText(wellId, 'Pozo activo');
    checkId(id);
    if (!own(revisions, id) || (revisions[id] as InputRevision).wellId !== wellId) throw new Error('La revisión activa no existe o pertenece a otro pozo.');
  }
  for (const raw of Object.values(revisions)) if (!own(active, (raw as InputRevision).wellId)) throw new Error('Hay un pozo con revisiones pero sin revisión activa.');
}

function sameBytes(a: Float64Array, b: Float64Array): boolean {
  if (a === b) return true;
  if (a.byteLength !== b.byteLength) return false;
  const x = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  const y = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
  return x.every((v, i) => v === y[i]);
}

/** Copia datos externos; reutiliza por contenido solo datos de una revisión previa validada. */
function capture<T>(value: T, previous?: T): T {
  if (Object.is(value, previous)) return previous as T;
  if (value instanceof Float64Array) {
    if (previous instanceof Float64Array && sameBytes(value, previous)) return previous;
    return value.slice() as T;
  }
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    const prev = Array.isArray(previous) ? previous : [];
    const keyed = new Map(prev.flatMap((v) => v && typeof v === 'object' && typeof v.id === 'string' ? [[v.id, v] as const] : []));
    const out = value.map((v, i) => capture(v, v && typeof v === 'object' && typeof v.id === 'string' ? keyed.get(v.id) ?? prev[i] : prev[i]));
    return (Array.isArray(previous) && out.length === prev.length && out.every((v, i) => v === prev[i]) ? previous : Object.freeze(out)) as T;
  }
  const obj = value as Record<string, unknown>;
  const prev = previous && typeof previous === 'object' ? previous as Record<string, unknown> : {};
  const entries = Object.entries(obj).map(([k, v]) => [k, capture(v, own(prev, k) ? prev[k] : undefined)] as const);
  if (previous !== undefined && entries.length === Object.keys(prev).length && entries.every(([k, v]) => own(prev, k) && Object.is(v, prev[k]))) return previous as T;
  return Object.freeze(Object.fromEntries(entries)) as T;
}

function publish(state: InputRevisionState, revision: InputRevision): InputRevisionState {
  return Object.freeze({
    revisions: dictionary([...Object.entries(state.revisions), [revision.id, Object.freeze(revision)]]),
    activeByWell: dictionary([...Object.entries(state.activeByWell).filter(([id]) => id !== revision.wellId), [revision.wellId, revision.id]]),
  });
}
function checkStamp(state: InputRevisionState, stamp: RevisionStamp): void {
  requireShape(stamp, 'Identidad de revisión', ['id', 'createdAt']);
  checkId(stamp.id);
  checkDate(stamp.createdAt);
  if (own(state.revisions, stamp.id)) throw new Error(`El id de revisión '${stamp.id}' ya existe.`);
}

export function addInitialInputRevision(state: InputRevisionState, well: Well, stamp: RevisionStamp, acquisition: AcquisitionMetadata = unknownAcquisition(), reason: 'import' | 'legacy-migration' = 'import'): InputRevisionState {
  validateInputRevisionState(state);
  validateInputWell(well);
  validateAcquisition(acquisition, well);
  checkStamp(state, stamp);
  if (reason !== 'import' && reason !== 'legacy-migration') throw new Error('Motivo de revisión inicial inválido.');
  if (own(state.activeByWell, well.id)) throw new Error(`El pozo '${well.id}' ya tiene una revisión inicial.`);
  return publish(state, { ...stamp, wellId: well.id, schemaVersion: 1, reason, well: capture(well), acquisition: capture(acquisition) });
}

export function getActiveInputRevision(state: InputRevisionState, wellId: string): InputRevision {
  validateInputRevisionState(state);
  requireText(wellId, 'Id de pozo');
  if (!own(state.activeByWell, wellId)) throw new Error(`El pozo '${wellId}' no tiene revisión activa.`);
  return state.revisions[state.activeByWell[wellId]!]!;
}

/** El llamador modifica esta copia; ningún buffer del almacén se entrega para escritura. */
export function copyInputWellForEdit(state: InputRevisionState, wellId: string): Well {
  return structuredClone(getActiveInputRevision(state, wellId).well);
}

export function reviseInputRevision(state: InputRevisionState, wellId: string, changes: InputChanges, stamp: RevisionStamp): InputRevisionState {
  const parent = getActiveInputRevision(state, wellId);
  requireShape(changes, 'Cambios de entradas', [], ['well', 'acquisition']);
  const well = own(changes, 'well') ? changes.well : parent.well;
  const acquisition = own(changes, 'acquisition') ? changes.acquisition : parent.acquisition;
  validateInputWell(well);
  if (well.id !== wellId) throw new Error('Una revisión hija no puede cambiar el id del pozo.');
  validateAcquisition(acquisition, well);
  const capturedWell = capture(well, parent.well);
  const capturedAcquisition = capture(acquisition, parent.acquisition);
  // Una copia con el mismo contenido no crea revisión, aunque sus objetos tengan otra identidad.
  if (capturedWell === parent.well && capturedAcquisition === parent.acquisition) return state;
  checkStamp(state, stamp);
  return publish(state, { ...stamp, wellId, parentRevisionId: parent.id, schemaVersion: 1, reason: 'edit-input', well: capturedWell, acquisition: capturedAcquisition });
}
