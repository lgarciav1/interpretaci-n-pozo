/**
 * Estado efímero del lienzo (vista y cursor), separado del store de la mesa: moverse o pasar el puntero no
 * re-renderiza los paneles. Sin persistencia.
 */
import { create } from 'zustand';
import type { Viewport } from '../model/viewport';

export interface CursorReadout {
  x: number;
  y: number;
  inside: boolean;
  /** Profundidad en la unidad de la imagen (NaN sin calibración). */
  depth: number;
  /** Valor de la curva seleccionada en esa columna (NaN sin marco). */
  value: number;
}

export interface DeskViewState {
  vp: Viewport;
  size: { width: number; height: number };
  cursor: CursorReadout | null;
  /** Barra espaciadora apretada: arrastrar desplaza. */
  spacePan: boolean;
}

export const useDeskView = create<DeskViewState>()(() => ({
  vp: { scale: 1, ox: 0, oy: 0 },
  size: { width: 0, height: 0 },
  cursor: null,
  spacePan: false,
}));
