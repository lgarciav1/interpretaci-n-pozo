/**
 * Store del proyecto (zustand). Toda modificación pasa por `commit(etiqueta, receta)`, donde la receta es una
 * función pura de `src/core/state/`. Ese único punto de entrada es donde se enchufará deshacer/rehacer
 * (guardando el proyecto anterior: las estructuras se comparten, no se copian datos).
 */
import { create } from 'zustand';
import { activeWellEntry, createProject, type Project, type WellEntry } from '../../core/state/project';

export interface ProjectStore {
  project: Project;
  /** Etiqueta del último cambio (para el futuro historial de deshacer). */
  lastChange: string | null;
  commit(label: string, recipe: (p: Project) => Project): void;
  replace(project: Project, label?: string): void;
}

export const useProject = create<ProjectStore>()((set, get) => ({
  project: createProject(),
  lastChange: null,
  commit(label, recipe) {
    const prev = get().project;
    const next = recipe(prev);
    if (next !== prev) set({ project: next, lastChange: label });
  },
  replace(project, label = 'Abrir proyecto') {
    set({ project, lastChange: label });
  },
}));

export function selectActiveEntry(s: ProjectStore): WellEntry | null {
  return activeWellEntry(s.project);
}
