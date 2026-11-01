/**
 * Acciones de «Armar pistas» (docs/decisiones/0016): traducen gestos (soltar, menú, teclado) a recetas puras de
 * `src/core/state/tracks.ts` y las guardan con `commit` (una entrada de deshacer por gesto, con etiqueta propia).
 *
 * Trabajan siempre sobre la lista materializada del proyecto en el momento del cambio (las pistas propias o las de
 * fábrica + las pistas de superposiciones), por id; el visor dibuja otra lista (sin vacías ni ocultas), por eso los
 * destinos se expresan como «antes de la pista X».
 */
import type { TrackSpec } from '../../core/display';
import { makeId, setTrackLayout, type Project } from '../../core/state/project';
import {
  addCurveToTrack,
  addTrack,
  applyTrackTemplate,
  deleteTrackTemplate,
  entryIndexFor,
  expandGroupEntry,
  layoutsEqual,
  moveCurveEntry,
  moveTrack,
  removeCurveEntry,
  removeTrack,
  renameTrack,
  renameTrackTemplate,
  reorderCurveEntry,
  resetTrackLayout,
  saveTrackTemplate,
  setTrackWidth,
  showTrack,
  trackTemplatesFor,
  TRACK_WIDTH_STEP,
  uniqueTrackId,
  updateTrackLayout,
} from '../../core/state/tracks';
import { getUnit } from '../../core/units';
import type { Curve } from '../../core/well';
import type { WorkspaceId } from '../../core/workspaces';
import { toast, type MenuEntry } from '../../ui';
import { conventionEntry, curveEntryOf, trackForCurve, type TrackDraft } from '../../viewer/catalog';
import type { LayoutDropTarget } from '../../viewer/layoutEdit';
import type { ViewerOverlay } from '../../viewer/overlay';
import type { ResolvedCurve, ResolvedTrack } from '../../viewer/resolve';
import { BUILTIN_LAYOUTS, layoutFor, withOverlayTracks } from '../../viewer/templates';
import { essentialPetrophysicsLayout } from '../../viewer/essential';
import { useProject } from '../store/project';
import type { DragPayload } from './dnd';

/** Anuncio para lectores de pantalla (región `aria-live` del visor). */
export function announce(message: string): void {
  const el = typeof document !== 'undefined' ? document.getElementById('tb-live') : null;
  if (!el) return;
  el.textContent = '';
  // Otro cuadro: algunos lectores no repiten un texto que cambia en el mismo cuadro.
  requestAnimationFrame(() => (el.textContent = message));
}

/**
 * `commit` que no deja escapar el error de una receta (pista que ya no existe, nombre repetido…): avisa con un toast
 * y no cambia nada. true si se aplicó.
 */
