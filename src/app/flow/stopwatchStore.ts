/**
 * Cronómetro del recorrido (F19): estado de interfaz. No entra en el proyecto, en deshacer/rehacer ni en el archivo;
 * el tiempo no se guarda. Solo la preferencia de mostrarlo se recuerda en localStorage (de fábrica, visible).
 * `installStopwatch()` (una vez, en el arranque) lo arranca al cargar un pozo y lo frena al abrir el paso «Sumario».
 */
import { create } from 'zustand';
import { useProject } from '../store/project';
import { useUi } from '../store/ui';
import { IDLE_STOPWATCH, startFor, stop, walkthroughStartFor, type StopwatchState } from './stopwatch';

/** Paso que cierra el recorrido (`src/app/flow/flow.ts`). */
export const WALKTHROUGH_END_STEP = 'summary';

const VISIBLE_KEY = 'pozo.ui.walkthroughClock';

function loadVisible(): boolean {
  try {
    return localStorage.getItem(VISIBLE_KEY) !== 'hidden';
  } catch {
    return true;
  }
}

export interface StopwatchStore {
  watch: StopwatchState;
  /** Mostrar el chip en la barra del flujo (se recuerda). */
  visible: boolean;
  setVisible(visible: boolean): void;
  /** Reinicia desde ahora para el pozo activo (sin pozo, no hace nada). */
  restart(): void;
}

/** Reloj (reemplazable en pruebas). */
export const stopwatchClock = { now: () => Date.now() };

export const useStopwatch = create<StopwatchStore>()((set) => ({
  watch: IDLE_STOPWATCH,
  visible: loadVisible(),
  setVisible: (visible) => {
    set({ visible });
    try {
      localStorage.setItem(VISIBLE_KEY, visible ? 'visible' : 'hidden');
    } catch {
      // sin almacenamiento: la preferencia dura la sesión
    }
  },
  restart: () => {
    const id = useProject.getState().project.activeWellId;
    if (id) set({ watch: startFor(id, stopwatchClock.now()) });
  },
}));

let installed = false;
export function installStopwatch(): void {
  if (installed) return;
  installed = true;
  // Arranque: el punto único por donde cambia el pozo del proyecto.
  useProject.subscribe((s, prev) => {
    if (s.project === prev.project) return;
    // `replace` vacía el historial y deja su etiqueta; `cancelGroup` también puede vaciarlo, pero sin etiqueta.
    const replaced = s.history !== prev.history && s.history.past.length === 0 && s.history.future.length === 0 && s.lastChange !== null;
    const id = walkthroughStartFor(prev.project, s.project, { replaced, label: s.lastChange }, useStopwatch.getState().watch);
    if (id) useStopwatch.setState({ watch: startFor(id, stopwatchClock.now()) });
  });
  // Freno: la primera vez que se abre el Sumario con el pozo que se mide; después queda fijo.
  useUi.subscribe((s, prev) => {
    if (s.activeStepId !== WALKTHROUGH_END_STEP || prev.activeStepId === WALKTHROUGH_END_STEP) return;
    const { watch } = useStopwatch.getState();
    if (watch.wellId !== useProject.getState().project.activeWellId) return;
    const next = stop(watch, stopwatchClock.now());
    if (next !== watch) useStopwatch.setState({ watch: next });
  });
}
