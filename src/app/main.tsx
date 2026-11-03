/**
 * Arranque: instala los tokens de diseño, el tema y el tamaño de interfaz, valida el registro de módulos, inicia el
 * motor y monta la interfaz con la pantalla de Inicio (docs/decisiones/0065), sin pozo: Inicio ofrece cargar uno, abrir un
 * proyecto o ver la demostración. `?inicio=no` (o `?muestras=N`) arranca como antes, en el espacio de trabajo con el pozo
 * de demostración (pruebas de los scripts de `scripts/qa/` y de rendimiento del visor). Si el registro es inválido se muestra el error completo (con todos los
 * problemas) en vez de una pantalla vacía.
 *
 * `#ui` en la URL abre la página de muestra del sistema de diseño (revisión visual).
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initTheme } from '../ui/theme';
import { installTokens } from '../ui/tokens';
import { initUiScale } from '../ui/uiScale';
import '../ui/styles/base.css';
import './styles.css';

installTokens();
initTheme();
initUiScale();

const root = createRoot(document.getElementById('root')!);

async function bootShowcase() {
  const { DesignSystemPage } = await import('../ui/showcase/DesignSystemPage');
  root.render(
    <StrictMode>
      <DesignSystemPage />
    </StrictMode>,
  );
}

async function boot() {
  try {
    const [{ registry }, { App }, { startEngineBridge }, { useProject }, { syntheticWell }, { addWell, createProject }, { installUiSync }, { installHistoryShortcuts }, { useHome }] = await Promise.all([
      import('../modules'),
      import('./App'),
      import('./engineBridge'),
      import('./store/project'),
      import('./demo/syntheticWell'),
      import('../core/state/project'),
      import('./store/uiSync'),
      import('./shell/historyActions'),
      import('./home/store'),
    ]);
    const params = new URLSearchParams(location.search);
    if (params.get('inicio') === 'no' || params.has('muestras')) {
      // `?muestras=50000` genera un pozo sintético más largo (pruebas de rendimiento del visor).
      const requested = Number(params.get('muestras'));
      const demo = syntheticWell(Number.isInteger(requested) && requested >= 100 && requested <= 1_000_000 ? requested : undefined);
      useProject.getState().replace(addWell(createProject('Demostración'), demo.well, demo.zones), 'Pozo de demostración');
    } else {
      useHome.getState().set({ phase: 'open', via: 'boot' });
    }
    installUiSync((id) => registry.get(id) !== undefined);
    installHistoryShortcuts();
    for (const w of registry.warnings) console.warn(`Registro de módulos: ${w}`);
    startEngineBridge(registry);
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  } catch (err) {
    console.error(err);
    root.render(<pre className="boot-error">{err instanceof Error ? err.message : String(err)}</pre>);
  }
}

const showcase = () => location.hash === '#ui';
void (showcase() ? bootShowcase() : boot());
// Entrar o salir de la página de muestra recarga (el motor y los stores arrancan una sola vez).
window.addEventListener('hashchange', (e) => {
  if (new URL(e.oldURL).hash === '#ui' || showcase()) location.reload();
});
