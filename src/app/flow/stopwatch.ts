/**
 * Cronómetro del recorrido (F19), lógica pura: mide desde que se carga un pozo hasta que se abre el paso «Sumario»,
 * contra la meta de «un pozo en menos de 5 minutos». Sin DOM ni stores: el estado vive en
 * `stopwatchStore.ts` (interfaz, nunca en el proyecto ni en deshacer) y el reloj se pasa como `now`.
 */
import type { Project } from '../../core/state/project';

export interface StopwatchState {
  /** Pozo cuyo recorrido se mide (null = sin cronómetro). */
  wellId: string | null;
  startedAt: number | null;
  stoppedAt: number | null;
}

export type WalkthroughGoal = 'within' | 'over';

/** Meta del plan: un pozo interpretado de punta a punta en menos de 5 minutos. */
export const WALKTHROUGH_GOAL_MS = 5 * 60_000;

/** Etiquetas de `replace` que no son cargar un pozo: el sintético del arranque y la sesión autoguardada (0071). */
export const BOOT_DEMO_LABEL = 'Pozo de demostración';
export const RESTORE_SESSION_LABEL = 'Recuperar sesión';
const NOT_A_WALKTHROUGH = new Set([BOOT_DEMO_LABEL, RESTORE_SESSION_LABEL]);

export const IDLE_STOPWATCH: StopwatchState = { wellId: null, startedAt: null, stoppedAt: null };

/** Arranca (o reinicia) el recorrido de un pozo desde `now`. */
export function startFor(wellId: string, now: number): StopwatchState {
  return { wellId, startedAt: now, stoppedAt: null };
}

/** Frena el recorrido. Idempotente: si no arrancó o ya frenó, devuelve el mismo estado. */
export function stop(state: StopwatchState, now: number): StopwatchState {
  if (state.startedAt === null || state.stoppedAt !== null) return state;
  return { ...state, stoppedAt: Math.max(now, state.startedAt) };
}

export const isRunning = (s: StopwatchState): boolean => s.startedAt !== null && s.stoppedAt === null;

/** Tiempo transcurrido en ms (0 si no arrancó; fijo después de frenar). */
export function elapsedMs(state: StopwatchState, now: number): number {
  if (state.startedAt === null) return 0;
  return Math.max(0, (state.stoppedAt ?? now) - state.startedAt);
}

export function goalStatus(elapsed: number, goalMs = WALKTHROUGH_GOAL_MS): WalkthroughGoal {
  return elapsed < goalMs ? 'within' : 'over';
}

/** Fracción de la meta consumida, entre 0 y 1 (para el aro de progreso). */
export function goalFraction(elapsed: number, goalMs = WALKTHROUGH_GOAL_MS): number {
  return goalMs > 0 ? Math.min(1, Math.max(0, elapsed / goalMs)) : 1;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** «m:ss», o «h:mm:ss» desde la hora. Trunca a segundos (un reloj no se adelanta). */
export function formatElapsed(ms: number): string {
  const total = Math.floor(Math.max(0, Number.isFinite(ms) ? ms : 0) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Para leer en prosa (informe, lectores de pantalla): «42 s», «3 min 42 s», «1 h 02 min». */
export function formatElapsedLong(ms: number): string {
  const total = Math.floor(Math.max(0, Number.isFinite(ms) ? ms : 0) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h} h ${pad(m)} min`;
  if (m > 0) return `${m} min ${pad(s)} s`;
  return `${s} s`;
}

/** Datos del recorrido para el informe (los pasa quien lo genera; el informe no lee stores). */
export interface WalkthroughReport {
  elapsedMs: number;
  finished: boolean;
  goalMs: number;
}

export function walkthroughReport(state: StopwatchState, now: number, wellId: string | null): WalkthroughReport | undefined {
  if (state.startedAt === null || state.wellId === null || state.wellId !== wellId) return undefined;
  return { elapsedMs: elapsedMs(state, now), finished: state.stoppedAt !== null, goalMs: WALKTHROUGH_GOAL_MS };
}

/**
 * ¿Este cambio del proyecto es «cargar un pozo»? Devuelve el id del pozo cuyo recorrido arranca, o null.
 * - `replaced`: el proyecto se reemplazó entero (abrir un proyecto): arranca con su pozo activo, salvo el sintético
 *   del arranque y la sesión recuperada.
 * - Si no: arranca cuando el pozo activo pasa a ser uno que no estaba (importar, TP, demostración, digitalizado).
 *   Cambiar a un pozo que ya estaba o deshacer no arrancan; rehacer la carga del pozo que ya se mide tampoco reinicia.
 */
export function walkthroughStartFor(prev: Project, next: Project, change: { replaced: boolean; label: string | null }, current: StopwatchState): string | null {
  const id = next.activeWellId;
  if (!id || !next.wells.some((w) => w.well.id === id)) return null;
  if (change.replaced) return change.label !== null && NOT_A_WALKTHROUGH.has(change.label) ? null : id;
  if (id === prev.activeWellId || prev.wells.some((w) => w.well.id === id)) return null;
  return id === current.wellId ? null : id;
}
