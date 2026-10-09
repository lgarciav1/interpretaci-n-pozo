/**
 * Recetas puras sobre las tendencias de un pozo (docs/decisiones/0008-tendencias-y-gradientes.md, D2).
 * Se aplican con `useProject.getState().commit(etiqueta, (p) => receta(p, …))`; etiquetas en español con verbo
 * («Agregar tendencia», «Mover tramo de la tendencia», «Excluir punto de la tendencia»).
 * Si nada cambia, devuelven el mismo proyecto (no se registra en el historial).
 */
import type { TrendSpec } from '../trends';
import { getWellEntry, updateInterpretation, type Project } from './project';

/** Cambios admitidos por `updateTrend` (el id no cambia). `undefined` en color o manual los quita. */
export type TrendPatch = Partial<Omit<TrendSpec, 'id'>>;

function mapTrends(project: Project, wellId: string, fn: (list: TrendSpec[]) => TrendSpec[]): Project {
  return updateInterpretation(project, wellId, (i) => {
    const trends = fn(i.trends);
    return trends === i.trends ? i : { ...i, trends };
  });
}

function requireTrend(project: Project, wellId: string, id: string): TrendSpec {
  const t = getWellEntry(project, wellId).interpretation.trends.find((x) => x.id === id);
  if (!t) throw new Error(`No existe la tendencia '${id}'.`);
  return t;
}

export function addTrend(project: Project, wellId: string, spec: TrendSpec): Project {
  if (getWellEntry(project, wellId).interpretation.trends.some((t) => t.id === spec.id)) throw new Error(`Ya hay una tendencia con el id '${spec.id}'.`);
  if (spec.mode === 'manual' && !spec.manual) throw new Error('Una tendencia a mano necesita dos puntos.');
  return mapTrends(project, wellId, (list) => [...list, spec]);
}

const sameValue = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

/** Aplica un parche a una tendencia. Claves con `undefined` se quitan (color propio, puntos a mano, zona…). */
export function updateTrend(project: Project, wellId: string, id: string, patch: TrendPatch): Project {
  const prev = requireTrend(project, wellId, id);
  const next = { ...prev } as TrendSpec & Record<string, unknown>;
  let changed = false;
  for (const [k, v] of Object.entries(patch)) {
    if (sameValue(next[k], v)) continue;
    changed = true;
    if (v === undefined) delete next[k];
    else next[k] = v;
  }
  if (!changed) return project;
  if (next.mode === 'manual' && !next.manual) throw new Error('Una tendencia a mano necesita dos puntos.');
  return mapTrends(project, wellId, (list) => list.map((t) => (t.id === id ? next : t)));
}

export function removeTrend(project: Project, wellId: string, id: string): Project {
  requireTrend(project, wellId, id);
  return mapTrends(project, wellId, (list) => list.filter((t) => t.id !== id));
}

/** Copia una tendencia justo después de la original, con id y nombre nuevos. */
export function duplicateTrend(project: Project, wellId: string, id: string, newId: string, name?: string): Project {
  const src = requireTrend(project, wellId, id);
  const copy: TrendSpec = structuredClone(src);
  copy.id = newId;
  copy.name = name ?? `${src.name} (copia)`;
  delete copy.color; // otro color de la paleta: se distingue de la original
  return mapTrends(project, wellId, (list) => {
    const k = list.findIndex((t) => t.id === id);
    return [...list.slice(0, k + 1), copy, ...list.slice(k + 1)];
  });
}

/** Excluye del ajuste un punto (por su clave estable) o lo vuelve a incluir si ya estaba excluido. */
export function toggleTrendPoint(project: Project, wellId: string, id: string, pointKey: string): Project {
  const t = requireTrend(project, wellId, id);
  const has = t.selection.excluded.includes(pointKey);
  const excluded = has ? t.selection.excluded.filter((k) => k !== pointKey) : [...t.selection.excluded, pointKey];
  return updateTrend(project, wellId, id, { selection: { ...t.selection, excluded } });
}

/** Fija el tramo de profundidad (top < base). Deja de seguir a una zona. */
export function setTrendRange(project: Project, wellId: string, id: string, top: number, base: number): Project {
  const t = requireTrend(project, wellId, id);
  const [a, b] = top <= base ? [top, base] : [base, top];
  const { zoneId: _zone, ...rest } = t.selection;
  return updateTrend(project, wellId, id, { selection: { ...rest, top: a, base: b } });
}

/** Usa una zona como tramo (el tramo la sigue mientras exista). */
export function setTrendZone(project: Project, wellId: string, id: string, zoneId: string): Project {
  const entry = getWellEntry(project, wellId);
  const z = entry.interpretation.zones.find((zz) => zz.id === zoneId);
  if (!z) throw new Error(`No existe la zona '${zoneId}'.`);
  const t = requireTrend(project, wellId, id);
  return updateTrend(project, wellId, id, { selection: { ...t.selection, zoneId, top: z.top, base: z.base } });
}
