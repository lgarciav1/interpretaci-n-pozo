/**
 * Acción de la paleta de comandos: abrir «Distribuciones por zona» (docs/decisiones/0066). Se descubre sola
 * (`src/modules/<id>/commands.ts`), como `dock.tsx`.
 */
import { selectActiveEntry, useProject } from '../../app/store/project';
import type { CommandSource } from '../../ui';
import { openZoneDistribution } from './dock';

export const commands: CommandSource = () => {
  const entry = selectActiveEntry(useProject.getState());
  return [
    {
      id: 'zone-distribution:open',
      title: 'Ver distribuciones por zona',
      group: 'Gráficos',
      keywords: ['boxplot', 'caja', 'distribucion', 'percentil', 'p10', 'p50', 'p90', 'zona', 'comparar', 'snapshot'],
      icon: 'boxplot',
      enabled: () => !!entry,
      run: openZoneDistribution,
    },
  ];
};
