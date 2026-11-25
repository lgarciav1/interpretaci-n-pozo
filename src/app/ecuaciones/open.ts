/** Abrir la pantalla «Ecuaciones» (docs/decisiones/0025). Sin React: lo usan la paleta, la barra y los paneles. */
import { registry } from '../../modules';
import { panelsOpen, useUi } from '../store/ui';

/**
 * Paneles del dock que tienen su propia entrada en «Ecuaciones» (id de pestaña = id de la entrada): los extras y los
 * módulos de panel del registro (0058), cuya pestaña lleva su mismo id.
 */
const DOCK_ENTRIES = new Set(['formation-water', 'mdt', ...registry.panels.map((p) => p.id)]);

/** Módulo o panel que el usuario está mirando: el módulo activo del inspector o, si no hay, la pestaña del dock. */
export function contextEquationId(): string | null {
  const ui = useUi.getState();
  const tab = panelsOpen(ui) && DOCK_ENTRIES.has(ui.dockTab) ? ui.dockTab : null;
  // Con los paneles al costado se ve una sola cosa: la pestaña, si es lo que está a la vista; si no, el módulo del paso.
  if (tab && ui.layout.panels === 'side') return tab;
  return ui.activeModuleId ?? tab;
}

/** Abre «Ecuaciones» en ese módulo; sin id, en el módulo o panel activo (o en el primero). */
export function openEquations(moduleId?: string): void {
  useUi.getState().set({ equations: { moduleId: moduleId ?? contextEquationId() } });
}

export function closeEquations(): void {
  useUi.getState().set({ equations: null });
}
