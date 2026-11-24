/**
 * Vistas guardadas y modo defensa (docs/decisiones/0075): recetas puras, saneamiento al abrir, resolución contra el
 * proyecto, independencia del motor, ciclo guardar/abrir y las partes del modo defensa (foto, parches, recorrido,
 * teclado) sin DOM.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { syntheticWell } from '../src/app/demo/syntheticWell';
import { enterDefense, exitDefense, goToView, nextDefenseView, prevDefenseView, saveCurrentView } from '../src/app/views/actions';
import { defensePatch, nextIndex, prevIndex, rangeMatches, restorePatch, takePhoto, type UiPhoto } from '../src/app/views/defense';
import { useViewsUi } from '../src/app/views/store';
import { useProject } from '../src/app/store/project';
import { useUi, type ShellLayout } from '../src/app/store/ui';
import { defenseExitNeeded } from '../src/app/store/uiSync';
import { useViewer } from '../src/app/store/viewer';
import { useTrendsUi } from '../src/app/trends/store';
import { setLoupeOpen } from '../src/viewer/loupe';
import { sanitizeDisplay, type SavedView, type TrackSpec } from '../src/core/display';
import { sameEngineInputs } from '../src/core/interpretation';
import { addWell, createProject, setTrackLayout, setZones, type Project } from '../src/core/state/project';
import { deserializeProject, serializeProject } from '../src/core/state/serialize';
import { createSnapshot } from '../src/core/state/snapshots';
import { deleteTrackTemplate, saveTrackTemplate } from '../src/core/state/tracks';
import { activeWellViews, deleteView, findView, moveView, orphanViews, renameView, resolveView, saveView, viewsForWell } from '../src/core/state/views';
import { createWell } from '../src/core/well';

const demo = syntheticWell(400);
const WELL = demo.well.id;
const base = (): Project => addWell(createProject('Vistas'), demo.well, demo.zones);
const TRACKS: TrackSpec[] = [
  { id: 'depth', title: 'Prof.', kind: 'depth' },
  { id: 'gr', title: 'GR', kind: 'curves', curves: [{ select: { role: 'GR' } }] },
];

function view(over: Partial<SavedView> & { id: string; name: string }): SavedView {
  return { wellId: WELL, workspace: 'petrophysics', top: 1000, base: 1050, tracks: null, zoneId: null, panel: null, ...over };
}

/** Proyecto con cinco vistas del pozo, variando tramo, zona, pistas y panel. */
function withFive(): Project {
  const z = demo.zones;
  let p = base();
  p = saveView(p, view({ id: 'v1', name: 'Pozo entero', top: demo.well.depth.values[0]!, base: demo.well.depth.values.at(-1)!, templateName: 'De fábrica', savedAt: '2026-11-17T10:00:00.000Z' }));
  p = saveView(p, view({ id: 'v2', name: 'Zona C con Sw', top: z[2]!.top, base: z[2]!.base, zoneId: z[2]!.id, zoneName: z[2]!.name, tracks: TRACKS, templateName: 'Petrofísica esencial' }));
  p = saveView(p, view({ id: 'v3', name: 'Crossplot', top: z[1]!.top, base: z[1]!.base, zoneId: z[1]!.id, zoneName: z[1]!.name, panel: 'crossplot' }));
  p = saveView(p, view({ id: 'v4', name: 'Histograma', top: z[3]!.top, base: z[3]!.base, panel: 'histogram' }));
  p = saveView(p, view({ id: 'v5', name: 'Geología', workspace: 'geology', top: z[0]!.top, base: z[4]?.base ?? z[0]!.base }));
  return p;
}

