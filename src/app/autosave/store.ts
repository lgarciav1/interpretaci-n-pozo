/**
 * Estado del autoguardado para la interfaz (barra superior e Inicio). Es de interfaz: no entra en el proyecto ni en el
 * historial. Lo escribe solo `AutosaveSession` (vía `installAutosave`).
 */
import { create } from 'zustand';
import type { AutosaveSnapshot } from './session';

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
