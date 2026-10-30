/**
 * Recetas puras para armar pistas y guardar plantillas propias (docs/decisiones/0016-pistas-armables.md).
 *
 * Las de lista (`addTrack`, `moveCurveEntry`…) trabajan sobre `TrackSpec[]` y devuelven una lista nueva (o la misma
 * si no cambió nada). Ubican las pistas por id y los destinos con «antes de la pista X» (`beforeId`, null = al
 * final): lo que dibuja el visor omite pistas vacías u ocultas, así que sus índices no sirven para la lista guardada.
 * Las curvas de una pista son entradas con un selector (`{ role }`, `{ curveId }`, `{ unassigned }`); su índice es
 * el orden de dibujo (la última queda arriba).
 *
 * Las de proyecto (`updateTrackLayout`, plantillas) usan `setTrackLayout` de project.ts. Sin React ni stores.
 */
import { clampTrackWidth, TRACK_WIDTH_RANGE, TRACK_WIDTH_STEP, type CurveDisplayOverride, type CurveSelector, type FillSpec, type TrackCurveSpec, type TrackSpec, type TrackTemplate } from '../display';
import { setTrackLayout, type Project } from './project';

export { TRACK_WIDTH_RANGE, TRACK_WIDTH_STEP };

// ── utilidades ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Clave estable de un selector ('r:GR', 'c:AT10', 'u:resistivity'). */
export function selectorKey(sel: CurveSelector): string {
  if ('role' in sel) return sel.module ? `r:${sel.role}@${sel.module}` : `r:${sel.role}`;
  if ('curveId' in sel) return `c:${sel.curveId}`;
  return `u:${sel.unassigned}`;
}

/** Rol de un selector (solo `{ role }`; los demás no lo conocen sin el pozo). */
export const selectorRole = (sel: CurveSelector): string | null => ('role' in sel ? sel.role : null);

/** JSON con claves ordenadas: compara pistas sin depender del orden de las claves. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_k, v: unknown) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return v;
    const o = v as Record<string, unknown>;
    return Object.fromEntries(Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
  });
}

/** ¿Dos juegos de pistas son iguales (mismo contenido)? */
export const layoutsEqual = (a: readonly TrackSpec[], b: readonly TrackSpec[]): boolean => a === b || canonicalJson(a) === canonicalJson(b);

/**
 * Identidad de un relleno: qué curvas y qué lado, no su color ni su opacidad. Dos rellenos de borde izquierdo de GR
 * (arcilla al 32 % y al 30 %) son el mismo: soltar GR del catálogo en el GR espectral no lo duplica.
 */
export function fillKey(f: FillSpec): string {
  if (f.kind === 'edge') return `edge:${f.curve}:${f.side}`;
  if (f.kind === 'baseline') return `baseline:${f.curve}:${f.value}`;
  if (f.kind === 'range') return `range:${f.curve}`;
  return `between:${[f.a, f.b].sort().join(':')}`;
}
const sameFill = (a: FillSpec, b: FillSpec) => fillKey(a) === fillKey(b);

/** Roles que usa un relleno. */
export function fillRoles(f: FillSpec): string[] {
  return f.kind === 'between' ? [f.a, f.b] : [f.curve];
}

const trackRoles = (t: TrackSpec): Set<string> => new Set((t.curves ?? []).map((e) => selectorRole(e.select)).filter((r): r is string => !!r));

/** Id nuevo, legible y único en la lista ('u-gr', 'u-gr-2'…). Las de fábrica no usan el prefijo `u-`. */
export function uniqueTrackId(tracks: readonly TrackSpec[], base: string): string {
  const slug =
    base
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24) || 'pista';
  const ids = new Set(tracks.map((t) => t.id));
  const first = `u-${slug}`;
  if (!ids.has(first)) return first;
  for (let i = 2; ; i++) if (!ids.has(`${first}-${i}`)) return `${first}-${i}`;
}

/** «Pista N» con el primer N libre. */
export function nextTrackTitle(tracks: readonly TrackSpec[]): string {
  const titles = new Set(tracks.map((t) => t.title));
  for (let i = 1; ; i++) if (!titles.has(`Pista ${i}`)) return `Pista ${i}`;
}