describe('recetas', () => {
  it('guardar, reemplazar por nombre (mismo pozo, sin distinguir mayúsculas), renombrar, mover y borrar', () => {
    let p = saveView(base(), view({ id: 'a', name: ' Pozo entero ' }));
    p = saveView(p, view({ id: 'b', name: 'Zona C', zoneId: demo.zones[2]!.id, zoneName: demo.zones[2]!.name }));
    p = saveView(p, view({ id: 'c', name: 'Contacto' }));
    expect(activeWellViews(p).map((v) => v.name)).toEqual(['Pozo entero', 'Zona C', 'Contacto']);
    // Reemplazar: conserva id y lugar, cambia el contenido.
    const q = saveView(p, view({ id: 'nuevo', name: 'ZONA c', top: 1100, base: 1120 }));
    expect(activeWellViews(q).map((v) => v.id)).toEqual(['a', 'b', 'c']);
    expect(findView(q, WELL, 'zona C')).toMatchObject({ id: 'b', name: 'ZONA c', top: 1100, base: 1120, zoneId: null });
    // Otro pozo: el mismo nombre es otra vista, y no se lista con las del pozo activo.
    const other = saveView(q, view({ id: 'x', name: 'Pozo entero', wellId: 'otro' }));
    expect(other.display.views).toHaveLength(4);
    expect(activeWellViews(other)).toHaveLength(3);
    expect(viewsForWell(other, 'otro').map((v) => v.id)).toEqual(['x']);
    // Validación.
    expect(() => saveView(p, view({ id: 'z', name: '   ' }))).toThrow(/nombre/);
    expect(() => saveView(p, view({ id: 'z', name: 'Mal', top: 10, base: 10 }))).toThrow(/tramo/);
    expect(() => saveView(p, view({ id: 'z', name: 'Mal', top: NaN, base: 10 }))).toThrow(/tramo/);
    // Renombrar con choque, vacío, igual.
    expect(() => renameView(p, 'c', 'pozo ENTERO')).toThrow(/Ya hay una vista/);
    expect(() => renameView(p, 'c', ' ')).toThrow(/nombre/);
    expect(renameView(p, 'c', 'Contacto')).toBe(p);
    expect(findView(renameView(p, 'c', 'Contacto agua–petróleo'), WELL, 'contacto agua–petróleo')?.id).toBe('c');
    expect(renameView(other, 'x', 'Zona C').display.views!.find((v) => v.id === 'x')!.name).toBe('Zona C'); // otro pozo: no choca
    // Mover: salta las vistas de otros pozos; en el borde no cambia nada.
    const mixed = saveView(saveView(p, view({ id: 'o1', name: 'Otra', wellId: 'otro' })), view({ id: 'd', name: 'Cuarta' }));
    expect(mixed.display.views!.map((v) => v.id)).toEqual(['a', 'b', 'c', 'o1', 'd']);
    expect(moveView(mixed, 'd', -1).display.views!.map((v) => v.id)).toEqual(['a', 'b', 'd', 'o1', 'c']);
    expect(activeWellViews(moveView(mixed, 'a', 1)).map((v) => v.id)).toEqual(['b', 'a', 'c', 'd']);
    expect(moveView(mixed, 'a', -1)).toBe(mixed);
    expect(moveView(mixed, 'd', 1)).toBe(mixed);
    expect(() => moveView(mixed, 'nada', 1)).toThrow(/No existe/);
    // Borrar: sin vistas, el campo desaparece.
    const empty = deleteView(deleteView(deleteView(p, 'a'), 'b'), 'c');
    expect(empty.display).not.toHaveProperty('views');
    expect(deleteView(empty, 'a')).toBe(empty);
  });

  it('las pistas se copian: tocar o borrar la plantilla después no cambia la vista', () => {
    let p = saveTrackTemplate(base(), { id: 'tpl', name: 'Mi plantilla', workspace: 'petrophysics', tracks: TRACKS });
    const tracks = p.display.trackTemplates![0]!.tracks;
    p = saveView(p, view({ id: 'v', name: 'Con plantilla', tracks, templateName: 'Mi plantilla' }));
    const saved = p.display.views![0]!.tracks!;
    expect(saved).toEqual(TRACKS);
    expect(saved).not.toBe(tracks);
    p = deleteTrackTemplate(saveTrackTemplate(p, { id: 'tpl', name: 'Mi plantilla', workspace: 'petrophysics', tracks: [TRACKS[0]!] }), 'tpl');
    expect(p.display.views![0]!.tracks).toEqual(TRACKS);
  });

  it('las vistas no tocan la interpretación: ni el motor, ni los snapshots', () => {
    const p = base();
    const q = withFive();
    expect(q.wells.length).toBe(p.wells.length);
    const r = saveView(p, view({ id: 'v', name: 'Una' }));
    expect(r.wells).toBe(p.wells);
    expect(r.snapshots).toBe(p.snapshots);
    expect(sameEngineInputs(p.wells[0]!.interpretation, r.wells[0]!.interpretation)).toBe(true);
    expect(r.wells[0]!.interpretation).toBe(p.wells[0]!.interpretation);
    const snap = createSnapshot(q, WELL, 'con vistas').snapshot;
    expect(JSON.stringify(snap)).not.toContain('Pozo entero');
    expect(Object.keys(q.wells[0]!.interpretation)).not.toContain('views');
  });
});

