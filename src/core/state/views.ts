/**
 * Recetas puras de las vistas guardadas (docs/decisiones/0075): guardar (reemplaza por nombre en el mismo pozo),
 * renombrar, subir, bajar, borrar, listar las de un pozo y resolver una vista contra el proyecto (qué falta: zona
 * borrada, panel que ya no existe, pozo ausente).
 *
 * Las vistas viven en `project.display.views`: configuración del visor, no interpretación. No entran en
 * `sameEngineInputs`, en la firma de los módulos ni en los snapshots, y no disparan cálculos. Sin React ni stores.
 */
import type { SavedView } from '../display';
import type { Project } from './project';

/** Comparación de nombres sin distinguir mayúsculas ni espacios de los bordes. */
export const sameViewName = (a: string, b: string): boolean => a.trim().toLocaleLowerCase('es') === b.trim().toLocaleLowerCase('es');

/** Todas las vistas del proyecto, en el orden del recorrido. */
export const allViews = (project: Project): readonly SavedView[] => project.display.views ?? [];

/** Vistas de un pozo, en el orden del recorrido. */
export function viewsForWell(project: Project, wellId: string | null): SavedView[] {
  if (!wellId) return [];
  return allViews(project).filter((v) => v.wellId === wellId);
}

/** Vistas del pozo activo (las que se listan y se recorren). */
export const activeWellViews = (project: Project): SavedView[] => viewsForWell(project, project.activeWellId);

/** Vistas de pozos que ya no están en el proyecto: no se listan ni se recorren, pero se pueden borrar. */
export function orphanViews(project: Project): SavedView[] {
  const wells = new Set(project.wells.map((w) => w.well.id));
  return allViews(project).filter((v) => !wells.has(v.wellId));
}

/** Vista de un pozo con ese nombre (sin distinguir mayúsculas). */
export function findView(project: Project, wellId: string, name: string): SavedView | undefined {
  return allViews(project).find((v) => v.wellId === wellId && sameViewName(v.name, name));
}

function withViews(project: Project, list: SavedView[]): Project {
  const { views: _old, ...rest } = project.display;
  return { ...project, display: list.length ? { ...rest, views: list } : rest };
}

/**
 * Guarda una vista. Si en ese pozo ya hay una con el mismo nombre, la reemplaza en su lugar y conserva su id. `id` y
 * `savedAt` los pone quien llama (la receta es pura). Las pistas se copian: tocar después la plantilla no cambia la
 * vista.
 */
export function saveView(project: Project, view: SavedView): Project {
  const name = view.name.trim();
  if (!name) throw new Error('La vista necesita un nombre.');
  if (!Number.isFinite(view.top) || !Number.isFinite(view.base) || !(view.top < view.base)) throw new Error('El tramo de la vista es inválido.');
  const list = [...allViews(project)];
  const prev = list.findIndex((v) => v.wellId === view.wellId && sameViewName(v.name, name));
  const entry: SavedView = { ...view, name, id: prev >= 0 ? list[prev]!.id : view.id, tracks: view.tracks ? view.tracks.map((t) => ({ ...t })) : null };
  if (prev >= 0) list[prev] = entry;
  else list.push(entry);
  return withViews(project, list);
}

/** Renombra una vista. Falla si el nombre está vacío o ya lo usa otra del mismo pozo; el mismo nombre no cambia nada. */
export function renameView(project: Project, id: string, name: string): Project {
  const list = allViews(project);
  const i = list.findIndex((v) => v.id === id);
  if (i < 0) throw new Error('No existe esa vista.');
  const clean = name.trim();
  if (!clean) throw new Error('La vista necesita un nombre.');
  const view = list[i]!;
  if (view.name === clean) return project;
  if (list.some((v) => v.id !== id && v.wellId === view.wellId && sameViewName(v.name, clean))) throw new Error(`Ya hay una vista «${clean}».`);
  const next = [...list];
  next[i] = { ...view, name: clean };
  return withViews(project, next);
}

/**
 * Sube (`-1`) o baja (`1`) una vista en el recorrido de su pozo: intercambia su lugar con la vista anterior o siguiente
 * del mismo pozo (las de otros pozos no cuentan). En el borde devuelve el mismo proyecto.
 */
export function moveView(project: Project, id: string, dir: -1 | 1): Project {
  const list = allViews(project);
  const i = list.findIndex((v) => v.id === id);
  if (i < 0) throw new Error('No existe esa vista.');
  const wellId = list[i]!.wellId;
  let j = i + dir;
  while (j >= 0 && j < list.length && list[j]!.wellId !== wellId) j += dir;
  if (j < 0 || j >= list.length) return project;
  const next = [...list];
  next[i] = list[j]!;
  next[j] = list[i]!;
  return withViews(project, next);
}

export function deleteView(project: Project, id: string): Project {
  const list = allViews(project);
  if (!list.some((v) => v.id === id)) return project;
  return withViews(project, list.filter((v) => v.id !== id));
}

/** Qué falta de una vista al abrirla. Ninguna falta impide abrirla: lo que falta se omite y se dice. */
export type ViewIssue =
  | { kind: 'well'; message: string }
  | { kind: 'zone'; zoneName: string; message: string }
  | { kind: 'dockPanel'; panel: string; message: string };

export interface ResolvedView {
  view: SavedView;
  /** El pozo de la vista está en el proyecto. Si no, la vista no se lista ni se recorre. */
  wellPresent: boolean;
  /** Zona activa a aplicar (null si la vista no tenía o ya no existe). */
  zoneId: string | null;
  /** Panel a mostrar (null si la vista no tenía o ya no existe). */
  panel: string | null;
  /** Pistas a dibujar (null = las de fábrica). Las curvas que el pozo no tenga las resuelve el visor como siempre. */
  tracks: SavedView['tracks'];
  /** Tramo pedido; si cae fuera del pozo, el visor lo acota. */
  top: number;
  base: number;
  issues: ViewIssue[];
}

/**
 * Resuelve una vista contra el proyecto: zona borrada → sin zona activa y aviso «La zona X ya no existe»; panel que ya
 * no existe → sin panel; pozo ausente → `wellPresent: false`. `panelExists` lo da quien llama (la lista de paneles es
 * de la app).
 */
export function resolveView(project: Project, view: SavedView, panelExists: (id: string) => boolean = () => true): ResolvedView {
  const issues: ViewIssue[] = [];
  const entry = project.wells.find((w) => w.well.id === view.wellId);
  if (!entry) issues.push({ kind: 'well', message: 'El pozo de esta vista ya no está en el proyecto' });
  let zoneId = view.zoneId;
  if (zoneId && entry && !entry.interpretation.zones.some((z) => z.id === zoneId)) {
    const zoneName = view.zoneName ?? 'de la vista';
    issues.push({ kind: 'zone', zoneName, message: `La zona ${zoneName} ya no existe` });
    zoneId = null;
  }
  let panel = view.panel;
  if (panel && !panelExists(panel)) {
    issues.push({ kind: 'dockPanel', panel, message: 'El panel de esta vista ya no existe' });
    panel = null;
  }
  return { view, wellPresent: !!entry, zoneId: entry ? zoneId : null, panel, tracks: view.tracks, top: view.top, base: view.base, issues };
}
