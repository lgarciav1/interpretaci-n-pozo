/**
 * Abrir el panel «Preparar datos» del dock (docs/decisiones/0058). Sin React: lo usan la columna izquierda, el paso
 * Calidad del flujo guiado y la paleta de comandos. El panel vive en `src/modules/preparation/` (pestaña con el id del
 * módulo); acá solo se elige la pestaña, se despliega el dock (con alto suficiente para el gráfico) y, si se pide, la
 * curva.
 */
import { PREPARATION_DOCK_ID } from '../../modules/preparation';
import { getUiScaleFactor } from '../../ui';
import { LAYOUT_LIMITS, useUi } from '../store/ui';
import { usePreparationUi } from './store';

/** Alto mínimo del dock para ver tarjetas, tubería y gráfico sin desplazarse (px de Compacto). */
export const PREPARATION_DOCK_HEIGHT = 460;

let seq = 0;

/** `tool`: herramienta que se abre directamente (p. ej. «normalize» desde la paleta). */
export function openPreparation(curveId: string | null = null, tool: string | null = null): void {
  usePreparationUi.setState({ request: { curveId, seq: ++seq, ...(tool ? { tool } : {}) } });
  const ui = useUi.getState();
  ui.set({ dockTab: PREPARATION_DOCK_ID });
  // Con los paneles al costado (0068) la preparación (tarjetas, tubería y gráfico) necesita ancho: se abre agrandada.
  if (ui.layout.panels === 'side') {
    useUi.setState({ panelExpanded: true });
    return;
  }
  // Despliega el dock (también sale del modo lectura) y, si está bajo o en automático, le da alto para el gráfico.
  // Nunca más del 55 % de la ventana: el visor sigue a la vista. El store guarda px de Compacto (× factor en pantalla).
  const { dockAuto, dockHeight } = ui.layout;
  const screen = typeof window === 'undefined' ? 900 : window.innerHeight;
  const want = Math.round(Math.min(PREPARATION_DOCK_HEIGHT, (screen * 0.55) / getUiScaleFactor()));
  const grow = dockAuto || dockHeight < want;
  ui.setLayout({ dockCollapsed: false, ...(grow ? { dockAuto: false, dockHeight: Math.min(LAYOUT_LIMITS.dock.max, Math.max(dockHeight, want)) } : {}) });
}
