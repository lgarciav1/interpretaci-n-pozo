/**
 * Errores y utilidades de control comunes al motor del Log Digitizer. Puro: sin DOM ni React.
 *
 * Toda entrada inválida (calibración, región, máscara, parámetros) lanza `DigitizerError` con un mensaje en español
 * pensado para mostrarse tal cual en la interfaz. La cancelación lanza `DigitizerAbortError` (`name === 'AbortError'`).
 * Las situaciones "normales" (imagen sin trazo, curva interrumpida) NO son errores: devuelven resultados con NaN y
 * advertencias.
 */

export type DigitizerErrorCode =
  | 'invalid-calibration'
  | 'invalid-geometry'
  | 'invalid-image'
  | 'invalid-region'
  | 'invalid-mask'
  | 'invalid-options'
  | 'invalid-series'
  | 'invalid-session'
  | 'no-overlap';

export class DigitizerError extends Error {
  readonly code: DigitizerErrorCode;
  constructor(code: DigitizerErrorCode, message: string) {
    super(message);
    this.name = 'DigitizerError';
    this.code = code;
  }
}

/** Cancelación por `AbortSignal`. Se reconoce por `name === 'AbortError'` (igual que las APIs del navegador). */
export class DigitizerAbortError extends Error {
  constructor() {
    super('La digitalización se canceló.');
    this.name = 'AbortError';
  }
}

/** Opciones de las funciones largas: progreso (0–1) y cancelación. */
export interface ProgressOptions {
  /** Se llama de vez en cuando con una fracción creciente entre 0 y 1. */
  onProgress?: (fraction: number) => void;
  /** Si se aborta, la función lanza `DigitizerAbortError` en el siguiente punto de control. */
  signal?: AbortSignal;
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DigitizerAbortError();
}
