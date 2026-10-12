/**
 * Lectura de la selección compartida (`src/plots/link.ts`) desde React: los paneles del histograma y del crossplot y la
 * barra del visor se vuelven a dibujar solo cuando cambia la selección (no con el puntero). Docs: 0021, F.
 */
import { useSyncExternalStore } from 'react';
import { getPlotLink, selectionFor, subscribePlotLink, type PlotSelection } from './link';

/** Selección vigente para el pozo de esa profundidad (null si no hay o es de otro pozo). */
export function usePlotSelection(depth: Float64Array | null | undefined): PlotSelection | null {
  const sel = useSyncExternalStore(subscribePlotLink, () => getPlotLink().selection);
  return sel && depth && sel.depth === depth ? sel : selectionFor(depth);
}