describe('saneamiento al abrir', () => {
  it('conserva las válidas, descarta las inválidas con aviso, y un proyecto anterior abre sin el campo', () => {
    const warnings: string[] = [];
    const out = sanitizeDisplay(
      {
        layouts: {},
        roles: {},
        curves: {},
        views: [
          { id: 'a', name: 'Buena', wellId: 'w', workspace: 'petrophysics', top: 1, base: 2, tracks: null, zoneId: 'z1', zoneName: 'C', panel: 'crossplot', templateName: 'De fábrica', savedAt: '2026-11-01T00:00:00Z' },
          { id: 'b', name: 'Con pistas', wellId: 'w', workspace: 'geology', top: 1, base: 3, tracks: [{ id: 'd', title: 'Prof.', kind: 'depth' }, { id: 'x' }], zoneId: null, panel: null },
          { id: 'c', name: '', wellId: 'w', workspace: 'petrophysics', top: 1, base: 2 },
          { id: 'd', name: 'Tramo al revés', wellId: 'w', workspace: 'petrophysics', top: 5, base: 2 },
          { id: 'e', name: 'buena', wellId: 'w', workspace: 'petrophysics', top: 1, base: 2 },
          { id: 'a', name: 'Id repetido', wellId: 'w', workspace: 'petrophysics', top: 1, base: 2 },
          { id: 'f', name: 'Sin pistas válidas', wellId: 'w', workspace: 'petrophysics', top: 1, base: 2, tracks: [{ id: 'x' }], zoneId: 7, panel: 3, savedAt: 'ayer' },
          'basura',
        ],
      },
      (m) => warnings.push(m),
    );
    expect(out.views!.map((v) => v.id)).toEqual(['a', 'b', 'f']);
    expect(out.views![0]).toEqual({ id: 'a', name: 'Buena', wellId: 'w', workspace: 'petrophysics', top: 1, base: 2, tracks: null, zoneId: 'z1', zoneName: 'C', panel: 'crossplot', templateName: 'De fábrica', savedAt: '2026-11-01T00:00:00Z' });
    expect(out.views![1]!.tracks).toEqual([{ id: 'd', title: 'Prof.', kind: 'depth' }]);
    expect(out.views![2]).toEqual({ id: 'f', name: 'Sin pistas válidas', wellId: 'w', workspace: 'petrophysics', top: 1, base: 2, tracks: null, zoneId: null, panel: null });
    // pista mala (b), sin nombre (c), tramo (d), nombre repetido (e), id repetido, pista mala + sin pistas + fecha (f), basura
    expect(warnings.length).toBe(9);
    expect(warnings.some((w) => /tramo de profundidad es inválido/.test(w))).toBe(true);
    expect(sanitizeDisplay({ views: 'x' }, (m) => warnings.push(m)).views).toBeUndefined();
    const before = warnings.length;
    expect(sanitizeDisplay({ layouts: {}, roles: {}, curves: {} }, (m) => warnings.push(m))).not.toHaveProperty('views');
    expect(warnings.length).toBe(before);
  });

  it('un proyecto guardado antes de F07 (sin `views`) abre igual', async () => {
    const file = JSON.parse(await serializeProject(base(), { codec: 'f64le-b64' }));
    expect(file.project.display).not.toHaveProperty('views');
    const back = await deserializeProject(JSON.stringify(file));
    expect(back.display.views).toBeUndefined();
  });
});

