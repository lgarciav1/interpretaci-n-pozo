/**
 * Motor de comparación de snapshots: un `IsolatedRunner` sobre un segundo motor en su propio Web Worker (se crea la
 * primera vez que se compara). Lo comparten el diálogo de Snapshots (sumario lado a lado) y la cortina del visor:
 * elegir el mismo snapshot en los dos no vuelve a calcular. Ver docs/decisiones/0026.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { toEngineWell } from '../../core/engine/engine';
import type { Snapshot } from '../../core/state/project';
import type { Well } from '../../core/well';
import { registry } from '../../modules';
import { createEngineSupervisor } from '../engineBridge';
import { IsolatedRunner, runKey, type RunEntry } from './runner';

const PENDING: RunEntry = { status: 'pending' };

export const snapshotRunner = new IsolatedRunner(() => createEngineSupervisor(registry, 'motor-snapshots'));

const subscribe = (cb: () => void) => snapshotRunner.subscribe(cb);

// Para verificar desde el navegador que arrastrar la cortina no recalcula (lectura, sin efectos).
if (typeof window !== 'undefined') {
  Object.defineProperty(window, '__snapshotRuns', { configurable: true, get: () => snapshotRunner.runCount });
}

/**
 * Corrida del motor con la interpretación del snapshot sobre las curvas medidas del pozo activo. null si no hay
 * snapshot o pozo, o si el snapshot es de otro pozo.
 */
export function useSnapshotRun(snapshot: Snapshot | null, well: Well | null): RunEntry | null {
  const valid = !!snapshot && !!well && snapshot.wellId === well.id;
  const key = valid ? runKey(snapshot.id, snapshot.interpretation, { id: well.id, depth: well.depth.values, curves: well.curves }) : null;
  useEffect(() => {
    if (!key || !snapshot || !well) return;
    return snapshotRunner.acquire(key, toEngineWell(well), snapshot.interpretation);
    // La clave resume snapshot, interpretación y curvas: no hace falta depender de los objetos.
  }, [key]);
  return useSyncExternalStore(
    subscribe,
    () => (key ? (snapshotRunner.get(key) ?? PENDING) : null),
  );
}
