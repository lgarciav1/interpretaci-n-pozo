/**
 * Una fuente de comparación: un snapshot o la interpretación actual. Para el snapshot se usa la corrida aislada
 * (snapshotEngine); para la actual, el resultado del motor principal que ya está calculado (no se repite el cálculo).
 */
import { useMemo } from 'react';
import type { ClientResult } from '../../core/engine/client';
import type { Interpretation } from '../../core/interpretation';
import { extractSummary, type SummarySide } from '../../core/state/snapshotCompare';
import type { Snapshot, WellEntry } from '../../core/state/project';
import { useResults } from '../store/results';
import { useSnapshotRun } from './snapshotEngine';

/** Id de la fuente «Interpretación actual» (los ids de snapshot empiezan con «snap-»). */
export const CURRENT = '#current';

export type SourceState =
  | { status: 'pending'; label: string; interpretation: Interpretation | null }
  | { status: 'error'; label: string; interpretation: Interpretation | null; message: string }
  | { status: 'ready'; label: string; interpretation: Interpretation; result: ClientResult };

export function sourceLabel(id: string, snapshots: readonly Snapshot[]): string {
  if (id === CURRENT) return 'Interpretación actual';
  return snapshots.find((s) => s.id === id)?.name ?? 'Snapshot borrado';
}

export function useSource(id: string, entry: WellEntry, snapshots: readonly Snapshot[]): SourceState {
  const snap = id === CURRENT ? null : (snapshots.find((s) => s.id === id) ?? null);
  const run = useSnapshotRun(snap, entry.well);
  const main = useResults((s) => s.result);
  const busy = useResults((s) => s.busy);
  const mainError = useResults((s) => s.error);
  const label = sourceLabel(id, snapshots);

  if (id === CURRENT) {
    const interpretation = entry.interpretation;
    if (main && main.wellId === entry.well.id && !busy) return { status: 'ready', label, interpretation, result: main };
    if (mainError && !busy) return { status: 'error', label, interpretation, message: mainError };
    return { status: 'pending', label, interpretation };
  }
  if (!snap) return { status: 'error', label, interpretation: null, message: 'El snapshot ya no existe.' };
  if (!run || run.status === 'pending') return { status: 'pending', label, interpretation: snap.interpretation };
  if (run.status === 'error') return { status: 'error', label, interpretation: snap.interpretation, message: run.message };
  return { status: 'ready', label, interpretation: snap.interpretation, result: run.result };
}

/** Sumario por zona de una fuente lista (memorizado por resultado e interpretación). */
export function useSummary(src: SourceState, depth: Float64Array): SummarySide | null {
  const result = src.status === 'ready' ? src.result : null;
  const zones = src.interpretation?.zones;
  return useMemo(() => (result && zones ? extractSummary(result, zones, depth) : null), [result, zones, depth]);
}