describe('resolver una vista contra el proyecto', () => {
  it('zona borrada, panel inexistente y pozo ausente: se abre igual, sin lo que falta y con aviso', () => {
    const p = withFive();
    const zoneC = demo.zones[2]!;
    const v2 = p.display.views!.find((v) => v.id === 'v2')!;
    const ok = resolveView(p, v2, () => true);
    expect(ok).toMatchObject({ wellPresent: true, zoneId: zoneC.id, issues: [] });
    expect(ok.tracks).toEqual(TRACKS);
    // Zona borrada.
    const noC = setZones(p, WELL, demo.zones.filter((z) => z.id !== zoneC.id));
    const r = resolveView(noC, v2, () => true);
    expect(r.zoneId).toBeNull();
    expect(r.issues.map((i) => i.message)).toEqual([`La zona ${zoneC.name} ya no existe`]);
    // Panel que ya no existe.
    const v3 = p.display.views!.find((v) => v.id === 'v3')!;
    const r3 = resolveView(p, v3, (id) => id !== 'crossplot');
    expect(r3.panel).toBeNull();
    expect(r3.issues[0]!.kind).toBe('dockPanel');
    expect(resolveView(p, v3, () => true).panel).toBe('crossplot');
    // Pozo ausente: no se lista ni entra en el recorrido; se cuenta aparte.
    const orphan = saveView(p, view({ id: 'o', name: 'De otro pozo', wellId: 'ya-no-esta' }));
    const ro = resolveView(orphan, orphan.display.views!.at(-1)!, () => true);
    expect(ro.wellPresent).toBe(false);
    expect(ro.issues[0]!.kind).toBe('well');
    expect(activeWellViews(orphan)).toHaveLength(5);
    expect(orphanViews(orphan).map((v) => v.id)).toEqual(['o']);
    expect(orphanViews(p)).toEqual([]);
  });
});

describe('guardar y abrir', () => {
  it('cinco vistas: serializeProject → deserializeProject las devuelve iguales y en orden', async () => {
    const p = withFive();
    const text = await serializeProject(p, { codec: 'f64le-b64' });
    const back = await deserializeProject(text);
    expect(back.display.views).toEqual(p.display.views);
    expect(back.display.views!.map((v) => v.name)).toEqual(['Pozo entero', 'Zona C con Sw', 'Crossplot', 'Histograma', 'Geología']);
    // Reordenadas, también vuelven en el nuevo orden.
    const moved = moveView(moveView(p, 'v5', -1), 'v1', 1);
    const back2 = await deserializeProject(await serializeProject(moved, { codec: 'f64le-b64' }));
    expect(back2.display.views!.map((v) => v.id)).toEqual(['v2', 'v1', 'v3', 'v5', 'v4']);
  });
});

// ── modo defensa ──────────────────────────────────────────────────────────────────────────────────────────────

const LAYOUT: ShellLayout = {
  leftWidth: 241, rightWidth: 329, dockHeight: 183,
  leftAuto: false, rightAuto: false, dockAuto: false,
  leftCollapsed: false, rightCollapsed: false, dockCollapsed: false, wellHeader: true, compactHeads: false, panels: 'side',
};

