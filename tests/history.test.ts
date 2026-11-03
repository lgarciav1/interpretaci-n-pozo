import { beforeEach, describe, expect, it } from 'vitest';
import { emptyHistory, GROUP_MS, HISTORY_LIMIT, recordChange, redo, redoLabelOf, undo, undoLabelOf, type History } from '../src/core/state/history';
import { addWell, applyZoneEdit, createProject, getWellEntry, setParam, type Project } from '../src/core/state/project';
import { createWell } from '../src/core/well';
import { historyClock, useProject } from '../src/app/store/project';
import { staleUiPatch } from '../src/app/store/uiSync';
import { historyShortcut } from '../src/app/shell/historyActions';
import { createZonesOverlay } from '../src/viewer/overlays/zones';
import { depthRange, zone } from './helpers';

function demoProject(): Project {
  const w = createWell({
    id: 'w1',
    name: 'Pozo 1',
    depth: depthRange(40),
    curves: [{ id: 'GR', mnemonic: 'GR', role: 'GR', unit: 'gAPI', data: new Float64Array(40), origin: { kind: 'measured' } }],
  });
  return addWell(createProject('Demo'), w, [zone('a', 1000, 1005), zone('b', 1005.5, 1010)]);
}

const rw = (p: Project) => getWellEntry(p, 'w1').interpretation.params.global['rw'];

/** Aplica una serie de cambios (etiqueta, valor de rw, instante) sobre el historial puro. */
function play(p0: Project, steps: [string, number, number][]): { history: History; project: Project } {
  let history = emptyHistory();
  let project = p0;
  for (const [label, value, at] of steps) {
    const next = setParam(project, 'w1', 'rw', value);
    history = recordChange(history, project, label, at);
    project = next;
  }
  return { history, project };
}

describe('historial (puro)', () => {
  it('deshace y rehace en orden, con las etiquetas de cada cambio', () => {
    const p0 = demoProject();
    const { history, project } = play(p0, [
      ['Cambiar Rw', 0.1, 0],
      ['Cambiar a', 0.2, 5000],
    ]);
    expect(undoLabelOf(history)).toBe('Cambiar a');
    const u1 = undo(history, project)!;
    expect(u1.label).toBe('Cambiar a');
    expect(rw(u1.project)).toBe(0.1);
    const u2 = undo(u1.history, u1.project)!;
    expect(rw(u2.project)).toBeUndefined();
    expect(u2.project).toBe(p0);
    expect(undo(u2.history, u2.project)).toBeNull();
    expect(redoLabelOf(u2.history)).toBe('Cambiar Rw');
    const r1 = redo(u2.history, u2.project)!;
    expect(rw(r1.project)).toBe(0.1);
    const r2 = redo(r1.history, r1.project)!;
    expect(r2.project).toBe(project);
    expect(redo(r2.history, r2.project)).toBeNull();
  });

  it('un cambio nuevo vacía el futuro', () => {
    const { history, project } = play(demoProject(), [
      ['Cambiar Rw', 0.1, 0],
      ['Cambiar a', 0.2, 5000],
    ]);
    const u = undo(history, project)!;
    expect(u.history.future).toHaveLength(1);
    const h = recordChange(u.history, u.project, 'Cambiar m', 9000);
    expect(h.future).toHaveLength(0);
    expect(h.past.map((e) => e.label)).toEqual(['Cambiar Rw', 'Cambiar m']);
  });

  it('agrupa cambios seguidos con la misma etiqueta dentro de la ventana y vuelve al valor inicial', () => {
    const p0 = demoProject();
    const { history, project } = play(p0, [
      ['Cambiar Rw', 0.1, 0],
      ['Cambiar Rw', 0.2, 300],
      ['Cambiar Rw', 0.3, 600],
      ['Cambiar Rw', 0.4, 600 + GROUP_MS - 1], // la ventana se mide desde el último cambio
    ]);
    expect(history.past).toHaveLength(1);
    expect(rw(project)).toBe(0.4);
    const u = undo(history, project)!;
    expect(u.project).toBe(p0);
  });

  it('no agrupa con otra etiqueta, fuera de la ventana, ni después de deshacer', () => {
    const p0 = demoProject();
    expect(play(p0, [['Cambiar Rw', 0.1, 0], ['Cambiar a', 0.2, 100]]).history.past).toHaveLength(2);
    expect(play(p0, [['Cambiar Rw', 0.1, 0], ['Cambiar Rw', 0.2, GROUP_MS]]).history.past).toHaveLength(2);
    const { history, project } = play(p0, [['Cambiar Rw', 0.1, 0], ['Cambiar Rw', 0.2, 5000]]);
    const u = undo(history, project)!;
    const h = recordChange(u.history, u.project, 'Cambiar Rw', 5100);
    expect(h.past).toHaveLength(2);
  });

  it(`guarda a lo sumo ${HISTORY_LIMIT} entradas (descarta las más viejas)`, () => {
    let h = emptyHistory();
    const p = demoProject();
    for (let i = 0; i < HISTORY_LIMIT + 20; i++) h = recordChange(h, p, `Cambio ${i}`, i * 10_000);
    expect(h.past).toHaveLength(HISTORY_LIMIT);
    expect(h.past[0]!.label).toBe('Cambio 20');
    expect(undoLabelOf(h)).toBe(`Cambio ${HISTORY_LIMIT + 19}`);
  });
});

