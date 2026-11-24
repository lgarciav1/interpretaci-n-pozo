/** Acción de la paleta para la pantalla «Ecuaciones» (se descubre sola, docs/decisiones/0018). */
import type { CommandSource } from '../../ui';
import { contextEquationId, openEquations } from './open';
import { registry } from '../../modules';
import { parameterCommands } from './parameterCommands';

export const commands: CommandSource = () => {
  const id = contextEquationId();
  const name = id ? (registry.get(id)?.name ?? registry.getPanel(id)?.name ?? null) : null;
  return [
    {
      id: 'help:equations',
      title: 'Abrir las ecuaciones de los métodos',
      group: 'Ayuda',
      keywords: ['ecuaciones', 'formulas', 'metodos', 'referencias', 'bibliografia', 'documentacion', 'latex', 'parametros'],
      icon: 'sigma',
      ...(name ? { detail: name } : {}),
      run: () => openEquations(),
    },
    ...parameterCommands,
  ];
};
