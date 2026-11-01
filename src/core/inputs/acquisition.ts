/** Metadatos declarados de adquisición. Desconocido nunca significa cero o «ya corregido». */
import type { Well } from '../well';
import { requireArray, requireShape, requireText } from './validation';

export interface AcquisitionEffect {
  effect: string;
  method: string;
  version: string | null;
  reference: string;
}
export interface AcquisitionRun {
  id: string;
  curveIds: string[];
  tool: { catalogId: string | null; vendor: string | null; model: string | null };
  corrections: { status: 'unknown' | 'declared'; effects: AcquisitionEffect[] };
  mud: { salinityPpmNaClEquivalent: number | null; resistivityOhmM: number | null; temperatureC: number | null };
}
export interface AcquisitionMetadata {
  schemaVersion: 1;
  depth: { kind: 'MD'; datum: string | null };
  runs: AcquisitionRun[];
}

export function unknownAcquisition(): AcquisitionMetadata {
  return { schemaVersion: 1, depth: { kind: 'MD', datum: null }, runs: [] };
}

export function validateAcquisition(value: unknown, well: Well): asserts value is AcquisitionMetadata {
  const a = requireShape(value, 'Adquisición', ['schemaVersion', 'depth', 'runs']);
  if (a.schemaVersion !== 1) throw new Error('Adquisición: versión de esquema no admitida.');
  const depth = requireShape(a.depth, 'Adquisición.depth', ['kind', 'datum']);
  if (depth.kind !== 'MD') throw new Error('Adquisición: se requiere profundidad MD.');
  if (depth.datum !== null) requireText(depth.datum, 'Datum');
  requireArray(a.runs, 'Corridas');
  const ids = new Set<string>();
  const assigned = new Set<string>();
  const curves = new Set(well.curves.map((c) => c.id));
  for (const raw of a.runs) {
    const run = requireShape(raw, 'Corrida', ['id', 'curveIds', 'tool', 'corrections', 'mud']);
    requireText(run.id, 'Corrida.id');
    if (ids.has(run.id)) throw new Error(`Corrida repetida '${run.id}'.`);
    ids.add(run.id);
    requireArray(run.curveIds, 'Curvas de corrida');
    for (const id of run.curveIds) {
      requireText(id, 'Id de curva de corrida');
      if (!curves.has(id)) throw new Error(`La corrida refiere a una curva inexistente '${id}'.`);
      if (assigned.has(id)) throw new Error(`La curva '${id}' aparece en más de una asignación de corrida.`);
      assigned.add(id);
    }
    const tool = requireShape(run.tool, 'Herramienta', ['catalogId', 'vendor', 'model']);
    for (const [key, v] of Object.entries(tool)) if (v !== null) requireText(v, `Herramienta.${key}`);
    const corrections = requireShape(run.corrections, 'Correcciones adquiridas', ['status', 'effects']);
    if (corrections.status !== 'unknown' && corrections.status !== 'declared') throw new Error('Estado de correcciones adquiridas inválido.');
    requireArray(corrections.effects, 'Efectos adquiridos');
    if (corrections.status === 'unknown' && corrections.effects.length) throw new Error('Correcciones desconocidas no pueden declarar efectos aplicados.');
    for (const raw of corrections.effects) {
      const effect = requireShape(raw, 'Efecto adquirido', ['effect', 'method', 'version', 'reference']);
      for (const key of ['effect', 'method', 'reference']) requireText(effect[key], `Efecto.${key}`);
      if (effect.version !== null) requireText(effect.version, 'Versión del efecto');
    }
    const mud = requireShape(run.mud, 'Lodo', ['salinityPpmNaClEquivalent', 'resistivityOhmM', 'temperatureC']);
    for (const [key, v] of Object.entries(mud)) {
      if (v === null) continue;
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`Lodo.${key}: valor no finito.`);
      if ((key === 'salinityPpmNaClEquivalent' && v < 0) || (key === 'resistivityOhmM' && v <= 0) || (key === 'temperatureC' && v <= -273.15)) throw new Error(`Lodo.${key}: valor fuera de dominio.`);
    }
  }
}
