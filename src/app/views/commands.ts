/**
 * Vistas guardadas y modo defensa en la paleta de comandos (docs/decisiones/0075, punto 7): «Guardar la vista
 * actual…», «Modo defensa: recorrer las vistas», «Salir del modo defensa» e «Ir a la vista X» por vista del pozo activo.
 * Se descubre solo (`src/app/<carpeta>/commands.ts`).
 */
import { activeWellEntry } from '../../core/state/project';
import { activeWellViews } from '../../core/state/views';
import type { Command, CommandSource } from '../../ui';
import { useProject } from '../store/project';
import { useUi } from '../store/ui';
import { enterDefense, exitDefense, goToView, rangeLabel } from './actions';
import { useViewsUi } from './store';

export const commands: CommandSource = () => {
  const project = useProject.getState().project;
  const hasWell = !!activeWellEntry(project);
  const defense = useViewsUi.getState().defense;
  const views = activeWellViews(project);
  return [
    {
      id: 'views:save',
      title: 'Guardar la vista actual…',
      group: 'Vistas',
      keywords: ['vista', 'encuadre', 'guardar', 'defensa', 'presentacion', 'tramo'],
      icon: 'save',
      enabled: () => hasWell && !useUi.getState().presenting,
      run: () => useViewsUi.getState().set({ saving: true }),
    },
    {
      id: 'views:defense',
      title: 'Modo defensa: recorrer las vistas',
      group: 'Vistas',
      keywords: ['presentar', 'presentacion', 'defensa', 'pantalla', 'limpia', 'recorrido', 'vistas'],
      icon: 'play',
      ...(defense ? { detail: 'activo' } : views.length ? { detail: `${views.length} ${views.length === 1 ? 'vista' : 'vistas'}` } : {}),
      enabled: () => hasWell && !useViewsUi.getState().defense,
      run: () => enterDefense(0),
    },
    {
      id: 'views:exit',
      title: 'Salir del modo defensa',
      group: 'Vistas',
      keywords: ['presentacion', 'defensa', 'volver', 'terminar'],
      icon: 'restore-view',
      keys: 'Esc',
      enabled: () => !!useViewsUi.getState().defense,
      run: () => exitDefense(),
    },
    ...views.map(
      (v, i): Command => ({
        id: `views:go:${v.id}`,
        title: `Ir a la vista «${v.name}»`,
        group: 'Vistas',
        keywords: ['vista', 'encuadre', 'tramo', `${i + 1}`],
        icon: 'arrow-right',
        detail: defense && defense.viewIds[defense.index] === v.id ? 'a la vista' : rangeLabel(v.top, v.base),
        run: () => goToView(v.id),
      }),
    ),
    { id: 'doc:defense-step', title: 'Pasar de vista en el modo defensa', group: 'Vistas', keys: '← →' },
  ];
};
