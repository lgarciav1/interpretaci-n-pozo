/**
 * Estado del proyecto (lo que se guarda en el archivo): pozos, interpretación por pozo y snapshots.
 *
 * Todas las modificaciones son funciones puras `(proyecto, ...) => proyecto nuevo` con estructura compartida:
 * lo que no cambia conserva su referencia (en particular los arrays de datos, que nunca se copian).
 * Esto permite deshacer/rehacer guardando proyectos anteriores, y que el puente con el motor detecte cambios por
 * referencia.
 */
import { emptyInterpretation, type Interpretation, type SourceRef } from '../interpretation';
import type { ParamValue } from '../params';
import type { RoleId } from '../roles';
import type { UnitId } from '../units';
import type { Curve, Well, Zone } from '../well';

export interface WellEntry {
  well: Well;
  interpretation: Interpretation;
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
}

let idCounter = 0;
/** Id corto y único en la sesión (no depende de crypto, que no siempre existe en file://). */
export function makeId(prefix: string): string {
  idCounter = (idCounter + 1) % 1e6;
  return `${prefix}-${Date.now().toString(36)}${idCounter.toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function createProject(name = 'Proyecto sin nombre'): Project {
  return { name, wells: [], activeWellId: null, snapshots: [] };
}

export function addWell(project: Project, well: Well, zones: Zone[] = []): Project {
  if (project.wells.some((w) => w.well.id === well.id)) throw new Error(`Ya hay un pozo con el id '${well.id}'.`);
  return {
    ...project,
    wells: [...project.wells, { well, interpretation: emptyInterpretation(zones) }],
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

function mapWell(project: Project, wellId: string, fn: (e: WellEntry) => WellEntry): Project {
  let found = false;
  const wells = project.wells.map((e) => {
    if (e.well.id !== wellId) return e;
    found = true;
    return fn(e);
  });
  if (!found) throw new Error(`No existe el pozo '${wellId}'.`);
  return { ...project, wells };
}

export function updateInterpretation(
  project: Project,
  wellId: string,
  fn: (i: Interpretation) => Interpretation,
): Project {
  return mapWell(project, wellId, (e) => ({ ...e, interpretation: fn(e.interpretation) }));
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
