/** «Preparar datos» en la app (0058): pestaña del dock descubierta sola, acción de la paleta y apertura. */
import { afterEach, describe, expect, it } from 'vitest';
import { collectDockPanels, DOCK_PANELS } from '../src/app/shell/dockPanels';
import { openPreparation, PREPARATION_DOCK_HEIGHT } from '../src/app/preparation/open';
import { usePreparationUi } from '../src/app/preparation/store';
import { useProject } from '../src/app/store/project';
import { useUi } from '../src/app/store/ui';
import { addWell, createProject } from '../src/core/state/project';
import { listCommands, searchCommands, registerCommandSource } from '../src/ui/commands';
import { contextEquationId } from '../src/app/ecuaciones/open';
import { PREPARATION_DOCK_ID } from '../src/modules/preparation';
import { commands, PREPARATION_COMMAND_ID } from '../src/modules/preparation/commands';
import { syntheticWell } from '../src/app/demo/syntheticWell';

afterEach(() => {
  useUi.setState({ dockTab: 'results' });
  usePreparationUi.setState({ request: null });
});

describe('pestaña del dock', () => {
  it('el dock la descubre sola desde src/modules/preparation/dock.tsx', async () => {
    const mod = await import('../src/modules/preparation/dock');
    const panels = collectDockPanels({ 'preparation/dock.tsx': mod }, []);
    expect(panels).toHaveLength(1);
    expect(panels[0]).toMatchObject({ id: PREPARATION_DOCK_ID, title: 'Preparar datos', icon: 'filter' });
    expect(DOCK_PANELS.map((p) => p.id)).toContain(PREPARATION_DOCK_ID);
  });
});

describe('acción de la paleta «Abrir Preparar datos»', () => {
  const find = () => (typeof commands === 'function' ? commands() : []).find((c) => c.id === PREPARATION_COMMAND_ID)!;

  it('existe, se encuentra buscando y solo se habilita con un pozo', () => {
    const c = find();
    expect(c.title).toBe('Abrir Preparar datos');
    const off = registerCommandSource('test-preparation', commands);
    try {
      expect(searchCommands(listCommands(), 'preparar datos')[0]?.command.id).toBe(PREPARATION_COMMAND_ID);
      expect(searchCommands(listCommands(), 'espurios').map((m) => m.command.id)).toContain(PREPARATION_COMMAND_ID);
    } finally {
      off();
    }
    useProject.setState({ project: createProject() });
    expect(c.enabled?.()).toBe(false);
    const demo = syntheticWell();
    useProject.setState({ project: addWell(createProject(), demo.well, demo.zones) });
    expect(find().enabled?.()).toBe(true);
  });

  it('con los paneles al costado (de fábrica, 0068) abre la pestaña agrandada en el panel lateral', () => {
    const before = useProject.getState().project;
    useUi.getState().setLayout({ panels: 'side', rightCollapsed: true });
    find().run?.();
    const ui = useUi.getState();
    expect(ui.dockTab).toBe(PREPARATION_DOCK_ID);
    expect(ui.sideView).toBe('panels');
    expect(ui.layout.rightCollapsed).toBe(false);
    expect(ui.panelExpanded).toBe(true);
    expect(useProject.getState().project).toBe(before);
    expect(contextEquationId()).toBe(PREPARATION_DOCK_ID);
    useUi.setState({ panelExpanded: false });
  });

  it('con los paneles abajo abre la pestaña, despliega el dock con alto suficiente y no cambia el proyecto', () => {
    const before = useProject.getState().project;
    useUi.getState().setLayout({ panels: 'bottom', dockCollapsed: true, dockAuto: true });
    find().run?.();
    const ui = useUi.getState();
    expect(ui.dockTab).toBe(PREPARATION_DOCK_ID);
    expect(ui.layout.dockCollapsed).toBe(false);
    expect(ui.layout.dockHeight).toBeGreaterThan(0);
    expect(ui.layout.dockHeight).toBeLessThanOrEqual(PREPARATION_DOCK_HEIGHT);
    expect(usePreparationUi.getState().request).toMatchObject({ curveId: null });
    expect(useProject.getState().project).toBe(before);
    // Desde la pestaña, «Ecuaciones» abre la entrada del módulo.
    expect(contextEquationId()).toBe(useUi.getState().activeModuleId ?? PREPARATION_DOCK_ID);
  });

  it('openPreparation con una curva la pide al panel (cada pedido es distinto)', () => {
    openPreparation('GR');
    const a = usePreparationUi.getState().request!;
    openPreparation('GR');
    const b = usePreparationUi.getState().request!;
    expect(a.curveId).toBe('GR');
    expect(b.seq).toBeGreaterThan(a.seq);
  });
});
