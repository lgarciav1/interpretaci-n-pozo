/**
 * Entrar y salir de Inicio (docs/decisiones/0065). Sin React: los llaman la barra superior, la paleta de comandos y la
 * propia pantalla. Nada de esto toca el proyecto: solo el estado de interfaz.
 */
import { useUi } from '../store/ui';
import { useHome } from './store';

/** Abre Inicio desde el espacio de trabajo, con un fundido breve (no repite la entrada al pozo en reversa). */
export function openHome(): void {
  const home = useHome.getState();
  if (home.phase !== 'closed') return;
  // Una sola vista 3D a la vez: el configurador se cierra (su selección queda en su store).
  const ui = useUi.getState();
  if (ui.toolStringOpen) ui.set({ toolStringOpen: false });
  home.set({ phase: 'open', via: 'return' });
}

/** Cierra Inicio en el acto (desmonta la escena y libera su contexto) y devuelve el foco al espacio de trabajo. */
export function closeHome(): void {
  useHome.getState().set({ phase: 'closed' });
  requestAnimationFrame(() => {
    const target = document.querySelector<HTMLElement>('.shell-center [tabindex="0"], .shell-center canvas[tabindex]');
    target?.focus({ preventScroll: true });
  });
}

/** «Explorar sarta»: el configurador existente, con la herramienta elegida en Inicio ya seleccionada. */
export function exploreToolString(): void {
  closeHome();
  useUi.getState().set({ toolStringOpen: true });
}