describe('historial en el store del proyecto', () => {
  let now = 0;
  beforeEach(() => {
    now = 0;
    historyClock.now = () => now;
    useProject.getState().replace(demoProject());
  });

  const store = () => useProject.getState();

  it('expone canUndo/canRedo y las etiquetas; undo y redo devuelven la etiqueta', () => {
    expect(store().canUndo).toBe(false);
    store().commit('Cambiar Rw', (p) => setParam(p, 'w1', 'rw', 0.1));
    expect(store()).toMatchObject({ canUndo: true, canRedo: false, undoLabel: 'Cambiar Rw', redoLabel: null });
    expect(store().undo()).toBe('Cambiar Rw');
    expect(store()).toMatchObject({ canUndo: false, canRedo: true, undoLabel: null, redoLabel: 'Cambiar Rw' });
    expect(rw(store().project)).toBeUndefined();
    expect(store().redo()).toBe('Cambiar Rw');
    expect(rw(store().project)).toBe(0.1);
    expect(store().redo()).toBeNull();
  });

  it('una receta que no cambia nada no entra al historial', () => {
    store().commit('Nada', (p) => p);
    expect(store().canUndo).toBe(false);
  });

  it('replace (abrir proyecto) vacía el historial', () => {
    store().commit('Cambiar Rw', (p) => setParam(p, 'w1', 'rw', 0.1));
    store().commit('Cambiar a', (p) => setParam(p, 'w1', 'a', 1));
    store().undo();
    expect(store().canUndo && store().canRedo).toBe(true);
    store().replace(demoProject());
    expect(store()).toMatchObject({ canUndo: false, canRedo: false, undoLabel: null, redoLabel: null });
  });

  it('un slider movido varias veces es un solo paso de deshacer', () => {
    const p0 = store().project;
    for (let i = 1; i <= 10; i++) {
      now = i * 50;
      store().commit('Cambiar Rw', (p) => setParam(p, 'w1', 'rw', i / 100));
    }
    expect(store().history.past).toHaveLength(1);
    store().undo();
    expect(store().project).toBe(p0);
  });

  it('un arrastre de slider con una pausa larga con el botón apretado sigue siendo un solo paso (gesto)', () => {
    const p0 = store().project;
    const group = 'param-gesto-1';
    for (const [i, at] of [[1, 0], [2, 100], [3, GROUP_MS * 3], [4, GROUP_MS * 3 + 50]] as const) {
      now = at;
      store().commit('Cambiar Rw', (p) => setParam(p, 'w1', 'rw', i / 100), { group });
    }
    expect(store().history.past).toHaveLength(1);
    expect(rw(store().project)).toBe(0.04);
    store().undo();
    expect(store().project).toBe(p0);
  });

  it('sin gesto, una pausa mayor que la ventana abre un paso nuevo; un gesto nuevo también', () => {
    for (const [i, at] of [[1, 0], [2, GROUP_MS * 2]] as const) {
      now = at;
      store().commit('Cambiar Rw', (p) => setParam(p, 'w1', 'rw', i / 100));
    }
    expect(store().history.past).toHaveLength(2);
    now = GROUP_MS * 2 + 10;
    store().commit('Cambiar Rw', (p) => setParam(p, 'w1', 'rw', 0.3), { group: 'param-gesto-2' });
    store().commit('Cambiar Rw', (p) => setParam(p, 'w1', 'rw', 0.31), { group: 'param-gesto-2' });
    expect(store().history.past).toHaveLength(3);
    now = GROUP_MS * 2 + 20;
    store().commit('Cambiar Rw', (p) => setParam(p, 'w1', 'rw', 0.4), { group: 'param-gesto-3' });
    expect(store().history.past).toHaveLength(4);
  });

  it('arrastrar un tope en el visor deja una sola entrada «Mover tope de A»', () => {
    const [, over] = createZonesOverlay({
      edit: {
        current: () => {
          const e = getWellEntry(store().project, 'w1');
          return { zones: e.interpretation.zones, depth: e.well.depth.values };
        },
        marking: () => false,
        commit: (zones, label, clone) => store().commit(label, (p) => applyZoneEdit(p, 'w1', zones, clone ?? null)),
        newZone: () => ({ id: 'n', lowerId: 'n2', name: 'N', color: '#000' }),
      },
    });
    const frame = { data: { zones: [] }, invalidate: () => {} } as never;
    const target = over!.targets!(frame).find((t) => t.hit.key === 't:a')!;
    const drag = target.hit.drag!;
    const start = { x: 0, y: 0, depth: 1000, track: null };
    for (const d of [1000.5, 1001, 1001.5, 1002]) drag.move({ ...start, depth: d }, start);
    drag.end({ ...start, depth: 1002 }, start);
    expect(store().history.past.map((e) => e.label)).toEqual(['Mover tope de A']);
    expect(getWellEntry(store().project, 'w1').interpretation.zones[0]!.top).toBe(1002);
    store().undo();
    expect(getWellEntry(store().project, 'w1').interpretation.zones[0]!.top).toBe(1000);
  });
});

