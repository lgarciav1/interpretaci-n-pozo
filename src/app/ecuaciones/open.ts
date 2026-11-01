/** Abrir la pantalla «Ecuaciones» (docs/decisiones/0025). Sin React: lo usan la paleta, la barra y los paneles. */
import { registry } from '../../modules';
import { useUi } from '../store/ui';

/**
 * Paneles del dock que tienen su propia entrada en «Ecuaciones» (id de pestaña = id de la entrada): los extras y los
 * módulos de panel del registro (0058), cuya pestaña lleva su mismo id.
 */
const DOCK_ENTRIES = new Set(['formation-water', ...registry.panels.map((p) => p.id)]);

/** Módulo o panel que el usuario está mirando: el módulo activo del inspector o, si no hay, la pestaña del dock. */
export function contextEquationId(): string | null {
  const { activeModuleId, dockTab, layout } = useUi.getState();
  if (activeModuleId) return activeModuleId;
  if (!layout.dockCollapsed && DOCK_ENTRIES.has(dockTab)) return dockTab;
  return null;
}

/** Abre «Ecuaciones» en ese módulo; sin id, en el módulo o panel activo (o en el primero). */
export function openEquations(moduleId?: string): void {
  useUi.getState().set({ equations: { moduleId: moduleId ?? contextEquationId() } });
}

export function closeEquations(): void {
  useUi.getState().set({ equations: null });
}
