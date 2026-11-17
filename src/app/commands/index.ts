/**
 * Descubrimiento de las acciones de la paleta de comandos (docs/decisiones/0018). Cada `commands.ts` de una carpeta de
 * `src/app/` o de un módulo (`src/modules/<id>/commands.ts`) exporta `commands: CommandSource` (una función que
 * devuelve las acciones, o una lista fija) y se registra solo, igual que `dock.tsx` con `dockPanels`. Se importa una
 * vez desde `App.tsx`.
 */
import { registerCommandSource, sourceOf, type Command, type CommandSource } from '../../ui';
import { useUi } from '../store/ui';

const found = import.meta.glob<{ commands?: unknown }>(['../*/commands.ts', '../../modules/*/commands.ts'], { eager: true });

/**
 * Fuentes válidas de un conjunto de archivos (puro: recibe lo que encontró el glob). Un archivo que no exporta
 * `commands` se ignora con un aviso en la consola.
 */
export function collectCommandSources(files: Record<string, { commands?: unknown }>): { path: string; source: CommandSource }[] {
  const out: { path: string; source: CommandSource }[] = [];
  for (const [path, mod] of Object.entries(files)) {
    const source = sourceOf(mod.commands);
    if (!source) {
      console.warn(`${path} no exporta 'commands' (una función que devuelve Command[]); se ignora.`);
      continue;
    }
    out.push({ path, source });
  }
  return out;
}

/**
 * Durante el modo defensa (docs/decisiones/0075, punto 6) no se edita: la paleta y los atajos de las acciones
 * descubiertas se reducen al grupo «Vistas» (pasar de vista, salir). Deshacer, Armar pistas, plantillas… vuelven al salir.
 */
export const DEFENSE_GROUP = 'Vistas';
export function whilePresenting(list: readonly Command[], presenting: boolean): readonly Command[] {
  return presenting ? list.filter((c) => c.group === DEFENSE_GROUP) : list;
}

for (const { path, source } of collectCommandSources(found)) registerCommandSource(path, () => whilePresenting(source(), useUi.getState().presenting));
