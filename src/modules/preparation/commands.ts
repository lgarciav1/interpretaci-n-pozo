/**
 * Acción de la paleta (Ctrl+K) para «Preparar datos» (docs/decisiones/0058, 0018). Se descubre sola
 * (`src/modules/<id>/commands.ts`).
 */
import { openPreparation } from '../../app/preparation/open';
import { selectActiveEntry, useProject } from '../../app/store/project';
import type { CommandSource } from '../../ui';

export const PREPARATION_COMMAND_ID = 'preparation:open';

export const commands: CommandSource = () => [
  {
    id: PREPARATION_COMMAND_ID,
    title: 'Abrir Preparar datos',
    group: 'Pozo',
    keywords: ['preparar', 'limpiar', 'excluir', 'espurios', 'interpolar', 'mediana', 'filtro', 'alinear', 'profundidad', 'corrimiento', 'drx', 'mgt', 'calidad'],
    icon: 'filter',
    enabled: () => !!selectActiveEntry(useProject.getState()),
    run: () => openPreparation(),
  },
];
