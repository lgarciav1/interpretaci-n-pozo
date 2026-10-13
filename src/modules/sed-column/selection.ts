/** Selección compartida entre pista y panel; sólo interfaz, no modifica el proyecto. */
let selected: { wellId: string; top: number } | null = null;
const listeners = new Set<() => void>();
export const getSelectedLayer = () => selected;
export function subscribeSelectedLayer(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
export function selectLayer(wellId: string, top: number | null): void {
  const next = top === null ? null : { wellId, top };
  if (next?.wellId === selected?.wellId && next?.top === selected?.top) return;
  selected = next;
  for (const listener of listeners) listener();
}
