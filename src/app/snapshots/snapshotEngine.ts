/**
 * Motor de comparación de snapshots: un `IsolatedRunner` sobre un segundo motor en su propio Web Worker (se crea la
 * primera vez que se compara). Lo comparten el diálogo de Snapshots (sumario lado a lado) y la cortina del visor:
 * elegir el mismo snapshot en los dos no vuelve a calcular. Ver docs/decisiones/0026.
 */
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { ClientResult } from '../../core/engine/client';
import type { Project, Snapshot } from '../../core/state/project';
import type { Well } from '../../core/well';
import { registry } from '../../modules';
import { createEngineSupervisor } from '../engineBridge';
import { IsolatedRunner, type RunEntry } from './runner';
import { snapshotRunRequest } from './request';
import { effectiveWell } from '../preparation/data';

const PENDING: RunEntry = { status: 'pending' };

export const snapshotRunner = new IsolatedRunner(() => createEngineSupervisor(registry, 'motor-snapshots'));

const subscribe = (cb: () => void) => snapshotRunner.subscribe(cb);

// Para verificar desde el navegador que arrastrar la cortina no recalcula (lectura, sin efectos).
if (typeof window !== 'undefined') {
  Object.defineProperty(window, '__snapshotRuns', { configurable: true, get: () => snapshotRunner.runCount });
}

/**
 * Corrida del motor sobre los datos fijados por el snapshot (o datos actuales en modo legado). null si no hay
 * snapshot o pozo, o si el snapshot es de otro pozo.
 */
export type SnapshotRunEntry = Exclude<RunEntry, { status: 'ready' }> | { status: 'ready'; result: ClientResult; well: Well; inputRevisionId: string | null };
export function useSnapshotRun(snapshot: Snapshot | null, well: Well | null, project: Project): SnapshotRunEntry | null {
  const selection = useMemo(() => {
    if (!snapshot || !well || snapshot.wellId !== well.id) return { request: null, error: null };
    try { return { request: snapshotRunRequest(project, snapshot), error: null }; }
    catch (err) { return { request: null, error: err instanceof Error ? err.message : String(err) }; }
  }, [snapshot, well, project]);
  const request = selection.request;
  const key = request?.key ?? null;
  useEffect(() => {
    if (!key || !request) return;
    return snapshotRunner.acquire(key, request.engineWell, request.interpretation,request.context,request.preparation);
    // La clave resume snapshot, interpretación y curvas: no hace falta depender de los objetos.
  }, [key]);
  const entry = useSyncExternalStore(
    subscribe,
    () => (key ? (snapshotRunner.get(key) ?? PENDING) : null),
  );
  if (selection.error) return { status: 'error', message: selection.error };
  if (entry?.status === 'ready') return request ? { ...entry, well: effectiveWell(request.well, entry.result), inputRevisionId: request.inputRevisionId } : null;
  return entry;
}

