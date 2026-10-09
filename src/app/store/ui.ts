/** Estado de interfaz: no se guarda en el proyecto. */
import { create } from 'zustand';
import type { WorkspaceId } from '../../core/workspaces';

export interface UiStore {
  workspace: WorkspaceId;
  activeModuleId: string | null;
  /** Zona cuyos parámetros se están editando (null = valores globales). */
  editingZoneId: string | null;
  set(patch: Partial<Omit<UiStore, 'set'>>): void;
}

export const useUi = create<UiStore>()((set) => ({
  workspace: 'petrophysics',
  activeModuleId: null,
  editingZoneId: null,
  set: (patch) => set(patch),
}));
