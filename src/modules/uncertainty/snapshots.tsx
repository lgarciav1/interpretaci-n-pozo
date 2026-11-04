/**
 * Copia del último cálculo de incertidumbre de cada pozo (sobrevive al cambio de panel). El panel la guarda cuando llega
 * el resultado y apaga `calculate` en el mismo paso del historial, así que es la ÚNICA copia del Monte Carlo: la lee
 * también el panel «Distribuciones por zona» (barra P90–P10 del volumen; docs/decisiones/0066, D19). Estado de
 * interfaz: no entra en el proyecto ni en deshacer. Va en .tsx porque usa un store (los .ts de `src/modules/` los
 * carga el worker y no pueden).
 */
import { create } from 'zustand';
import type { Row } from './model';

export interface UncertaintySnapshot {
  wellId: string;
  /** Generación del resultado del motor con que se calculó. */
  gen: number;
  /** Firma de lo que determina el resultado (`dependencySignature`): si cambia, la copia está desactualizada. */
  sig: string;
  iterations: number;
  summary: readonly Row[];
  hist: readonly Row[];
  cdf: readonly Row[];
  tornado: readonly Row[];
  warnings: string[];
}

export const useSnapshots = create<{ byWell: Record<string, UncertaintySnapshot> }>(() => ({
  byWell: {},
}));