describe('interfaz después de deshacer', () => {
  const ui = { editingZoneId: null, activeModuleId: null, zoneMarking: false, snapshotsOpen: false };

  it('suelta la zona en edición si ya no existe', () => {
    const p = demoProject();
    expect(staleUiPatch({ ...ui, editingZoneId: 'a' }, p)).toEqual({});
    expect(staleUiPatch({ ...ui, editingZoneId: 'zz' }, p)).toEqual({ editingZoneId: null });
  });

  it('sin pozo activo cierra lo que depende del pozo', () => {
    expect(staleUiPatch({ editingZoneId: 'a', activeModuleId: null, zoneMarking: true, snapshotsOpen: true }, createProject())).toEqual({
      editingZoneId: null,
      zoneMarking: false,
      snapshotsOpen: false,
    });
  });

  it('suelta un módulo activo que no existe', () => {
    expect(staleUiPatch({ ...ui, activeModuleId: 'x' }, demoProject(), (id) => id === 'igr')).toEqual({ activeModuleId: null });
    expect(staleUiPatch({ ...ui, activeModuleId: 'igr' }, demoProject(), (id) => id === 'igr')).toEqual({});
  });
});

describe('atajos', () => {
  const k = (key: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey', boolean>> = {}) => ({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });
  it('Ctrl+Z deshace; Ctrl+Mayús+Z y Ctrl+Y rehacen', () => {
    expect(historyShortcut(k('z', { ctrlKey: true }))).toBe('undo');
    expect(historyShortcut(k('Z', { ctrlKey: true, shiftKey: true }))).toBe('redo');
    expect(historyShortcut(k('y', { ctrlKey: true }))).toBe('redo');
    expect(historyShortcut(k('z'))).toBeNull();
    expect(historyShortcut(k('z', { ctrlKey: true, altKey: true }))).toBeNull();
    expect(historyShortcut(k('x', { ctrlKey: true }))).toBeNull();
  });
});
