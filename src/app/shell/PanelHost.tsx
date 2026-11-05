/**
 * Cuerpo de los paneles (Resumen, Resultados, Avisos, Tendencias y los que aportan los módulos), compartido por el dock
 * de abajo y el panel lateral (docs/decisiones/0068). Una sola lista (`DOCK_PANELS`), un solo lugar donde se montan: la
 * disposición elegida decide el contenedor, no qué paneles hay.
 *
 * «Agrandar» (⤢) no vuelve a montar nada: el mismo contenedor pasa a `position: fixed` sobre el área de trabajo (los
 * gráficos conservan su estado y se enteran del tamaño por su ResizeObserver). Escape o el mismo botón lo devuelven.
 */
import { useEffect, useRef, type ReactNode } from 'react';
import { IconButton, TabPanel } from '../../ui';
import { useUi } from '../store/ui';
import { DOCK_PANELS } from './dockPanels';

/** Pestaña vigente: la elegida si existe; si no, la primera. */
export function currentPanelId(tab: string): string {
  return DOCK_PANELS.some((p) => p.id === tab) ? tab : DOCK_PANELS[0]!.id;
}

/** Botón ⤢ / restaurar del panel agrandado. */
export function ExpandButton() {
  const expanded = useUi((s) => s.panelExpanded);
  return (
    <IconButton
      icon={expanded ? 'restore-view' : 'expand-view'}
      label={expanded ? 'Volver al tamaño normal (Esc)' : 'Agrandar el panel'}
      size="sm"
      aria-pressed={expanded}
      data-testid="panel-expand"
      onClick={() => useUi.setState({ panelExpanded: !expanded })}
    />
  );
}

/**
 * Contenedor que se agranda: Escape lo restaura (sin robarle el Escape a un menú o un arrastre abiertos dentro, que
 * lo detienen antes) y el foco vuelve al botón que lo abrió.
 */
export function ExpandableFrame({ className, label, children, hidden }: { className: string; label: string; children: ReactNode; hidden?: boolean }) {
  const expanded = useUi((s) => s.panelExpanded);
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!expanded) return;
    const opener = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      useUi.setState({ panelExpanded: false });
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [expanded]);
  return (
    <>
      {expanded && <div className="shell-panels__backdrop" aria-hidden="true" onClick={() => useUi.setState({ panelExpanded: false })} />}
      <section ref={ref} hidden={hidden} className={`${className}${expanded ? ' is-expanded' : ''}`} aria-label={label} {...(expanded ? { 'data-expanded': '' } : {})}>
        {children}
      </section>
    </>
  );
}

/** Todos los paneles montados; solo el vigente a la vista (cada uno decide si dibuja estando oculto). */
export function PanelBodies({ idBase, current, hidden }: { idBase: string; current: string; hidden?: boolean }) {
  return (
    <div className="shell-dock__body" hidden={hidden}>
      {DOCK_PANELS.map((p) => (
        <TabPanel key={p.id} id={p.id} idBase={idBase} active={p.id === current} className="shell-dock__panel">
          <p.component />
        </TabPanel>
      ))}
    </div>
  );
}

/** Insignias de las pestañas (hooks: la lista es constante, así que el orden de los hooks también). */
export function usePanelBadges(): ReactNode[] {
  return DOCK_PANELS.map((p) => p.useBadge?.() ?? null);
}
