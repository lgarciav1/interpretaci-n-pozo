/** Lectura amplia: estado temporal, preferencias persistidas y salidas hacia herramientas/paneles. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { syntheticWell } from '../../src/app/demo/syntheticWell';
import { commands } from '../../src/app/shell/commands';
import { useProject } from '../../src/app/store/project';
import { useUi, type ShellLayout } from '../../src/app/store/ui';
import { staleUiPatch } from '../../src/app/store/uiSync';
import { useViewer } from '../../src/app/store/viewer';
import { addWell, createProject } from '../../src/core/state/project';
import { serializeProject } from '../../src/core/state/serialize';

const custom: ShellLayout = {
  leftWidth: 241, rightWidth: 329, dockHeight: 183,
  leftAuto: false, rightAuto: false, dockAuto: false,
  leftCollapsed: true, rightCollapsed: false, dockCollapsed: false, wellHeader: false, panels: 'bottom',
};
const write = vi.fn();
const demo = syntheticWell(200);
const base = () => addWell(createProject('Lectura'), demo.well, demo.zones);

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: write });
  useUi.setState({ layout: { ...custom }, readingMode: false, trackBuilder: false, toolStringOpen: false, activeStepId: null, activeModuleId: null, editingZoneId: null });
  useViewer.setState({ dragging: false });
  useProject.getState().replace(base());
  vi.advanceTimersByTime(250);
  write.mockClear();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it('entrar y salir conserva exactamente paneles, anchos, alto, automatismos y cabecera', () => {
  const layout = useUi.getState().layout;
  useUi.getState().toggleReadingMode();
  expect(useUi.getState().readingMode).toBe(true);
  expect(useUi.getState().layout).toBe(layout);
  useUi.getState().toggleReadingMode();
  expect(useUi.getState().readingMode).toBe(false);
  expect(useUi.getState().layout).toBe(layout);
  expect(layout).toEqual(custom);
});

it('la lectura temporal no escribe en localStorage, incluso si había una preferencia pendiente', () => {
  useUi.getState().setLayout({ leftWidth: 255 });
  const layout = useUi.getState().layout;
  useUi.getState().toggleReadingMode();
  vi.advanceTimersByTime(250);
  expect(write).toHaveBeenCalledTimes(1);
  expect(JSON.parse(write.mock.calls[0]![1])).toEqual(layout);
  expect(JSON.parse(write.mock.calls[0]![1])).not.toHaveProperty('readingMode');
  write.mockClear();
  useUi.getState().toggleReadingMode();
  useUi.getState().toggleReadingMode();
  vi.advanceTimersByTime(250);
  expect(write).not.toHaveBeenCalled();
});

it('abrir un panel durante lectura vuelve a la disposición original y aplica solo la elección explícita', () => {
  useUi.getState().toggleReadingMode();
  useUi.getState().setLayout({ leftCollapsed: false });
  expect(useUi.getState().readingMode).toBe(false);
  expect(useUi.getState().layout).toEqual({ ...custom, leftCollapsed: false });
  vi.advanceTimersByTime(250);
  expect(JSON.parse(write.mock.calls[0]![1])).toEqual({ ...custom, leftCollapsed: false });
});

describe('acceso a herramientas y parámetros', () => {
  it.each([
    { trackBuilder: true }, { toolStringOpen: true }, { activeStepId: 'porosity' },
    { activeModuleId: 'vsh' }, { editingZoneId: 'zone-c' },
  ])('sale de lectura al solicitar %j, sin cambiar medidas guardadas', (patch) => {
    const layout = useUi.getState().layout;
    useUi.getState().toggleReadingMode();
    useUi.getState().set(patch);
    expect(useUi.getState().readingMode).toBe(false);
    expect(useUi.getState().layout).toBe(layout);
    expect(useUi.getState()).toMatchObject(patch);
  });

  it.each([{ trackBuilder: true }, { toolStringOpen: true }])('no amplía un visor cubierto por %j', (patch) => {
    useUi.getState().set(patch);
    useUi.getState().toggleReadingMode();
    expect(useUi.getState().readingMode).toBe(false);
    useUi.getState().set({ readingMode: true });
    expect(useUi.getState().readingMode).toBe(false);
  });
});

it('permite cambiar de espacio de trabajo y conserva la lectura mientras no se solicite un panel', () => {
  useUi.getState().toggleReadingMode();
  useUi.getState().set({ workspace: 'geology', activeStepId: null, activeModuleId: null });
  expect(useUi.getState().readingMode).toBe(true);
  expect(useUi.getState().layout).toEqual(custom);
});

it('el comando está disponible con pozo y se bloquea durante arrastre o sin pozo', () => {
  const c = commands().find((c) => c.id === 'layout:reading')!;
  const enabled = () => typeof c.enabled === 'function' ? c.enabled() : c.enabled;
  expect(enabled()).toBe(true);
  c.run!();
  expect(useUi.getState().readingMode).toBe(true);
  useViewer.setState({ dragging: true });
  expect(enabled()).toBe(false);
  useViewer.setState({ dragging: false });
  useProject.getState().replace(createProject());
  expect(enabled()).toBe(false);
});

it('un proyecto sin pozo no deja el visor atrapado en lectura', () => {
  useUi.getState().toggleReadingMode();
  expect(staleUiPatch(useUi.getState(), createProject())).toMatchObject({ readingMode: false });
});

it('cambiar lectura no modifica proyecto, interpretación, historial, resultados guardados ni formato', async () => {
  const p = useProject.getState().project;
  const history = useProject.getState().history;
  const before = JSON.parse(await serializeProject(p, { codec: 'f64le-b64' }));
  useUi.getState().toggleReadingMode();
  const after = JSON.parse(await serializeProject(useProject.getState().project, { codec: 'f64le-b64' }));
  expect(useProject.getState().project).toBe(p);
  expect(useProject.getState().history).toBe(history);
  expect(after.version).toBe(6);
  expect(after.project).toEqual(before.project);
  expect(after.project).not.toHaveProperty('readingMode');
});