describe('modo defensa: partes puras', () => {
  it('siguiente y anterior sin vuelta circular', () => {
    expect(nextIndex(0, 5)).toBe(1);
    expect(nextIndex(4, 5)).toBe(4);
    expect(prevIndex(0, 5)).toBe(0);
    expect(prevIndex(3, 5)).toBe(2);
    expect(nextIndex(0, 0)).toBe(0);
    expect(nextIndex(9, 3)).toBe(2);
  });

  it('foto y restauración: devuelve tal cual lo que el modo cambia', () => {
    const ui = { workspace: 'geology' as const, editingZoneId: 'z', activeStepId: 'sw', activeModuleId: 'archie', dockTab: 'trends', sideView: 'step' as const, layout: LAYOUT, readingMode: true, panelExpanded: false };
    const photo = takePhoto(ui, { top: 1000, base: 1100 }, WELL);
    expect(photo.visible).toEqual({ top: 1000, base: 1100 });
    expect(restorePatch(photo)).toEqual(ui);
    expect(restorePatch(photo).layout).toBe(LAYOUT);
  });

  it('parche de una vista: sin columna del pozo; el panel donde estén los paneles, o el visor solo', () => {
    const photo: UiPhoto = { workspace: 'petrophysics', editingZoneId: null, activeStepId: 'sw', activeModuleId: null, dockTab: 'glance', sideView: 'step', layout: LAYOUT, readingMode: true, panelExpanded: true, visible: null, wellId: WELL };
    const side = defensePatch(photo, { workspace: 'petrophysics', zoneId: 'c', panel: 'crossplot' });
    expect(side).toMatchObject({ editingZoneId: 'c', dockTab: 'crossplot', sideView: 'panels', readingMode: false, panelExpanded: false });
    expect(side.layout).toMatchObject({ leftCollapsed: true, rightCollapsed: false, leftWidth: 241 });
    expect(side).not.toHaveProperty('activeStepId');
    const alone = defensePatch(photo, { workspace: 'geology', zoneId: null, panel: null });
    expect(alone.layout).toMatchObject({ leftCollapsed: true, rightCollapsed: true });
    expect(alone).toMatchObject({ workspace: 'geology', activeStepId: null, activeModuleId: null });
    expect(alone).not.toHaveProperty('dockTab');
    const bottom = defensePatch({ ...photo, layout: { ...LAYOUT, panels: 'bottom', dockCollapsed: true } }, { workspace: 'petrophysics', zoneId: null, panel: 'histogram' });
    expect(bottom.layout).toMatchObject({ dockCollapsed: false, rightCollapsed: false, leftCollapsed: true });
    expect(bottom).not.toHaveProperty('sideView');
  });

  it('el tramo visible coincide con el pedido (con redondeo y acotado al pozo)', () => {
    expect(rangeMatches({ top: 1000.01, base: 1099.98 }, { top: 1000, base: 1100 })).toBe(true);
    expect(rangeMatches({ top: 1010, base: 1100 }, { top: 1000, base: 1100 })).toBe(false);
    expect(rangeMatches({ top: 900, base: 1000 }, { top: 850, base: 1000 }, { min: 900, max: 2000 })).toBe(true);
    expect(rangeMatches(null, { top: 1, base: 2 })).toBe(false);
  });

  it('salir si cambia el pozo activo o se reemplaza el proyecto', () => {
    const s = useProject.getState();
    const p = base();
    expect(defenseExitNeeded({ project: p, history: s.history }, { project: { ...p, activeWellId: 'otro' }, history: s.history })).toBe(true);
    const h1 = { past: [{ project: p, label: 'x', at: 0 }], future: [] } as unknown as typeof s.history;
    const h0 = { past: [], future: [] } as unknown as typeof s.history;
    expect(defenseExitNeeded({ project: p, history: h1 }, { project: { ...p }, history: h0 })).toBe(true);
    expect(defenseExitNeeded({ project: p, history: h0 }, { project: { ...p }, history: h1 })).toBe(false);
  });
});

