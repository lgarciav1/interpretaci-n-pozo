/**
 * Store del proyecto (zustand). Toda modificación pasa por `commit(etiqueta, receta)`, donde la receta es una
 * función pura de `src/core/state/`. Ahí se registra el historial de deshacer/rehacer (`src/core/state/history.ts`):
 * se guarda el proyecto anterior (las estructuras se comparten, no se copian datos). `replace` abre un proyecto y
 * vacía el historial.
 *
 * La etiqueta es lo que lee el usuario en «Deshacer: …» y «Se deshizo: …»: corta, en español, con verbo
 * («Mover tope de C», «Cambiar Rw»). Cambios seguidos con la misma etiqueta se agrupan (ver history.ts).
 */
import { create } from 'zustand';
import { cancelGroup, emptyHistory, recordChange, redo, redoLabelOf, undo, undoLabelOf, type History } from '../../core/state/history';
import { activeWellEntry, createProject, type Project, type WellEntry } from '../../core/state/project';
import { projectInputState } from '../../core/state/inputRevisions';

export interface ProjectStore {
  project: Project;
  /** Etiqueta del último cambio. */
  lastChange: string | null;
  history: History;
  canUndo: boolean;
  canRedo: boolean;
  /** Qué deshace / rehace el próximo paso (null si no hay). */
  undoLabel: string | null;
  redoLabel: string | null;
  /**
   * Aplica una receta y la registra en deshacer. `opts.group` = id de un gesto (un arrastre): sus cambios con la misma
   * etiqueta se funden en una sola entrada aunque haya pausas largas (docs/decisiones/0015).
   */
  commit(label: string, recipe: (p: Project) => Project, opts?: { group?: string }): void;
  replace(project: Project, label?: string): void;
  /** Escape durante un arrastre: vuelve al proyecto de antes del gesto `group` y quita su entrada de deshacer. */
  cancelGroup(group: string): void;
  /** Deshace el último cambio; devuelve su etiqueta, o null si no había nada. */
  undo(): string | null;
  /** Rehace el último cambio deshecho; devuelve su etiqueta, o null si no había nada. */
  redo(): string | null;
}

const historyState = (history: History) => ({
  history,
  canUndo: history.past.length > 0,
  canRedo: history.future.length > 0,
  undoLabel: undoLabelOf(history),
  redoLabel: redoLabelOf(history),
});

/** Reloj del agrupado (reemplazable en pruebas). */
export const historyClock = { now: () => Date.now() };

export const useProject = create<ProjectStore>()((set, get) => ({
  project: createProject(),
  lastChange: null,
  ...historyState(emptyHistory()),
  commit(label, recipe, opts) {
    const { project: prev, history } = get();
    const next = recipe(prev);
    if (next === prev) return;
    projectInputState(next);
    set({ project: next, lastChange: label, ...historyState(recordChange(history, prev, label, historyClock.now(), undefined, opts?.group)) });
  },
  cancelGroup(group) {
    const step = cancelGroup(get().history, group);
    if (!step) return;
    set({ project: step.project, lastChange: null, ...historyState(step.history) });
  },
  replace(project, label = 'Abrir proyecto') {
    projectInputState(project);
    set({ project, lastChange: label, ...historyState(emptyHistory()) });
  },
  undo() {
    const { project, history } = get();
    const step = undo(history, project);
    if (!step) return null;
    set({ project: step.project, lastChange: `Deshacer ${step.label}`, ...historyState(step.history) });
    return step.label;
  },
  redo() {
    const { project, history } = get();
    const step = redo(history, project);
    if (!step) return null;
    set({ project: step.project, lastChange: step.label, ...historyState(step.history) });
    return step.label;
  },
}));

export function selectActiveEntry(s: ProjectStore): WellEntry | null {
  return activeWellEntry(s.project);
}

