/** Archivo de revisiones: una representación por Well, arrays compartidos por hash de bytes LE. */
import { sanitizeDisplay, type DisplaySettings } from '../../display';
import type { Interpretation } from '../../interpretation';
import { validatePreparation } from '../../preparation/state';
import { isNumericColumn, sanitizePointSetDecisions, type PointSet } from '../../pointSets';
import { sanitizeToolString } from '../../toolString';
import { sanitizeTrends } from '../../trends';
import { makeDepthIndex, type Well, type Curve } from '../../well';
import { validateInputRevisionState, type InputRevision } from '../../inputs/revisions';
import { requireArray, requireObject, requireShape, requireText } from '../../inputs/validation';
import { projectInputState } from '../inputRevisions';
import type { FlowProgress, Project, Snapshot, WellEntry } from '../project';
import { decodeArray, encodeArray, float64Bytes, type CodecChoice, type EncodedArray } from './arrayCodec';
import { ArchiveLimitError, archiveLimits, checkFileSize, DecodeBudget, type ArchiveLimits } from './limits';
import { sha256 } from './sha256';
import { mapArchive } from './parallel';

export const REVISION_PROJECT_VERSION = 7;
export interface BlobRef { blobId: string }
export interface SavedBlob extends EncodedArray { scalarType: 'f64'; endian: 'little'; byteLength: number; sha256: string }
type SavedPointColumn = { label: string; unit?: string; values: BlobRef | string[] };
interface SavedWell extends Omit<Well, 'depth' | 'curves' | 'pointSets'> {
  depth: { unit: 'm'; sourceUnit?: string; values: BlobRef };
  curves: (Omit<Curve, 'data'> & { data: BlobRef })[];
  pointSets: (Omit<PointSet, 'depth' | 'columns'> & { depth: BlobRef; columns: Record<string, SavedPointColumn> })[];
}
export interface RevisionProjectFile {
  format: 'pozo-proyecto'; version: 7; savedAt: string;
  project: {
    name: string; activeWellId: string | null; display: DisplaySettings;
    wells: { wellId: string; inputRevisionId: string; interpretation: Interpretation; progress: FlowProgress }[];
    snapshots: Snapshot[];
    inputRevisions: Record<string, Omit<InputRevision, 'well'> & { well: SavedWell }>;
    blobs: Record<string, SavedBlob>;
  };
}
export interface ArchiveIssue { where: string; message: string }
export interface RecoveryResult { project: Project | null; issues: ArchiveIssue[] }
export class ArchiveReadError extends Error {
  constructor(readonly issues: ArchiveIssue[]) {
    super(`No se abrió el proyecto v7: ${issues[0]?.where}: ${issues[0]?.message} Se conserva el archivo original; la recuperación independiente debe pedirse explícitamente.`);
  }
}
const own = (o: object, key: string) => Object.hasOwn(o, key);
const dict = <T>(entries: [string, T][]): Record<string, T> => Object.assign(Object.create(null) as Record<string, T>, Object.fromEntries(entries));
function fail(message: string): never { throw new Error(message); }
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
function jsonData(value: unknown): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || finite(value)) return;
  if (Array.isArray(value)) { requireArray(value, 'Lista JSON'); value.forEach(jsonData); return; }
  for (const v of Object.values(requireObject(value, 'Datos JSON'))) jsonData(v);
}
function interpretation(raw: unknown): Interpretation {
  const i = requireShape(raw, 'Interpretación', ['zones','params','sources','compare','disabled','trends','pointSets'], ['toolString','preparation']);
  if (own(i, 'preparation')) validatePreparation(i.preparation);
  jsonData(i);
  requireArray(i.zones, 'Zonas');
  const ids = new Set<string>();
  for (const raw of i.zones) {
    const z = requireShape(raw, 'Zona', ['id','name','top','base','color','kind']);
    requireText(z.id, 'Zona.id'); requireText(z.name, 'Zona.name', false); requireText(z.color, 'Zona.color');
    if (ids.has(z.id) || !finite(z.top) || !finite(z.base) || z.top >= z.base || !['formation','reservoir','seal','other'].includes(z.kind as string)) fail('Zona inválida o repetida.');
    ids.add(z.id);
  }
  const p = requireShape(i.params, 'Parámetros', ['global','zones']);
  const params = (raw: unknown) => { for (const v of Object.values(requireObject(raw, 'Valores de parámetros'))) if (!(finite(v) || typeof v === 'string' || typeof v === 'boolean')) fail('Valor de parámetro inválido.'); };
  params(p.global); for (const v of Object.values(requireObject(p.zones, 'Parámetros por zona'))) params(v);
  for (const raw of Object.values(requireObject(i.sources, 'Fuentes'))) {
    const s = requireObject(raw, 'Fuente');
    if (s.kind === 'curve') { requireShape(s, 'Fuente', ['kind','curveId']); requireText(s.curveId, 'Curva fuente'); }
    else if (s.kind === 'module') { requireShape(s, 'Fuente', ['kind','moduleId']); requireText(s.moduleId, 'Módulo fuente'); }
    else fail('Tipo de fuente desconocido.');
  }
  for (const key of ['compare','disabled']) { requireArray(i[key], key); for (const id of i[key]) requireText(id, key); }
  const warn = (m: string) => fail(m);
  requireArray(i.trends, 'Tendencias'); sanitizeTrends(i.trends, 'v7', warn);
  for (const [id,raw] of Object.entries(requireObject(i.pointSets, 'Decisiones de laboratorio'))) {
    requireText(id, 'Id de conjunto');
    const d = requireShape(raw, 'Decisiones de conjunto', ['points'], ['depthShift','runShifts','settings']);
    if (own(d,'depthShift') && !finite(d.depthShift)) fail('Desplazamiento de laboratorio inválido.');
    if (own(d,'runShifts')) for (const v of Object.values(requireObject(d.runShifts,'Desplazamientos por corrida'))) if (!finite(v)) fail('Desplazamiento de corrida inválido.');
    if (own(d,'settings')) params(d.settings);
    for (const [pid,raw] of Object.entries(requireObject(d.points,'Decisiones por punto'))) {
      requireText(pid, 'Id de punto'); const dec = requireShape(raw, 'Decisión', [], ['status','tag']);
      if (own(dec,'status') && dec.status !== 'include' && dec.status !== 'exclude') fail('Estado de punto inválido.');
      if (own(dec,'tag')) requireText(dec.tag,'Etiqueta');
    }
  }
  sanitizePointSetDecisions(i.pointSets, 'v7', warn);
  if (own(i, 'toolString')) sanitizeToolString(i.toolString, 'v7', warn);
  // Conservar los datos originales, también ids de módulos ausentes; el lector no recalibra ni sustituye fuentes.
  return raw as Interpretation;
}
function progress(raw: unknown): FlowProgress {
  const p = requireShape(raw, 'Progreso', ['marks']);
  for (const v of Object.values(requireObject(p.marks, 'Marcas'))) if (v !== 'done' && v !== 'skipped') fail('Marca de progreso inválida.');
  return raw as FlowProgress;
}
export function freezeRevisionMetadata<T>(value: T): T {
  if (value && typeof value === 'object' && !(value instanceof Float64Array) && !Object.isFrozen(value)) {
    for (const v of Object.values(value)) freezeRevisionMetadata(v);
    Object.freeze(value);
  }
  return value;
}
function validateProjectMetadata(project: Project): void {
  requireText(project.name, 'Nombre de proyecto', false);
  if (project.activeWellId !== null && !project.wells.some((e) => e.well.id === project.activeWellId)) fail('El pozo activo no existe.');
  for (const e of project.wells) { interpretation(e.interpretation); progress(e.progress); }
  for (const s of project.snapshots) {
    requireShape(s, 'Snapshot', ['id','name','wellId','createdAt','inputRevisionId','inputBinding','interpretation']);
    for (const key of ['id','wellId','createdAt']) requireText(s[key as keyof Snapshot], key);
    requireText(s.name, 'Nombre de snapshot', false);
    if (!Number.isFinite(Date.parse(s.createdAt))) fail('Fecha de snapshot inválida.');
    interpretation(s.interpretation);
  }
  jsonData(project.display);
  sanitizeDisplay(project.display, (m) => fail(m));
}

