/**
 * Estado del proyecto (lo que se guarda en el archivo): pozos, interpretación por pozo y snapshots.
 *
 * Todas las modificaciones son funciones puras `(proyecto, ...) => proyecto nuevo` con estructura compartida:
 * lo que no cambia conserva su referencia (en particular los arrays de datos, que nunca se copian).
 * Esto permite deshacer/rehacer guardando proyectos anteriores, y que el puente con el motor detecte cambios por
 * referencia.
 */
import { DEFAULT_VIEWER_LOOK, emptyDisplay, isEmptyOverride, type CurveDisplayOverride, type DisplaySettings, type TrackSpec, type ViewerLookSetting } from '../display';
import { emptyInterpretation, sourceRefEquals, type Interpretation, type JsonValue, type SourceRef } from '../interpretation';
import type { ParamValue } from '../params';
import type { RoleId } from '../roles';
import type { TrendSpec } from '../trends';
import type { TrainerRecipe } from '../../petro/trainer';
import type { UnitId } from '../units';
import type { Curve, Well, Zone } from '../well';
import { copyInputWellForEdit, type InputRevision, type InputRevisionId } from '../inputs/revisions';
import { attachAddedWellRevision, projectInputState, reviseProjectInputs, type RevisionStampFactory } from './inputRevisions';

export interface WellEntry {
  well: Well;
  inputRevisionId?: InputRevisionId;
  /** Receta del ejercicio, fuera del motor y de los snapshots. */
  trainerRecipe?: TrainerRecipe;
  interpretation: Interpretation;
  /**
   * Marcas del usuario en el flujo guiado (paso → completo/saltado). Lo derivado del estado (pozo cargado, puertos
   * calculados) no se guarda. Vive fuera de `interpretation`: no entra en snapshots ni dispara cálculos.
   */
  progress: FlowProgress;
  /**
   * Huellas de los avisos que la usuaria marcó como vistos (docs/decisiones/0072; ver `diagnosticFingerprint` en
   * `src/app/diagnostics/grouping.ts`). Igual que `progress`, fuera de `interpretation`: marcar no recalcula ni
   * entra en snapshots. Ausente = ninguno visto.
   */
  seenDiagnostics?: string[];
}

export type StepMark = 'done' | 'skipped';

export interface FlowProgress {
  marks: Record<string, StepMark>;
}

export function emptyProgress(): FlowProgress {
  return { marks: {} };
}

export interface Snapshot {
  id: string;
  name: string;
  wellId: string;
  /** ISO 8601. */
  createdAt: string;
  interpretation: Interpretation;
  inputRevisionId?: InputRevisionId;
  inputBinding?: 'pinned' | 'legacy-current-inputs';
}

export interface Project {
  name: string;
  wells: WellEntry[];
  activeWellId: string | null;
  snapshots: Snapshot[];
  /** Optativo hasta conectar la persistencia de revisiones; ausente conserva el modo v6. */
  inputRevisions?: Readonly<Record<InputRevisionId, InputRevision>>;
  /**
   * Pistas propias y overrides de escala/color del visor (docs/decisiones/0005-visor-multipista.md, D3).
   * Fuera de `Interpretation`: no recalcula el motor ni entra en snapshots.
   */
  display: DisplaySettings;
}

