/** Resultados del motor: derivados del proyecto, nunca se guardan. */
import { create } from 'zustand';
import type { ClientResult } from '../../core/engine/client';

export interface ResultsStore {
  result: ClientResult | null;
  busy: boolean;
  error: string | null;
  /** Cómo corre el motor: 'worker' o 'in-process' (si no se pudo crear el worker). */
  mode: 'worker' | 'in-process' | null;
}

export const useResults = create<ResultsStore>()(() => ({ result: null, busy: false, error: null, mode: null }));
