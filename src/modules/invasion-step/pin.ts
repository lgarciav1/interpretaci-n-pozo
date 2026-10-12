/**
 * Estado de interfaz del perfil radial (no se guarda en el proyecto): la última profundidad que señaló el cursor del
 * visor y la profundidad fijada. Pub/sub sin React ni stores de la app: lo leen el panel del dock (con
 * `useSyncExternalStore`), la superposición del visor que marca la profundidad fijada y los comandos.
 */

export interface RadialPinState {
  /** Pozo al que se refieren las profundidades (al cambiar de pozo se olvidan). */
  wellId: string | null;
  /** Última profundidad bajo el cursor (m); se conserva cuando el cursor sale del visor. */
  lastDepth: number | null;
  /** Profundidad fijada (m): el panel deja de seguir al cursor. */
  pinnedDepth: number | null;
}

let state: RadialPinState = { wellId: null, lastDepth: null, pinnedDepth: null };
const listeners = new Set<() => void>();

export const getRadialPin = (): RadialPinState => state;

export function subscribeRadialPin(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

function set(next: RadialPinState): void {
  if (next.wellId === state.wellId && next.lastDepth === state.lastDepth && next.pinnedDepth === state.pinnedDepth) return;
  state = next;
  for (const l of listeners) l();
}

/** Recuerda la profundidad del cursor de un pozo (cambiar de pozo suelta lo fijado). */
export function noteCursorDepth(wellId: string, depth: number): void {
  set(state.wellId === wellId ? { ...state, lastDepth: depth } : { wellId, lastDepth: depth, pinnedDepth: null });
}

/** Fija una profundidad (o la suelta con null). */
export function pinRadialDepth(wellId: string, depth: number | null): void {
  set(state.wellId === wellId ? { ...state, pinnedDepth: depth } : { wellId, lastDepth: depth, pinnedDepth: depth });
}

/** Solo para tests. */
export function resetRadialPin(): void {
  set({ wellId: null, lastDepth: null, pinnedDepth: null });
}