export async function serializeProjectV7(project: Project, codec: CodecChoice, savedAt: string): Promise<string> {
  const state = projectInputState(project);
  if (!state) fail('Para guardar v7 primero se deben habilitar las revisiones.');
  validateProjectMetadata(project);
  if (!Number.isFinite(Date.parse(savedAt))) fail('Fecha de guardado inválida.');
  const blobs = new Map<string, SavedBlob>();
  const memo = new WeakMap<Float64Array, Promise<BlobRef>>();
  const encodedByHash = new Map<string, Promise<SavedBlob>>();
  const budget = new DecodeBudget();
  const ref = (data: Float64Array): Promise<BlobRef> => {
    const existing = memo.get(data); if (existing) return existing;
    const pending = (async () => {
      if (data.byteLength > budget.limits.arrayBytes) throw new ArchiveLimitError('El array supera el límite de archivo.');
      const hash = await sha256(float64Bytes(data)); const id = `sha256:${hash}`;
      let encoded = encodedByHash.get(id);
      if (!encoded) {
        budget.reserve(data.length);
        encoded = encodeArray(data, codec).then((array) => ({ scalarType: 'f64' as const, endian: 'little' as const, byteLength: data.byteLength, sha256: hash, ...array }));
        encodedByHash.set(id, encoded);
      }
      blobs.set(id, await encoded);
      return { blobId: id };
    })();
    memo.set(data, pending); return pending;
  };
  const well = async (w: Well): Promise<SavedWell> => {
    const curves = await mapArchive(w.curves, async (c) => ({ ...c, data: await ref(c.data) }));
    const pointSets: SavedWell['pointSets'] = [];
    for (const ps of w.pointSets) {
      const columns: [string, SavedPointColumn][] = [];
      for (const [key,c] of Object.entries(ps.columns)) columns.push([key, { ...c, values: isNumericColumn(c) ? await ref(c.values) : [...c.values] }]);
      pointSets.push({ ...ps, pointIds: [...ps.pointIds], depth: await ref(ps.depth), columns: dict(columns) });
    }
    return { id: w.id, name: w.name, header: w.header, depth: { unit: 'm', ...(w.depth.sourceUnit ? { sourceUnit: w.depth.sourceUnit } : {}), values: await ref(w.depth.values) }, curves, pointSets };
  };
  const revisions: [string, RevisionProjectFile['project']['inputRevisions'][string]][] = [];
  for (const [id,r] of Object.entries(state.revisions).sort(([a],[b]) => a.localeCompare(b))) revisions.push([id, { ...r, well: await well(r.well) }]);
  const file: RevisionProjectFile = { format: 'pozo-proyecto', version: 7, savedAt, project: {
    name: project.name, activeWellId: project.activeWellId, display: project.display,
    wells: project.wells.map((e) => ({ wellId: e.well.id, inputRevisionId: e.inputRevisionId!, interpretation: e.interpretation, progress: e.progress })),
    snapshots: project.snapshots, inputRevisions: dict(revisions), blobs: dict([...blobs].sort(([a],[b]) => a.localeCompare(b))),
  } };
  const text = JSON.stringify(file); checkFileSize(text, archiveLimits().fileBytes); return text;
}

