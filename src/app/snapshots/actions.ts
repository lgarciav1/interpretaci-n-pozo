/**
 * Abrir y cerrar la cortina antes/después del visor (docs/decisiones/0026). Estado de interfaz (`useUi.curtain`): no
 * pasa por `commit`, así que no entra en deshacer/rehacer ni en el archivo del proyecto.
 */
import { useUi } from '../store/ui';

export function openCurtain(snapshotId: string): void {
  useUi.getState().set({ snapshotsOpen: false, curtain: { snapshotId } });
}

export function closeCurtain(): void {
  if (useUi.getState().curtain) useUi.getState().set({ curtain: null });
}
