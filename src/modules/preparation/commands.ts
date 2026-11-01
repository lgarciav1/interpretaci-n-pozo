/**
 * Acción de la paleta (Ctrl+K) para «Preparar datos» (docs/decisiones/0058, 0018). Se descubre sola
 * (`src/modules/<id>/commands.ts`).
 */
import { openPreparation } from '../../app/preparation/open';
import { selectActiveEntry, useProject } from '../../app/store/project';
import type { CommandSource } from '../../ui';

export const PREPARATION_COMMAND_ID = 'preparation:open';
/** Abre el panel con la herramienta «Normalizar» (0060). */
export const NORMALIZATION_COMMAND_ID = 'preparation:normalize';

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
  {
    id: NORMALIZATION_COMMAND_ID,
    title: 'Normalizar curva',
    group: 'Pozo',
    keywords: ['normalizar', 'normalización', 'calibración', 'escala', 'histograma', 'percentil', 'referencia', 'preparar'],
    icon: 'histogram',
    enabled: () => !!selectActiveEntry(useProject.getState()),
    run: () => openPreparation(null, 'normalize'),
  },
];
