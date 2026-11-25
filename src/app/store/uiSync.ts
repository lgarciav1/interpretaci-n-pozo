/**
 * Mantiene el estado de interfaz consistente con el proyecto: después de deshacer, rehacer o cualquier cambio, una
 * referencia de UI puede apuntar a algo que ya no existe (zona borrada, pozo quitado). `staleUiPatch` dice qué
 * corregir (puro); `installUiSync` lo aplica en cada cambio del proyecto.
 */
import { activeWellEntry, type Project } from '../../core/state/project';
import type { History } from '../../core/state/history';
import { clearPlotSelection, getPlotLink, setPlotSelection } from '../../plots/link';
import { exitDefense } from '../views/actions';
import { useProject } from './project';
import { useUi, type UiStore } from './ui';

type UiRefs = Pick<UiStore, 'editingZoneId' | 'activeModuleId' | 'zoneMarking' | 'snapshotsOpen'> & Partial<Pick<UiStore, 'curtain' | 'readingMode'>>;

/** Correcciones para que la interfaz no apunte a nada inexistente (vacío si está todo bien). */
export function staleUiPatch(ui: UiRefs, project: Project, moduleExists: (id: string) => boolean = () => true): Partial<UiRefs> {
  const patch: Partial<UiRefs> = {};
  const entry = activeWellEntry(project);
  if (!entry) {
    if (ui.readingMode) patch.readingMode = false;
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

/**
 * ¿Hay que salir del modo defensa (docs/decisiones/0075)? Si cambió el pozo activo o se reemplazó el proyecto (abrir un
 * archivo, recuperar una sesión: `replace` deja el historial vacío).
 */
export function defenseExitNeeded(prev: { project: Project; history: History }, next: { project: Project; history: History }): boolean {
  if (next.project.activeWellId !== prev.project.activeWellId) return true;
  return next.history !== prev.history && next.history.past.length === 0 && next.history.future.length === 0;
}

function sameDepthValues(a: Float64Array, b: Float64Array): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Sincroniza la selección compartida con el pozo activo tras un cambio de proyecto:
 * - Si el mismo pozo conservó exactamente la misma grilla MD (p. ej. clonado inmutable al migrar v6 ↔ v7 en
 *   Preparación o deshacer/rehacer), re-vincula `PlotSelection.depth` a la nueva referencia sin perder la selección.
 * - Si cambió el pozo activo o la grilla MD, limpia la selección.
 */
export function syncPlotSelectionWithProject(prevProject: Project, nextProject: Project): void {
  const sel = getPlotLink().selection;
  if (!sel) return;
  const nextEntry = activeWellEntry(nextProject);
  const nextDepth = nextEntry?.well.depth.values;
  if (nextDepth === sel.depth) return;
  const prevEntry = activeWellEntry(prevProject);
  if (prevEntry && nextEntry && prevEntry.well.id === nextEntry.well.id && nextDepth && sameDepthValues(sel.depth, nextDepth)) {
    setPlotSelection({ ...sel, depth: nextDepth });
  } else {
    clearPlotSelection();
  }
}

let installed = false;
export function installUiSync(moduleExists?: (id: string) => boolean): void {
  if (installed) return;
  installed = true;
  useProject.subscribe((s, prev) => {
    if (s.project === prev.project) return;
    // Primero se sale del modo defensa (restaura la foto); después se corrige lo que haya quedado colgado.
    // Sin restaurar el tramo: es de otro pozo, o de un proyecto que ya no está (aunque el pozo tenga el mismo id).
    if (useUi.getState().presenting && defenseExitNeeded(prev, s)) exitDefense({ restoreRange: false });
    const patch = staleUiPatch(useUi.getState(), s.project, moduleExists);
    if (Object.keys(patch).length > 0) useUi.getState().set(patch);
    // La selección de los gráficos (0021): re-vincula en clones idénticos (v6↔v7), limpia si cambió pozo o grilla MD.
    syncPlotSelectionWithProject(prev.project, s.project);
  });
}