/** Recuperación explícita: omite solo componentes diagnosticados, nunca cambia una referencia por otra. */
export async function readProjectV7(raw: unknown, opts: { limits?: Partial<ArchiveLimits>; recover?: boolean; onWarning?: (m: string) => void } = {}): Promise<RecoveryResult> {
  const file = requireShape(raw, 'Archivo v7', ['format','version','savedAt','project']);
  if (file.format !== 'pozo-proyecto' || file.version !== 7) fail('No es un archivo v7.');
  requireText(file.savedAt, 'Fecha de guardado'); if (!Number.isFinite(Date.parse(file.savedAt))) fail('Fecha de guardado inválida.');
  const p = requireShape(file.project, 'Proyecto v7', ['name','activeWellId','display','wells','snapshots','inputRevisions','blobs']);
  requireText(p.name, 'Nombre de proyecto', false);
  if (p.activeWellId !== null) requireText(p.activeWellId, 'Pozo activo');
  requireArray(p.wells, 'Pozos'); requireArray(p.snapshots, 'Snapshots');
  const issues: ArchiveIssue[] = [];
  const issue = (where: string, err: unknown) => { if (err instanceof ArchiveLimitError) throw err; issues.push({ where, message: err instanceof Error ? err.message : String(err) }); };
  const budget = new DecodeBudget(archiveLimits(opts.limits));
  const blobs = new Map<string, Float64Array>();
  await mapArchive(Object.entries(requireObject(p.blobs, 'Blobs')), async ([id,raw]) => {
    try {
      const b = requireShape(raw, 'Blob', ['scalarType','endian','length','byteLength','codec','sha256','data']);
      if (b.scalarType !== 'f64' || b.endian !== 'little' || typeof b.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(b.sha256) || id !== `sha256:${b.sha256}`) fail('Id, tipo o hash de blob inválido.');
      if (typeof b.length !== 'number' || b.byteLength !== b.length * 8) fail('Dimensiones de blob inconsistentes.');
      const data = await decodeArray(b as unknown as EncodedArray, budget);
      if (await sha256(float64Bytes(data)) !== b.sha256) fail('El hash de integridad no coincide con los datos.');
      blobs.set(id, data);
    } catch (err) { issue(`Blob ${id}`, err); }
  });
  const resolve = (raw: unknown): Float64Array => {
    const r = requireShape(raw, 'Referencia de array', ['blobId']); requireText(r.blobId, 'Id de blob');
    return blobs.get(r.blobId) ?? fail(`Blob inexistente o dañado: ${r.blobId}.`);
  };
  const decodeWell = (raw: unknown): Well => {
    const w = requireShape(raw, 'Pozo v7', ['id','name','header','depth','curves','pointSets']);
    const depth = requireShape(w.depth, 'Profundidad', ['unit','values'], ['sourceUnit']);
    if (depth.unit !== 'm') fail('La profundidad debe estar en metros.');
    requireArray(w.curves, 'Curvas'); requireArray(w.pointSets, 'Conjuntos de puntos');
    const curves = w.curves.map((raw) => { const c = requireObject(raw, 'Curva'); return { ...c, data: resolve(c.data) }; });
    const pointSets = w.pointSets.map((raw) => {
      const ps = requireObject(raw, 'Conjunto de puntos');
      const columns = Object.entries(requireObject(ps.columns, 'Columnas')).map(([key,raw]) => {
        const col = requireObject(raw, 'Columna');
        return [key, { ...col, values: Array.isArray(col.values) ? col.values : resolve(col.values) }] as [string, unknown];
      });
      return { ...ps, depth: resolve(ps.depth), columns: dict(columns) };
    });
    return { ...w, depth: { ...depth, ...makeDepthIndex(resolve(depth.values), depth.sourceUnit as string | undefined) }, curves, pointSets } as unknown as Well;
  };
  const revisions = new Map<string, InputRevision>();
  for (const [id,raw] of Object.entries(requireObject(p.inputRevisions, 'Revisiones'))) {
    try {
      const r = requireObject(raw, 'Revisión');
      const revision = { ...r, well: decodeWell(r.well) } as unknown as InputRevision;
      // Validar cada registro sin requerir todavía que su padre se haya decodificado.
      const root = { ...revision, reason: 'import' as const }; delete (root as { parentRevisionId?: string }).parentRevisionId;
      validateInputRevisionState({ revisions: { [id]: root }, activeByWell: { [revision.wellId]: id } });
      if (revision.reason !== 'import' && revision.reason !== 'legacy-migration' && revision.reason !== 'edit-input') fail('Motivo de revisión desconocido.');
      if (revision.reason === 'edit-input' ? !own(revision, 'parentRevisionId') : own(revision, 'parentRevisionId')) fail('Padre inconsistente con el motivo.');
      revisions.set(id, revision);
    } catch (err) { issue(`Revisión ${id}`, err); }
  }
  const bad = new Set<string>(); const roots = new Map<string,string>();
  for (const [id,r] of revisions) if (r.reason !== 'edit-input') {
    const existing = roots.get(r.wellId); if (existing) { bad.add(id); bad.add(existing); } else roots.set(r.wellId,id);
  }
  const checked = new Set<string>();
  for (const [id,r] of revisions) {
    const path = new Set<string>(); let current: string | undefined = id;
    while (current !== undefined) {
      const node: InputRevision | undefined = revisions.get(current);
      if (!node || bad.has(current) || path.has(current) || node.wellId !== r.wellId) { for (const key of path) bad.add(key); bad.add(id); break; }
      if (checked.has(current)) break;
      path.add(current); current = node.parentRevisionId;
    }
    for (const key of path) checked.add(key);
  }
  for (const id of bad) { revisions.delete(id); issue(`Revisión ${id}`, 'Grafo de revisiones inválido (padre, raíz, pozo o ciclo).'); }
  const wells: WellEntry[] = [];
  const duplicateWells = new Set<string>(); const seenWells = new Set<string>();
  for (const raw of p.wells) {
    try {
      const e = requireShape(raw, 'Entrada de pozo', ['wellId','inputRevisionId','interpretation','progress']);
      requireText(e.wellId, 'Pozo'); requireText(e.inputRevisionId, 'Revisión activa');
      if (seenWells.has(e.wellId)) { duplicateWells.add(e.wellId); fail('Entrada de pozo repetida.'); } seenWells.add(e.wellId);
      const revision = revisions.get(e.inputRevisionId);
      if (!revision || revision.wellId !== e.wellId) fail('La revisión activa no existe, está dañada o pertenece a otro pozo.');
      wells.push({ well: revision.well, inputRevisionId: revision.id, interpretation: interpretation(e.interpretation), progress: progress(e.progress) });
    } catch (err) { issue('Entrada de pozo', err); }
  }
  const keptWells = wells.filter((e) => !duplicateWells.has(e.well.id));
  const wellIds = new Set(keptWells.map((e) => e.well.id));
  for (const [id,r] of revisions) if (!wellIds.has(r.wellId)) { revisions.delete(id); issue(`Revisión ${id}`, 'No tiene una entrada de pozo válida.'); }
  const snapshots: Snapshot[] = [];
  const seenSnapshots = new Set<string>(), duplicateSnapshots = new Set<string>();
  for (const raw of p.snapshots) {
    try {
      const s = requireShape(raw, 'Snapshot', ['id','name','wellId','createdAt','inputRevisionId','inputBinding','interpretation']);
      requireText(s.id,'Snapshot.id'); requireText(s.wellId,'Snapshot.wellId'); requireText(s.inputRevisionId,'Snapshot.inputRevisionId');
      if (seenSnapshots.has(s.id)) { duplicateSnapshots.add(s.id); fail('Id de snapshot repetido.'); } seenSnapshots.add(s.id);
      const r = revisions.get(s.inputRevisionId);
      if (!r || r.wellId !== s.wellId || !wellIds.has(s.wellId)) fail('El snapshot refiere a datos inexistentes o dañados.');
      if (s.inputBinding !== 'pinned' && s.inputBinding !== 'legacy-current-inputs') fail('Vínculo de snapshot desconocido.');
      interpretation(s.interpretation); requireText(s.name,'Snapshot.name',false); requireText(s.createdAt,'Snapshot.createdAt');
      if (!Number.isFinite(Date.parse(s.createdAt))) fail('Fecha de snapshot inválida.');
      snapshots.push(raw as Snapshot);
    } catch (err) { issue('Snapshot', err); }
  }
  jsonData(p.display);
  // Estilo inválido: mismo saneamiento con diagnóstico que el lector legado; no modifica entradas científicas.
  const display = sanitizeDisplay(p.display, (m) => { opts.onWarning?.(m); });
  const activeWellId = p.activeWellId === null || wellIds.has(p.activeWellId as string) ? p.activeWellId as string | null : null;
  if (activeWellId !== p.activeWellId) issue('Pozo activo', 'El pozo activo no tiene una entrada válida; no se elige otro en su lugar.');
  const project: Project = { name: p.name, activeWellId, wells: keptWells, snapshots: snapshots.filter((s) => !duplicateSnapshots.has(s.id)), display, inputRevisions: freezeRevisionMetadata(dict([...revisions])) };
  projectInputState(project);
  issues.sort((a,b) => a.where.localeCompare(b.where));
  if (issues.length && !opts.recover) throw new ArchiveReadError(issues);
  for (const s of project.snapshots) if (s.inputBinding === 'legacy-current-inputs') opts.onWarning?.(`Snapshot '${s.name}': el archivo original no conservaba datos históricos; está asociado a las entradas disponibles al migrarlo.`);
  return { project: p.wells.length && !keptWells.length ? null : project, issues };
}
