/**
 * Panel lateral derecho (disposición de fábrica, docs/decisiones/0068): UNA columna con dos vistas, el paso del flujo
 * (el inspector) y los paneles (Resumen, Resultados, gráficos de los módulos…), elegidas desde una barra vertical de
 * pestañas con rótulo pegada al borde derecho (las fijas y «Más», docs/decisiones/0069). Plegado, queda solo la barra: cada pestaña lo vuelve a abrir.
 *
 * El inspector y los paneles quedan montados (ocultos) al cambiar de vista: no pierden su estado. Los gráficos pesados
 * solo dibujan a la vista (`panelVisible`).
 */
import { useRef, type ReactNode } from 'react';
import { Icon, IconButton, Menu, Tooltip, type IconName, type MenuEntry } from '../../ui';
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
  /** Rótulo corto bajo el ícono (el título completo va en el tooltip). */
  short: string;
  icon: IconName;
  badge: ReactNode;
}

/**
 * Pestañas fijas de la barra, en este orden (docs/decisiones/0069): el resumen y las tablas, y después los módulos
 * obligatorios. El resto de los paneles (los que aporte cualquier módulo, sin registrarse acá) va al menú «Más»; el que
 * esté abierto se suma a la barra mientras se usa. `short` es el rótulo bajo el ícono cuando el título no entra.
 */
export const RAIL_PINNED: readonly { id: string; short?: string; group: 'summary' | 'required' }[] = [
  { id: 'glance', group: 'summary' },
  { id: 'results', short: 'Tablas', group: 'summary' },
  { id: 'diagnostics', group: 'summary' },
  { id: 'crossplot', group: 'required' },
  { id: 'histogram', short: 'Histogr.', group: 'required' },
  { id: 'mdt', short: 'MDT', group: 'required' },
  { id: 'core', group: 'required' },
  { id: 'trends', short: 'Tend.', group: 'required' },
];

const hasBadge = (b: ReactNode) => b !== null && b !== undefined && b !== false;
const shortOf = (title: string) => (title.length > 9 ? `${title.slice(0, 7).trimEnd()}.` : title);

/** Puro: reparte los paneles entre la barra (fijos + el abierto si no es fijo) y el menú «Más». */
export function splitRail<T extends { id: string }>(panels: readonly T[], current: string | null): { pinned: T[]; extra: T | null; more: T[] } {
  const byId = new Map(panels.map((p) => [p.id, p]));
  const pinned = RAIL_PINNED.map((r) => byId.get(r.id)).filter((p): p is T => !!p);
  const more = panels.filter((p) => !RAIL_PINNED.some((r) => r.id === p.id));
  return { pinned, extra: more.find((p) => p.id === current) ?? null, more };
}

const MORE_GROUP_INTERP = new Set([
  'formation-water', 'rock-typing', 'scal', 'swi-pc', 'saturation-height', 'invasion-radial', 'invasion-step',
  'clay-typing', 'mineral-inversion', 'passey-toc', 'electrofacies', 'electrosequences',
  'sed-column', 'synthetic-seismogram',
]);
const MORE_GROUP_DATA = new Set([
  'preparation', 'core-calibration', 'model-tournament', 'digitizer', 'zone-distribution', 'zone-distributions', 'zone-cards', 'zones',
]);

function buildMoreMenu(more: readonly RailItem[], onSelect: (id: string) => void): MenuEntry[] {
  const toEntry = (t: RailItem): MenuEntry => ({
    id: t.id,
    label: t.title,
    icon: t.icon,
    ...(hasBadge(t.badge) ? { hint: t.badge } : {}),
    onSelect: () => onSelect(t.id),
  });
  if (more.length <= 4) {
    return [{ type: 'label', id: 'l', label: 'Más paneles' }, ...more.map(toEntry)];
  }
  const groups: { id: string; label: string; items: RailItem[] }[] = [
    { id: 'interp', label: 'Interpretación y laboratorio', items: more.filter((t) => MORE_GROUP_INTERP.has(t.id)) },
    { id: 'data', label: 'Datos y validación', items: more.filter((t) => MORE_GROUP_DATA.has(t.id)) },
    { id: 'sys', label: 'Consulta y sistema', items: more.filter((t) => !MORE_GROUP_INTERP.has(t.id) && !MORE_GROUP_DATA.has(t.id)) },
  ].filter((g) => g.items.length > 0);
  const entries: MenuEntry[] = [];
  groups.forEach((g, idx) => {
    if (idx > 0) entries.push({ type: 'separator', id: `sep-${g.id}` });
    entries.push({ type: 'label', id: `lbl-${g.id}`, label: g.label }, ...g.items.map(toEntry));
  });
  return entries;
}

/**
 * Barra vertical de pestañas (role="tablist", flechas arriba/abajo, Inicio/Fin) con ícono y rótulo; «Más» abre el
 * resto de los paneles y, al pie, disposición y plegado.
 */
function Rail({ items, more, value, collapsed, onSelect }: { items: readonly (RailItem & { sep?: boolean })[]; more: readonly RailItem[]; value: string; collapsed: boolean; onSelect(id: string): void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const setLayout = useUi((s) => s.setLayout);
  const moreItems = buildMoreMenu(more, onSelect);
  return (
    <nav className="side-rail" aria-label="Vistas del panel lateral">
      <div role="tablist" aria-orientation="vertical" aria-label="Paso y paneles" className="side-rail__tabs">
        {items.map((t, i) => {
          const selected = !collapsed && t.id === value;
          return (
            <Tooltip key={t.id} content={hasBadge(t.badge) ? <>{t.title} ({t.badge})</> : t.title} placement="left" describe={false}>
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
                className={`side-rail__tab${t.sep ? ' side-rail__tab--sep' : ''}`}
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
                <span className="side-rail__label" aria-hidden="true">{t.short}</span>
                {hasBadge(t.badge) && <span className="side-rail__badge num">{t.badge}</span>}
              </button>
            </Tooltip>
          );
        })}
        {more.length > 0 && (
          <Menu
            aria-label="Más paneles"
            minWidth={230}
            items={moreItems}
            trigger={(p) => (
              <button {...p} type="button" className="side-rail__tab side-rail__tab--sep side-rail__more" title="Más paneles: calibración, agua de formación, tipos de roca, preparar datos…" data-testid="side-more">
                <Icon name="more" size={16} />
                <span className="side-rail__label">Más</span>
              </button>
            )}
          />
        )}
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
  const all: RailItem[] = DOCK_PANELS.map((p, i) => ({ id: p.id, title: p.title, short: RAIL_PINNED.find((r) => r.id === p.id)?.short ?? shortOf(p.title), icon: p.icon, badge: badges[i] }));
  const { pinned, extra, more } = splitRail(all, view === 'panels' ? current : null);
  const firstRequired = RAIL_PINNED.find((r) => r.group === 'required' && pinned.some((p) => p.id === r.id))?.id;
  const items: (RailItem & { sep?: boolean })[] = [
    { id: STEP_TAB, title: 'Paso del flujo: parámetros del paso abierto', short: 'Paso', icon: 'sliders', badge: null },
    ...pinned.map((p, i) => ({ ...p, sep: i === 0 || p.id === firstRequired })),
    ...(extra ? [{ ...extra, sep: true }] : []),
  ];
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
      <Rail items={items} more={more} value={value} collapsed={collapsed} onSelect={select} />
    </aside>
  );
}
