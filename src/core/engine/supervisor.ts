/**
 * Supervisor del motor (hilo principal): elige dónde corre el motor y lo mantiene vivo.
 *
 * - Arranca en un Web Worker si hay fábrica de workers; si no, en proceso.
 * - Si el worker da error ANTES de su primera respuesta (el navegador no lo soporta, p. ej. Blob bloqueado en
 *   file://), pasa directamente al motor en proceso.
 * - Si da error DESPUÉS de haber respondido (se cayó), lo recrea hasta `maxRestarts` veces y después pasa al
 *   motor en proceso. En ambos casos reenvía el pozo y relanza el último pedido, así que nunca queda
 *   "calculando…" para siempre.
 *
 * Recuerda el último pozo y la última interpretación pedidos; no depende de React ni del DOM.
 */
import type { Interpretation } from '../interpretation';
import { EngineClient, type ClientEvent } from './client';
import type { EngineWell } from './engine';
import type { Endpoint } from './protocol';

/** Lo que el supervisor necesita de un Worker (lo cumple `Worker`, con un cast). */
export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message' | 'error' | 'messageerror', listener: (ev: { data?: unknown; message?: string }) => void): void;
  removeEventListener(type: 'message' | 'error' | 'messageerror', listener: (ev: { data?: unknown; message?: string }) => void): void;
  terminate(): void;
}

export type EngineMode = 'worker' | 'in-process';

export type SupervisorEvent =
  | ClientEvent
  /** Cambió el pozo (generación nueva): los resultados anteriores ya no corresponden a la profundidad actual. */
  | { type: 'reset'; wellId: string; gen: number }
  | { type: 'mode'; mode: EngineMode; reason?: string };

export interface SupervisorOptions {
  /** Crea el worker del motor. Sin fábrica, el motor corre en proceso. */
  createWorker?: () => WorkerLike;
  createInProcess: () => EngineClient;
  /** Reinicios del worker permitidos tras caídas (por defecto 2). */
  maxRestarts?: number;
  log?: (message: string, detail?: unknown) => void;
}

export class EngineSupervisor {
  private client!: EngineClient;
  private mode: EngineMode = 'in-process';
  private restarts = 0;
  private lastWell: EngineWell | null = null;
  private lastInterp: Interpretation | null = null;
  private readonly listeners = new Set<(e: SupervisorEvent) => void>();

  constructor(private readonly options: SupervisorOptions) {
    if (options.createWorker) this.startWorker();
    else this.startInProcess('sin fábrica de workers');
  }

  get currentMode(): EngineMode {
    return this.mode;
  }

  get restartCount(): number {
    return this.restarts;
  }

  subscribe(listener: (e: SupervisorEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  syncWell(well: EngineWell): void {
    this.lastWell = well;
    const { gen, isNew } = this.client.syncWell(well);
    if (isNew) this.emit({ type: 'reset', wellId: well.id, gen });
  }

  run(interpretation: Interpretation): void {
    this.lastInterp = interpretation;
    this.client.run(interpretation);
  }

  dispose(): void {
    this.client.dispose();
    this.listeners.clear();
  }

  private emit(e: SupervisorEvent): void {
    for (const l of this.listeners) l(e);
  }

  private attach(client: EngineClient, mode: EngineMode, reason?: string): void {
    this.client = client;
    this.mode = mode;
    client.subscribe((e) => this.emit(e));
    this.emit({ type: 'mode', mode, ...(reason ? { reason } : {}) });
  }

  private startWorker(): void {
    let worker: WorkerLike;
    try {
      worker = this.options.createWorker!();
    } catch (err) {
      const reason = `no se pudo crear el worker: ${describe(err)}`;
      this.options.log?.(`El motor pasa al hilo principal: ${reason}.`);
      this.startInProcess(reason);
      return;
    }
    let answered = false;
    let dead = false;
    const onMessage = () => {
      answered = true;
    };
    const onError = (ev: { message?: string }) => {
      if (dead) return;
      dead = true;
      this.onWorkerFailure(answered, ev.message || 'error desconocido');
    };
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);
    worker.addEventListener('messageerror', onError);
    const cleanup = () => {
      dead = true;
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      worker.removeEventListener('messageerror', onError);
      worker.terminate();
    };
    this.attach(new EngineClient(worker as unknown as Endpoint, cleanup), 'worker');
  }

  private startInProcess(reason: string): void {
    this.attach(this.options.createInProcess(), 'in-process', reason);
  }

  private onWorkerFailure(answered: boolean, message: string): void {
    const wasBusy = this.client.busy;
    this.client.dispose(); // termina el worker y descarta lo que estaba en vuelo
    if (wasBusy) this.emit({ type: 'busy', busy: false });
    if (answered && this.restarts < (this.options.maxRestarts ?? 2)) {
      this.restarts++;
      this.options.log?.(`El worker del motor se cayó (${message}); se reinicia (${this.restarts}).`);
      this.startWorker();
    } else {
      const reason = answered ? `el worker se cayó ${this.restarts + 1} veces (${message})` : `el worker no arrancó (${message})`;
      this.options.log?.(`El motor pasa al hilo principal: ${reason}.`);
      this.startInProcess(reason);
    }
    // Reenviar el estado al motor nuevo. No se emite 'reset': es el mismo pozo y la misma profundidad.
    if (this.lastWell) this.client.syncWell(this.lastWell);
    if (this.lastInterp) this.client.run(this.lastInterp);
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
