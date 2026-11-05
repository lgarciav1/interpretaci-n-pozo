/** Panel lateral (docs/decisiones/0068): disposición de los paneles, vista del panel derecho y visibilidad de pestañas. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOCK_PANELS } from '../../src/app/shell/dockPanels';
import { GLANCE_PANEL_ID, panelsOpen, panelVisible, useUi, type ShellLayout } from '../../src/app/store/ui';

const base: ShellLayout = {
  leftWidth: 292, rightWidth: 368, dockHeight: 260, leftAuto: true, rightAuto: true, dockAuto: true,
  leftCollapsed: false, rightCollapsed: false, dockCollapsed: false, wellHeader: true, panels: 'side',
};
const write = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: write });
  useUi.setState({ layout: { ...base }, sideView: 'step', dockTab: GLANCE_PANEL_ID, panelExpanded: false, readingMode: false, activeStepId: null, activeModuleId: null });
  write.mockClear();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('paneles', () => {
  it('el Resumen es la primera pestaña y ningún panel se pierde (los de la app y los de los módulos)', () => {
    const ids = DOCK_PANELS.map((p) => p.id);
    expect(ids[0]).toBe(GLANCE_PANEL_ID);
    for (const id of ['results', 'diagnostics', 'trends', 'core', 'crossplot', 'histogram', 'mdt', 'formation-water', 'zone-distribution', 'engine']) expect(ids).toContain(id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('al costado: elegir una pestaña pasa a la vista de paneles y despliega el panel plegado', () => {
    useUi.getState().setLayout({ rightCollapsed: true });
    useUi.getState().set({ dockTab: 'crossplot' });
    const s = useUi.getState();
    expect(s.sideView).toBe('panels');
    expect(s.layout.rightCollapsed).toBe(false);
    expect(panelVisible(s, 'crossplot')).toBe(true);
    expect(panelVisible(s, 'histogram')).toBe(false);
  });

  it('al costado: abrir un paso vuelve a la vista del paso y cierra el panel agrandado; la pestaña deja de estar a la vista', () => {
    useUi.getState().openPanel('histogram');
    useUi.setState({ panelExpanded: true });
    useUi.getState().set({ activeStepId: 'cutoffs' });
    const s = useUi.getState();
    expect(s.sideView).toBe('step');
    expect(s.panelExpanded).toBe(false);
    expect(panelVisible(s, 'histogram')).toBe(false);
    expect(panelsOpen(s)).toBe(false);
  });

  it('resetear el paso (null, p. ej. al cargar un pozo) no cambia la vista', () => {
    useUi.getState().openPanel('results');
    useUi.getState().set({ activeStepId: null, activeModuleId: null });
    expect(useUi.getState().sideView).toBe('panels');
  });

  it('abajo: la pestaña está a la vista con el dock desplegado, sin mirar la vista del panel lateral', () => {
    useUi.getState().placePanels('bottom');
    let s = useUi.getState();
    expect(s.layout.panels).toBe('bottom');
    expect(s.sideView).toBe('step');
    useUi.getState().setLayout({ dockCollapsed: true });
    useUi.getState().set({ dockTab: 'trends' });
    s = useUi.getState();
    expect(s.layout.dockCollapsed).toBe(false);
    expect(panelVisible(s, 'trends')).toBe(true);
  });

  it('la disposición se recuerda (localStorage) y cambiarla cierra el panel agrandado', () => {
    useUi.setState({ panelExpanded: true, sideView: 'panels' });
    useUi.getState().placePanels('bottom');
    expect(useUi.getState().panelExpanded).toBe(false);
    vi.advanceTimersByTime(250);
    expect(JSON.parse(write.mock.calls.at(-1)![1]).panels).toBe('bottom');
    useUi.getState().placePanels('side');
    expect(useUi.getState().sideView).toBe('panels');
  });

  it('plegar el panel lateral cierra el agrandado; la lectura amplia oculta todas las pestañas', () => {
    useUi.getState().openPanel('crossplot');
    useUi.setState({ panelExpanded: true });
    useUi.getState().setLayout({ rightCollapsed: true });
    expect(useUi.getState().panelExpanded).toBe(false);
    useUi.getState().openPanel('crossplot');
    useUi.getState().toggleReadingMode();
    expect(panelVisible(useUi.getState(), 'crossplot')).toBe(false);
  });
});