function indexOf(tracks: readonly TrackSpec[], id: string): number {
  const i = tracks.findIndex((t) => t.id === id);
  if (i < 0) throw new Error(`No existe la pista '${id}'.`);
  return i;
}

/** Índice de inserción «antes de `beforeId`» (null o inexistente = al final). */
function insertAt(tracks: readonly TrackSpec[], beforeId: string | null): number {
  if (beforeId === null) return tracks.length;
  const i = tracks.findIndex((t) => t.id === beforeId);
  return i < 0 ? tracks.length : i;
}

function replaceTrack(tracks: readonly TrackSpec[], index: number, next: TrackSpec): TrackSpec[] {
  const out = [...tracks];
  out[index] = next;
  return out;
}

/** ¿La pista puede recibir curvas? Profundidad, columnas y superposiciones no. */
export const acceptsCurves = (t: TrackSpec): boolean => t.kind === 'curves' || t.kind === 'flags';

// ── pistas ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Agrega una pista antes de `beforeId` (null = al final). Si el id ya existe, se le da uno nuevo. */
export function addTrack(tracks: readonly TrackSpec[], track: TrackSpec, beforeId: string | null = null): TrackSpec[] {
  const t = tracks.some((x) => x.id === track.id) ? { ...track, id: uniqueTrackId(tracks, track.title || 'pista') } : track;
  const out = [...tracks];
  out.splice(insertAt(tracks, beforeId), 0, t);
  return out;
}

/** Mueve una pista antes de `beforeId` (null = al final). Si queda donde estaba, devuelve la misma lista. */
export function moveTrack(tracks: readonly TrackSpec[], id: string, beforeId: string | null): TrackSpec[] {
  const from = indexOf(tracks, id);
  if (beforeId === id) return tracks as TrackSpec[];
  const rest = tracks.filter((t) => t.id !== id);
  const at = insertAt(rest, beforeId);
  if (at === from) return tracks as TrackSpec[];
  rest.splice(at, 0, tracks[from]!);
  return rest;
}

/**
 * Quita una pista. Las de superposición quedan `hidden` (si se borraran, el visor las volvería a agregar solo); el
 * resto se borra.
 */
export function removeTrack(tracks: readonly TrackSpec[], id: string): TrackSpec[] {
  const i = indexOf(tracks, id);
  const t = tracks[i]!;
  if (t.kind === 'overlay') return t.hidden ? (tracks as TrackSpec[]) : replaceTrack(tracks, i, { ...t, hidden: true });
  return tracks.filter((x) => x.id !== id);
}

/** Vuelve a mostrar una pista oculta y la ubica antes de `beforeId`. */
export function showTrack(tracks: readonly TrackSpec[], id: string, beforeId: string | null = null): TrackSpec[] {
  const i = indexOf(tracks, id);
  const { hidden: _h, ...shown } = tracks[i]!;
  return moveTrack(replaceTrack(tracks, i, shown), id, beforeId);
}

/** Ancho relativo, acotado a `TRACK_WIDTH_RANGE` y redondeado a centésimos. Solo pistas flexibles. */
export function setTrackWidth(tracks: readonly TrackSpec[], id: string, width: number): TrackSpec[] {
  const i = indexOf(tracks, id);
  const t = tracks[i]!;
  if (t.kind === 'depth' || !Number.isFinite(width)) return tracks as TrackSpec[];
  const w = clampTrackWidth(width);
  if ((t.width ?? 1) === w) return tracks as TrackSpec[];
  return replaceTrack(tracks, i, { ...t, width: w });
}

export function renameTrack(tracks: readonly TrackSpec[], id: string, title: string): TrackSpec[] {
  const i = indexOf(tracks, id);
  const clean = title.trim();
  if (!clean || tracks[i]!.title === clean) return tracks as TrackSpec[];
  return replaceTrack(tracks, i, { ...tracks[i]!, title: clean });
}

// ── curvas ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** Lo que se suelta en una pista: un selector con su estilo de plantilla y los rellenos que le son propios. */
export interface CurveEntryInput {
  select: CurveSelector;
  style?: CurveDisplayOverride;
  fills?: readonly FillSpec[];
}

