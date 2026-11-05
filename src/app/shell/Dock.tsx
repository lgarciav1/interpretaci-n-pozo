/**
 * Dock de abajo (disposición «Paneles abajo», docs/decisiones/0068): pestañas de los paneles (resumen, resultados,
 * avisos, tendencias y las de los módulos: corona, crossplot, histograma, MDT; motor) debajo del visor. La disposición
 * de fábrica los pone en el panel lateral (`SidePanel.tsx`); los dos usan el mismo cuerpo (`PanelHost.tsx`).
 */
import { IconButton, Tabs } from '../../ui';
import { useUi } from '../store/ui';
import { DOCK_PANELS } from './dockPanels';
import { currentPanelId, ExpandableFrame, ExpandButton, PanelBodies, usePanelBadges } from './PanelHost';

const ID_BASE = 'dock';

export function Dock() {
  const tab = useUi((s) => s.dockTab);
  const collapsed = useUi((s) => s.readingMode || s.layout.dockCollapsed);
  const set = useUi((s) => s.set);
  const setLayout = useUi((s) => s.setLayout);
  const badges = usePanelBadges();
  const current = currentPanelId(tab);

  return (
    <ExpandableFrame className={`shell-dock${collapsed ? ' is-collapsed' : ''}`} label="Paneles">
      <div className="shell-dock__bar">
        <Tabs
          aria-label="Paneles del dock"
          idBase={ID_BASE}
          size="sm"
          value={current}
          onChange={(id) => set({ dockTab: id })}
          items={DOCK_PANELS.map((p, i) => ({ id: p.id, label: p.title, icon: p.icon, badge: badges[i] }))}
        />
        <span className="shell-spacer" />
        {!collapsed && <ExpandButton />}
        <IconButton icon="panel-right" label="Mover los paneles al costado del perfil" size="sm" data-testid="panels-to-side" onClick={() => useUi.getState().placePanels('side')} />
        <IconButton
          icon={collapsed ? 'chevron-up' : 'chevron-down'}
          label={collapsed ? 'Mostrar paneles' : 'Ocultar paneles'}
          size="sm"
          onClick={() => setLayout({ dockCollapsed: !collapsed })}
        />
      </div>
      <PanelBodies idBase={ID_BASE} current={current} hidden={collapsed} />
    </ExpandableFrame>
  );
}
