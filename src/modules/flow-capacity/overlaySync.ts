/**
 * Puente mínimo en memoria entre `FlowCapacityPanel` y la superposición SMLP del visor (`overlay.ts`): permite que,
 * al cambiar la zona seleccionada en el panel, el visor pinte de inmediato las sub-unidades de esa zona sin sumar una
 * entrada al historial de deshacer (`Ctrl+Z`). En figuras exportadas o con el panel cerrado, la superposición usa la
 * zona guardada en `interpretation.moduleState['flow-capacity']`.
 */

export interface SmlpPreviewSelection {
  wellId: string;
  zoneKey: string;
}

let preview: SmlpPreviewSelection | null = null;
const listeners = new Set<() => void>();

export function getSmlpPreviewZone(): SmlpPreviewSelection | null {
  return preview;
}

export function setSmlpPreviewZone(next: SmlpPreviewSelection | null): void {
  if (preview?.wellId === next?.wellId && preview?.zoneKey === next?.zoneKey) return;
  preview = next;
  for (const fn of listeners) fn();
}

export function subscribeSmlpOverlay(invalidate: () => void): () => void {
  listeners.add(invalidate);
  return () => {
    listeners.delete(invalidate);
  };
}
