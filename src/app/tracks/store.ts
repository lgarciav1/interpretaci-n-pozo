/** Estado de interfaz de «Armar pistas»: diálogos abiertos (no se guarda en el proyecto). */
import { create } from 'zustand';
import type { LayoutEditor } from './actions';

export interface TrackUiState {
  /** Diálogo «Guardar como plantilla». */
  saving: boolean;
  /** Pista que se está renombrando. */
  renaming: { trackId: string; title: string } | null;
  /** Plantilla propia que se está renombrando. */
  renamingTemplate: { id: string; name: string } | null;
  /** Acciones sobre las pistas que se ven ahora (las publica el visor; null sin pozo). */
  editor: LayoutEditor | null;
  set(patch: Partial<Omit<TrackUiState, 'set'>>): void;
}

export const useTrackUi = create<TrackUiState>()((set) => ({
  saving: false,
  renaming: null,
  renamingTemplate: null,
  editor: null,
  set: (patch) => set(patch),
}));
