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

/**
 * Lo que hay que limpiar del estado de interfaz cuando las tendencias del pozo activo cambiaron por fuera (deshacer,
 * restaurar un snapshot, cambiar de pozo): una selección o una herramienta que apuntan a una tendencia que ya no está.
 * null si no hay nada que cambiar.
 */
export function staleTrendsUi(ui: Pick<TrendsUiStore, 'tool' | 'selectedId'>, trends: readonly { id: string }[]): Partial<Pick<TrendsUiStore, 'tool' | 'selectedId'>> | null {
  const has = (id: string) => trends.some((t) => t.id === id);
  const patch: Partial<Pick<TrendsUiStore, 'tool' | 'selectedId'>> = {};
  if (ui.selectedId && !has(ui.selectedId)) patch.selectedId = null;
  if (ui.tool?.trendId && !has(ui.tool.trendId)) patch.tool = null;
  return Object.keys(patch).length ? patch : null;
}

export const useTrendsUi = create<TrendsUiStore>()((set) => ({
  tool: null,
  selectedId: null,
  showRange: null,
  set: (patch) => set(patch),
  requestRange: (top, base) => set((s) => ({ showRange: { top, base, seq: (s.showRange?.seq ?? 0) + 1 } })),
}));
