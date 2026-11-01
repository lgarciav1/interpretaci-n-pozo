/**
 * Corridas aisladas del motor para comparar snapshots (docs/decisiones/0026). Sin React ni stores.
 *
 * - Usa un motor propio (otro `EngineSupervisor`, en su Web Worker): el principal no se entera, su caché y su
 *   resultado quedan intactos. El protocolo del worker no cambia: es el mismo pedido `well` + `run`.
 * - Una corrida a la vez. El cliente del motor coalesce (gana el último) y no dice a qué pedido corresponde cada
 *   respuesta; por eso se manda un pedido, se espera a que el motor quede libre (`busy: false`) y recién ahí sale el
 *   siguiente. Así cada resultado se atribuye sin ambigüedad.
 * - Caché por clave (snapshot + revisión de su interpretación + revisión de las curvas del pozo). Un pedido en cola que
 *   ya nadie quiere (la selección cambió) se descarta antes de mandarlo; uno en vuelo termina y queda en caché.
 */
import type { ClientResult } from '../../core/engine/client';
import type { EngineWell } from '../../core/engine/engine';
import type { SupervisorEvent } from '../../core/engine/supervisor';
import type { Interpretation } from '../../core/interpretation';

export type RunEntry = { status: 'pending' } | { status: 'ready'; result: ClientResult } | { status: 'error'; message: string };

/** Lo que el corredor necesita del motor (lo cumple `EngineSupervisor`). */
export interface RunnerEngine {
  syncWell(well: EngineWell): void;
  run(interpretation: Interpretation): void;
  subscribe(listener: (e: SupervisorEvent) => void): () => void;
}

interface Request {
  key: string;
  well: EngineWell;
  interpretation: Interpretation;
}

const revisions = new WeakMap<object, number>();
let nextRevision = 1;
/** Revisión de un objeto inmutable: cambia solo si cambia la identidad (interpretación, lista de curvas). */
export function revisionOf(o: object): number {
  let r = revisions.get(o);
  if (r === undefined) revisions.set(o, (r = nextRevision++));
  return r;
}

/** Clave de caché de una corrida: qué snapshot, qué revisión de su interpretación, sobre qué pozo y curvas. */
export function runKey(snapshotId: string, interpretation: Interpretation, well: { id: string; depth: object; curves: object }, inputRevisionId?: string | null): string {
  return `${snapshotId}@${revisionOf(interpretation)}|${well.id}#${revisionOf(well.depth)}.${revisionOf(well.curves)}${inputRevisionId ? `|input:${inputRevisionId}` : ''}`;
}

export class IsolatedRunner {
  private engine: RunnerEngine | null = null;
  private readonly entries = new Map<string, RunEntry>();
  private readonly wanted = new Map<string, number>();
  private queue: Request[] = [];
  private inFlight: Request | null = null;
  private got: { result?: ClientResult; error?: string } = {};
  private readonly listeners = new Set<() => void>();
  private sent = 0;

  constructor(
    private readonly createEngine: () => RunnerEngine,
    private readonly maxEntries = 6,
  ) {}

  /** Corridas mandadas al motor desde que se creó (para verificar que nada recalcula de más). */
  get runCount(): number {
    return this.sent;
  }

  get(key: string): RunEntry | undefined {
    return this.entries.get(key);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Pide (si no está en caché) la corrida y la marca como en uso; devuelve cómo soltarla. */
  acquire(key: string, well: EngineWell, interpretation: Interpretation): () => void {
    this.wanted.set(key, (this.wanted.get(key) ?? 0) + 1);
    if (!this.entries.has(key)) {
      this.entries.set(key, { status: 'pending' });
      this.queue.push({ key, well, interpretation });
      this.emit();
      this.pump();
    } else {
      // Uso reciente: al final del orden de la caché.
      const e = this.entries.get(key)!;
      this.entries.delete(key);
      this.entries.set(key, e);
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const n = (this.wanted.get(key) ?? 1) - 1;
      if (n > 0) {
        this.wanted.set(key, n);
        return;
      }
      this.wanted.delete(key);
      // Nadie la quiere y todavía no salió: se cancela (no se calcula algo que ya no se va a mostrar).
      const i = this.queue.findIndex((r) => r.key === key);
      if (i >= 0) {
        this.queue.splice(i, 1);
        this.entries.delete(key);
        this.emit();
      }
      this.trim();
    };
  }

  private ensureEngine(): RunnerEngine {
    if (!this.engine) {
      this.engine = this.createEngine();
      this.engine.subscribe((e) => this.onEvent(e));
    }
    return this.engine;
  }

  private pump(): void {
    if (this.inFlight || this.queue.length === 0) return;
    const req = this.queue.shift()!;
    this.inFlight = req;
    this.got = {};
    this.sent++;
    const engine = this.ensureEngine();
    engine.syncWell(req.well);
    engine.run(req.interpretation);
  }

  private onEvent(e: SupervisorEvent): void {
    if (!this.inFlight) return;
    if (e.type === 'result') this.got.result = e.result;
    else if (e.type === 'error') this.got.error ??= e.message;
    else if (e.type === 'busy' && !e.busy) {
      // Sin respuesta (el worker se cayó): el supervisor relanza el último pedido, que es este; se sigue esperando.
      if (!this.got.result && this.got.error === undefined) return;
      const req = this.inFlight;
      this.inFlight = null;
      const entry: RunEntry = this.got.result ? { status: 'ready', result: this.got.result } : { status: 'error', message: this.got.error! };
      this.got = {};
      this.entries.delete(req.key);
      this.entries.set(req.key, entry);
      this.trim();
      this.emit();
      this.pump();
    }
  }

  /** Mantiene la caché acotada: quita las corridas listas más viejas que nadie usa. */
  private trim(): void {
    if (this.entries.size <= this.maxEntries) return;
    for (const [key, e] of this.entries) {
      if (this.entries.size <= this.maxEntries) break;
      if (e.status !== 'pending' && !this.wanted.has(key)) this.entries.delete(key);
    }
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}

