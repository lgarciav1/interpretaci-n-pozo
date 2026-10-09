/**
 * Estado de interfaz de las tendencias (no se guarda): herramienta activa del visor, tendencia seleccionada y un
 * pedido de «ver el tramo» para el visor. Las tendencias mismas viven en el proyecto (`Interpretation.trends`).
 */
import { create } from 'zustand';
import type { TrendTool } from '../../plots/trend/overlay';

export interface TrendsUiStore {
  /** Herramienta del visor: elegir tramo o dibujar a mano (null = ninguna). */
  tool: TrendTool | null;
  /** Tendencia seleccionada (resaltada en el visor y en el panel; clic en una muestra la excluye). */
  selectedId: string | null;
  /** Pedido al visor de mostrar un tramo (el `seq` lo distingue de uno anterior igual). */
  showRange: { top: number; base: number; seq: number } | null;
  set(patch: Partial<Pick<TrendsUiStore, 'tool' | 'selectedId'>>): void;
  requestRange(top: number, base: number): void;
}

export const useTrendsUi = create<TrendsUiStore>()((set) => ({
  tool: null,
  selectedId: null,
  showRange: null,
  set: (patch) => set(patch),
  requestRange: (top, base) => set((s) => ({ showRange: { top, base, seq: (s.showRange?.seq ?? 0) + 1 } })),
}));
