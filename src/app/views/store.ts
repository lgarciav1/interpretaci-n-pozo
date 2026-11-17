/**
 * Estado de interfaz de las vistas guardadas (docs/decisiones/0075): diálogos abiertos y el modo defensa (recorrido,
 * vista a la vista, pistas de reemplazo para el visor y la foto de la interfaz para salir). No se guarda en el proyecto
 * ni entra en deshacer.
 */
import { create } from 'zustand';
import type { TrackSpec } from '../../core/display';
import type { ViewIssue } from '../../core/state/views';
import type { UiPhoto } from './defense';

export interface DefenseState {
  /** Ids de las vistas del recorrido (las del pozo activo al entrar, en el orden de la lista). */
  viewIds: string[];
  /** Vista a la vista (índice en `viewIds`). */
  index: number;
  /** Nombre de la vista a la vista (para el indicador). */
  name: string;
  /** Lo que falta de la vista (zona borrada, panel quitado): se dice en el indicador. */
  issues: ViewIssue[];
  /**
   * Pistas que dibuja el visor en lugar de `display.layouts[espacio]` (reemplazo sin `commit`): las de la vista, o
   * null para las de fábrica.
   */
  tracks: TrackSpec[] | null;
  /** Foto de la interfaz al entrar: se restaura tal cual al salir. */
  photo: UiPhoto;
}

export interface ViewsUiState {
  /** Diálogo «Guardar la vista actual». */
  saving: boolean;
  /** Vista que se está renombrando. */
  renaming: { id: string; name: string } | null;
  /** Modo defensa (null = no se está presentando). */
  defense: DefenseState | null;
  set(patch: Partial<Omit<ViewsUiState, 'set'>>): void;
}

export const useViewsUi = create<ViewsUiState>()((set) => ({
  saving: false,
  renaming: null,
  defense: null,
  set: (patch) => set(patch),
}));

/** Id del panel «Vistas» del dock. */
export const VIEWS_PANEL_ID = 'views';
