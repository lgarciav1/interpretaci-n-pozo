/**
 * Acciones del perfil radial para la paleta de comandos (docs/decisiones/0018 y 0020): abrir la pestaña y fijar o
 * soltar la profundidad que muestra. Se descubre solo (`src/modules/<id>/commands.ts`), como `dock.tsx`.
 */
import { selectActiveEntry, useProject } from '../../app/store/project';
import { useUi } from '../../app/store/ui';
import { useViewer } from '../../app/store/viewer';
import type { Command, CommandSource } from '../../ui';
import { RADIAL_DOCK_ID } from './dock';
import { getRadialPin, pinRadialDepth } from './pin';
import { nearestSampleIndex } from './radial';

const open = () => {
  useUi.getState().set({ dockTab: RADIAL_DOCK_ID });
  useUi.getState().setLayout({ dockCollapsed: false });
};

export const commands: CommandSource = () => {
  const entry = selectActiveEntry(useProject.getState());
  const pin = getRadialPin();
  const pinned = !!entry && pin.wellId === entry.well.id && pin.pinnedDepth !== null;
  return [
    {
      id: 'radial:open',
      title: 'Ver perfil radial de invasión',
      group: 'Gráficos',
      keywords: ['radial', 'invasion', 'rxo', 'diametro', 'di', 'at10', 'at90', 'induccion', 'arreglo', 'tornado', 'zona lavada'],
      icon: 'radial',
      enabled: () => !!entry,
      run: open,
    },
    {
      id: 'radial:pin',
      title: pinned ? 'Soltar la profundidad del perfil radial' : 'Fijar la profundidad del perfil radial',
      group: 'Gráficos',
      keywords: ['radial', 'invasion', 'fijar', 'soltar', 'profundidad', 'cursor'],
      icon: 'pin',
      enabled: () => !!entry,
      run: () => {
        const e = selectActiveEntry(useProject.getState());
        if (!e) return;
        if (pinned) {
          pinRadialDepth(e.well.id, null);
          return;
        }
        const depth = e.well.depth.values;
        const p = getRadialPin();
        const vis = useViewer.getState().visible;
        const d = useViewer.getState().cursorDepth ?? (p.wellId === e.well.id ? p.lastDepth : null) ?? (vis ? (vis.top + vis.base) / 2 : depth[depth.length >> 1]!);
        const i = nearestSampleIndex(depth, d);
        if (i >= 0) pinRadialDepth(e.well.id, depth[i]!);
        open();
      },
    } satisfies Command,
  ];
};
