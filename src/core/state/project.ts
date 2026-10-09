/**
 * Estado del proyecto (lo que se guarda en el archivo): pozos, interpretación por pozo y snapshots.
 *
 * Todas las modificaciones son funciones puras `(proyecto, ...) => proyecto nuevo` con estructura compartida:
 * lo que no cambia conserva su referencia (en particular los arrays de datos, que nunca se copian).
 * Esto permite deshacer/rehacer guardando proyectos anteriores, y que el puente con el motor detecte cambios por
 * referencia.
 */
import { emptyDisplay, isEmptyOverride, type CurveDisplayOverride, type DisplaySettings, type TrackSpec } from '../display';
import { emptyInterpretation, sourceRefEquals, type Interpretation, type SourceRef } from '../interpretation';
import type { ParamValue } from '../params';
import type { RoleId } from '../roles';
import type { UnitId } from '../units';
import type { Curve, Well, Zone } from '../well';

export interface WellEntry {
  well: Well;
  interpretation: Interpretation;
  /**
   * Marcas del usuario en el flujo guiado (paso → completo/saltado). Lo derivado del estado (pozo cargado, puertos
   * calculados) no se guarda. Vive fuera de `interpretation`: no entra en snapshots ni dispara cálculos.
   */
  progress: FlowProgress;
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
}

export interface Project {
  name: string;
  wells: WellEntry[];
  activeWellId: string | null;
  snapshots: Snapshot[];
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

export function addWell(project: Project, well: Well, zones: Zone[] = []): Project {
  if (project.wells.some((w) => w.well.id === well.id)) throw new Error(`Ya hay un pozo con el id '${well.id}'.`);
  return {
    ...project,
    wells: [...project.wells, { well, interpretation: emptyInterpretation(zones), progress: emptyProgress() }],
    activeWellId: project.activeWellId ?? well.id,
  };
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
    return { ...i, zones, params: { ...i.params, zones: zoneParams } };
  });
}

/** Cambia metadatos de una curva (rol, unidad, descripción). Los datos conservan su referencia. */
export function updateCurveMeta(
  project: Project,
  wellId: string,
  curveId: string,
  patch: { role?: RoleId | null; unit?: UnitId; description?: string },
): Project {
  return mapWell(project, wellId, (e) => {
    if (!e.well.curves.some((c) => c.id === curveId)) throw new Error(`No existe la curva '${curveId}'.`);
    const curves: Curve[] = e.well.curves.map((c) => (c.id === curveId ? { ...c, ...patch } : c));
    return { ...e, well: { ...e.well, curves } };
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
