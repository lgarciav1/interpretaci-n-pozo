/**
 * Estado del autoguardado para la interfaz (barra superior e Inicio). Es de interfaz: no entra en el proyecto ni en el
 * historial. Lo escribe solo `AutosaveSession` (vía `installAutosave`).
 */
import { create } from 'zustand';
import type { AutosaveSnapshot } from './session';
import type { SessionMeta } from './storage';

export const useAutosave = create<AutosaveSnapshot>()(() => ({
  status: 'empty',
  available: false,
  autoSavedAt: null,
  fileSafe: true,
  fileOrigin: 'boot',
  autoSafe: false,
  sessions: [],
  sessionId: null,
  restoring: false,
  error: null,
}));

/** «hace 12 s», «hace 3 min», «hace 2 h», «ayer», «hace 4 días» o la fecha (puro, es-AR). */
export function formatAgo(thenMs: number, nowMs: number): string {
  const s = Math.max(0, Math.round((nowMs - thenMs) / 1000));
  if (s < 5) return 'recién';
  if (s < 60) return `hace ${s} s`;
  const min = Math.floor(s / 60);
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'ayer';
  if (d < 7) return `hace ${d} días`;
  return new Date(thenMs).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' });
}

/** Hora corta (14:32) para los tooltips. */
export function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

/** Nombre que `createProject` le pone a un proyecto nuevo: no dice nada de la sesión. */
export const DEFAULT_PROJECT_NAME = 'Proyecto sin nombre';

/** «Pozo TP», «Pozo TP y 1 más»; «sin pozos» si no hay. */
export function wellsLabel(wells: readonly string[]): string {
  if (wells.length === 0) return 'sin pozos';
  return wells.length === 1 ? wells[0]! : `${wells[0]} y ${wells.length - 1} más`;
}

/**
 * Cómo se nombra una sesión en Inicio (puro). Con nombre propio, el proyecto es el título y los pozos van en el
 * detalle; con el nombre por defecto (o vacío), los pozos son el título y el detalle no los repite (`wells: null`).
 */
export function sessionTitle(meta: Pick<SessionMeta, 'projectName' | 'wells'>): { title: string; wells: string | null } {
  const name = meta.projectName.trim();
  if (name && name !== DEFAULT_PROJECT_NAME) return { title: name, wells: wellsLabel(meta.wells) };
  if (meta.wells.length === 0) return { title: name || DEFAULT_PROJECT_NAME, wells: null };
  return { title: wellsLabel(meta.wells), wells: null };
}
