import { panelVisible, useUi } from '../../app/store/ui';
import type { CommandSource } from '../../ui';
import { CALIBRATION_DOCK_ID } from './model';

export const FORMATION_FACTOR_HEADING_ID = 'core-calibration-formation-factor';

export const commands: CommandSource = () => [
  {
    id: 'core-calibration:formation-factor',
    title: 'Factor de formación (F)',
    group: 'Calibración',
    keywords: ['FF', 'Archie', 'cementación', 'exponente m', 'corona', 'plugs', 'formación Ro/Rw'],
    icon: 'layers',
    run: () => {
      useUi.getState().openPanel(CALIBRATION_DOCK_ID);
      // El panel puede estar plegado o cambiar de contenedor al abrirse.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (!panelVisible(useUi.getState(), CALIBRATION_DOCK_ID)) return;
        const heading = document.getElementById(FORMATION_FACTOR_HEADING_ID);
        heading?.scrollIntoView({ block: 'start', inline: 'nearest' });
        heading?.focus({ preventScroll: true });
      }));
    },
  },
];
