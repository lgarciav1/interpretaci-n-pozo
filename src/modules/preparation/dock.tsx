/**
 * Panel del dock «Preparar datos» (docs/decisiones/0058). Se descubre solo (`src/modules/<id>/dock.tsx`); la insignia
 * cuenta las recetas guardadas del pozo activo.
 */
import type { DockPanelDef } from '../../ui/dockPanel';
import { selectActiveEntry, useProject } from '../../app/store/project';
import { PREPARATION_DOCK_ID } from './index';
import { PreparationPanel } from './PreparationPanel';

export const dockPanels: DockPanelDef[] = [
  {
    id: PREPARATION_DOCK_ID,
    title: 'Preparar datos',
    icon: 'filter',
    component: PreparationPanel,
    useBadge: () => useProject((s) => selectActiveEntry(s)?.interpretation.preparation?.nodes.length || null),
  },
];
