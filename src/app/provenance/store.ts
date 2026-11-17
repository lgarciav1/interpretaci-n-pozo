/**
 * Selección del panel «Origen» (docs/decisiones/0074): qué salida y en qué profundidad. Estado de interfaz: no entra
 * en el proyecto, en deshacer ni en el archivo.
 */
import { create } from 'zustand';
import { useUi } from '../store/ui';

export const PROVENANCE_PANEL_ID = 'provenance';

export interface ProvenanceSelection {
  /** `<moduleId>:<puerto>` (como `OutputRecord.key`), o `m:<curveId>` si se eligió una curva medida. */
  outputKey: string;
  /** Profundidad medida (m); el panel la lleva a la muestra más cercana. */
  depth: number;
}

export interface ProvenanceUiStore {
  selection: ProvenanceSelection | null;
  select(selection: ProvenanceSelection | null): void;
}

export const useProvenanceUi = create<ProvenanceUiStore>()((set) => ({
  selection: null,
  select: (selection) => set({ selection }),
}));

/** Elige la salida y la profundidad y muestra el panel «Origen». */
export function openProvenance(selection: ProvenanceSelection): void {
  useProvenanceUi.getState().select(selection);
  useUi.getState().openPanel(PROVENANCE_PANEL_ID);
}
