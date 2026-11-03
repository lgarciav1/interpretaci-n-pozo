/** Inicio en la paleta de comandos (docs/decisiones/0065): volver a la pantalla de Inicio sin perder el trabajo. */
import type { CommandSource } from '../../ui';
import { openHome } from './actions';
import { useHome } from './store';

export const commands: CommandSource = () =>
  useHome.getState().phase === 'closed'
    ? [{ id: 'home:open', title: 'Ir a Inicio', group: 'Vista', keywords: ['inicio', 'portada', 'sarta 3d', 'entrar al pozo'], icon: 'tool-string', run: openHome }]
    : [];
