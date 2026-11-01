/**
 * Abrir el panel «Preparar datos» del dock (docs/decisiones/0058). Sin React: lo usan la columna izquierda, el paso
 * Calidad del flujo guiado y la paleta de comandos. El panel vive en `src/modules/preparation/` (pestaña con el id del
 * módulo); acá solo se elige la pestaña, se despliega el dock (con alto suficiente para el gráfico) y, si se pide, la
 * curva.
 */
import { PREPARATION_DOCK_ID } from '../../modules/preparation';
import { LAYOUT_LIMITS, useUi } from '../store/ui';
import { usePreparationUi } from './store';

/** Alto mínimo del dock para ver tarjetas, tubería y gráfico sin desplazarse (px de Compacto). */
export const PREPARATION_DOCK_HEIGHT = 460;

let seq = 0;

export function openPreparation(curveId: string | null = null): void {
  usePreparationUi.setState({ request: { curveId, seq: ++seq } });
  const ui = useUi.getState();
  ui.set({ dockTab: PREPARATION_DOCK_ID });
  // Despliega el dock (también sale del modo lectura) y, si está bajo o en automático, le da alto para el gráfico.
  // Nunca más de la mitad larga de la ventana: el visor sigue a la vista.
  const { dockAuto, dockHeight } = ui.layout;
  const want = Math.round(Math.min(PREPARATION_DOCK_HEIGHT, (typeof window === 'undefined' ? 900 : window.innerHeight) * 0.55));
  const grow = dockAuto || dockHeight < want;
  ui.setLayout({ dockCollapsed: false, ...(grow ? { dockAuto: false, dockHeight: Math.min(LAYOUT_LIMITS.dock.max, Math.max(dockHeight, want)) } : {}) });
}
