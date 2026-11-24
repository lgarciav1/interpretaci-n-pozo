/**
 * Acciones de las vistas guardadas y del modo defensa (docs/decisiones/0075).
 *
 * - Guardar, renombrar, subir, bajar y borrar son recetas puras de `src/core/state/views.ts` con `commit` (se deshacen).
 * - Ir a una vista (fuera del modo) aplica espacio, zona activa, panel y tramo a la interfaz, y las pistas con un
 *   `commit` «Abrir vista «X»» solo si difieren de las actuales.
 * - El modo defensa es estado de interfaz: al entrar se toma una foto (`defense.ts`), cada vista se muestra con un
 *   parche de interfaz y las pistas de la vista como reemplazo en el visor (sin `commit`), y al salir se restaura la
 *   foto tal cual, tramo incluido. Teclado: → ← pasan de vista, Esc sale, Ctrl+Z y Ctrl+Y no hacen nada.
 */
import type { SavedView } from '../../core/display';
import { activeWellEntry, makeId, setTrackLayout, type Project } from '../../core/state/project';
import { layoutsEqual } from '../../core/state/tracks';
import { activeWellViews, allViews, deleteView, findView, moveView, renameView, resolveView, saveView } from '../../core/state/views';
import { WORKSPACES, type WorkspaceId } from '../../core/workspaces';
import { formatNumber, toast } from '../../ui';
import { ESSENTIAL_NAME } from '../../viewer/essential';
import { isLoupeOpen } from '../../viewer/loupe';
import { DOCK_PANELS } from '../shell/dockPanels';
import { hasNativeUndo, historyShortcut } from '../shell/historyActions';
import { OVERLAYS } from '../shell/viewerOverlayList';
import { useProject } from '../store/project';
import { panelsOpen, useUi } from '../store/ui';
import { useViewer } from '../store/viewer';
import { announce, currentTemplate, safeCommit } from '../tracks/actions';
import { stopTrendTool } from '../trends/actions';
import { useTrendsUi } from '../trends/store';
import { defensePatch, nextIndex, prevIndex, rangeMatches, restorePatch, takePhoto } from './defense';
import { useViewsUi, VIEWS_PANEL_ID } from './store';

// ── utilidades ─────────────────────────────────────────────────────────────────────────────────────────────────

/** ¿Existe el panel? (la lista de paneles es de la app; se lee al usarla, no al cargar el módulo). */
export const panelExists = (id: string): boolean => DOCK_PANELS.some((p) => p.id === id);
/** Título de un panel (o el id, si ya no existe). */
export const panelTitle = (id: string): string => DOCK_PANELS.find((p) => p.id === id)?.title ?? id;

const m1 = (d: number) => formatNumber(d, { digits: 1, grouping: false });
/** «7633,0–8518,0 m». */
export const rangeLabel = (top: number, base: number): string => `${m1(top)}–${m1(base)} m`;

const isWorkspace = (w: string): w is WorkspaceId => WORKSPACES.some((x) => x.id === w);

/** Límites de profundidad del pozo activo (para comparar el tramo visible con el pedido). */
function wellLimits(): { min: number; max: number } | null {
  const d = activeWellEntry(useProject.getState().project)?.well.depth.values;
  return d && d.length > 1 ? { min: d[0]!, max: d[d.length - 1]! } : null;
}

/** Después de que el armazón se acomode (React pinta y el visor recibe su tamaño nuevo): dos cuadros. */
function afterLayout(fn: () => void): void {
  if (typeof requestAnimationFrame !== 'function') {
    setTimeout(fn, 0);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(fn));
}

let rangeToken = 0;
/**
 * Lleva el visor al tramo cuando el armazón ya se acomodó (al esconder barras cambia el alto del visor y el mismo pedido
 * daría otro tramo) y comprueba que el tramo visible sea el pedido; si no, lo vuelve a pedir (hasta 4 veces). Un pedido
 * nuevo cancela el anterior.
 */
function settleRange(top: number, base: number): void {
  const token = ++rangeToken;
  let tries = 0;
  const attempt = () =>
    afterLayout(() => {
      if (token !== rangeToken) return;
      useTrendsUi.getState().requestRange(top, base);
      afterLayout(() => {
        if (token !== rangeToken) return;
        if (!rangeMatches(useViewer.getState().visible, { top, base }, wellLimits()) && ++tries < 4) attempt();
      });
    });
  attempt();
}

const viewerBody = (): HTMLElement | null => (typeof document === 'undefined' ? null : document.querySelector<HTMLElement>('.shell-viewer .wv-body'));

