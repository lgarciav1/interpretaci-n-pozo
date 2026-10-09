/**
 * Protocolo entre el hilo principal (EngineClient) y el motor (serveEngine), sea un Web Worker o un canal en
 * proceso. Todos los mensajes son clonables (structured clone); los Float64Array viajan como transferibles.
 */
import type { Interpretation } from '../interpretation';
import type { RoleId } from '../roles';
import type { UnitId } from '../units';
import type { EngineRunResult, OutputRecord } from './engine';

/** Extremo de un canal de mensajes: lo cumplen `Worker`, el `self` de un worker y `MessagePort`. */
export interface Endpoint {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (ev: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (ev: MessageEvent) => void): void;
  start?(): void;
}

export interface WireCurve {
  id: string;
  mnemonic: string;
  role: RoleId | null;
  unit: UnitId;
  /** Se omite si el motor ya tiene ese array (mismo id, mismos datos). */
  data?: Float64Array;
}

export type ToEngine =
  | {
      type: 'well';
      /** Generación de pozo: cambia cuando cambia el pozo o su profundidad (descarta resultados viejos). */
      gen: number;
      wellId: string;
      /** Presente solo en una generación nueva. */
      depth?: Float64Array;
      curves: WireCurve[];
    }
  | { type: 'run'; seq: number; gen: number; interpretation: Interpretation };

/** Salida en tránsito: `value` se omite si no cambió desde el último mensaje (el cliente ya la tiene). */
export type WireOutput = Omit<OutputRecord, 'value'> & { value?: OutputRecord['value'] };

export type WireResult = Omit<EngineRunResult, 'outputs'> & { outputs: WireOutput[] };

export type FromEngine =
  | { type: 'result'; seq: number; gen: number; result: WireResult }
  /** seq = -1: error al cargar el pozo. */
  | { type: 'error'; seq: number; gen: number; message: string };
