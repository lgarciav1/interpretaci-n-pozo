/**
 * Conexión de los gráficos del dock con el visor (docs/decisiones/0014, D4; ampliada en la 0021, F): lo que el usuario
 * señala en el histograma, en el crossplot o en el visor, para que los demás lo marquen. Estado de interfaz (no se
 * guarda ni pasa por `commit`), sin React ni zustand: un pub/sub mínimo. Lo leen la superposición `plot-link`
 * (`src/modules/crossplot/overlay.ts`), los paneles (`usePlotSelection`, `src/plots/useLink.ts`) y la barra del visor.
 *
 * - Lo de paso (bajo el puntero): profundidad de un punto del crossplot, tramos de la clase del histograma.
 * - La SELECCIÓN: una sola activa entre todas las fuentes (lazo o rectángulo del crossplot, clases del histograma,
 *   tramo del visor). Es una máscara sobre las muestras del pozo; los demás la muestran a su manera (tramos en el
 *   visor, puntos resaltados en el crossplot, distribución superpuesta en el histograma).
 *
 * El cursor del visor → punto del crossplot sigue leyendo `useViewer.cursorDepth`.
 */
import type { DepthRun } from './data';
import { maskCount, maskRuns, type SelectionShape } from './selection';

export type SelectionSource = 'crossplot' | 'histogram' | 'viewer';

/** Lo que hace falta para volver a dibujar la selección donde se creó (y para sumar a ella). */
export type SelectionDetail =
  /** Crossplot: formas elegidas sobre los ejes `x`–`y` (claves de curva). */
  | { kind: 'shapes'; x: string; y: string; shapes: readonly SelectionShape[] }
  /** Histograma: clases elegidas de la curva `curve` con esos bordes. */
  | { kind: 'bins'; curve: string; curveLabel: string; edges: readonly number[]; bins: readonly number[] }
  /** Visor: tramo de profundidad (m). */
  | { kind: 'interval'; top: number; base: number };

export interface PlotSelection {
  source: SelectionSource;
  /** Profundidad del pozo sobre la que vale la máscara (identidad: otro pozo u otra importación la invalidan). */
  depth: Float64Array;
  /** 1 = muestra seleccionada; largo = muestras del pozo. No se modifica: una selección nueva es otro array. */
  mask: Uint8Array;
  count: number;
  /** Tramos para el visor. */
  runs: readonly DepthRun[];
  detail: SelectionDetail;
}

export interface PlotLinkState {
  /** Profundidad del punto bajo el puntero en un crossplot (línea en el visor). */
  hoverDepth: number | null;
  /** Tramos de las muestras de la clase bajo el puntero en el histograma. */
  hoverRuns: readonly DepthRun[] | null;
  /** Selección vigente (queda hasta que se limpia: Escape, botón, otro pozo). */
  selection: PlotSelection | null;
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

/** Arma una selección (cuenta y tramos) a partir de su máscara. Sin muestras → null (no hay nada que mostrar). */
export function makeSelection(source: SelectionSource, depth: Float64Array, mask: Uint8Array, detail: SelectionDetail): PlotSelection | null {
  const count = maskCount(mask);
  if (count === 0) return null;
  return { source, depth, mask, count, runs: maskRuns(depth, mask), detail };
}

/** Reemplaza la selección (null = limpiar). */
export function setPlotSelection(sel: PlotSelection | null): void {
  setPlotLink({ selection: sel });
}

export function clearPlotSelection(): void {
  setPlotLink({ selection: null });
}

/** La selección vigente si vale para este pozo (misma profundidad), o null. */
export function selectionFor(depth: Float64Array | null | undefined): PlotSelection | null {
  const s = state.selection;
  return s && depth && s.depth === depth ? s : null;
}

/** Texto corto de la selección para rótulos y la barra del visor («Lazo en el crossplot», «Tramo 7 800–7 850 m»). */
export function selectionTitle(s: PlotSelection, fmtDepth: (d: number) => string = (d) => d.toFixed(1)): string {
  const d = s.detail;
  if (d.kind === 'interval') return `Tramo ${fmtDepth(d.top)}–${fmtDepth(d.base)} m`;
  if (d.kind === 'bins') return d.bins.length === 1 ? `Clase del histograma de ${d.curveLabel}` : `${d.bins.length} clases del histograma de ${d.curveLabel}`;
  const lasso = d.shapes.some((q) => q.kind === 'lasso');
  const rect = d.shapes.some((q) => q.kind === 'rect');
  return lasso && rect ? 'Selección en el crossplot' : lasso ? 'Lazo en el crossplot' : 'Rectángulo en el crossplot';
}
