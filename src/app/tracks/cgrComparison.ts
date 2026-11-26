/**
 * Acción «Ver CGR frente a GR en el visor» (docs/decisiones/0090): agrega la pista «GR · CGR»
 * junto a Correlación y la desplaza a la vista. Un solo `commit` deshacible con Ctrl+Z.
 */
import { activeWellEntry } from '../../core/state/project';
import { toast } from '../../ui';
import { isCgrComparisonTrack, showCgrComparisonRecipe } from '../../viewer/cgrComparison';
import { OVERLAYS } from '../shell/viewerOverlayList';
import { useProject } from '../store/project';
import { useUi } from '../store/ui';
import { announce, materializedLayout } from './actions';

function revealCgrTrack(): void {
  const t = materializedLayout(useProject.getState().project, useUi.getState().workspace, OVERLAYS).find(isCgrComparisonTrack);
  if (!t) return;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => document.querySelector(`.wv-head[data-track-id="${CSS.escape(t.id)}"]`)?.scrollIntoView({ inline: 'center', block: 'nearest' })),
  );
}

/** Muestra la pista «GR · CGR» en el espacio de trabajo activo. Devuelve false si no hay pozo. */
export function showCgrComparison(): boolean {
  const entry = activeWellEntry(useProject.getState().project);
  if (!entry) {
    toast({ tone: 'warn', title: 'Cargá un pozo primero', description: 'La comparación GR frente a CGR necesita un pozo cargado.' });
    return false;
  }
  const workspace = useUi.getState().workspace;
  const before = useProject.getState().project;
  useProject.getState().commit('Mostrar GR frente a CGR', (p) => showCgrComparisonRecipe(p, workspace, materializedLayout(p, workspace, OVERLAYS)));
  if (useProject.getState().project === before) {
    toast({ tone: 'info', title: 'La pista GR · CGR ya está visible' });
    revealCgrTrack();
    return true;
  }
  announce('Pista GR · CGR agregada junto a Correlación.');
  revealCgrTrack();
  return true;
}
