/**
 * Pestaña del dock «Digitalizar» (docs/decisiones/0063). Se descubre sola (`src/modules/<id>/dock.tsx`); la insignia
 * cuenta las curvas trazadas de la sesión. El componente también monta la mesa a ventana completa.
 */
import type { DockPanelDef } from '../../ui/dockPanel';
import { DIGITIZER_DOCK_ID } from './index';
import { useDigitizer } from './store';
import { DigitizerDockPanel } from './ui/DockPanel';

export const dockPanels: DockPanelDef[] = [
  {
    id: DIGITIZER_DOCK_ID,
    title: 'Digitalizar',
    icon: 'pen',
    component: DigitizerDockPanel,
    useBadge: () => useDigitizer((s) => s.work.curves.filter((c) => c.trace).length || null),
  },
];
