/**
 * Puente entre el estado del proyecto y el motor.
 * - El `EngineSupervisor` (core) corre el motor en un Web Worker incrustado en el HTML (`?worker&inline`) y, si el
 *   worker no arranca o se cae, lo recrea o pasa al motor en proceso, reenviando pozo y último pedido.
 * - Cuando cambia el pozo activo → syncWell (solo datos nuevos); cuando cambian las entradas del motor de su
 *   interpretación → run (el cliente coalesce: gana el último). Un cambio solo de tendencias no pide cálculo.
 * - Al cambiar de pozo (generación nueva) se borra el resultado: nunca conviven arrays de un pozo con la
 *   profundidad de otro. Además se ignora cualquier resultado cuyo pozo no sea el activo.
 */
import { createInProcessClient } from '../core/engine/client';
import { toEngineWell } from '../core/engine/engine';
import { EngineSupervisor, type WorkerLike } from '../core/engine/supervisor';
import { sameEngineInputs, type Interpretation } from '../core/interpretation';
import type { Registry } from '../core/registry';
import type { Well } from '../core/well';
import EngineWorker from './engine.worker?worker&inline';
import { selectActiveEntry, useProject } from './store/project';
import { useResults } from './store/results';

let started = false;

/**
 * Supervisor de un motor en su propio Web Worker (con alternativa en proceso). Lo usan el motor principal y el de
 * comparación de snapshots (src/app/snapshots/snapshotEngine.ts, docs/decisiones/0026), que corre aparte para no
 * tocar la caché ni el estado del principal.
 */
export function createEngineSupervisor(registry: Registry, name = 'motor'): EngineSupervisor {
  return new EngineSupervisor({
    createWorker: () => new EngineWorker({ name }) as unknown as WorkerLike,
    // En desarrollo el motor verifica que ningún módulo escriba en sus entradas.
    createInProcess: () => createInProcessClient(registry, { checkInputs: import.meta.env.DEV }),
    log: (msg) => console.warn(msg),
  });
}

export function startEngineBridge(registry: Registry): EngineSupervisor {
  if (started) throw new Error('El puente del motor ya está iniciado.');
  started = true;

  const supervisor = createEngineSupervisor(registry);

  supervisor.subscribe((e) => {
    switch (e.type) {
      case 'result': {
        const active = selectActiveEntry(useProject.getState());
        if (active && e.result.wellId === active.well.id) useResults.setState({ result: e.result, error: null });
        break;
      }
      case 'reset':
        useResults.setState({ result: null, error: null });
        break;
      case 'error':
        useResults.setState({ error: e.message });
        break;
      case 'busy':
        useResults.setState({ busy: e.busy });
        break;
      case 'mode':
        useResults.setState({ mode: e.mode });
        break;
    }
  });
  useResults.setState({ mode: supervisor.currentMode });

  let lastWell: Well | null = null;
  let lastInterp: Interpretation | null = null;
  const sync = () => {
    const entry = selectActiveEntry(useProject.getState());
    if (!entry) return;
    // El motor solo lee id, profundidad y curvas: cargar o borrar un conjunto de puntos (presiones MDT) cambia el
    // objeto pozo pero no pide sincronizar ni recalcular.
    const w = entry.well;
    if (!lastWell || w.id !== lastWell.id || w.depth !== lastWell.depth || w.curves !== lastWell.curves) {
      lastWell = entry.well;
      supervisor.syncWell(toEngineWell(entry.well));
      lastInterp = null; // pozo nuevo o curvas cambiadas: recalcular
    } else lastWell = w;
    if (entry.interpretation !== lastInterp) {
      // Solo cambió algo que el motor no lee (tendencias): no hace falta calcular.
      const skip = lastInterp !== null && sameEngineInputs(lastInterp, entry.interpretation);
      lastInterp = entry.interpretation;
      if (!skip) supervisor.run(entry.interpretation);
    }
  };
  useProject.subscribe(sync);
  sync();
  return supervisor;
}
