/** Acción de la paleta para el «Manual de uso» (se descubre sola, docs/decisiones/0018). */
import type { CommandSource } from '../../ui';
import { openManual } from './open';

export const commands: CommandSource = () => [
  {
    id: 'help:manual',
    title: 'Abrir el manual de uso',
    group: 'Ayuda',
    keywords: ['manual', 'guia', 'ayuda', 'documentacion', 'pdf', 'tutorial', 'instrucciones', 'html'],
    icon: 'book',
    run: () => openManual(),
  },
];
