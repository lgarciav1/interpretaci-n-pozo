/**
 * Historial de deshacer/rehacer del proyecto. Puro: sin React ni zustand; el tiempo entra como parámetro.
 *
 * - Cada entrada guarda el proyecto ANTERIOR a un cambio (barato: los proyectos son inmutables y comparten
 *   estructura; los arrays de datos nunca se copian) y la etiqueta del cambio («Mover tope de C»).
 * - Un cambio nuevo vacía el futuro. Hay a lo sumo `HISTORY_LIMIT` entradas: las más viejas se descartan.
 * - Agrupado: cambios consecutivos con la MISMA etiqueta separados por menos de `GROUP_MS` se funden en una
 *   entrada (sliders, ↑/↓ de un campo, topes movidos con el teclado). La entrada conserva el proyecto anterior al
 *   primero, así un deshacer vuelve al valor inicial. La ventana se mide desde el último cambio del grupo.
 * - Deshacer o rehacer corta el grupo: el próximo cambio abre una entrada nueva aunque tenga la misma etiqueta.
 */
import type { Project } from './project';

export interface HistoryEntry {
  /** Proyecto a restaurar. */
  project: Project;
  /** Qué cambio se deshace (o rehace) con esta entrada. */
  label: string;
  /** Momento del primer cambio de la entrada (ms). */
  at: number;
}

export interface History {
  /** Lo que se puede deshacer; el último es el más reciente. */
  past: readonly HistoryEntry[];
  /** Lo que se puede rehacer; el último es el próximo a rehacer. */
  future: readonly HistoryEntry[];
  /** Último cambio registrado (para agrupar), o null si se cortó el grupo. */
  last: { label: string; at: number } | null;
}

export const HISTORY_LIMIT = 100;
/** Ventana de agrupado (ms) entre cambios con la misma etiqueta. */
export const GROUP_MS = 800;

export function emptyHistory(): History {
  return { past: [], future: [], last: null };
}

/**
 * Registra un cambio ya aplicado: `prev` es el proyecto de antes. Si continúa el grupo abierto (misma etiqueta,
 * dentro de la ventana), no agrega entrada: la de arriba ya guarda el proyecto anterior al primer cambio.
 */
export function recordChange(h: History, prev: Project, label: string, now: number, limit = HISTORY_LIMIT): History {
  const top = h.past[h.past.length - 1];
  if (top && h.last && h.last.label === label && now - h.last.at >= 0 && now - h.last.at < GROUP_MS) {
    return { past: h.past, future: [], last: { label, at: now } };
  }
  const past = [...h.past, { project: prev, label, at: now }];
  return { past: past.length > limit ? past.slice(past.length - limit) : past, future: [], last: { label, at: now } };
}

export interface HistoryStep {
  history: History;
  /** Proyecto al que se vuelve (o se avanza). */
  project: Project;
  /** Etiqueta del cambio deshecho o rehecho. */
  label: string;
}

/** Deshace el último cambio. `current` es el proyecto actual (pasa al futuro). null si no hay nada. */
export function undo(h: History, current: Project): HistoryStep | null {
  const top = h.past[h.past.length - 1];
  if (!top) return null;
  return {
    history: { past: h.past.slice(0, -1), future: [...h.future, { project: current, label: top.label, at: top.at }], last: null },
    project: top.project,
    label: top.label,
  };
}

/** Rehace el último cambio deshecho. null si no hay nada. */
export function redo(h: History, current: Project): HistoryStep | null {
  const top = h.future[h.future.length - 1];
  if (!top) return null;
  return {
    history: { past: [...h.past, { project: current, label: top.label, at: top.at }], future: h.future.slice(0, -1), last: null },
    project: top.project,
    label: top.label,
  };
}

export const undoLabelOf = (h: History): string | null => h.past[h.past.length - 1]?.label ?? null;
export const redoLabelOf = (h: History): string | null => h.future[h.future.length - 1]?.label ?? null;
