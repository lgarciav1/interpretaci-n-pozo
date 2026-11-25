/**
 * Estado transitorio de los diálogos de acción sobre `PlotSelection` (G02, docs/decisiones/0088).
 * No se guarda en el proyecto ni entra en deshacer: al cerrar o cambiar de pozo/selección se limpia solo.
 */
import { create } from 'zustand';

export type SelectionActionDialog =
  | { kind: 'flag'; defaultName?: string }
  | { kind: 'exclude'; preferredKeys?: readonly (string | null | undefined)[] };

interface SelectionActionsUi {
  dialog: SelectionActionDialog | null;
  openFlag(defaultName?: string): void;
  openExclude(preferredKeys?: readonly (string | null | undefined)[]): void;
  close(): void;
}

export const useSelectionActionsUi = create<SelectionActionsUi>((set) => ({
  dialog: null,
  openFlag: (defaultName) => set({ dialog: defaultName ? { kind: 'flag', defaultName } : { kind: 'flag' } }),
  openExclude: (preferredKeys) =>
    set({ dialog: preferredKeys?.length ? { kind: 'exclude', preferredKeys } : { kind: 'exclude' } }),
  close: () => set({ dialog: null }),
}));
