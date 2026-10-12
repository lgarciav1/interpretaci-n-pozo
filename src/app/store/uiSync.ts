/**
 * Mantiene el estado de interfaz consistente con el proyecto: después de deshacer, rehacer o cualquier cambio, una
 * referencia de UI puede apuntar a algo que ya no existe (zona borrada, pozo quitado). `staleUiPatch` dice qué
 * corregir (puro); `installUiSync` lo aplica en cada cambio del proyecto.
 */
import { activeWellEntry, type Project } from '../../core/state/project';
import { clearPlotSelection, getPlotLink } from '../../plots/link';
import { useProject } from './project';
import { useUi, type UiStore } from './ui';

type UiRefs = Pick<UiStore, 'editingZoneId' | 'activeModuleId' | 'zoneMarking' | 'snapshotsOpen'> & Partial<Pick<UiStore, 'curtain'>>;

/** Correcciones para que la interfaz no apunte a nada inexistente (vacío si está todo bien). */
export function staleUiPatch(ui: UiRefs, project: Project, moduleExists: (id: string) => boolean = () => true): Partial<UiRefs> {
  const patch: Partial<UiRefs> = {};
  const entry = activeWellEntry(project);
  if (!entry) {
    if (ui.zoneMarking) patch.zoneMarking = false;
    if (ui.snapshotsOpen) patch.snapshotsOpen = false;
  }
  if (ui.editingZoneId !== null && !entry?.interpretation.zones.some((z) => z.id === ui.editingZoneId)) patch.editingZoneId = null;
  if (ui.activeModuleId !== null && !moduleExists(ui.activeModuleId)) patch.activeModuleId = null;
  // Cortina: el snapshot tiene que seguir existiendo y ser del pozo activo.
  if (ui.curtain) {
    const snap = project.snapshots.find((s) => s.id === ui.curtain!.snapshotId);
    if (!snap || !entry || snap.wellId !== entry.well.id) patch.curtain = null;
  }
  return patch;
}

let installed = false;
export function installUiSync(moduleExists?: (id: string) => boolean): void {
  if (installed) return;
  installed = true;
  useProject.subscribe((s, prev) => {
    if (s.project === prev.project) return;
    const patch = staleUiPatch(useUi.getState(), s.project, moduleExists);
    if (Object.keys(patch).length > 0) useUi.getState().set(patch);
    // La selección de los gráficos (0021) es de un pozo: otro pozo activo (u otra importación) la limpia.
    const sel = getPlotLink().selection;
    if (sel && activeWellEntry(s.project)?.well.depth.values !== sel.depth) clearPlotSelection();
  });
}
