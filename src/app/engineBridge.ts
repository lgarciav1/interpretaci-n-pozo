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
import { entryPreparationPlan } from '../core/state/preparation';
import { materializePreparation } from '../core/preparation/plan';
import { EngineSupervisor, type WorkerLike } from '../core/engine/supervisor';
import { sameComputation, sameContext, type EngineContext } from '../core/engine/context';
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
        if (active) try {
          const plan = entryPreparationPlan(useProject.getState().project, active, registry);
          if (sameContext(e.result.context, plan.context)) {
            if (e.result.preparation) materializePreparation(active.well, e.result.preparation, e.result.context, registry);
            useResults.setState({ result: e.result, error: null });
          }
        } catch (error) { useResults.setState({ result: null, error: String(error) }); }
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
  let expected: EngineContext | null = null;
  const sync = () => {
    const entry = selectActiveEntry(useProject.getState());
    if (!entry) { expected=null;lastWell=null;useResults.setState({result:null,error:null,busy:false});return; }
    let plan;
    try { plan = entryPreparationPlan(useProject.getState().project, entry, registry); }
    catch (error) { supervisor.cancel(); expected = null; lastWell = null; useResults.setState({ result: null, busy: false, error: error instanceof Error ? error.message : String(error) }); return; }
    const context=plan.context;
    if(sameContext(context,expected)){
      const current = useResults.getState().result;
      if (current?.preparation && current.preparation.plan.stateKey !== plan.stateKey) useResults.setState({ result: { ...current, preparation: { ...current.preparation, plan } } });
      lastWell=entry.well;return;
    }
    const old=useResults.getState().result;
    // Laboratorio/adquisición sin consumidores del motor: mismo engineKey permite conservar todas
    // las salidas y solo volver a vincular el contexto. Nunca se ejecuta ni duplica el cálculo.
    const rebound=old && sameComputation(old.context,context) ? {...old,context,...(old.preparation ? { preparation: { ...old.preparation, plan } } : {})} : null;
    useResults.setState({result:rebound,error:null});
    const inputsChanged=!lastWell || entry.well.id!==lastWell.id || entry.well.depth!==lastWell.depth || entry.well.curves!==lastWell.curves || expected?.inputRevisionId!==context.inputRevisionId || expected?.preparationKey !== context.preparationKey;
    expected=context;lastWell=entry.well;
    if(inputsChanged)supervisor.syncWell(toEngineWell(entry.well),context);
    if(!rebound)supervisor.run(entry.interpretation,context, entry.interpretation.preparation?.nodes.length ? plan : undefined);
  };
  useProject.subscribe(sync);
  sync();
  return supervisor;
}

