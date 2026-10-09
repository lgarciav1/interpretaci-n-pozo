/** Dock del centro: pestañas de paneles acoplables (resultados, avisos, motor; histograma y crossplot en la fase 7). */
import { IconButton, TabPanel, Tabs } from '../../ui';
import { useUi } from '../store/ui';
import { DOCK_PANELS } from './dockPanels';

const ID_BASE = 'dock';

export function Dock() {
  const tab = useUi((s) => s.dockTab);
  const collapsed = useUi((s) => s.layout.dockCollapsed);
  const set = useUi((s) => s.set);
  const setLayout = useUi((s) => s.setLayout);
  // Hooks de insignia: la lista es constante, así que el orden de hooks también.
  const badges = DOCK_PANELS.map((p) => p.useBadge?.() ?? null);
  const current = DOCK_PANELS.some((p) => p.id === tab) ? tab : DOCK_PANELS[0]!.id;

  return (
    <section className={`shell-dock${collapsed ? ' is-collapsed' : ''}`} aria-label="Paneles">
      <div className="shell-dock__bar">
        <Tabs
          aria-label="Paneles del dock"
          idBase={ID_BASE}
          size="sm"
          value={current}
          onChange={(id) => {
            set({ dockTab: id });
            if (collapsed) setLayout({ dockCollapsed: false });
          }}
          items={DOCK_PANELS.map((p, i) => ({ id: p.id, label: p.title, icon: p.icon, badge: badges[i] }))}
        />
        <span className="shell-spacer" />
        <IconButton
          icon={collapsed ? 'chevron-up' : 'chevron-down'}
          label={collapsed ? 'Mostrar paneles' : 'Ocultar paneles'}
          size="sm"
          onClick={() => setLayout({ dockCollapsed: !collapsed })}
        />
      </div>
      <div className="shell-dock__body" hidden={collapsed}>
        {DOCK_PANELS.map((p) => (
          <TabPanel key={p.id} id={p.id} idBase={ID_BASE} active={p.id === current} className="shell-dock__panel">
            <p.component />
          </TabPanel>
        ))}
      </div>
    </section>
  );
}
