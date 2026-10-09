/**
 * Lado "cliente" del motor (hilo principal). Habla con `serveEngine` a través de un Endpoint (Web Worker o canal
 * en proceso) y se encarga de:
 * - mandar los datos del pozo una sola vez (y solo los arrays nuevos después);
 * - coalescer pedidos: a lo sumo un cálculo en vuelo y uno pendiente; el pendiente se reemplaza (gana el último);
 * - descartar respuestas de un pozo anterior (generación) y reconstruir el conjunto completo de salidas a partir
 *   de respuestas incrementales.
 */
import type { Interpretation } from '../interpretation';
import type { Registry } from '../registry';
import type { EngineRunResult, EngineWell, OutputRecord } from './engine';
import type { Endpoint, FromEngine, ToEngine, WireCurve } from './protocol';
import { serveEngine } from './serve';

export interface ClientResult extends EngineRunResult {
  seq: number;
  /** Tiempo desde que se pidió el cálculo hasta que llegó la respuesta (ms). */
  roundTripMs: number;
  /** Pedidos descartados por coalescencia que este resultado reemplazó (gana el último). */
  coalesced: number;
}

export type ClientEvent =
  | { type: 'result'; result: ClientResult }
  | { type: 'error'; message: string }
  | { type: 'busy'; busy: boolean };

export class EngineClient {
  private seq = 0;
  private gen = 0;
  private inFlight: { seq: number; sentAt: number; coalesced: number } | null = null;
  private pending: Interpretation | null = null;
  private coalesced = 0;
  private outputs = new Map<string, OutputRecord>();
  private wellId: string | null = null;
  private depth: Float64Array | null = null;
  private sentData = new Map<string, Float64Array>();
  private readonly listeners = new Set<(e: ClientEvent) => void>();
  private readonly onMessage = (ev: MessageEvent) => this.handle(ev.data as FromEngine);

  constructor(
    private readonly endpoint: Endpoint,
    private readonly cleanup: () => void = () => {},
  ) {
    endpoint.addEventListener('message', this.onMessage);
    endpoint.start?.();
  }

  subscribe(listener: (e: ClientEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get busy(): boolean {
    return this.inFlight !== null;
  }

  /**
   * Sincroniza el pozo con el motor. Si cambia el pozo o la profundidad, empieza una generación nueva y manda
   * todo; si no, manda metadatos y solo los arrays de datos que cambiaron (por identidad).
   */
  syncWell(well: EngineWell): void {
    const isNew = well.id !== this.wellId || well.depth !== this.depth;
    if (isNew) {
      this.gen++;
      this.wellId = well.id;
      this.depth = well.depth;
      this.sentData.clear();
      this.outputs.clear();
    }
    const curves: WireCurve[] = well.curves.map((c) => {
      const meta: WireCurve = { id: c.id, mnemonic: c.mnemonic, role: c.role, unit: c.unit };
      if (this.sentData.get(c.id) !== c.data) {
        this.sentData.set(c.id, c.data);
        meta.data = c.data;
      }
      return meta;
    });
    for (const id of [...this.sentData.keys()]) if (!well.curves.some((c) => c.id === id)) this.sentData.delete(id);
    // Sin transferir: el hilo principal sigue usando los datos medidos (se copian una vez).
    this.post({ type: 'well', gen: this.gen, wellId: well.id, ...(isNew ? { depth: well.depth } : {}), curves });
    if (!this.inFlight && this.pending) {
      const next = this.pending;
      this.pending = null;
      this.send(next);
    }
  }

  /** Pide un cálculo. Si hay uno en vuelo, queda pendiente y reemplaza a cualquier otro pendiente. */
  run(interpretation: Interpretation): void {
    if (this.inFlight || this.wellId === null) {
      if (this.pending) this.coalesced++;
      this.pending = interpretation;
      return;
    }
    this.send(interpretation);
  }

  dispose(): void {
    this.endpoint.removeEventListener('message', this.onMessage);
    this.listeners.clear();
    this.cleanup();
  }

  private send(interpretation: Interpretation): void {
    const seq = ++this.seq;
    this.inFlight = { seq, sentAt: now(), coalesced: this.coalesced };
    this.coalesced = 0;
    this.post({ type: 'run', seq, gen: this.gen, interpretation });
    this.emit({ type: 'busy', busy: true });
  }

  private post(msg: ToEngine): void {
    this.endpoint.postMessage(msg);
  }

  private emit(e: ClientEvent): void {
    for (const l of this.listeners) l(e);
  }

  private handle(msg: FromEngine): void {
    if (msg.seq === -1) {
      if (msg.type === 'error' && msg.gen === this.gen) this.emit({ type: 'error', message: msg.message });
      return;
    }
    const flight = this.inFlight;
    if (!flight || msg.seq !== flight.seq) return; // respuesta inesperada: se ignora
    this.inFlight = null;
    const coalesced = flight.coalesced;

    if (msg.gen === this.gen) {
      if (msg.type === 'error') {
        this.emit({ type: 'error', message: msg.message });
      } else {
        const merged = new Map<string, OutputRecord>();
        let missing: string | null = null;
        for (const o of msg.result.outputs) {
          if (o.value !== undefined) {
            merged.set(o.key, o as OutputRecord);
            continue;
          }
          const prev = this.outputs.get(o.key);
          if (!prev || prev.version !== o.version) {
            missing = o.key;
            continue;
          }
          merged.set(o.key, { ...o, value: prev.value });
        }
        this.outputs = merged;
        if (missing) {
          this.emit({ type: 'error', message: `Resultado incompleto del motor (falta '${missing}').` });
        }
        this.emit({
          type: 'result',
          result: { ...msg.result, outputs: [...merged.values()], seq: msg.seq, roundTripMs: now() - flight.sentAt, coalesced },
        });
      }
    }

    if (this.pending) {
      const next = this.pending;
      this.pending = null;
      this.send(next);
    } else {
      this.emit({ type: 'busy', busy: false });
    }
  }
}

/**
 * Cliente con el motor en el mismo hilo, conectado por un MessageChannel (mismo protocolo, misma semántica de
 * copia/transferencia que un worker). Sirve como alternativa si no se puede crear el worker, y para tests.
 */
export function createInProcessClient(registry: Registry): EngineClient {
  const channel = new MessageChannel();
  const stopServer = serveEngine(channel.port2, registry);
  return new EngineClient(channel.port1, () => {
    stopServer();
    channel.port1.close();
    channel.port2.close();
  });
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
