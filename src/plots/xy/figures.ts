/**
 * Registro de los gráficos x–y que se pueden exportar como figura. Un `XYPlot` con `figureId` publica acá lo que está
 * mostrando mientras está montado (ejes, capas, tendencias) y se retira al desmontarse: el diálogo «Exportar» lista lo
 * que hay a la vista y lo dibuja con `figure.ts`, sin que el gráfico conozca el diálogo. Sin React.
 * Un crossplot o un histograma nuevo se vuelve exportable pasando `figureId` y `figureTitle`: no hay que tocar nada más.
 */
import type { XYAxis } from './axes';
import type { XYColorKey } from './figure';
import type { XYBarLayer, XYGuide, XYLineLayer, XYPointLayer, XYTrendLayer } from './layers';

export interface XYFigureSource {
  id: string;
  title: string;
  x: XYAxis;
  y: XYAxis;
  points: readonly XYPointLayer[];
  lines: readonly XYLineLayer[];
  trends: readonly XYTrendLayer[];
  guides: readonly XYGuide[];
  /** Barras (histograma). */
  bars?: readonly XYBarLayer[];
  /** Eje derecho (acumulada del histograma). */
  y2?: XYAxis;
  /** Barra de color por una tercera curva (crossplot libre). */
  colorKey?: XYColorKey;
}

const sources = new Map<string, XYFigureSource>();
const listeners = new Set<() => void>();
let snapshot: readonly XYFigureSource[] = [];

function changed(): void {
  snapshot = [...sources.values()];
  for (const l of listeners) l();
}

/** Publica (o actualiza) un gráfico. Devuelve la función que lo retira. */
export function registerXYFigure(source: XYFigureSource): () => void {
  sources.set(source.id, source);
  changed();
  return () => {
    // Solo retira si sigue siendo la misma publicación (un remonte puede haber puesto otra).
    if (sources.get(source.id) === source) {
      sources.delete(source.id);
      changed();
    }
  };
}

/** Gráficos publicados ahora (la misma referencia mientras nada cambie: sirve para `useSyncExternalStore`). */
export const listXYFigures = (): readonly XYFigureSource[] => snapshot;
export const getXYFigure = (id: string): XYFigureSource | undefined => sources.get(id);

export function subscribeXYFigures(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
