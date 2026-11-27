/** Comando de la paleta para abrir el panel «Coherencia cruzada entre herramientas» (G08). */
import { useUi } from '../../app/store/ui';
import type { CommandSource } from '../../ui';
import { CROSS_CHECK_DOCK_ID } from './model';

export const commands: CommandSource = () => [
  {
    id: 'cross-check:open',
    title: 'Coherencia cruzada entre herramientas',
    group: 'Sumario',
    keywords: ['coherencia', 'semáforo', 'auditoría', 'defensa', 'Archie', 'SCAL', 'RMN', 'CMR', 'MDT', 'MICP', 'sello', 'uranio', 'movilidad'],
    icon: 'check',
    run: () => {
      useUi.getState().openPanel(CROSS_CHECK_DOCK_ID);
    },
  },
];