/**
 * Al entrar, el foco se suelta (queda en el documento): enfocar el visor mostraría el cursor de teclado y el marco de
 * foco en la pantalla limpia. La primera tecla del visor (↑ ↓, Re Pág, Av Pág, Inicio, Fin, + − 0) lo enfoca y se le
 * reenvía (ver `onDefenseKey`).
 */
function releaseFocus(): void {
  if (typeof document === 'undefined') return;
  const el = document.activeElement;
  if (el instanceof HTMLElement && el !== document.body) el.blur();
}

/** Al salir, el foco vuelve al botón «Modo defensa» de la barra superior (si está). */
function focusDefenseToggle(): void {
  if (typeof document === 'undefined') return;
  afterLayout(() => document.querySelector<HTMLElement>('[data-testid=defense-toggle]')?.focus({ preventScroll: true }));
}

/** Teclas del visor que se reenvían si el foco no está en ningún lado. */
const VIEWER_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', '+', '=', '-', '_', '0']);

function templateLabel(project: Project, workspace: WorkspaceId): string | undefined {
  const c = currentTemplate(project, workspace, OVERLAYS);
  return c.kind === 'factory' ? 'De fábrica' : c.kind === 'essential' ? ESSENTIAL_NAME : c.kind === 'template' ? c.name : undefined;
}

// ── guardar y administrar ─────────────────────────────────────────────────────────────────────────────────────

/**
 * La vista actual sin id ni nombre: espacio, tramo visible, copia de las pistas propias del espacio (null = las de
 * fábrica), plantilla aplicada (rótulo), zona activa y panel a la vista. null sin pozo.
 */
export function currentViewDraft(): Omit<SavedView, 'id' | 'name'> | null {
  const project = useProject.getState().project;
  const entry = activeWellEntry(project);
  if (!entry) return null;
  const ui = useUi.getState();
  const depth = entry.well.depth.values;
  const visible = useViewer.getState().visible ?? { top: depth[0]!, base: depth[depth.length - 1]! };
  const own = project.display.layouts[ui.workspace];
  const zone = ui.editingZoneId ? entry.interpretation.zones.find((z) => z.id === ui.editingZoneId) : undefined;
  // El panel «Vistas» no es parte del encuadre: es desde donde se guarda.
  const tab = panelsOpen(ui) && panelExists(ui.dockTab) ? ui.dockTab : null;
  const template = templateLabel(project, ui.workspace);
  return {
    wellId: entry.well.id,
    workspace: ui.workspace,
    top: visible.top,
    base: visible.base,
    tracks: own ? own.map((t) => ({ ...t })) : null,
    ...(template ? { templateName: template } : {}),
    zoneId: zone?.id ?? null,
    ...(zone ? { zoneName: zone.name } : {}),
    panel: tab && tab !== VIEWS_PANEL_ID ? tab : null,
    savedAt: new Date().toISOString(),
  };
}

/** Guarda la vista actual con un nombre (si el pozo ya tiene una con ese nombre, la reemplaza). */
export function saveCurrentView(name: string): boolean {
  const clean = name.trim();
  const draft = currentViewDraft();
  if (!clean || !draft) return false;
  const replacing = !!findView(useProject.getState().project, draft.wellId, clean);
  if (!safeCommit(`Guardar vista «${clean}»`, (p) => saveView(p, { ...draft, id: makeId('vista'), name: clean }))) return false;
  toast({ tone: 'ok', title: replacing ? `Vista «${clean}» reemplazada` : `Vista «${clean}» guardada`, description: `${rangeLabel(draft.top, draft.base)}. Recorré las vistas con «Modo defensa».`, duration: 2600 });
  announce(replacing ? `Vista ${clean} reemplazada` : `Vista ${clean} guardada`);
  return true;
}

/** Renombra (lanza si el nombre está vacío o repetido: el diálogo muestra el error). */
export function renameSavedView(id: string, name: string): void {
  useProject.getState().commit(`Renombrar vista «${name.trim()}»`, (p) => renameView(p, id, name));
}

export function moveSavedView(id: string, dir: -1 | 1): void {
  const v = allViews(useProject.getState().project).find((x) => x.id === id);
  if (!v) return;
  if (safeCommit(`${dir < 0 ? 'Subir' : 'Bajar'} vista «${v.name}»`, (p) => moveView(p, id, dir))) announce(`Vista ${v.name} ${dir < 0 ? 'subida' : 'bajada'}`);
}

export function deleteSavedView(id: string): void {
  const v = allViews(useProject.getState().project).find((x) => x.id === id);
  if (!v) return;
  if (!safeCommit(`Borrar vista «${v.name}»`, (p) => deleteView(p, id))) return;
  toast({ title: `Vista «${v.name}» borrada`, description: 'Ctrl+Z la recupera.', duration: 2600 });
}

// ── ir a una vista (fuera del modo defensa) ───────────────────────────────────────────────────────────────────

