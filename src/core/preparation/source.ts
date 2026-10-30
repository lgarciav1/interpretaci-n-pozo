/** Espacio de nombres de artefactos; SourceRef conserva su representación v6/v7. */
import type { SourceRef } from '../interpretation';

export const PREPARED_PREFIX = 'prep:';
export const isPreparedId = (id: string): boolean => id.startsWith(PREPARED_PREFIX);
export const isPreparedSource = (ref: SourceRef | undefined): boolean => ref?.kind === 'curve' && isPreparedId(ref.curveId);

export function preparedCurveId(nodeId: string, outputKey: string): string {
  if (![nodeId, outputKey].every(s => /^[a-zA-Z0-9_-]+$/.test(s))) throw new Error('Identificador de preparación inválido.');
  return `${PREPARED_PREFIX}${nodeId}:${outputKey}`;
}
