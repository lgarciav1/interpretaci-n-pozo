/**
 * Puente entre el estado del proyecto y el motor.
 * - Crea el worker (incrustado en el HTML con `?worker&inline`); si falla, usa el motor en proceso.
 * - Cuando cambia el pozo activo → syncWell (solo datos nuevos); cuando cambia su interpretación → run
 *   (el cliente coalesce: gana el último).
 */
import { createInProcessClient, EngineClient } from '../core/engine/client';
import { toEngineWell } from '../core/engine/engine';
import type { Endpoint } from '../core/engine/protocol';
import type { Registry } from '../core/registry';
import type { Interpretation } from '../core/interpretation';
import type { Well } from '../core/well';
import EngineWorker from './engine.worker?worker&inline';
import { selectActiveEntry, useProject } from './store/project';
import { useResults } from './store/results';

let started = false;

/**
 * Inicia el puente. Si el worker falla antes de responder por primera vez (p. ej. el navegador bloquea workers
 * desde Blob en file://), cambia al motor en proceso sin perder el estado.
 */
export function startEngineBridge(registry: Registry): void {
  if (started) throw new Error('El puente del motor ya está iniciado.');
  started = true;

  let client: EngineClient;
  let unsubscribe: () => void = () => {};
  let lastWell: Well | null = null;
  let lastInterp: Interpretation | null = null;

  const sync = () => {
    const entry = selectActiveEntry(useProject.getState());
    if (!entry) return;
    if (entry.well !== lastWell) {
      lastWell = entry.well;
      client.syncWell(toEngineWell(entry.well));
      lastInterp = null; // pozo nuevo o curvas cambiadas: recalcular
    }
    if (entry.interpretation !== lastInterp) {
      lastInterp = entry.interpretation;
      client.run(entry.interpretation);
    }
  };

  const attach = (next: EngineClient, mode: 'worker' | 'in-process') => {
    unsubscribe();
    client = next;
    lastWell = null;
    lastInterp = null;
    useResults.setState({ mode, busy: false });
    unsubscribe = client.subscribe((e) => {
      if (e.type === 'result') useResults.setState({ result: e.result, error: null });
      else if (e.type === 'error') useResults.setState({ error: e.message });
      else useResults.setState({ busy: e.busy });
    });
    sync();
  };

  const fallback = (reason: unknown) => {
    console.warn('El motor corre en el hilo principal (no se pudo usar el Web Worker).', reason);
    client?.dispose();
    attach(createInProcessClient(registry), 'in-process');
  };

  try {
    const worker = new EngineWorker({ name: 'motor' });
    let answered = false;
    worker.addEventListener('message', () => (answered = true), { once: true });
    worker.addEventListener('error', (ev) => {
      if (!answered) fallback(ev.message);
      else useResults.setState({ error: `Error en el worker del motor: ${ev.message || 'desconocido'}` });
    });
    attach(new EngineClient(worker as unknown as Endpoint, () => worker.terminate()), 'worker');
  } catch (err) {
    fallback(err);
  }
  useProject.subscribe(sync);
}
