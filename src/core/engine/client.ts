/** Cliente incremental: contexto completo, coalescencia y recuperación acotada sin publicar deltas parciales. */
import { emptyInterpretation, type Interpretation } from '../interpretation';
import type { Registry } from '../registry';
import type { EngineOptions, EngineRunResult, EngineWell, OutputRecord } from './engine';
import type { Endpoint, FromEngine, ToEngine, WireCurve } from './protocol';
import { contextMatchesWell, curveInputKey, curveProvenance, engineContext, engineDecisionKey, wellInputKey, sameContext, validContext, type EngineContext } from './context';
import { validatePreparedPayloads, type PreparationPlan, type PreparedPackage } from '../preparation/plan';
import { preparationStateKey } from '../preparation/state';
import { serveEngine } from './serve';
export interface ClientResult extends EngineRunResult {
  preparation?: PreparedPackage;
  context: EngineContext;
  seq: number;
  wellId: string;
  gen: number;
  roundTripMs: number;
  coalesced: number;
}
export type ClientEvent = {
  type: 'result';
  result: ClientResult;
} | {
  type: 'error';
  message: string;
} | {
  type: 'busy';
  busy: boolean;
} | {
  type: 'protocol-error';
  message: string;
} | {
  type: 'cancelled';
};
let lastGen = 0;
interface Request {
  preparation?: PreparationPlan;
  interpretation: Interpretation;
  context: EngineContext;
}
interface Flight extends Request {
  cancelled?: boolean;
  seq: number;
  gen: number;
  samples: number;
  sentAt: number;
  coalesced: number;
}
export class EngineClient {
  private seq = 0;
  private gen = 0;
  private syncId = 0;
  private inFlight: Flight | null = null;
  private pending: Request | null = null;
  private latest: Request | null = null;
  private beforeWell: Interpretation | null = null;
  private desired: EngineContext | null = null;
  private well: EngineWell | null = null;
  private coalesced = 0;
  private fullAttempted = false;
  private stopped = false;
  private outputs = new Map<string, OutputRecord>();
  private sentData = new Map<string, Float64Array>();
  private readonly listeners = new Set<(e: ClientEvent) => void>();
  private readonly onMessage = (ev: MessageEvent) => this.handle(ev.data as FromEngine);
  constructor(private readonly endpoint: Endpoint, private readonly cleanup: () => void = () => { }) { endpoint.addEventListener('message', this.onMessage); endpoint.start?.(); }
  subscribe(listener: (e: ClientEvent) => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  get busy(): boolean { return this.inFlight !== null; }
  syncWell(well: EngineWell, context?: EngineContext): {
    gen: number;
    isNew: boolean;
  } {
    const nextContext=context ?? engineContext(well,this.latest?.interpretation ?? emptyInterpretation());
    if(!validContext(nextContext)||nextContext.wellId!==well.id)throw new Error('Contexto científico inválido.');
    if (well.curves.some(c => c.provenance?.origin === 'prepared') && (nextContext.preparationKey === 'identity' || !contextMatchesWell(nextContext, well))) throw new Error('La proyección preparada no coincide con su contexto validado.');
    const isNew = well.id !== this.well?.id || well.depth !== this.well?.depth || nextContext.preparationKey !== this.desired?.preparationKey;
    if (isNew) {
      this.gen = ++lastGen;
      this.sentData.clear();
      this.outputs.clear();
      this.fullAttempted = false;
    }
    this.well = well;
    this.desired = nextContext;
    this.checkContext(this.desired);
    this.sendWell(isNew);
    if (this.beforeWell) {
      const i = this.beforeWell;
      this.beforeWell = null;
      this.run(i, context);
    }
    if (this.pending && this.pending.context.wellId !== well.id)
      this.pending = null;
    if (!this.inFlight && this.pending) {
      const next = this.pending;
      this.pending = null;
      this.send(next);
    }
    return { gen: this.gen, isNew };
  }
  run(interpretation: Interpretation, context?: EngineContext, preparation?: PreparationPlan): void {
    if (!this.well) {
      if (interpretation.preparation?.nodes.length) throw new Error('Primero sincronizá los originales de la preparación.');
      if (this.beforeWell)
        this.coalesced++;
      this.beforeWell = interpretation;
      return;
    }
    const request = { interpretation, preparation, context: context ?? (this.well ? engineContext(this.well, interpretation, this.desired?.inputRevisionId ?? null) : null) };
    if (!request.context)
      throw new Error('Primero se debe sincronizar un pozo.');
    this.checkContext(request.context);
    if (!!interpretation.preparation?.nodes.length !== !!preparation) throw new Error('La receta de preparación requiere su plan validado.');
    if (preparation) {
      const depthKey = request.context.depthKey;
      const originals = this.well.curves.map(c => ({ ...c, provenance: curveProvenance(c, depthKey) }));
      const key = curveInputKey(this.well.id, depthKey, [...originals, ...preparation.artifacts]) + '|' + engineDecisionKey(interpretation);
      if (preparation.stateKey !== preparationStateKey(interpretation.preparation) || preparation.originalKey !== wellInputKey(this.well) || !sameContext(preparation.context, request.context) || key !== request.context.engineKey) throw new Error('El plan preparado no coincide con las entradas o decisiones vigentes.');
    }
    if (this.well.curves.some(c => c.provenance?.origin === 'prepared') && request.context.engineKey !== wellInputKey(this.well) + '|' + engineDecisionKey(interpretation)) throw new Error('El cálculo preparado no coincide con su contexto.');
    const next = request as Request;
    this.latest = next;
    this.desired = next.context;
    if (this.inFlight) {
      if (this.pending)
        this.coalesced++;
      this.pending = next;
      return;
    }
    this.send(next);
  }
  dispose(): void { this.stopped = true; this.endpoint.removeEventListener('message', this.onMessage); this.listeners.clear(); this.cleanup(); }
  cancel(): void {
    this.pending = null;
    if (this.inFlight) { this.inFlight.cancelled = true; this.post({ type: 'cancel', gen: this.inFlight.gen, seq: this.inFlight.seq }); }
  }
  private checkContext(context: EngineContext): void { if (!validContext(context) || context.wellId !== this.well?.id)
    throw new Error('Contexto científico inválido.');
    if (this.well?.curves.some(c => c.provenance?.origin === 'prepared') && (context.preparationKey === 'identity' || !contextMatchesWell(context, this.well))) throw new Error('La proyección preparada no coincide con su contexto validado.'); }
  private sendWell(full: boolean): void {
    const well = this.well!, context = this.desired!;
    const curves: WireCurve[] = well.curves.map(c => {
      const meta: WireCurve = { id: c.id, mnemonic: c.mnemonic, role: c.role, unit: c.unit, ...curveProvenance(c, context.depthKey) };
      if (full || this.sentData.get(c.id) !== c.data)
        meta.data = c.data;
      return meta;
    });
    this.post({ type: 'well', gen: this.gen, syncId: ++this.syncId, context, wellId: well.id, ...(full ? { depth: well.depth } : {}), curves });
    this.sentData = new Map(well.curves.map(c => [c.id, c.data]));
  }
  private send(request: Request, full = false): void {
    this.inFlight = { ...request, seq: ++this.seq, gen: this.gen, samples: this.well!.depth.length, sentAt: now(), coalesced: this.coalesced };
    this.coalesced = 0;
    this.post({ type: 'run', seq: this.seq, gen: this.gen, syncId: this.syncId, context: request.context, interpretation: request.interpretation, ...(request.preparation ? { preparation: request.preparation } : {}), ...(full ? { full: true } : {}) });
    this.emit({ type: 'busy', busy: true });
  }
  private post(msg: ToEngine): void { this.endpoint.postMessage(msg); }
  private emit(e: ClientEvent): void { for (const l of this.listeners)
    l(e); }
  private recover(message: string, input = false): void {
    if (this.fullAttempted) {
      this.inFlight = null;
      this.pending = null;
      this.emit({ type: 'protocol-error', message });
      if (!this.stopped) {
        this.emit({ type: 'error', message });
        this.emit({ type: 'busy', busy: false });
      }
      return;
    }
    this.fullAttempted = true;
    this.inFlight = null;
    const next = this.pending ?? this.latest;
    this.pending = null;
    if (input)
      this.sendWell(true);
    if (next && this.well && sameContext(next.context, this.desired))
      this.send(next, true);
    else
      this.emit({ type: 'busy', busy: false });
  }
  private handle(msg: FromEngine): void {
    if (this.stopped || !msg || typeof msg !== 'object' || !['result', 'error', 'resync', 'cancelled'].includes(msg.type))
      return;
    if (msg.type === 'resync') {
      if (msg.gen === this.gen && msg.syncId === this.syncId)
        this.recover(msg.message, true);
      return;
    }
    if (msg.seq === -1) {
      if (msg.type === 'error' && msg.gen === this.gen && msg.syncId === this.syncId)
        this.emit({ type: 'error', message: msg.message });
      return;
    }
    const flight = this.inFlight;
    if (!flight || msg.seq !== flight.seq || msg.gen !== flight.gen)
      return;
    if (!sameContext(msg.context, flight.context)) {
      this.recover('El motor respondió con otro contexto científico.');
      return;
    }
    if (msg.type === 'result' && msg.gen === this.gen) {
      try {
        if (flight.preparation) validatePreparedPayloads(flight.preparation, msg.prepared, flight.samples);
        else if (msg.prepared !== undefined) throw new Error('El motor devolvió una preparación no solicitada.');
        if (!Array.isArray(msg.result.outputs) || msg.result.stats.samples !== flight.samples)
          throw new Error('Dimensiones de resultado inconsistentes.');
        const merged = new Map<string, OutputRecord>();
        for (const o of msg.result.outputs) {
          if (!o || typeof o.key !== 'string' || merged.has(o.key) || !Number.isSafeInteger(o.version) || o.version<0 || typeof o.moduleId!=='string' || typeof o.port!=='string' || o.key!==`${o.moduleId}:${o.port}` || !['curve','scalar','zoneScalar','table'].includes(o.kind) || (o.unit!==undefined && typeof o.unit!=='string'))
            throw new Error('Metadatos de salida inválidos o repetidos.');
          const prev = this.outputs.get(o.key);
          if(prev&&prev.version===o.version&&(prev.unit!==o.unit||prev.kind!==o.kind))throw new Error('La versión de salida no coincide con sus metadatos.');
          const value = o.value !== undefined ? o.value : prev && prev.version === o.version && prev.kind === o.kind && prev.moduleId === o.moduleId && prev.port === o.port && prev.unit===o.unit ? prev.value : undefined;
          if (value === undefined)
            throw new Error(`Resultado incompleto del motor (falta '${o.key}').`);
          if (o.kind === 'curve' && (!(value instanceof Float64Array) || value.length !== flight.samples))
            throw new Error('Curva de salida con dimensión incorrecta.');
          if(o.kind==='scalar'&&typeof value!=='number')throw new Error('Escalar de salida inválido.');
          if(o.kind==='table'&&(!value||typeof value!=='object'||!('rows' in value)||!Array.isArray(value.rows)))throw new Error('Tabla de salida inválida.');
          if(o.kind==='zoneScalar'&&(!value||typeof value!=='object'||Array.isArray(value)||ArrayBuffer.isView(value)||Object.values(value).some(v=>typeof v!=='number')))throw new Error('Valores por zona inválidos.');
          merged.set(o.key, { ...o, value } as OutputRecord);
        }
        // Solo actualizar la caché si el conjunto entero es válido. Un resultado atrasado puede alimentar
        // deltas por versión, pero nunca se publica como el contexto que el usuario está viendo.
        this.outputs = merged;
        if (!flight.cancelled && sameContext(msg.context, this.desired)) {
          this.fullAttempted = false;
          this.emit({ type: 'result', result: { ...msg.result, ...(flight.preparation ? { preparation: { plan: flight.preparation, artifacts: msg.prepared! } } : {}), outputs: [...merged.values()], context: Object.freeze({ ...msg.context }), seq: msg.seq, wellId: msg.context.wellId, gen: msg.gen, roundTripMs: now() - flight.sentAt, coalesced: flight.coalesced } });
        }
      }
      catch (err) {
        this.recover(err instanceof Error ? err.message : String(err));
        return;
      }
    }
    else if (msg.type === 'error' && !flight.cancelled && msg.gen === this.gen && sameContext(flight.context, this.desired))
      this.emit({ type: 'error', message: msg.message });
    if (msg.type === 'cancelled' || flight.cancelled) this.emit({ type: 'cancelled' });
    this.inFlight = null;
    if (this.pending) {
      const next = this.pending;
      this.pending = null;
      this.send(next);
    }
    else
      this.emit({ type: 'busy', busy: false });
  }
}
export function createInProcessClient(registry: Registry, options: EngineOptions = {}): EngineClient {
  const channel = new MessageChannel(), stop = serveEngine(channel.port2, registry, options);
  return new EngineClient(channel.port1, () => { stop(); channel.port1.close(); channel.port2.close(); });
}
function now(): number { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }
