/**
 * Estado de interfaz del panel Avisos (docs/decisiones/0072): gravedades ocultas, «Ocultar vistos» y grupos que la
 * usuaria abrió o plegó a mano. No es del proyecto: no se guarda ni entra en deshacer.
 */
import { create } from 'zustand';
import type { DiagnosticLevel } from './grouping';

export interface DiagnosticsUiStore {
  hiddenLevels: DiagnosticLevel[];
  hideSeen: boolean;
  /** Grupo → abierto (true) o plegado (false) a mano; los ausentes siguen el plegado por defecto. */
  openGroups: Record<string, boolean>;
  toggleLevel(level: DiagnosticLevel): void;
  setHideSeen(hide: boolean): void;
  setGroupOpen(id: string, open: boolean): void;
}

export const useDiagnosticsUi = create<DiagnosticsUiStore>()((set) => ({
  hiddenLevels: [],
  hideSeen: false,
  openGroups: {},
  toggleLevel: (level) =>
    set((s) => ({ hiddenLevels: s.hiddenLevels.includes(level) ? s.hiddenLevels.filter((l) => l !== level) : [...s.hiddenLevels, level] })),
  setHideSeen: (hideSeen) => set({ hideSeen }),
  setGroupOpen: (id, open) => set((s) => ({ openGroups: { ...s.openGroups, [id]: open } })),
}));