describe('modo defensa: recorrido con los stores', () => {
  const listeners: ((e: KeyboardEvent) => void)[] = [];
  const write = vi.fn();
  beforeEach(() => {
    vi.useFakeTimers();
    listeners.length = 0;
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: write });
    vi.stubGlobal('window', {
      addEventListener: (type: string, fn: (e: KeyboardEvent) => void) => type === 'keydown' && listeners.push(fn),
      removeEventListener: (_t: string, fn: (e: KeyboardEvent) => void) => listeners.splice(listeners.indexOf(fn), 1),
    });
    useProject.getState().replace(withFive());
    useUi.setState({ workspace: 'petrophysics', editingZoneId: null, activeStepId: 'sw', activeModuleId: null, dockTab: 'trends', sideView: 'step', layout: { ...LAYOUT }, readingMode: false, presenting: false, panelExpanded: false, trackBuilder: false, toolStringOpen: false, zoneMarking: false, curtain: null });
    useViewer.setState({ visible: { top: 1010, base: 1060 }, dragging: false });
    useViewsUi.setState({ defense: null, saving: false, renaming: null });
    vi.advanceTimersByTime(300);
    write.mockClear();
  });
  afterEach(() => {
    exitDefense();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const key = (k: string, mods: Partial<KeyboardEvent> = {}) => {
    const e = { key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, isComposing: false, target: null, defaultPrevented: false, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...mods };
    listeners.forEach((l) => l(e as unknown as KeyboardEvent));
    return e;
  };

  it('recorre sin tocar el proyecto ni el historial, no guarda la disposición y al salir devuelve todo', () => {
    const project = useProject.getState().project;
    const history = useProject.getState().history;
    const layout = useUi.getState().layout;
    enterDefense(0);
    let ui = useUi.getState();
    expect(ui.presenting).toBe(true);
    expect(ui.layout.leftCollapsed).toBe(true);
    expect(ui.layout.rightCollapsed).toBe(true); // la primera vista no tiene panel
    expect(useViewsUi.getState().defense).toMatchObject({ index: 0, name: 'Pozo entero', tracks: null });
    expect(listeners).toHaveLength(1);

    key('ArrowRight');
    ui = useUi.getState();
    expect(useViewsUi.getState().defense).toMatchObject({ index: 1, name: 'Zona C con Sw', tracks: TRACKS });
    expect(ui.editingZoneId).toBe(demo.zones[2]!.id);
    key('ArrowRight');
    expect(useUi.getState()).toMatchObject({ dockTab: 'crossplot', sideView: 'panels' });
    expect(useUi.getState().layout.rightCollapsed).toBe(false);
    nextDefenseView();
    nextDefenseView();
    expect(useViewsUi.getState().defense!.index).toBe(4);
    expect(useUi.getState().workspace).toBe('geology');
    nextDefenseView(); // en la última, no avanza
    expect(useViewsUi.getState().defense!.index).toBe(4);
    key('ArrowLeft');
    expect(useViewsUi.getState().defense!.index).toBe(3);
    prevDefenseView();
    prevDefenseView();
    prevDefenseView();
    prevDefenseView();
    expect(useViewsUi.getState().defense!.index).toBe(0);

    // Ctrl+Z y Ctrl+Y no hacen nada (se consumen antes que el atajo global).
    const z = key('z', { ctrlKey: true });
    const y = key('y', { ctrlKey: true });
    expect(z.preventDefault).toHaveBeenCalled();
    expect(z.stopPropagation).toHaveBeenCalled();
    expect(y.stopPropagation).toHaveBeenCalled();
    // ↑ ↓ + − 0 siguen al visor.
    expect(key('ArrowDown').preventDefault).not.toHaveBeenCalled();
    expect(key('+').preventDefault).not.toHaveBeenCalled();

    // Nada del recorrido entró al proyecto ni al historial; la disposición prestada no se escribió.
    expect(useProject.getState().project).toBe(project);
    expect(useProject.getState().history).toBe(history);
    vi.advanceTimersByTime(500);
    expect(write).not.toHaveBeenCalled();

    // Esc sale y restaura la foto (tramo incluido).
    key('Escape');
    ui = useUi.getState();
    expect(ui.presenting).toBe(false);
    expect(useViewsUi.getState().defense).toBeNull();
    expect(ui).toMatchObject({ workspace: 'petrophysics', editingZoneId: null, activeStepId: 'sw', dockTab: 'trends', sideView: 'step', readingMode: false });
    expect(ui.layout).toBe(layout);
    expect(listeners).toHaveLength(0);
    vi.advanceTimersByTime(100);
    expect(useTrendsUi.getState().showRange).toMatchObject({ top: 1010, base: 1060 });
    vi.advanceTimersByTime(300);
    expect(write).toHaveBeenCalledTimes(1);
    expect(JSON.parse(write.mock.calls[0]![1])).toEqual(layout);
  });

  it('con la lupa del visor abierta, el primer Esc es de la lupa y la defensa sigue (F17)', () => {
    const owner = {};
    enterDefense(0);
    setLoupeOpen(owner, true);
    const e = key('Escape');
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(useViewsUi.getState().defense).not.toBeNull();
    // Un Esc que ya usó otro (la lupa registrada antes lo marca) tampoco sale.
    setLoupeOpen(owner, false);
    key('Escape', { defaultPrevented: true });
    expect(useViewsUi.getState().defense).not.toBeNull();
    key('Escape');
    expect(useViewsUi.getState().defense).toBeNull();
  });

  it('una lista fija en el panel de la vista (sin foco) no se come → ←; un diálogo abierto sí', () => {
    let dialogOpen = false;
    // Un panel con role="listbox" siempre montado (las curvas del digitalizador) y, a veces, un diálogo.
    vi.stubGlobal('HTMLElement', class {});
    vi.stubGlobal('document', { activeElement: null, body: {}, getElementById: () => null, querySelector: (sel: string) => (sel.includes('listbox') || (dialogOpen && sel.includes('dialog')) ? {} : null) });
    enterDefense(0);
    key('ArrowRight');
    expect(useViewsUi.getState().defense!.index).toBe(1);
    dialogOpen = true;
    key('ArrowRight');
    expect(useViewsUi.getState().defense!.index).toBe(1);
  });

  it('sin vistas no entra: abre el panel «Vistas»', () => {
    useProject.getState().replace(base());
    enterDefense(0);
    expect(useUi.getState().presenting).toBe(false);
    expect(useUi.getState().dockTab).toBe('views');
  });

  it('ir a una vista fuera del modo: aplica interfaz y pistas con un commit que se deshace', () => {
    goToView('v2');
    const s = useProject.getState();
    expect(s.project.display.layouts['petrophysics']).toEqual(TRACKS);
    expect(s.undoLabel).toBe('Abrir vista «Zona C con Sw»');
    expect(useUi.getState().editingZoneId).toBe(demo.zones[2]!.id);
    goToView('v2'); // las pistas ya son esas: sin otra entrada
    expect(useProject.getState().history.past).toHaveLength(1);
    goToView('v1'); // de fábrica: quita las propias
    expect(useProject.getState().project.display.layouts).toEqual({});
    useProject.getState().undo();
    expect(useProject.getState().project.display.layouts['petrophysics']).toEqual(TRACKS);
  });

  it('guardar la vista actual toma tramo, pistas propias, zona y panel a la vista', () => {
    useProject.getState().commit('pistas', (p) => setTrackLayout(p, 'petrophysics', TRACKS));
    useUi.setState({ editingZoneId: demo.zones[1]!.id, dockTab: 'histogram', sideView: 'panels' });
    expect(saveCurrentView('Nueva')).toBe(true);
    const v = findView(useProject.getState().project, WELL, 'nueva')!;
    expect(v).toMatchObject({ top: 1010, base: 1060, tracks: TRACKS, zoneId: demo.zones[1]!.id, zoneName: demo.zones[1]!.name, panel: 'histogram', workspace: 'petrophysics' });
    expect(useProject.getState().undoLabel).toBe('Guardar vista «Nueva»');
    // Panel plegado → sin panel.
    useUi.setState({ layout: { ...LAYOUT, rightCollapsed: true } });
    saveCurrentView('nueva');
    expect(findView(useProject.getState().project, WELL, 'Nueva')!.panel).toBeNull();
    expect(activeWellViews(useProject.getState().project)).toHaveLength(6);
  });

  it('una vista de un pozo con otro id no entra en el recorrido; borrar una zona deja la vista con aviso', () => {
    let p = withFive();
    p = setZones(p, WELL, demo.zones.filter((z) => z.id !== demo.zones[2]!.id));
    p = addWell(p, createWell({ id: 'otro', name: 'Otro', depth: Float64Array.from([1, 2, 3]), curves: [] }));
    p = saveView(p, view({ id: 'o', name: 'Del otro', wellId: 'otro' }));
    useProject.getState().replace(p);
    enterDefense(1);
    const d = useViewsUi.getState().defense!;
    expect(d.viewIds).toHaveLength(5);
    expect(d.issues.map((x) => x.message)).toEqual([`La zona ${demo.zones[2]!.name} ya no existe`]);
    expect(useUi.getState().editingZoneId).toBeNull();
  });
});
