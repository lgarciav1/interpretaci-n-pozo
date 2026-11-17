/** Cronómetro del recorrido (F19): lógica pura, arranque/freno automáticos y línea del informe. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { syntheticWell } from '../src/app/demo/syntheticWell';
import {
  BOOT_DEMO_LABEL,
  elapsedMs,
  formatElapsed,
  formatElapsedLong,
  goalFraction,
  goalStatus,
  IDLE_STOPWATCH,
  isRunning,
  RESTORE_SESSION_LABEL,
  startFor,
  stop,
  WALKTHROUGH_GOAL_MS,
  walkthroughReport,
  walkthroughStartFor,
} from '../src/app/flow/stopwatch';
import { installStopwatch, stopwatchClock, useStopwatch } from '../src/app/flow/stopwatchStore';
import { buildReportModel, defaultReportOptions, reportHtml, walkthroughLine } from '../src/app/report/report';
import { useProject } from '../src/app/store/project';
import { useUi } from '../src/app/store/ui';
import { emptyInterpretation } from '../src/core/interpretation';
import { addWell, createProject, setActiveWell } from '../src/core/state/project';
import { serializeProject } from '../src/core/state/serialize';

const demo = syntheticWell(200);
const wellA = { ...demo.well, id: 'pozo-a', name: 'Pozo A' };
const wellB = { ...demo.well, id: 'pozo-b', name: 'Pozo B' };

describe('cronómetro: lógica pura', () => {
  it('arranca, corre y frena una sola vez', () => {
    const s = startFor('a', 1000);
    expect(isRunning(s)).toBe(true);
    expect(elapsedMs(s, 4500)).toBe(3500);
    const stopped = stop(s, 61_000);
    expect(isRunning(stopped)).toBe(false);
    expect(elapsedMs(stopped, 999_999)).toBe(60_000);
    // Idempotente: no vuelve a frenar ni frena lo que no arrancó.
    expect(stop(stopped, 120_000)).toBe(stopped);
    expect(stop(IDLE_STOPWATCH, 5)).toBe(IDLE_STOPWATCH);
    expect(elapsedMs(IDLE_STOPWATCH, 5)).toBe(0);
  });

  it('formatea m:ss y h:mm:ss truncando a segundos', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(999)).toBe('0:00');
    expect(formatElapsed(222_400)).toBe('3:42');
    expect(formatElapsed(WALKTHROUGH_GOAL_MS)).toBe('5:00');
    expect(formatElapsed(3_600_000 + 65_000)).toBe('1:01:05');
    expect(formatElapsed(-5)).toBe('0:00');
    expect(formatElapsedLong(42_000)).toBe('42 s');
    expect(formatElapsedLong(222_000)).toBe('3 min 42 s');
    expect(formatElapsedLong(3_720_000)).toBe('1 h 02 min');
  });

  it('meta de 5 minutos: dentro hasta 4:59, fuera desde 5:00', () => {
    expect(WALKTHROUGH_GOAL_MS).toBe(300_000);
    expect(goalStatus(299_999)).toBe('within');
    expect(goalStatus(300_000)).toBe('over');
    expect(goalFraction(150_000)).toBe(0.5);
    expect(goalFraction(900_000)).toBe(1);
  });

  it('decide cuándo una carga arranca el recorrido', () => {
    const empty = createProject();
    const withA = addWell(empty, wellA);
    const withAB = setActiveWell(addWell(withA, wellB), 'pozo-b');
    const change = { replaced: false, label: 'Cargar' };
    expect(walkthroughStartFor(empty, withA, change, IDLE_STOPWATCH)).toBe('pozo-a');
    expect(walkthroughStartFor(withA, withAB, change, startFor('pozo-a', 0))).toBe('pozo-b');
    // Cambiar a un pozo que ya estaba (o deshacer) no arranca.
    expect(walkthroughStartFor(withAB, setActiveWell(withAB, 'pozo-a'), change, IDLE_STOPWATCH)).toBeNull();
    expect(walkthroughStartFor(withAB, withA, change, startFor('pozo-b', 0))).toBeNull();
    // Rehacer la carga del pozo que ya se mide no reinicia.
    expect(walkthroughStartFor(withA, withAB, change, startFor('pozo-b', 0))).toBeNull();
    // Abrir un proyecto arranca; el sintético del arranque y la sesión recuperada, no.
    expect(walkthroughStartFor(withAB, withA, { replaced: true, label: 'Abrir proyecto' }, startFor('pozo-a', 0))).toBe('pozo-a');
    expect(walkthroughStartFor(empty, withA, { replaced: true, label: BOOT_DEMO_LABEL }, IDLE_STOPWATCH)).toBeNull();
    expect(walkthroughStartFor(empty, withA, { replaced: true, label: RESTORE_SESSION_LABEL }, IDLE_STOPWATCH)).toBeNull();
    expect(walkthroughStartFor(withA, empty, { replaced: true, label: 'Abrir proyecto' }, IDLE_STOPWATCH)).toBeNull();
  });

  it('datos para el informe solo si se mide el pozo del informe', () => {
    expect(walkthroughReport(IDLE_STOPWATCH, 10, 'a')).toBeUndefined();
    expect(walkthroughReport(startFor('a', 0), 10, 'b')).toBeUndefined();
    expect(walkthroughReport(startFor('a', 0), 10, 'a')).toEqual({ elapsedMs: 10, finished: false, goalMs: WALKTHROUGH_GOAL_MS });
    expect(walkthroughReport(stop(startFor('a', 0), 7), 10, 'a')).toEqual({ elapsedMs: 7, finished: true, goalMs: WALKTHROUGH_GOAL_MS });
  });
});

describe('cronómetro: arranque y freno en la app', () => {
  let now = 0;
  beforeEach(() => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
    stopwatchClock.now = () => now;
    installStopwatch();
    now = 0;
    useProject.getState().replace(createProject(), 'Proyecto nuevo');
    useUi.setState({ activeStepId: null });
    useStopwatch.setState({ watch: IDLE_STOPWATCH, visible: true });
  });

  it('el sintético del arranque y la sesión recuperada no lo arrancan', () => {
    useProject.getState().replace(addWell(createProject(), wellA), BOOT_DEMO_LABEL);
    useProject.getState().replace(addWell(createProject(), wellB), RESTORE_SESSION_LABEL);
    expect(useStopwatch.getState().watch).toEqual(IDLE_STOPWATCH);
  });

  it('cargar un pozo arranca, abrir el sumario frena, y nada de eso pasa por el proyecto ni por deshacer', () => {
    now = 1000;
    useProject.getState().commit('Cargar Pozo A', (p) => setActiveWell(addWell(p, wellA), 'pozo-a'));
    expect(useStopwatch.getState().watch).toEqual({ wellId: 'pozo-a', startedAt: 1000, stoppedAt: null });
    const history = useProject.getState().history;
    const project = useProject.getState().project;
    const saved = serializeProject(project);

    now = 60_000;
    useUi.getState().set({ activeStepId: 'zones' });
    expect(isRunning(useStopwatch.getState().watch)).toBe(true);
    useUi.getState().set({ activeStepId: 'summary' });
    expect(useStopwatch.getState().watch.stoppedAt).toBe(60_000);
    // El recorrido no tocó el proyecto ni el historial.
    expect(useProject.getState().history).toBe(history);
    expect(useProject.getState().project).toBe(project);
    expect(serializeProject(useProject.getState().project)).toEqual(saved);

    // Volver a abrir el sumario no lo mueve; deshacer tampoco lo toca.
    now = 90_000;
    useUi.getState().set({ activeStepId: 'zones' });
    useUi.getState().set({ activeStepId: 'summary' });
    useProject.getState().commit('Agregar zona', (p) => ({ ...p, name: 'cambio' }));
    useProject.getState().undo();
    expect(useStopwatch.getState().watch).toEqual({ wellId: 'pozo-a', startedAt: 1000, stoppedAt: 60_000 });

    // Otro pozo reinicia; reiniciar a mano también.
    now = 100_000;
    useProject.getState().commit('Cargar Pozo B', (p) => setActiveWell(addWell(p, wellB), 'pozo-b'));
    expect(useStopwatch.getState().watch).toEqual({ wellId: 'pozo-b', startedAt: 100_000, stoppedAt: null });
    now = 130_000;
    useStopwatch.getState().restart();
    expect(useStopwatch.getState().watch).toEqual({ wellId: 'pozo-b', startedAt: 130_000, stoppedAt: null });
  });

  it('abrir el sumario de otro pozo no frena el recorrido medido', () => {
    useProject.getState().commit('Cargar Pozo A', (p) => addWell(p, wellA));
    useProject.getState().commit('Cargar Pozo B', (p) => setActiveWell(addWell(p, wellB), 'pozo-b'));
    useProject.getState().commit('Cambiar de pozo', (p) => setActiveWell(p, 'pozo-a'));
    useUi.getState().set({ activeStepId: 'summary' });
    expect(useStopwatch.getState().watch.wellId).toBe('pozo-b');
    expect(isRunning(useStopwatch.getState().watch)).toBe(true);
  });

  it('cargar un pozo estando en el Sumario no deja el reloj corriendo sin freno', () => {
    now = 1000;
    useProject.getState().commit('Cargar Pozo A', (p) => addWell(p, wellA));
    useUi.getState().set({ activeStepId: 'summary' });
    expect(useStopwatch.getState().watch.stoppedAt).toBe(1000);
    now = 5000;
    useProject.getState().commit('Cargar Pozo B', (p) => setActiveWell(addWell(p, wellB), 'pozo-b'));
    expect(useStopwatch.getState().watch).toEqual({ wellId: 'pozo-b', startedAt: 5000, stoppedAt: null });
    expect(useUi.getState().activeStepId).toBeNull();
    now = 9000;
    useUi.getState().set({ activeStepId: 'summary' });
    expect(useStopwatch.getState().watch.stoppedAt).toBe(9000);
  });

  it('ocultar se recuerda en localStorage', () => {
    const setItem = vi.fn();
    vi.stubGlobal('localStorage', { getItem: () => null, setItem });
    useStopwatch.getState().setVisible(false);
    expect(useStopwatch.getState().visible).toBe(false);
    expect(setItem).toHaveBeenCalledWith('pozo.ui.walkthroughClock', 'hidden');
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw new Error('lleno'); } });
    expect(() => useStopwatch.getState().setVisible(true)).not.toThrow();
  });
});

describe('cronómetro en el informe', () => {
  const model = buildReportModel(wellA, { ...emptyInterpretation(), zones: demo.zones }, null, new Date(2026, 10, 17));

  it('línea del tiempo, con meta y estado', () => {
    expect(walkthroughLine({ elapsedMs: 222_000, finished: true, goalMs: WALKTHROUGH_GOAL_MS })).toBe('Tiempo de interpretación: 3 min 42 s (meta: menos de 5 min)');
    expect(walkthroughLine({ elapsedMs: 42_000, finished: false, goalMs: WALKTHROUGH_GOAL_MS })).toBe('Tiempo de interpretación: 42 s (en curso; meta: menos de 5 min)');
  });

  it('aparece en el encabezado solo con dato y con la opción prendida', () => {
    const walkthrough = { elapsedMs: 222_000, finished: true, goalMs: WALKTHROUGH_GOAL_MS };
    expect(defaultReportOptions().includeWalkthrough).toBe(true);
    expect(reportHtml(model)).not.toContain('Tiempo de interpretación');
    const html = reportHtml({ ...model, walkthrough });
    expect(html).toContain('Tiempo de interpretación: 3 min 42 s (meta: menos de 5 min)');
    expect(html.indexOf('Tiempo de interpretación')).toBeLessThan(html.indexOf('</header>'));
    expect(reportHtml({ ...model, walkthrough }, [], { ...defaultReportOptions(), includeWalkthrough: false })).not.toContain('Tiempo de interpretación');
  });
});
