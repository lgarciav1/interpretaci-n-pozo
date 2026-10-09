/** Layout de tres zonas: pozo/curvas/zonas · visor (fase 4) · panel del módulo activo. */
import { CATEGORIES } from '../core/workspaces';
import { moduleWorkspaces } from '../core/module';
import { registry } from '../modules';
import { ModulePanelView } from './components/ModulePanelView';
import { ResultsPanel } from './components/ResultsPanel';
import { TopBar } from './components/TopBar';
import { WellPanel } from './components/WellPanel';
import { useUi } from './store/ui';

export function App() {
  const workspace = useUi((s) => s.workspace);
  const activeModuleId = useUi((s) => s.activeModuleId);
  const setUi = useUi((s) => s.set);
  const modules = registry.modules.filter((m) => moduleWorkspaces(m).includes(workspace));
  const active = modules.find((m) => m.id === activeModuleId) ?? modules[0];

  return (
    <div className="app">
      <TopBar />
      <main className="layout">
        <aside className="column" aria-label="Pozo, curvas y zonas">
          <WellPanel />
        </aside>
        <section className="column" aria-label="Visor y resultados">
          <ResultsPanel />
        </section>
        <aside className="column" aria-label="Módulo activo">
          <div className="section">
            <h2>Módulos</h2>
            <div className="module-list">
              {CATEGORIES.flatMap((c) =>
                modules
                  .filter((m) => m.category === c.id)
                  .map((m) => (
                    <button type="button" key={m.id} aria-current={m.id === active?.id} onClick={() => setUi({ activeModuleId: m.id })}>
                      {m.name} <span className="muted">· {c.label}</span>
                    </button>
                  )),
              )}
            </div>
          </div>
          {active ? <ModulePanelView key={active.id} module={active} /> : <div className="section muted">No hay módulos en este espacio de trabajo.</div>}
        </aside>
      </main>
    </div>
  );
}