const entryOf = (e: CurveEntryInput): TrackCurveSpec => ({ select: e.select, ...(e.style ? { style: e.style } : {}) });

function withFills(t: TrackSpec, fills: readonly FillSpec[] | undefined): TrackSpec {
  if (!fills?.length) return t;
  const have = t.fills ?? [];
  const add = fills.filter((f) => !have.some((h) => sameFill(h, f)));
  return add.length ? { ...t, fills: [...have, ...add] } : t;
}

/**
 * Agrega una curva a una pista en la posición `at` del orden de dibujo (por defecto arriba de todas). Si la pista
 * ya tiene ese selector, lo reubica en vez de duplicarlo. Suma los rellenos propios que falten.
 */
export function addCurveToTrack(tracks: readonly TrackSpec[], trackId: string, entry: CurveEntryInput, at?: number): TrackSpec[] {
  const i = indexOf(tracks, trackId);
  const t = tracks[i]!;
  if (!acceptsCurves(t)) throw new Error(`La pista '${t.title}' no acepta curvas.`);
  const curves = [...(t.curves ?? [])];
  const key = selectorKey(entry.select);
  const existing = curves.findIndex((c) => selectorKey(c.select) === key);
  let next: TrackSpec;
  if (existing >= 0) {
    const pos = at === undefined ? existing : Math.max(0, Math.min(curves.length, at));
    const [moved] = curves.splice(existing, 1);
    curves.splice(pos > existing ? pos - 1 : pos, 0, moved!);
    next = { ...t, curves };
  } else {
    curves.splice(at === undefined ? curves.length : Math.max(0, Math.min(curves.length, at)), 0, entryOf(entry));
    next = { ...t, curves };
  }
  next = withFills(next, entry.fills);
  return layoutsEqual([t], [next]) ? (tracks as TrackSpec[]) : replaceTrack(tracks, i, next);
}

/** Reordena una curva dentro de su pista: queda en la posición `at` (índice del orden de dibujo, antes de quitarla). */
export function reorderCurveEntry(tracks: readonly TrackSpec[], trackId: string, entryIndex: number, at: number): TrackSpec[] {
  const i = indexOf(tracks, trackId);
  const t = tracks[i]!;
  const curves = [...(t.curves ?? [])];
  if (entryIndex < 0 || entryIndex >= curves.length) return tracks as TrackSpec[];
  const target = Math.max(0, Math.min(curves.length, at));
  const pos = target > entryIndex ? target - 1 : target;
  if (pos === entryIndex) return tracks as TrackSpec[];
  const [moved] = curves.splice(entryIndex, 1);
  curves.splice(pos, 0, moved!);
  return replaceTrack(tracks, i, { ...t, curves });
}

/**
 * Saca la entrada `entryIndex` de una pista. Devuelve la pista nueva, la entrada y los rellenos de una sola curva que
 * se fueron con ella (los de su rol, si ninguna otra entrada de la pista lo tiene).
 */
function takeEntry(t: TrackSpec, entryIndex: number): { track: TrackSpec; entry: TrackCurveSpec; fills: FillSpec[] } {
  const curves = [...(t.curves ?? [])];
  const [entry] = curves.splice(entryIndex, 1);
  if (!entry) throw new Error(`La pista '${t.title}' no tiene la curva ${entryIndex + 1}.`);
  const role = selectorRole(entry.select);
  const stillHasRole = role !== null && curves.some((c) => selectorRole(c.select) === role);
  const own = (f: FillSpec) => role !== null && !stillHasRole && f.kind !== 'between' && f.curve === role;
  const fills = (t.fills ?? []).filter(own);
  const keep = (t.fills ?? []).filter((f) => !own(f));
  const track: TrackSpec = { ...t, curves, ...(t.fills ? { fills: keep } : {}) };
  return { track, entry, fills };
}

/**
 * Quita una curva de una pista. Se van con ella sus rellenos de una sola curva; los de dos curvas quedan latentes
 * (no se dibujan sin sus dos curvas y vuelven si la curva vuelve).
 */