/**
 * Aplica una vista a la interfaz: espacio, zona activa, panel (si tiene) y tramo; las pistas, con un `commit` solo si
 * difieren de las actuales (se deshace con Ctrl+Z). Durante el modo defensa salta a esa vista del recorrido.
 */
export function goToView(id: string): void {
  if (useViewsUi.getState().defense) {
    const i = useViewsUi.getState().defense!.viewIds.indexOf(id);
    if (i >= 0) showDefenseView(i);
    return;
  }
  const project = useProject.getState().project;
  const view = allViews(project).find((v) => v.id === id);
  if (!view) return;
  const r = resolveView(project, view, panelExists);
  if (!r.wellPresent || view.wellId !== project.activeWellId) {
    toast({ tone: 'warn', title: `No se puede abrir «${view.name}»`, description: 'Es de un pozo que no es el activo.' });
    return;
  }
  const workspace = isWorkspace(view.workspace) ? view.workspace : useUi.getState().workspace;
  safeCommit(`Abrir vista «${view.name}»`, (p) => {
    const cur = p.display.layouts[workspace];
    if (!r.tracks) return cur ? setTrackLayout(p, workspace, null) : p;
    return cur && layoutsEqual(cur, r.tracks) ? p : setTrackLayout(p, workspace, r.tracks.map((t) => ({ ...t })));
  });
  const ui = useUi.getState();
  ui.set({ workspace, editingZoneId: r.zoneId, ...(workspace !== ui.workspace ? { activeModuleId: null, activeStepId: null } : {}) });
  if (r.panel) useUi.getState().openPanel(r.panel);
  settleRange(r.top, r.base);
  if (r.issues.length) toast({ tone: 'warn', title: `Vista «${view.name}»`, description: r.issues.map((x) => x.message).join('. ') + '.' });
  announce(`Vista ${view.name}`);
}

// ── modo defensa ──────────────────────────────────────────────────────────────────────────────────────────────

/** ¿Hay un control con foco que usa sus propias teclas (texto, deslizador, pestañas)? */
const asElement = (t: EventTarget | null): Element | null => (typeof Element !== 'undefined' && t instanceof Element ? t : null);
function inControl(t: EventTarget | null): boolean {
  return !!asElement(t)?.closest('input, textarea, select, [contenteditable="true"], [role="slider"], [role="spinbutton"], [role="combobox"], [role="tab"], [role="radio"], [role="option"]');
}
const inText = (t: EventTarget | null): boolean => !!asElement(t)?.closest('input, textarea, select, [contenteditable="true"]');

/**
 * Teclado del modo defensa, en captura sobre la ventana (antes que el visor y que los atajos globales): → ← pasan de
 * vista, Esc sale, Ctrl+Z / Ctrl+Y no hacen nada (salvo el deshacer propio de un campo de texto). Un diálogo, menú o
 * lista abiertos se quedan con sus teclas.
 */
