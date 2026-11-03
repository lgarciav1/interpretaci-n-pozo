/**
 * Estado de la pantalla de Inicio (docs/decisiones/0065). Es de interfaz: no se guarda en el proyecto ni entra en el
 * historial. La cámara y la línea de tiempo de la entrada viven en el renderizador, no acá.
 */
import { create } from 'zustand';

/**
 * `open`: a la vista; `entering`: recorrido de la entrada al pozo; `leaving`: fundido final (el espacio de trabajo ya
 * responde debajo); `closed`: Inicio desmontado, sin lienzo ni bucle.
 */
export type HomePhase = 'closed' | 'open' | 'entering' | 'leaving';

export interface HomeUi {
  phase: HomePhase;
  /** Cómo apareció: al arrancar (sin fundido) o al volver desde el espacio de trabajo (fundido breve). */
  via: 'boot' | 'return';
  /** La entrada completa ya se vio en esta sesión: las siguientes son breves. */
  fullEntrySeen: boolean;
  set(patch: Partial<Omit<HomeUi, 'set'>>): void;
}

export const useHome = create<HomeUi>()((set) => ({
  phase: 'closed',
  via: 'boot',
  fullEntrySeen: false,
  set: (patch) => set(patch),
}));

/** Duraciones de la entrada al pozo, en ms: recorrido 3D y fundido del final hacia el espacio de trabajo. */
export const ENTRY_TIMING = {
  full: { camera: 2200, fade: 520 },
  short: { camera: 700, fade: 240 },
  /** Movimiento reducido: sin recorrido, solo un fundido corto (la opacidad no es movimiento). */
  reduced: { camera: 0, fade: 140 },
  /** Saltar o Escape. */
  skip: { camera: 0, fade: 0 },
} as const;

export type EntryKind = keyof typeof ENTRY_TIMING;

/** Qué entrada corresponde (puro, testeado). */
export function entryKind(opts: { reducedMotion: boolean; fullEntrySeen: boolean; hasScene: boolean }): EntryKind {
  if (opts.reducedMotion) return 'reduced';
  if (!opts.hasScene) return 'reduced';
  return opts.fullEntrySeen ? 'short' : 'full';
}