export function removeCurveEntry(tracks: readonly TrackSpec[], trackId: string, entryIndex: number): TrackSpec[] {
  const i = indexOf(tracks, trackId);
  return replaceTrack(tracks, i, takeEntry(tracks[i]!, entryIndex).track);
}

/**
 * Mueve una curva de una pista a otra (o la reordena si es la misma), a la posición `at` del destino (por defecto,
 * arriba). Sus rellenos de una sola curva viajan con ella; los de dos curvas se copian al destino si ahí quedan las
 * dos (en el origen quedan latentes).
 */
export function moveCurveEntry(tracks: readonly TrackSpec[], fromId: string, entryIndex: number, toId: string, at?: number): TrackSpec[] {
  if (fromId === toId) return reorderCurveEntry(tracks, fromId, entryIndex, at ?? (tracks[indexOf(tracks, fromId)]!.curves?.length ?? 0));
  const fi = indexOf(tracks, fromId);
  const ti = indexOf(tracks, toId);
  if (!acceptsCurves(tracks[ti]!)) throw new Error(`La pista '${tracks[ti]!.title}' no acepta curvas.`);
  const { track: source, entry, fills } = takeEntry(tracks[fi]!, entryIndex);
  let out = replaceTrack(tracks, fi, source);
  out = addCurveToTrack(out, toId, { select: entry.select, ...(entry.style ? { style: entry.style } : {}), fills }, at);
  // Rellenos entre dos curvas: si en el destino quedaron las dos, se copian.
  const dest = out[ti]!;
  const roles = trackRoles(dest);
  const role = selectorRole(entry.select);
  const shared = (tracks[fi]!.fills ?? []).filter((f) => f.kind === 'between' && role !== null && fillRoles(f).includes(role) && fillRoles(f).every((r) => roles.has(r)));
  return shared.length ? replaceTrack(out, ti, withFills(dest, shared)) : out;
}

/**
 * Reemplaza una entrada de grupo (`{ unassigned }`) por una entrada `{ curveId }` por cada curva que tomaba en el pozo
 * activo, en el mismo lugar y con el mismo estilo. Así se puede mover o quitar una sola (D3).
 */
export function expandGroupEntry(tracks: readonly TrackSpec[], trackId: string, entryIndex: number, curveIds: readonly string[]): TrackSpec[] {
  const i = indexOf(tracks, trackId);
  const t = tracks[i]!;
  const curves = [...(t.curves ?? [])];
  const entry = curves[entryIndex];
  if (!entry || !('unassigned' in entry.select)) return tracks as TrackSpec[];
  const present = new Set(curves.map((c) => selectorKey(c.select)));
  const expanded = curveIds.filter((id) => !present.has(`c:${id}`)).map((curveId): TrackCurveSpec => ({ select: { curveId }, ...(entry.style ? { style: entry.style } : {}) }));
  curves.splice(entryIndex, 1, ...expanded);
  return replaceTrack(tracks, i, { ...t, curves });
}

/** Índice de la entrada que puso una curva resuelta en su pista (-1 si la tomó un recolector). */
export function entryIndexFor(t: TrackSpec, curve: { role: string | null; curveId?: string; origin: 'measured' | 'prepared' | 'computed'; moduleId?: string }): number {
  const list = t.curves ?? [];
  const byId = curve.curveId === undefined ? -1 : list.findIndex((e) => 'curveId' in e.select && e.select.curveId === curve.curveId);
  if (byId >= 0) return byId;
  // Primero la entrada que nombra al módulo de la curva (modelos de Sw lado a lado), después la del rol a secas.
  const byModule = curve.role === null || !curve.moduleId ? -1 : list.findIndex((e) => 'role' in e.select && e.select.role === curve.role && e.select.module === curve.moduleId);
  if (byModule >= 0) return byModule;
  const byRole = curve.role === null ? -1 : list.findIndex((e) => 'role' in e.select && e.select.role === curve.role && !e.select.module);
  if (byRole >= 0) return byRole;
  return curve.origin !== 'computed' && curve.role === null ? list.findIndex((e) => 'unassigned' in e.select) : -1;
}

// ── proyecto ───────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Aplica `fn` a las pistas que se ven de un espacio (`current`: las propias o las de fábrica, con las pistas de
 * superposiciones ya agregadas) y las guarda como propias. Sin cambios, devuelve el mismo proyecto.
 */
