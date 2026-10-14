/**
 * Estado de interfaz de la pantalla de la sarta (docs/decisiones/0033): herramienta seleccionada (la comparten la
 * lista, la vista 3D y la ficha) y la que está bajo el puntero. No se guarda en el proyecto.
 */
import { create } from 'zustand';

export interface ToolStringUi {
  selectedId: string | null;
  hoverId: string | null;
  set(patch: Partial<Omit<ToolStringUi, 'set'>>): void;
}

export const useToolStringUi = create<ToolStringUi>()((set) => ({
  selectedId: null,
  hoverId: null,
  set: (patch) => set(patch),
}));
