/** Identidad de evidencia de laboratorio, separada de la ejecución petrofísica. */
import { engineDecisionKey, identityKey, wellInputKey } from '../engine/context';
import type { Interpretation } from '../interpretation';
import type { DataContext } from './projection';
import { preparationStateKey } from './state';

export interface CalibrationRequest {
  pointSetIds: readonly string[];
  methodVersion: string;
  pairing: { datum: 'MD'; top: number; base: number; windowM: number; aggregation: 'mean' | 'median' };
  /** Composición/densidades y opciones científicas específicas, JSON canónico sin estado de UI. */
  configuration: Readonly<Record<string, number | string | boolean | null>>;
}
export function calibrationKey(data: DataContext, interpretation: Interpretation, request: CalibrationRequest): string {
  if ((data.preparationStateKey !== undefined || interpretation.preparation?.nodes.length) && data.preparationStateKey !== preparationStateKey(interpretation.preparation)) throw new Error('El contexto de preparación de la calibración está obsoleto.');
  if (data.context.engineKey !== wellInputKey(data.engineWell) + '|' + engineDecisionKey(interpretation)) throw new Error('El contexto de calibración está obsoleto.');
  const { pairing } = request;
  if (!request.methodVersion.trim() || pairing.datum !== 'MD' || !['mean', 'median'].includes(pairing.aggregation) ||
    ![pairing.top, pairing.base, pairing.windowM].every(Number.isFinite) || pairing.base <= pairing.top || pairing.windowM < 0 ||
    !request.pointSetIds.length || new Set(request.pointSetIds).size !== request.pointSetIds.length) throw new Error('Configuración de emparejado inválida.');
  if (Object.values(request.configuration).some(v => typeof v === 'number' && !Number.isFinite(v))) throw new Error('Configuración de calibración no finita.');
  const sets = [...request.pointSetIds].sort().map(id => {
    const s = data.well.pointSets.find(s => s.id === id);
    if (!s) throw new Error(`El laboratorio '${id}' ya no está disponible.`);
    return [id, s.kind, s.synthetic ?? false, identityKey(s.depth), s.pointIds, Object.entries(s.columns).sort(([a], [b]) => a.localeCompare(b)).map(([key, c]) =>
      [key, 'unit' in c ? c.unit : null, c.values instanceof Float64Array ? identityKey(c.values) : c.values]), interpretation.pointSets[id] ?? null];
  });
  const canonical = (value: unknown) => JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
  return canonical([data.context.wellId, data.context.depthKey, data.context.preparationKey, data.context.engineKey, sets,
    request.methodVersion, request.pairing, request.configuration]);
}
