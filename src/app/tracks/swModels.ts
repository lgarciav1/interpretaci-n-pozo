/**
 * «Mostrar modelos de Sw» (docs/decisiones/0018): activa la comparación de Archie, Simandoux e Indonesia y agrega la
 * pista que los dibuja lado a lado. Un solo `commit` (un Ctrl+Z deshace las dos cosas).
 */
import { activeWellEntry } from '../../core/state/project';
import { toast } from '../../ui';
import { isSwModelsTrack, showSwModelsRecipe } from '../../viewer/swModels';
import { OVERLAYS } from '../shell/viewerOverlayList';
import { useProject } from '../store/project';
import { useResults } from '../store/results';
import { useUi } from '../store/ui';
import { announce, materializedLayout } from './actions';

/** Módulo que alimenta hoy el puerto SW (null si no hay resultado o viene de una curva medida). */
function activeSwModule(): string | null {
  return useResults.getState().result?.outputs.find((o) => o.port === 'SW' && o.kind === 'curve' && o.active)?.moduleId ?? null;
}

/** ¿La pista ya está en las pistas del espacio de trabajo activo? */
export function hasSwModelsTrack(): boolean {
  const project = useProject.getState().project;
  return materializedLayout(project, useUi.getState().workspace, OVERLAYS).some(isSwModelsTrack);
}

/** Lleva la pista de modelos de Sw a la vista (el visor se desplaza en horizontal cuando no entran todas). */
function revealSwModelsTrack(): void {
  const t = materializedLayout(useProject.getState().project, useUi.getState().workspace, OVERLAYS).find(isSwModelsTrack);
  if (!t) return;
  // El visor arma el encabezado en el cuadro siguiente al cambio del proyecto.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => document.querySelector(`.wv-head[data-track-id="${CSS.escape(t.id)}"]`)?.scrollIntoView({ inline: 'center', block: 'nearest' })),
  );
}

/** Muestra la pista «Modelos de Sw» y pone en comparación los módulos que faltan. false si no hay pozo. */
export function showSwModels(): boolean {
  const entry = activeWellEntry(useProject.getState().project);
  if (!entry) {
    toast({ tone: 'warn', title: 'Cargá un pozo primero', description: 'Los modelos de Sw se calculan sobre un pozo con resistividad y porosidad.' });
    return false;
  }
  const workspace = useUi.getState().workspace;
  const wellId = entry.well.id;
  const active = activeSwModule();
  const before = useProject.getState().project;
  useProject.getState().commit('Mostrar modelos de Sw', (p) => showSwModelsRecipe(p, wellId, workspace, materializedLayout(p, workspace, OVERLAYS), active));
  if (useProject.getState().project === before) {
    toast({ tone: 'info', title: 'Los modelos de Sw ya se están mostrando' });
    revealSwModelsTrack();
    return true;
  }
  announce('Pista Modelos de Sw agregada; se calculan Archie, Simandoux e Indonesia.');
  revealSwModelsTrack();
  return true;
}
