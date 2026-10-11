/**
 * Acciones de pistas para la paleta de comandos (docs/decisiones/0018): armar pistas, aplicar una plantilla de pistas
 * (de fábrica o propia), guardar las actuales como plantilla y mostrar los modelos de Sw lado a lado. Se descubre
 * solo (`src/app/<carpeta>/commands.ts`).
 */
import { activeWellEntry } from '../../core/state/project';
import { trackTemplatesFor } from '../../core/state/tracks';
import type { CommandSource } from '../../ui';
import { OVERLAYS } from '../shell/viewerOverlayList';
import { useProject } from '../store/project';
import { useUi } from '../store/ui';
import { applyTemplate, currentTemplate, resetToFactory } from './actions';
import { showSwModels } from './swModels';
import { useTrackUi } from './store';

export const commands: CommandSource = () => {
  const ui = useUi.getState();
  const project = useProject.getState().project;
  const workspace = ui.workspace;
  const hasWell = !!activeWellEntry(project);
  const current = currentTemplate(project, workspace, OVERLAYS);
  const check = (on: boolean) => (on ? { detail: 'aplicada' } : {});
  return [
    {
      id: 'tracks:builder',
      title: ui.trackBuilder ? 'Terminar de armar pistas' : 'Armar pistas',
      group: 'Pistas',
      keywords: ['catalogo', 'curvas', 'visor', 'editar', 'arrastrar', 'herramienta'],
      icon: 'tracks',
      enabled: () => hasWell,
      run: () => useUi.getState().set({ trackBuilder: !useUi.getState().trackBuilder }),
    },
    {
      id: 'tracks:template-factory',
      title: 'Aplicar la plantilla de pistas de fábrica',
      group: 'Pistas',
      keywords: ['restablecer', 'original', 'plantilla', 'default'],
      icon: 'refresh',
      ...check(current.kind === 'factory'),
      enabled: () => hasWell && current.kind !== 'factory',
      run: () => resetToFactory(useUi.getState().workspace),
    },
    ...trackTemplatesFor(project, workspace).map(
      (t): import('../../ui').Command => ({
        id: `tracks:template:${t.id}`,
        title: `Aplicar la plantilla de pistas «${t.name}»`,
        group: 'Pistas',
        keywords: ['plantilla', 'propia', 'mis plantillas'],
        icon: 'tracks',
        ...check(current.kind === 'template' && current.id === t.id),
        run: () => applyTemplate(t.id, t.name),
      }),
    ),
    {
      id: 'tracks:template-save',
      title: 'Guardar las pistas como plantilla…',
      group: 'Pistas',
      keywords: ['plantilla', 'propia', 'guardar'],
      icon: 'save',
      enabled: () => hasWell,
      run: () => useTrackUi.getState().set({ saving: true }),
    },
    {
      id: 'tracks:sw-models',
      title: 'Mostrar los modelos de Sw lado a lado',
      group: 'Pistas',
      keywords: ['archie', 'simandoux', 'indonesia', 'saturacion', 'comparar', 'sw', 'pista', 'modelos'],
      icon: 'compare',
      enabled: () => hasWell,
      run: () => void showSwModels(),
    },
  ];
};
