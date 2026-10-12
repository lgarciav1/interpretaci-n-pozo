/**
 * Tramo de electrosecuencia seleccionado (estado de interfaz, no se guarda): lo fija un clic en la pista del visor o
 * en el panel, y ambos lo resaltan. Pub/sub sin React ni stores de la app.
 */
let selected: { wellId: string; top: number } | null = null;
const listeners = new Set<() => void>();

export const getSelectedSequence = () => selected;

export function subscribeSelectedSequence(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function selectSequence(wellId: string | null, top: number | null): void {
  const next = wellId && top !== null ? { wellId, top } : null;
  if (next?.wellId === selected?.wellId && next?.top === selected?.top) return;
  selected = next;
  for (const l of listeners) l();
}
