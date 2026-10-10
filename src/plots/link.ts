/**
 * Conexión de los gráficos del dock con el visor (docs/decisiones/0014, D4): lo que el usuario señala en el histograma
 * o en el crossplot, para que el visor lo marque. Estado de interfaz (no se guarda), sin React ni zustand: un
 * pub/sub mínimo que lee la superposición `plot-link` (`src/modules/crossplot/overlay.ts`) con `subscribe`.
 *
 * El sentido inverso (cursor del visor → punto del crossplot) lee `useViewer.cursorDepth`, que ya existe.
 */
import type { DepthRun } from './data';

export interface PlotLinkState {
  /** Profundidad del punto bajo el puntero en un crossplot (línea en el visor). */
  hoverDepth: number | null;
  /** Tramos de las muestras de la clase bajo el puntero en el histograma. */
  hoverRuns: readonly DepthRun[] | null;
  /** Tramos de la selección por rectángulo del crossplot (quedan hasta que se limpian). */
  selection: { runs: readonly DepthRun[]; count: number } | null;
}

let state: PlotLinkState = { hoverDepth: null, hoverRuns: null, selection: null };
const listeners = new Set<() => void>();

export const getPlotLink = (): PlotLinkState => state;

export function setPlotLink(patch: Partial<PlotLinkState>): void {
  let changed = false;
  for (const [k, v] of Object.entries(patch) as [keyof PlotLinkState, unknown][]) if (state[k] !== v) changed = true;
  if (!changed) return;
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export function subscribePlotLink(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
