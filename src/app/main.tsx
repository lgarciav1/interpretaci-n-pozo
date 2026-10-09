/**
 * Arranque: valida el registro de módulos, carga el pozo de demostración, inicia el motor y monta la interfaz.
 * Si el registro es inválido se muestra el error completo (con todos los problemas) en vez de una pantalla vacía.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const root = createRoot(document.getElementById('root')!);

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

void boot();
