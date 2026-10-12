/** Acciones de la paleta para comparar snapshots (se descubren solas, docs/decisiones/0018 y 0026). */
import { activeWellEntry } from '../../core/state/project';
import { toast, type Command, type CommandSource } from '../../ui';
import { useProject } from '../store/project';
import { useUi } from '../store/ui';
import { closeCurtain, openCurtain } from './actions';

export const commands: CommandSource = () => {
  const project = useProject.getState().project;
  const entry = activeWellEntry(project);
  const snapshots = entry ? project.snapshots.filter((s) => s.wellId === entry.well.id) : [];
  const curtain = useUi.getState().curtain;
  const keywords = ['snapshot', 'cortina', 'antes', 'despues', 'comparar', 'versiones', 'visor'];
  const list: Command[] = [
    {
      id: 'snapshots:curtain',
      title: 'Comparar con snapshot…',
      group: 'Proyecto',
      keywords,
      icon: 'curtain',
      enabled: () => !!entry,
      // Con un solo snapshot, directo a la cortina; con varios, el diálogo para elegir (botón «Cortina» de cada fila).
      run: () => {
        if (snapshots.length === 0) toast({ title: 'Todavía no hay snapshots de este pozo', description: 'Guardá uno desde «Snapshots» antes de comparar.', tone: 'info' });
        else if (snapshots.length === 1) openCurtain(snapshots[0]!.id);
        else useUi.getState().set({ snapshotsOpen: true });
      },
    },
    ...[...snapshots].reverse().map(
      (s): Command => ({
        id: `snapshots:curtain:${s.id}`,
        title: `Cortina antes/después con «${s.name}»`,
        group: 'Proyecto',
        keywords,
        icon: 'curtain',
        ...(curtain?.snapshotId === s.id ? { detail: 'abierta' } : {}),
        run: () => openCurtain(s.id),
      }),
    ),
  ];
  if (curtain) list.push({ id: 'snapshots:curtain-close', title: 'Cerrar la cortina antes/después', group: 'Proyecto', keywords, icon: 'x', run: closeCurtain });
  return list;
};