function safeCommit(label: string, recipe: (p: Project) => Project): boolean {
  try {
    useProject.getState().commit(label, recipe);
    return true;
  } catch (err) {
    toast({ tone: 'warn', title: `No se pudo: ${label}`, description: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

/** Pistas que se ven de un espacio (propias o de fábrica, con las de superposiciones). */
export function materializedLayout(project: Project, workspace: WorkspaceId, overlays: readonly ViewerOverlay[]): TrackSpec[] {
  return withOverlayTracks(layoutFor(workspace, project.display.layouts), overlays, workspace);
}

/** Qué plantilla está aplicada: la de fábrica, una propia o ninguna (pistas tocadas a mano). */
export type CurrentTemplate = { kind: 'factory' } | { kind: 'essential' } | { kind: 'template'; id: string; name: string } | { kind: 'custom' };

export function currentTemplate(project: Project, workspace: WorkspaceId, overlays: readonly ViewerOverlay[]): CurrentTemplate {
  const custom = project.display.layouts[workspace];
  if (!custom) return { kind: 'factory' };
  const now = materializedLayout(project, workspace, overlays);
  for (const t of trackTemplatesFor(project, workspace)) if (layoutsEqual(now, withOverlayTracks(t.tracks, overlays, workspace))) return { kind: 'template', id: t.id, name: t.name };
  if (workspace === 'petrophysics' && layoutsEqual(now, withOverlayTracks(essentialPetrophysicsLayout(), overlays, workspace))) return { kind: 'essential' };
  if (layoutsEqual(now, withOverlayTracks(BUILTIN_LAYOUTS[workspace], overlays, workspace))) return { kind: 'factory' };
  return { kind: 'custom' };
}

export interface LayoutEditorContext {
  workspace: WorkspaceId;
  overlays: readonly ViewerOverlay[];
  /** Pistas como las dibuja el visor en modo edición (incluye las latentes). */
  displayed: readonly ResolvedTrack[];
  /**
   * Curvas medidas del pozo activo: al expandir un grupo (`{ unassigned }`) se toman de acá, no de lo dibujado, para
   * no perder las que el usuario ocultó (siguen ocultas: el ocultamiento vive en `display.curves`).
   */
  curves: readonly Pick<Curve, 'id' | 'role' | 'unit'>[];
}

const isCurveTrack = (t: ResolvedTrack) => t.kind === 'curves' || t.kind === 'flags';

/** ¿La pista dibujada acepta lo que se arrastra? Curvas en pistas de curvas; banderas en la de banderas. */
export function acceptsPayload(payload: DragPayload | null, t: ResolvedTrack): boolean {
  if (!payload) return false;
  if (payload.kind === 'track' || payload.kind === 'catalog-track') return false;
  const flag = payload.kind === 'curve' ? payload.flag : payload.item.flag;
  if (payload.kind === 'catalog-curve' && !payload.item.available) return false;
  return flag ? t.kind === 'flags' : t.kind === 'curves';
}

export function createLayoutEditor(ctx: LayoutEditorContext) {
  const { workspace, overlays, displayed } = ctx;
  const titleOf = (id: string) => displayed.find((t) => t.id === id)?.title ?? id;

  const edit = (label: string, fn: (tracks: readonly TrackSpec[]) => readonly TrackSpec[], done?: string) => {
    const before = useProject.getState().project;
    if (!safeCommit(label, (p) => updateTrackLayout(p, workspace, materializedLayout(p, workspace, overlays), fn))) return;
    if (done && useProject.getState().project !== before) announce(done);
  };

  /** Ids de las curvas del pozo que toma una entrada de grupo (sin rol, de esa magnitud), en el orden del pozo. */
  const groupIds = (dimension: string) => ctx.curves.filter((c) => !c.role && getUnit(c.unit)?.dimension === dimension).map((c) => c.id);

  /**
   * Entrada de la lista que corresponde a una curva dibujada. Si vino de un grupo, primero lo expande (D3). -1 si la
   * tomó un recolector.
   */
  const locate = (tracks: readonly TrackSpec[], t: ResolvedTrack, c: ResolvedCurve): { tracks: readonly TrackSpec[]; index: number } => {
    const spec = tracks.find((x) => x.id === t.id);
    if (!spec) return { tracks, index: -1 };
    const i = entryIndexFor(spec, c);
    const sel = i >= 0 ? spec.curves![i]!.select : null;
    if (sel && 'unassigned' in sel) {
      const expanded = expandGroupEntry(tracks, t.id, i, groupIds(sel.unassigned));
      return { tracks: expanded, index: entryIndexFor(expanded.find((x) => x.id === t.id)!, c) };
    }
    return { tracks, index: i };
  };

  /** Posición de inserción (orden de dibujo) para un destino sobre una fila: arriba = después de ella. */
  const insertionAt = (tracks: readonly TrackSpec[], target: LayoutDropTarget): number | undefined => {
    if (target.kind !== 'track' || !target.row) return undefined;
    const dt = displayed.find((t) => t.id === target.trackId);
    const rc = dt?.curves.find((c) => c.key === target.row!.curveKey);
    const spec = tracks.find((t) => t.id === target.trackId);
    if (!rc || !spec) return undefined;
    const i = entryIndexFor(spec, rc);
    if (i < 0) return undefined;
    return target.row.side === 'above' ? i + 1 : i;
  };

  const newTrackFrom = (tracks: readonly TrackSpec[], draft: TrackDraft): TrackSpec => ({ ...draft, id: draft.id && !tracks.some((t) => t.id === draft.id) ? draft.id : uniqueTrackId(tracks, draft.title) });

  const moveCurveTo = (t: ResolvedTrack, c: ResolvedCurve, to: LayoutDropTarget) => {
    const name = c.name;
    if (to.kind === 'gap') {
      edit(`Crear pista ${name}`, (tracks) => {
        const { tracks: base, index } = locate(tracks, t, c);
        const flag = c.kind === 'band';
        const id = uniqueTrackId(base, name);
        const shell: TrackSpec = flag ? { id, title: name, kind: 'flags', curves: [] } : { id, title: name, kind: 'curves', curves: [], emptyHint: 'Arrastrá curvas a esta pista desde el catálogo.' };
        const withTrack = addTrack(base, shell, to.beforeId);
        if (index < 0) return c.role ? addCurveToTrack(withTrack, id, conventionEntry(c.role)) : tracks;
        return moveCurveEntry(withTrack, t.id, index, id);
      }, `${name} en una pista nueva`);
      return;
    }
    const dest = titleOf(to.trackId);
    edit(to.trackId === t.id ? `Reordenar ${name}` : `Mover ${name} a ${dest}`, (tracks) => {
      const { tracks: base, index } = locate(tracks, t, c);
      const at = insertionAt(base, to);
      if (index < 0) return c.role ? addCurveToTrack(base, to.trackId, conventionEntry(c.role), at) : tracks;
      return moveCurveEntry(base, t.id, index, to.trackId, at);
    }, to.trackId === t.id ? `${name} reordenada` : `${name} movida a ${dest}`);
  };

  const api = {
    displayedTrack: (id: string): ResolvedTrack | undefined => displayed.find((t) => t.id === id),

    /** Soltar algo en un destino. */
    drop(payload: DragPayload, target: LayoutDropTarget) {
      switch (payload.kind) {
        case 'catalog-curve': {
          const item = payload.item;
          if (!item.available) return;
          if (target.kind === 'gap') {
            // Título: el nombre del rol si es corto («Caliper»), si no el mnemónico.
            const title = item.role && item.label.length <= 18 ? item.label : item.name;
            edit(`Crear pista ${title}`, (tracks) => addTrack(tracks, newTrackFrom(tracks, trackForCurve(item, title)), target.beforeId), `Pista ${title} creada`);
            return;
          }
          const dt = displayed.find((t) => t.id === target.trackId);
          if (!dt || !acceptsPayload(payload, dt)) return;
          edit(`Agregar ${item.name} a ${dt.title}`, (tracks) => addCurveToTrack(tracks, dt.id, curveEntryOf(item), insertionAt(tracks, target)), `${item.name} agregada a ${dt.title}`);
          return;
        }
        case 'catalog-track': {
          const item = payload.item;
          if (!item.available) return;
          const beforeId = target.kind === 'gap' ? target.beforeId : target.trackId;
          api.addTool(item.track, item.name, beforeId, item.overlayId);
          return;
        }
        case 'curve': {
          const t = displayed.find((x) => x.id === payload.trackId);
          const c = t?.curves.find((x) => x.key === payload.curveKey);
          if (!t || !c) return;
          if (target.kind === 'track') {
            const dt = displayed.find((x) => x.id === target.trackId);
            if (!dt || !acceptsPayload(payload, dt)) return;
          }
          moveCurveTo(t, c, target);
          return;
        }
        case 'track':
          if (target.kind !== 'gap') return;
          edit(`Mover pista ${payload.title}`, (tracks) => moveTrack(tracks, payload.trackId, target.beforeId), `Pista ${payload.title} movida`);
      }
    },

    /** Agrega una herramienta o pista especial antes de `beforeId` (null = al final). */
    addTool(draft: TrackDraft, name: string, beforeId: string | null, overlayId?: string) {
      edit(`Agregar pista ${name}`, (tracks) => {
        const existing = overlayId ? tracks.find((t) => (t.kind === 'overlay' && t.overlayId === overlayId) || (draft.id !== undefined && t.id === draft.id)) : undefined;
        if (existing) return showTrack(tracks, existing.id, beforeId);
        return addTrack(tracks, newTrackFrom(tracks, draft), beforeId);
      }, `Pista ${name} agregada`);
    },

    /** Agrega una curva del catálogo a una pista existente (sin mouse). */
    addCurve(item: Parameters<typeof curveEntryOf>[0] & { name: string }, trackId: string) {
      edit(`Agregar ${item.name} a ${titleOf(trackId)}`, (tracks) => addCurveToTrack(tracks, trackId, curveEntryOf(item)), `${item.name} agregada a ${titleOf(trackId)}`);
    },

    moveTrackBy(t: ResolvedTrack, dir: -1 | 1) {
      const i = displayed.findIndex((x) => x.id === t.id);
      if (i < 0 || (dir < 0 && i === 0) || (dir > 0 && i === displayed.length - 1)) return;
      const beforeId = dir < 0 ? displayed[i - 1]!.id : (displayed[i + 2]?.id ?? null);
      edit(`Mover pista ${t.title}`, (tracks) => moveTrack(tracks, t.id, beforeId), `Pista ${t.title} movida a la ${dir < 0 ? 'izquierda' : 'derecha'}`);
    },

    resize(t: ResolvedTrack, width: number) {
      edit(`Cambiar ancho de ${t.title}`, (tracks) => setTrackWidth(tracks, t.id, width), `Ancho de ${t.title}: ${Math.round(width * 100)} %`);
    },

    removeTrack(t: ResolvedTrack) {
      edit(`Quitar pista ${t.title}`, (tracks) => removeTrack(tracks, t.id), `Pista ${t.title} quitada`);
    },

    renameTrack(t: ResolvedTrack, title: string) {
      edit(`Renombrar pista ${t.title}`, (tracks) => renameTrack(tracks, t.id, title), `Pista renombrada: ${title.trim()}`);
    },

    moveCurveBy(t: ResolvedTrack, c: ResolvedCurve, dir: -1 | 1) {
      // dir 1 = subir (más arriba en el encabezado = después en el orden de dibujo).
      edit(`Reordenar ${c.name}`, (tracks) => {
        const { tracks: base, index } = locate(tracks, t, c);
        if (index < 0) return tracks;
        return reorderCurveEntry(base, t.id, index, dir > 0 ? index + 2 : index - 1);
      }, `${c.name} ${dir > 0 ? 'subida' : 'bajada'}`);
    },

    moveCurveToTrack(t: ResolvedTrack, c: ResolvedCurve, to: LayoutDropTarget) {
      moveCurveTo(t, c, to);
    },

    /** Pasa la curva a la pista vecina que la acepte (Alt+←/→). */
    moveCurveSideways(t: ResolvedTrack, c: ResolvedCurve, dir: -1 | 1) {
      const i = displayed.findIndex((x) => x.id === t.id);
      const flag = c.kind === 'band';
      for (let j = i + dir; j >= 0 && j < displayed.length; j += dir) {
        const d = displayed[j]!;
        if (flag ? d.kind === 'flags' : d.kind === 'curves') {
          moveCurveTo(t, c, { kind: 'track', trackId: d.id });
          return;
        }
      }
      announce(`No hay otra pista a la ${dir < 0 ? 'izquierda' : 'derecha'} para ${c.name}`);
    },

    removeCurve(t: ResolvedTrack, c: ResolvedCurve) {
      edit(`Quitar ${c.name} de ${t.title}`, (tracks) => {
        const { tracks: base, index } = locate(tracks, t, c);
        return index < 0 ? tracks : removeCurveEntry(base, t.id, index);
      }, `${c.name} quitada de ${t.title}`);
    },

    /** ¿La curva tiene entrada propia (se puede quitar o reordenar)? */
    hasEntry(t: ResolvedTrack, c: ResolvedCurve): boolean {
      const spec = materializedLayout(useProject.getState().project, workspace, overlays).find((x) => x.id === t.id);
      return !!spec && entryIndexFor(spec, c) >= 0;
    },

    trackMenu(t: ResolvedTrack, onRename: (t: ResolvedTrack) => void): MenuEntry[] {
      const i = displayed.findIndex((x) => x.id === t.id);
      const flexible = t.fixed === undefined;
      return [
        { type: 'label', id: 'l', label: t.title },
        { id: 'left', label: 'Mover a la izquierda', icon: 'chevron-left', hint: 'Alt+←', disabled: i <= 0, onSelect: () => api.moveTrackBy(t, -1) },
        { id: 'right', label: 'Mover a la derecha', icon: 'chevron-right', hint: 'Alt+→', disabled: i < 0 || i >= displayed.length - 1, onSelect: () => api.moveTrackBy(t, 1) },
        { type: 'separator', id: 's1' },
        { id: 'wider', label: 'Más ancha', icon: 'plus', hint: 'Alt+Mayús+→', disabled: !flexible, onSelect: () => api.resize(t, t.width * TRACK_WIDTH_STEP) },
        { id: 'narrower', label: 'Más angosta', icon: 'minus', hint: 'Alt+Mayús+←', disabled: !flexible, onSelect: () => api.resize(t, t.width / TRACK_WIDTH_STEP) },
        { id: 'rename', label: 'Renombrar…', icon: 'pen', onSelect: () => onRename(t) },
        { type: 'separator', id: 's2' },
        { id: 'remove', label: 'Quitar pista', icon: 'trash', hint: 'Supr', danger: true, onSelect: () => api.removeTrack(t) },
      ];
    },

    curveMenu(t: ResolvedTrack, c: ResolvedCurve): MenuEntry[] {
      const own = api.hasEntry(t, c);
      const flag = c.kind === 'band';
      const others = displayed.filter((d) => d.id !== t.id && isCurveTrack(d) && (flag ? d.kind === 'flags' : d.kind === 'curves'));
      const list = [...t.curves].reverse();
      const row = list.findIndex((x) => x.key === c.key);
      return [
        { type: 'label', id: 'l', label: c.name },
        { id: 'up', label: 'Subir', icon: 'chevron-up', hint: 'Alt+↑', disabled: !own || row <= 0, onSelect: () => api.moveCurveBy(t, c, 1) },
        { id: 'down', label: 'Bajar', icon: 'chevron-down', hint: 'Alt+↓', disabled: !own || row < 0 || row >= list.length - 1, onSelect: () => api.moveCurveBy(t, c, -1) },
        { type: 'separator', id: 's1' },
        { type: 'label', id: 'to', label: 'Mover a' },
        ...others.map((d): MenuEntry => ({ id: `to:${d.id}`, label: d.title, icon: 'arrow-right', onSelect: () => moveCurveTo(t, c, { kind: 'track', trackId: d.id }) })),
        { id: 'new', label: 'Una pista nueva', icon: 'plus', onSelect: () => moveCurveTo(t, c, { kind: 'gap', beforeId: displayed[displayed.findIndex((x) => x.id === t.id) + 1]?.id ?? null }) },
        { type: 'separator', id: 's2' },
        {
          id: 'remove',
          label: 'Quitar de la pista',
          icon: 'trash',
          danger: true,
          disabled: !own,
          ...(own ? {} : { description: 'La pista la toma sola; ocultala desde su escala' }),
          onSelect: () => api.removeCurve(t, c),
        },
      ];
    },

    /** Menú «Agregar a pista…» de un elemento del catálogo (sin mouse). */
    addMenu(kind: 'curve' | 'flag' | 'track', onTrack: (trackId: string) => void, onNew: () => void): MenuEntry[] {
      if (kind === 'track') {
        return [
          { type: 'label', id: 'l', label: 'Agregar' },
          ...displayed.map((d): MenuEntry => ({ id: `b:${d.id}`, label: `Antes de ${d.title}`, icon: 'chevron-left', onSelect: () => onTrack(d.id) })),
          { id: 'end', label: 'Al final', icon: 'arrow-right', onSelect: onNew },
        ];
      }
      const targets = displayed.filter((d) => (kind === 'flag' ? d.kind === 'flags' : d.kind === 'curves'));
      return [
        { type: 'label', id: 'l', label: 'Agregar a pista' },
        ...targets.map((d): MenuEntry => ({ id: `t:${d.id}`, label: d.title, icon: 'tracks', onSelect: () => onTrack(d.id) })),
        { type: 'separator', id: 's' },
        { id: 'new', label: 'En una pista nueva', icon: 'plus', hint: 'al final', onSelect: onNew },
      ];
    },
  };
  return api;
}

export type LayoutEditor = ReturnType<typeof createLayoutEditor>;

// ── plantillas ────────────────────────────────────────────────────────────────────────────────────────────────

export function saveTemplate(workspace: WorkspaceId, overlays: readonly ViewerOverlay[], name: string): void {
  const clean = name.trim();
  const before = useProject.getState().project;
  const ok = safeCommit(`Guardar plantilla «${clean}»`, (p) => saveTrackTemplate(p, { id: makeId('plantilla'), name: clean, workspace, tracks: materializedLayout(p, workspace, overlays), savedAt: new Date().toISOString() }));
  if (ok && useProject.getState().project !== before) announce(`Plantilla «${clean}» guardada`);
}

export function applyTemplate(id: string, name: string): void {
  if (!safeCommit(`Aplicar plantilla «${name}»`, (p) => applyTrackTemplate(p, id))) return;
  announce(`Plantilla «${name}» aplicada`);
}

export function resetToFactory(workspace: WorkspaceId): void {
  if (!safeCommit('Restablecer pistas de fábrica', (p) => resetTrackLayout(p, workspace))) return;
  announce('Pistas de fábrica restablecidas');
}

/** Solo cambia display: los datos, fuentes, parámetros y plantillas propias se conservan. */
export function applyEssentialTemplate(): void {
  if (!safeCommit('Aplicar Petrofísica esencial', (p) => {
    const tracks = essentialPetrophysicsLayout();
    const current = p.display.layouts.petrophysics;
    return current && layoutsEqual(current, tracks) ? p : setTrackLayout(p, 'petrophysics', tracks);
  })) return;
  announce('Petrofísica esencial aplicada. Las demás curvas siguen disponibles en Armar pistas.');
}

export function deleteTemplate(id: string, name: string): void {
  if (!safeCommit(`Borrar plantilla «${name}»`, (p) => deleteTrackTemplate(p, id))) return;
  announce(`Plantilla «${name}» borrada`);
}

export function renameTemplate(id: string, name: string): void {
  useProject.getState().commit(`Renombrar plantilla «${name.trim()}»`, (p) => renameTrackTemplate(p, id, name));
}