let idCounter = 0;
/** Id corto y único en la sesión (no depende de crypto, que no siempre existe en file://). */
export function makeId(prefix: string): string {
  idCounter = (idCounter + 1) % 1e6;
  return `${prefix}-${Date.now().toString(36)}${idCounter.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function createProject(name = 'Proyecto sin nombre'): Project {
  return { name, wells: [], activeWellId: null, snapshots: [], display: emptyDisplay() };
}

export function addWell(project: Project, well: Well, zones: Zone[] = [], stamp?: RevisionStampFactory): Project {
  const revisioned = projectInputState(project) !== null;
  if (project.wells.some((w) => w.well.id === well.id)) throw new Error(`Ya hay un pozo con el id '${well.id}'.`);
  const next = {
    ...project,
    wells: [...project.wells, { well, interpretation: emptyInterpretation(zones), progress: emptyProgress() }],
    activeWellId: project.activeWellId ?? well.id,
  };
  return revisioned ? attachAddedWellRevision(project, next, well, stamp) : next;
}

export function getWellEntry(project: Project, wellId: string): WellEntry {
  const entry = project.wells.find((w) => w.well.id === wellId);
  if (!entry) throw new Error(`No existe el pozo '${wellId}'.`);
  return entry;
}

export function activeWellEntry(project: Project): WellEntry | null {
  return project.wells.find((w) => w.well.id === project.activeWellId) ?? null;
}

/** Aplica `fn` a un pozo. Si `fn` devuelve la misma entrada, devuelve el mismo proyecto (sin cambios). */
function mapWell(project: Project, wellId: string, fn: (e: WellEntry) => WellEntry): Project {
  const index = project.wells.findIndex((e) => e.well.id === wellId);
  if (index < 0) throw new Error(`No existe el pozo '${wellId}'.`);
  const prev = project.wells[index]!;
  const next = fn(prev);
  if (next === prev) return project;
  const wells = [...project.wells];
  wells[index] = next;
  return { ...project, wells };
}

/** Aplica `fn` al pozo (datos) de una entrada. Si devuelve el mismo pozo, el proyecto no cambia. */
export function updateWell(project: Project, wellId: string, fn: (w: Well) => Well, stamp?: RevisionStampFactory): Project {
  const state = projectInputState(project);
  if (state) {
    const draft = copyInputWellForEdit(state, wellId);
    return reviseProjectInputs(project, wellId, { well: fn(draft) }, stamp);
  }
  return mapWell(project, wellId, (e) => {
    const well = fn(e.well);
    return well === e.well ? e : { ...e, well };
  });
}

export function updateInterpretation(
  project: Project,
  wellId: string,
  fn: (i: Interpretation) => Interpretation,
): Project {
  return mapWell(project, wellId, (e) => {
    const interpretation = fn(e.interpretation);
    return interpretation === e.interpretation ? e : { ...e, interpretation };
  });
}

/**
 * Guarda (o quita, con `undefined`) el estado de un módulo en `interpretation.moduleState[moduleId]`. No cambia las
 * entradas del motor: no pide un cálculo. Sin cambios (mismo valor por referencia) devuelve el mismo proyecto.
 */
export function setModuleState(project: Project, wellId: string, moduleId: string, value: JsonValue | undefined): Project {
  return updateInterpretation(project, wellId, (i) => {
    const prev = i.moduleState ?? {};
    if (prev[moduleId] === value) return i;
    const next: Record<string, JsonValue> = { ...prev };
    if (value === undefined) delete next[moduleId];
    else next[moduleId] = value;
    const { moduleState: _old, ...rest } = i;
    return Object.keys(next).length ? { ...rest, moduleState: next } : rest;
  });
}

/** Fija un parámetro (global si zoneId es null; override de zona si no). `key` es la clave de almacenamiento. */
export function setParam(project: Project, wellId: string, key: string, value: ParamValue, zoneId: string | null = null): Project {
  return updateInterpretation(project, wellId, (i) => {
    if (zoneId === null) {
      if (i.params.global[key] === value) return i;
      return { ...i, params: { ...i.params, global: { ...i.params.global, [key]: value } } };
    }
    if (!i.zones.some((z) => z.id === zoneId)) throw new Error(`No existe la zona '${zoneId}'.`);
    const zoneValues = i.params.zones[zoneId] ?? {};
    if (zoneValues[key] === value) return i;
    return { ...i, params: { ...i.params, zones: { ...i.params.zones, [zoneId]: { ...zoneValues, [key]: value } } } };
  });
}

/** Quita un valor: el global vuelve al default; el de zona vuelve al global. */
export function clearParam(project: Project, wellId: string, key: string, zoneId: string | null = null): Project {
  return updateInterpretation(project, wellId, (i) => {
    if (zoneId === null) {
      if (!(key in i.params.global)) return i;
      const { [key]: _removed, ...global } = i.params.global;
      return { ...i, params: { ...i.params, global } };
    }
    const zoneValues = i.params.zones[zoneId];
    if (!zoneValues || !(key in zoneValues)) return i;
    const { [key]: _removed, ...rest } = zoneValues;
    const zones = { ...i.params.zones };
    if (Object.keys(rest).length) zones[zoneId] = rest;
    else delete zones[zoneId];
    return { ...i, params: { ...i.params, zones } };
  });
}

/** Elige la fuente de un puerto (null = volver a la regla por defecto). */
export function setSource(project: Project, wellId: string, port: string, ref: SourceRef | null): Project {
  return updateInterpretation(project, wellId, (i) => {
    if (ref ? sourceRefEquals(i.sources[port], ref) : !(port in i.sources)) return i;
    const sources = { ...i.sources };
    if (ref) sources[port] = ref;
    else delete sources[port];
    return { ...i, sources };
  });
}

export function setCompare(project: Project, wellId: string, moduleId: string, on: boolean): Project {
  return updateInterpretation(project, wellId, (i) => {
    const has = i.compare.includes(moduleId);
    if (has === on) return i;
    return { ...i, compare: on ? [...i.compare, moduleId] : i.compare.filter((m) => m !== moduleId) };
  });
}

export function setModuleEnabled(project: Project, wellId: string, moduleId: string, enabled: boolean): Project {
  return updateInterpretation(project, wellId, (i) => {
    const isDisabled = i.disabled.includes(moduleId);
    if (isDisabled === !enabled) return i;
    return { ...i, disabled: enabled ? i.disabled.filter((m) => m !== moduleId) : [...i.disabled, moduleId] };
  });
}

/** Reemplaza las zonas. Los overrides de parámetros de zonas eliminadas se descartan. */
export function setZones(project: Project, wellId: string, zones: Zone[]): Project {
  const ids = new Set(zones.map((z) => z.id));
  if (ids.size !== zones.length) throw new Error('Hay zonas con ids repetidos.');
  return updateInterpretation(project, wellId, (i) => {
    const zoneParams = Object.fromEntries(Object.entries(i.params.zones).filter(([id]) => ids.has(id)));
    return { ...i, zones, params: { ...i.params, zones: zoneParams }, trends: trendsFollowingZones(i.trends, i.zones, zones) };
  });
}

/**
 * Tendencias que usan una zona como tramo: `top`/`base` guardan el último tramo de la zona (respaldo, D2 de la
 * decisión 0008). Si la zona se borra, la tendencia se queda con ese tramo y deja de referirla. Sin tendencias
 * afectadas, devuelve la misma lista (no cambia la identidad).
 */
function trendsFollowingZones(trends: TrendSpec[], prev: readonly Zone[], next: readonly Zone[]): TrendSpec[] {
  let changed = false;
  const out = trends.map((t) => {
    const zid = t.selection.zoneId;
    if (!zid) return t;
    const z = next.find((zz) => zz.id === zid);
    if (z) {
      if (t.selection.top === z.top && t.selection.base === z.base) return t;
      changed = true;
      return { ...t, selection: { ...t.selection, top: z.top, base: z.base } };
    }
    const old = prev.find((zz) => zz.id === zid);
    const { zoneId: _gone, ...rest } = t.selection;
    changed = true;
    return { ...t, selection: old ? { ...rest, top: old.top, base: old.base } : rest };
  });
  return changed ? out : trends;
}

/**
 * Guarda una edición de zonas (recetas de `zones.ts`). Si una zona se partió, la de abajo (`clone.to`) hereda los
 * parámetros de la original (`clone.from`): es la misma roca. Cambiar zonas cambia la firma de geometría del motor,
 * que recalcula los parámetros por zona.
 */
export function applyZoneEdit(project: Project, wellId: string, zones: Zone[], clone: { from: string; to: string } | null = null): Project {
  const entry = getWellEntry(project, wellId);
  if (zones === entry.interpretation.zones && !clone) return project;
  const next = setZones(project, wellId, zones);
  if (!clone) return next;
  const params = entry.interpretation.params.zones[clone.from];
  if (!params || !zones.some((z) => z.id === clone.to)) return next;
  return updateInterpretation(next, wellId, (i) => ({ ...i, params: { ...i.params, zones: { ...i.params.zones, [clone.to]: { ...params } } } }));
}

/** Cambia metadatos de una curva (rol, unidad, descripción). Los datos conservan su referencia. */
export function updateCurveMeta(
  project: Project,
  wellId: string,
  curveId: string,
  patch: { role?: RoleId | null; unit?: UnitId; description?: string },
): Project {
  return updateWell(project, wellId, (well) => {
    if (!well.curves.some((c) => c.id === curveId)) throw new Error(`No existe la curva '${curveId}'.`);
    const curves: Curve[] = well.curves.map((c) => (c.id === curveId ? { ...c, ...patch } : c));
    return { ...well, curves };
  });
}

export function setActiveWell(project: Project, wellId: string): Project {
  getWellEntry(project, wellId);
  return { ...project, activeWellId: wellId };
}

/** Marca un paso del flujo guiado como completo o saltado (null = quitar la marca). */
export function setStepMark(project: Project, wellId: string, stepId: string, mark: StepMark | null): Project {
  return mapWell(project, wellId, (e) => {
    const current = e.progress.marks[stepId];
    if ((current ?? null) === mark) return e;
    const marks = { ...e.progress.marks };
    if (mark) marks[stepId] = mark;
    else delete marks[stepId];
    return { ...e, progress: { ...e.progress, marks } };
  });
}

/**
 * Lee `seenDiagnostics` de un archivo: lista de textos sin repetir. Cualquier otra cosa (o lista vacía) = ausente.
 * Es una preferencia de la usuaria, no un dato: lo inválido se descarta sin rechazar el archivo.
 */
export function readSeenDiagnostics(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out = [...new Set(raw.filter((f): f is string => typeof f === 'string' && f.length > 0))];
  return out.length > 0 ? out : undefined;
}

/**
 * Marca (seen = true) o desmarca un aviso como visto. `existing` son las huellas de los avisos que hay ahora: las
 * marcas de avisos que ya no existen se podan (el aviso cambió o desapareció). Sin marcas queda el campo ausente.
 * Devuelve el mismo proyecto si no cambia nada.
 */
export function setDiagnosticSeen(
  project: Project,
  wellId: string,
  fingerprint: string,
  seen: boolean,
  existing: Iterable<string>,
): Project {
  return mapWell(project, wellId, (e) => {
    const alive = new Set(existing);
    const prev = e.seenDiagnostics ?? [];
    const next = prev.filter((f) => alive.has(f) && f !== fingerprint);
    if (seen) next.push(fingerprint);
    if (next.length === prev.length && next.every((f, i) => f === prev[i])) return e;
    if (next.length === 0) {
      const { seenDiagnostics: _drop, ...rest } = e;
      return rest;
    }
    return { ...e, seenDiagnostics: next };
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Visualización (pistas y overrides del visor)

/** Fija las pistas propias de un espacio de trabajo (null = volver a la plantilla de fábrica). */
export function setTrackLayout(project: Project, workspace: string, tracks: TrackSpec[] | null): Project {
  const has = workspace in project.display.layouts;
  if (!tracks && !has) return project;
  const layouts = { ...project.display.layouts };
  if (tracks) layouts[workspace] = tracks;
  else delete layouts[workspace];
  return { ...project, display: { ...project.display, layouts } };
}

/**
 * Estilo del visor del proyecto (docs/decisiones/0067). El de fábrica no se guarda (queda ausente). No toca las pistas:
 * una plantilla propia se conserva con cualquier estilo.
 */
export function setViewerLook(project: Project, look: ViewerLookSetting): Project {
  const current = project.display.look ?? DEFAULT_VIEWER_LOOK;
  if (current === look) return project;
  const display = { ...project.display };
  if (look === DEFAULT_VIEWER_LOOK) delete display.look;
  else display.look = look;
  return { ...project, display };
}

/** Override de dibujo para un rol en todo el proyecto (null o vacío = quitarlo). */
export function setRoleDisplay(project: Project, role: string, override: CurveDisplayOverride | null): Project {
  const roles = { ...project.display.roles };
  if (isEmptyOverride(override)) {
    if (!(role in roles)) return project;
    delete roles[role];
  } else roles[role] = override!;
  return { ...project, display: { ...project.display, roles } };
}

/** Override de dibujo para una curva de un pozo (null o vacío = quitarlo). */
export function setCurveDisplay(project: Project, wellId: string, curveId: string, override: CurveDisplayOverride | null): Project {
  getWellEntry(project, wellId);
  const forWell = { ...(project.display.curves[wellId] ?? {}) };
  if (isEmptyOverride(override)) {
    if (!(curveId in forWell)) return project;
    delete forWell[curveId];
  } else forWell[curveId] = override!;
  const curves = { ...project.display.curves };
  if (Object.keys(forWell).length) curves[wellId] = forWell;
  else delete curves[wellId];
  return { ...project, display: { ...project.display, curves } };
}

/** Ajuste de la pista propia de una superposición (p. ej. unidad de la pista de presión). `undefined` lo quita. */
export function setOverlaySetting(project: Project, overlayId: string, key: string, value: string | number | boolean | undefined): Project {
  const prev = project.display.overlays?.[overlayId] ?? {};
  if (prev[key] === value) return project;
  const next = { ...prev };
  if (value === undefined) delete next[key];
  else next[key] = value;
  const overlays = { ...project.display.overlays };
  if (Object.keys(next).length) overlays[overlayId] = next;
  else delete overlays[overlayId];
  const { overlays: _old, ...rest } = project.display;
  return { ...project, display: Object.keys(overlays).length ? { ...rest, overlays } : rest };
}