export function updateTrackLayout(project: Project, workspace: string, current: readonly TrackSpec[], fn: (tracks: readonly TrackSpec[]) => readonly TrackSpec[]): Project {
  const next = fn(current);
  if (next === current) return project;
  return setTrackLayout(project, workspace, [...next]);
}

const sameName = (a: string, b: string) => a.trim().toLocaleLowerCase('es') === b.trim().toLocaleLowerCase('es');

/** Plantilla propia de un espacio con ese nombre (sin distinguir mayúsculas). */
export function findTrackTemplate(project: Project, workspace: string, name: string): TrackTemplate | undefined {
  return project.display.trackTemplates?.find((t) => t.workspace === workspace && sameName(t.name, name));
}

/** Plantillas propias de un espacio, en orden de guardado. */
export function trackTemplatesFor(project: Project, workspace: string): TrackTemplate[] {
  return (project.display.trackTemplates ?? []).filter((t) => t.workspace === workspace);
}

function withTemplates(project: Project, list: TrackTemplate[]): Project {
  const { trackTemplates: _old, ...rest } = project.display;
  return { ...project, display: list.length ? { ...rest, trackTemplates: list } : rest };
}

/**
 * Guarda las pistas como plantilla con nombre. Si en ese espacio ya hay una con el mismo nombre, reemplaza sus
 * pistas (conserva su id). `id` y `savedAt` los pone quien llama (la receta es pura).
 */
export function saveTrackTemplate(project: Project, tpl: { id: string; name: string; workspace: string; tracks: readonly TrackSpec[]; savedAt?: string }): Project {
  const name = tpl.name.trim();
  if (!name) throw new Error('La plantilla necesita un nombre.');
  if (!tpl.tracks.length) throw new Error('La plantilla no tiene pistas.');
  const list = [...(project.display.trackTemplates ?? [])];
  const prev = list.findIndex((t) => t.workspace === tpl.workspace && sameName(t.name, name));
  const entry: TrackTemplate = { id: prev >= 0 ? list[prev]!.id : tpl.id, name, workspace: tpl.workspace, tracks: [...tpl.tracks], ...(tpl.savedAt ? { savedAt: tpl.savedAt } : {}) };
  if (prev >= 0) list[prev] = entry;
  else list.push(entry);
  return withTemplates(project, list);
}

export function deleteTrackTemplate(project: Project, id: string): Project {
  const list = project.display.trackTemplates ?? [];
  if (!list.some((t) => t.id === id)) return project;
  return withTemplates(project, list.filter((t) => t.id !== id));
}

/** Renombra una plantilla. Falla si el nombre está vacío o ya lo usa otra del mismo espacio. */
export function renameTrackTemplate(project: Project, id: string, name: string): Project {
  const list = project.display.trackTemplates ?? [];
  const i = list.findIndex((t) => t.id === id);
  if (i < 0) throw new Error('No existe esa plantilla.');
  const clean = name.trim();
  if (!clean) throw new Error('La plantilla necesita un nombre.');
  const tpl = list[i]!;
  if (tpl.name === clean) return project;
  if (list.some((t) => t.id !== id && t.workspace === tpl.workspace && sameName(t.name, clean))) throw new Error(`Ya hay una plantilla «${clean}».`);
  const next = [...list];
  next[i] = { ...tpl, name: clean };
  return withTemplates(project, next);
}

/** Aplica una plantilla propia a su espacio de trabajo (copia sus pistas a `layouts[espacio]`). */
export function applyTrackTemplate(project: Project, id: string): Project {
  const tpl = project.display.trackTemplates?.find((t) => t.id === id);
  if (!tpl) throw new Error('No existe esa plantilla.');
  const current = project.display.layouts[tpl.workspace];
  if (current && layoutsEqual(current, tpl.tracks)) return project;
  return setTrackLayout(project, tpl.workspace, [...tpl.tracks]);
}

/** Vuelve a la plantilla de fábrica del espacio. */
export const resetTrackLayout = (project: Project, workspace: string): Project => setTrackLayout(project, workspace, null);