export function onDefenseKey(e: KeyboardEvent): void {
  if (e.isComposing || !useViewsUi.getState().defense) return;
  const doc = typeof document !== 'undefined' ? document : null;
  if (historyShortcut(e)) {
    if (doc && hasNativeUndo(doc.activeElement)) return;
    e.preventDefault();
    e.stopPropagation();
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  // Un diálogo o menú abiertos se quedan con sus teclas; una lista solo si tiene el foco (un panel puede tener una lista
  // fija, como las curvas del digitalizador, y no por eso dejar de pasar de vista).
  if (doc?.querySelector('[role="dialog"], [role="menu"]') || asElement(e.target)?.closest('[role="listbox"]')) return;
  if (e.key === 'Escape') {
    // Con la lupa del visor abierta, el primer Esc es de la lupa (ADR 0085): la defensa sale con el siguiente.
    if (e.defaultPrevented || isLoupeOpen() || useViewer.getState().dragging || inText(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    exitDefense();
    return;
  }
  if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && !e.shiftKey && !inControl(e.target)) {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'ArrowRight') nextDefenseView();
    else prevDefenseView();
    return;
  }
  // Foco suelto (al entrar): las teclas del visor lo enfocan y se le reenvían.
  if (doc && VIEWER_KEYS.has(e.key) && (!doc.activeElement || doc.activeElement === doc.body)) {
    const body = viewerBody();
    if (!body) return;
    e.preventDefault();
    e.stopPropagation();
    body.focus({ preventScroll: true });
    body.dispatchEvent(new KeyboardEvent('keydown', { key: e.key, code: e.code, shiftKey: e.shiftKey, bubbles: true, cancelable: true }));
  }
}

/**
 * Entra al modo defensa y muestra la vista `startIndex` del pozo activo. Sin vistas no entra: avisa y abre el panel
 * «Vistas». Ya presentando, salta a esa vista.
 */
export function enterDefense(startIndex = 0): void {
  if (useViewsUi.getState().defense) {
    showDefenseView(startIndex);
    return;
  }
  const project = useProject.getState().project;
  const entry = activeWellEntry(project);
  if (!entry) return;
  const views = activeWellViews(project);
  if (!views.length) {
    toast({ tone: 'info', title: 'Todavía no hay vistas para presentar', description: 'Guardá los encuadres del pozo con «Guardar vista actual» y después recorrelos acá.' });
    useUi.getState().openPanel(VIEWS_PANEL_ID);
    return;
  }
  const ui = useUi.getState();
  // Los modos de edición del visor no siguen en la presentación.
  stopTrendTool();
  if (ui.trackBuilder || ui.toolStringOpen || ui.zoneMarking || ui.curtain) useUi.setState({ trackBuilder: false, toolStringOpen: false, zoneMarking: false, curtain: null });
  const photo = takePhoto(useUi.getState(), useViewer.getState().visible, entry.well.id);
  useViewsUi.getState().set({ defense: { viewIds: views.map((v) => v.id), index: 0, name: '', issues: [], tracks: null, photo } });
  useUi.setState({ presenting: true });
  if (typeof window !== 'undefined') window.addEventListener('keydown', onDefenseKey, true);
  showDefenseView(startIndex);
  releaseFocus();
}

/** Entra al modo defensa desde una vista de la lista. */
export function presentFrom(id: string): void {
  const i = activeWellViews(useProject.getState().project).findIndex((v) => v.id === id);
  enterDefense(Math.max(0, i));
}

/** Muestra la vista `index` del recorrido (acotado). Las vistas borradas mientras tanto salen del recorrido. */
export function showDefenseView(index: number): void {
  const d = useViewsUi.getState().defense;
  if (!d) return;
  const project = useProject.getState().project;
  const list = allViews(project);
  const views = d.viewIds.map((id) => list.find((v) => v.id === id)).filter((v): v is SavedView => !!v && v.wellId === project.activeWellId);
  if (!views.length) {
    exitDefense();
    return;
  }
  const i = Math.max(0, Math.min(views.length - 1, index));
  const view = views[i]!;
  const r = resolveView(project, view, panelExists);
  const workspace = isWorkspace(view.workspace) ? view.workspace : d.photo.workspace;
  useViewsUi.getState().set({ defense: { ...d, viewIds: views.map((v) => v.id), index: i, name: view.name, issues: r.issues, tracks: r.tracks ? r.tracks.map((t) => ({ ...t })) : null } });
  useUi.setState(defensePatch(d.photo, { workspace, zoneId: r.zoneId, panel: r.panel }));
  settleRange(r.top, r.base);
  announce(`Vista ${i + 1} de ${views.length}: ${view.name}${r.issues.length ? `. ${r.issues.map((x) => x.message).join('. ')}` : ''}`);
}

export function nextDefenseView(): void {
  const d = useViewsUi.getState().defense;
  if (!d) return;
  const i = nextIndex(d.index, d.viewIds.length);
  if (i !== d.index) showDefenseView(i);
}

export function prevDefenseView(): void {
  const d = useViewsUi.getState().defense;
  if (!d) return;
  const i = prevIndex(d.index, d.viewIds.length);
  if (i !== d.index) showDefenseView(i);
}

/**
 * Sale del modo defensa y devuelve la interfaz a la foto tal cual (espacio, zona, paso, módulo, pestaña, disposición,
 * lectura amplia y tramo). El tramo solo si el pozo activo sigue siendo el mismo. `restoreRange: false` cuando el
 * proyecto se reemplazó.
 */
export function exitDefense(opts: { restoreRange?: boolean } = {}): void {
  const d = useViewsUi.getState().defense;
  if (typeof window !== 'undefined') window.removeEventListener('keydown', onDefenseKey, true);
  if (!d) {
    if (useUi.getState().presenting) useUi.setState({ presenting: false });
    return;
  }
  useViewsUi.getState().set({ defense: null });
  // `presenting: false` en el mismo cambio que la disposición restaurada: esa sí se guarda en localStorage.
  useUi.setState({ ...restorePatch(d.photo), presenting: false });
  const sameWell = useProject.getState().project.activeWellId === d.photo.wellId;
  if (opts.restoreRange !== false && sameWell && d.photo.visible) settleRange(d.photo.visible.top, d.photo.visible.base);
  else rangeToken++;
  announce('Modo defensa terminado');
  focusDefenseToggle();
}

/** Alterna el modo defensa (botón de la barra superior). */
export function toggleDefense(): void {
  if (useViewsUi.getState().defense) exitDefense();
  else enterDefense(0);
}
