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
import { engineContext, sameContext, type EngineContext } from '../../core/engine/context';
import type { ClientResult } from '../../core/engine/client';
import type { EngineWell } from '../../core/engine/engine';
import type { SupervisorEvent } from '../../core/engine/supervisor';
import type { Interpretation } from '../../core/interpretation';
import type { PreparationPlan } from '../../core/preparation/plan';

export type RunEntry = { status: 'pending' } | { status: 'ready'; result: ClientResult } | { status: 'error'; message: string };

/** Lo que el corredor necesita del motor (lo cumple `EngineSupervisor`). */
export interface RunnerEngine {
  syncWell(well: EngineWell, context?:EngineContext): void;
  run(interpretation: Interpretation, context?:EngineContext, preparation?:PreparationPlan): void;
  cancel?(): void;
  subscribe(listener: (e: SupervisorEvent) => void): () => void;
}

interface Request {
  preparation?: PreparationPlan;
  context:EngineContext;
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
export function runKey(snapshotId: string, interpretation: Interpretation, well: { id: string; depth: object; curves: object }, inputRevisionId?: string | null, context?:EngineContext): string {
  return `${snapshotId}@${revisionOf(interpretation)}|${well.id}#${revisionOf(well.depth)}.${revisionOf(well.curves)}${inputRevisionId ? `|input:${inputRevisionId}` : ''}${context ? `|context:${JSON.stringify(context)}` : ''}`;
}

export class IsolatedRunner {
  private engine: RunnerEngine | null = null;
  private readonly contexts = new Map<string,EngineContext>();
  private readonly entries = new Map<string, RunEntry>();
  private readonly wanted = new Map<string, number>();
  private queue: Request[] = [];
  private inFlight: Request | null = null;
  private got: { result?: ClientResult; error?: string; cancelled?: boolean } = {};
  private readonly listeners = new Set<() => void>();
  private sent = 0;

  constructor(
    private readonly createEngine: () => RunnerEngine,
    private readonly maxEntries = 6,
    private readonly maxBytes = 128 * 1024 * 1024,
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
  acquire(key: string, well: EngineWell, interpretation: Interpretation, context=engineContext(well,interpretation), preparation?:PreparationPlan): () => void {
    const previous=this.contexts.get(key);
    if(previous&&!sameContext(previous,context))throw new Error('La clave de caché refiere a otro contexto científico.');
    this.contexts.set(key,context);
    this.wanted.set(key, (this.wanted.get(key) ?? 0) + 1);
    if (!this.entries.has(key)) {
      this.entries.set(key, { status: 'pending' });
      const request = { key, well, interpretation, context, preparation };
      if (key.startsWith('preparation-preview:')) this.queue.unshift(request); else this.queue.push(request);
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
      if (this.inFlight?.key === key && preparation) this.engine?.cancel?.();
      // Nadie la quiere y todavía no salió: se cancela (no se calcula algo que ya no se va a mostrar).
      const i = this.queue.findIndex((r) => r.key === key);
      if (i >= 0) {
        this.queue.splice(i, 1);
        this.entries.delete(key);this.contexts.delete(key);
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
    engine.syncWell(req.well,req.context);
    engine.run(req.interpretation,req.context,req.preparation);
  }

  private onEvent(e: SupervisorEvent): void {
    if (!this.inFlight) return;
    if (e.type === 'result') { if(sameContext(e.result.context,this.inFlight.context))this.got.result=e.result;else this.got.error='El resultado aislado pertenece a otro contexto.'; }
    else if (e.type === 'error') this.got.error ??= e.message;
    else if (e.type === 'cancelled') this.got.cancelled = true;
    else if (e.type === 'busy' && !e.busy) {
      // Sin respuesta (el worker se cayó): el supervisor relanza el último pedido, que es este; se sigue esperando.
      if (!this.got.result && this.got.error === undefined && !this.got.cancelled) return;
      const req = this.inFlight;
      this.inFlight = null;
      const entry: RunEntry = this.got.result ? { status: 'ready', result: this.got.result } : { status: 'error', message: this.got.error ?? 'Previsualización cancelada.' };
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
    let bytes = [...this.entries.values()].reduce((sum, e) => sum + entryBytes(e), 0);
    if (this.entries.size <= this.maxEntries && bytes <= this.maxBytes) return;
    for (const [key, e] of this.entries) {
      if (this.entries.size <= this.maxEntries && bytes <= this.maxBytes) break;
      if (e.status !== 'pending' && !this.wanted.has(key)) {this.entries.delete(key);this.contexts.delete(key);bytes -= entryBytes(e);}
    }
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}


/** Cuenta arrays transferidos; los resultados en uso quedan fijados hasta soltar su lease. */
function entryBytes(entry: RunEntry): number {
  if (entry.status !== 'ready') return 0;
  return entry.result.outputs.reduce((sum, o) => sum + (o.value instanceof Float64Array ? o.value.byteLength : 0), 0)
    + (entry.result.preparation?.artifacts.reduce((sum, a) => sum + a.data.byteLength + a.quality.byteLength, 0) ?? 0);
}
