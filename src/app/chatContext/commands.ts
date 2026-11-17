/** Comando de la paleta «Copiar contexto para un chat» (se descubre solo, docs/decisiones/0018). */
import { activeWellEntry } from '../../core/state/project';
import type { Command, CommandSource } from '../../ui';
import { useProject } from '../store/project';
import { copyChatContext } from './actions';

export const commands: CommandSource = () => {
  const entry = activeWellEntry(useProject.getState().project);
  const list: Command[] = [
    {
      id: 'chat-context:copy',
      title: 'Copiar contexto para un chat',
      group: 'Proyecto',
      keywords: ['chat', 'asistente', 'ia', 'copiar', 'contexto', 'resumen', 'portapapeles'],
      icon: 'copy',
      enabled: () => !!entry,
      run: () => { void copyChatContext(); },
    },
  ];
  return list;
};
