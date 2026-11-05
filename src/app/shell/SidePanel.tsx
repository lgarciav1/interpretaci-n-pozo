/**
 * Panel lateral derecho (disposición de fábrica, docs/decisiones/0068): UNA columna con dos vistas, el paso del flujo
 * (el inspector) y los paneles (Resumen, Resultados, gráficos de los módulos…), elegidas desde una barra vertical de
 * pestañas pegada al borde derecho. Plegado, queda solo la barra: cada pestaña lo vuelve a abrir.
 *
 * El inspector y los paneles quedan montados (ocultos) al cambiar de vista: no pierden su estado. Los gráficos pesados
 * solo dibujan a la vista (`panelVisible`).
 */
import { useRef, type ReactNode } from 'react';
import { Icon, IconButton, Tooltip, type IconName } from '../../ui';
import { useUi } from '../store/ui';
import { DOCK_PANELS } from './dockPanels';
import { Inspector } from './Inspector';
import { currentPanelId, ExpandableFrame, ExpandButton, PanelBodies, usePanelBadges } from './PanelHost';

const ID_BASE = 'side';
/** Pestaña del paso del flujo (no es un panel del dock). */
export const STEP_TAB = '__step';

interface RailItem {
  id: string;
  title: string;
  icon: IconName;
  badge: ReactNode;
}

/** Barra vertical de pestañas (role="tablist", flechas arriba/abajo, Inicio/Fin) y, al pie, disposición y plegado. */
function Rail({ items, value, collapsed, onSelect }: { items: readonly RailItem[]; value: string; collapsed: boolean; onSelect(id: string): void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const setLayout = useUi((s) => s.setLayout);
  return (
    <nav className="side-rail" aria-label="Vistas del panel lateral">
      <div role="tablist" aria-orientation="vertical" aria-label="Paso y paneles" className="side-rail__tabs">
        {items.map((t, i) => {
          const selected = !collapsed && t.id === value;
          return (
            <Tooltip key={t.id} content={t.title} placement="left" describe={false}>
              <button
                ref={(el) => {
                  refs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`${ID_BASE}-tab-${t.id}`}
                aria-selected={selected}
                aria-controls={collapsed ? undefined : `${ID_BASE}-panel-${t.id}`}
                aria-label={t.title}
                tabIndex={t.id === value ? 0 : -1}
                className={`side-rail__tab${i === 0 ? ' side-rail__tab--step' : ''}`}
                data-testid={`side-tab-${t.id}`}
                onClick={() => onSelect(t.id)}
                onKeyDown={(e) => {
                  const n = items.length;
                  const j = e.key === 'ArrowDown' ? (i + 1) % n : e.key === 'ArrowUp' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
                  if (j < 0) return;
                  e.preventDefault();
                  refs.current[j]?.focus();
                  onSelect(items[j]!.id);
                }}
              >
                <Icon name={t.icon} size={16} />
                {t.badge !== null && t.badge !== undefined && t.badge !== false && <span className="side-rail__badge num">{t.badge}</span>}
              </button>
            </Tooltip>
          );
        })}
      </div>
      <div className="side-rail__foot">
        <IconButton icon="panel-bottom" label="Mover los paneles abajo del perfil" size="sm" data-testid="panels-to-bottom" onClick={() => useUi.getState().placePanels('bottom')} />
        <IconButton
          icon="panel-right"
          label={collapsed ? 'Mostrar el panel lateral' : 'Plegar el panel lateral'}
          size="sm"
          data-testid="side-collapse"
          aria-expanded={!collapsed}
          onClick={() => setLayout({ rightCollapsed: !collapsed })}
        />
      </div>
    </nav>
  );
}

export function SidePanel() {
  const view = useUi((s) => s.sideView);
  const tab = useUi((s) => s.dockTab);
  const collapsed = useUi((s) => s.readingMode || s.layout.rightCollapsed);
  const badges = usePanelBadges();
  const current = currentPanelId(tab);
  const panel = DOCK_PANELS.find((p) => p.id === current)!;
  const items: RailItem[] = [{ id: STEP_TAB, title: 'Paso del flujo', icon: 'check-circle', badge: null }, ...DOCK_PANELS.map((p, i) => ({ id: p.id, title: p.title, icon: p.icon, badge: badges[i] }))];
  const value = view === 'step' ? STEP_TAB : current;

  const select = (id: string) => {
    const ui = useUi.getState();
    if (id === STEP_TAB) ui.set({ sideView: 'step' });
    else ui.set({ dockTab: id, sideView: 'panels' });
    if (collapsed) ui.setLayout({ rightCollapsed: false });
  };

  return (
    <aside className={`shell-side shell-side--right shell-side--panels${collapsed ? ' is-collapsed' : ''}`} aria-label="Paso del flujo y paneles" data-testid="side-panel">
      {!collapsed && (
        <div className="side-views">
          <div className="side-view" role="tabpanel" id={`${ID_BASE}-panel-${STEP_TAB}`} aria-labelledby={`${ID_BASE}-tab-${STEP_TAB}`} hidden={view !== 'step'}>
            <div className="shell-side__scroll">
              <Inspector />
            </div>
          </div>
          <ExpandableFrame className="side-panels" label={panel.title} hidden={view !== 'panels'}>
            <div className="side-panels__inner">
              <header className="side-panels__head">
                <Icon name={panel.icon} size={15} />
                <h2 className="side-panels__title">{panel.title}</h2>
                <span className="shell-spacer" />
                <ExpandButton />
              </header>
              <PanelBodies idBase={ID_BASE} current={current} />
            </div>
          </ExpandableFrame>
        </div>
      )}
      <Rail items={items} value={value} collapsed={collapsed} onSelect={select} />
    </aside>
  );
}
