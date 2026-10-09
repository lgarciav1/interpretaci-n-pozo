/**
 * Arranque: instala los tokens de diseño y el tema, valida el registro de módulos, carga el pozo de demostración,
 * inicia el motor y monta la interfaz. Si el registro es inválido se muestra el error completo (con todos los
 * problemas) en vez de una pantalla vacía.
 *
 * `#ui` en la URL abre la página de muestra del sistema de diseño (revisión visual).
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initTheme } from '../ui/theme';
import { installTokens } from '../ui/tokens';
import '../ui/styles/base.css';
import './styles.css';

installTokens();
initTheme();

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
    const [{ registry }, { App }, { startEngineBridge }, { useProject }, { syntheticWell }, { addWell, createProject }] = await Promise.all([
      import('../modules'),
      import('./App'),
      import('./engineBridge'),
      import('./store/project'),
      import('./demo/syntheticWell'),
      import('../core/state/project'),
    ]);
    const demo = syntheticWell();
    useProject.getState().replace(addWell(createProject('Demostración'), demo.well, demo.zones), 'Pozo de demostración');
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
