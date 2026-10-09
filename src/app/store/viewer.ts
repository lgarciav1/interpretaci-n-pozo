/**
 * Estado del visor que otros paneles leen (no se guarda): profundidad del cursor (perfil radial, crossplot
 * conectado) y tramo visible (minimapa de la fase 4b). Lo publica `ViewerSlot`; nadie más lo escribe.
 */
import { create } from 'zustand';

export interface ViewerStore {
  /** Profundidad bajo el cursor (m), o null si el cursor no está sobre el visor. */
  cursorDepth: number | null;
  /** Tramo visible (m). */
  visible: { top: number; base: number } | null;
}

export const useViewer = create<ViewerStore>()(() => ({ cursorDepth: null, visible: null }));
