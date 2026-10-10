/**
 * Contrato de un panel del dock (la franja de pestañas debajo del visor). La app tiene los suyos (Resultados, Avisos,
 * Tendencias, Motor) y un módulo puede aportar más sin tocar la app: `src/modules/<id>/dock.tsx` que exporte
 * `export const dockPanels: DockPanelDef[] = [{ id, title, icon, component }]` (descubierto solo, como los paneles a
 * medida y las superposiciones). Vive en `ui/` porque es React: las definiciones puras de módulo no lo importan.
 */
import type { ComponentType, ReactNode } from 'react';
import type { IconName } from './components/Icon';

export interface DockPanelDef {
  /** Único (va en `useUi.dockTab`). */
  id: string;
  title: string;
  icon: IconName;
  component: ComponentType;
  /** Hook opcional: contador o marca junto al título. */
  useBadge?: () => ReactNode;
}
