/**
 * Lado "servidor" del motor: escucha mensajes en un Endpoint (el `self` de un Web Worker, o un MessagePort en
 * proceso) y mantiene residentes el pozo y la caché del motor.
 */
import { sameContext, sameInputDomain, validContext, type EngineContext } from './context';
import { MaskEvaluator, PreparationCancelled } from '../preparation/evaluate';
import { planPreparation, projectedEngineCurves, type PreparedPayload } from '../preparation/plan';
import { makeDepthIndex } from '../well';
import type { Registry } from '../registry';
import { Engine, type EngineWell, type EngineCurve, type EngineOptions } from './engine';
import type { Endpoint, FromEngine, ToEngine, WireOutput } from './protocol';

export function serveEngine(endpoint: Endpoint, registry: Registry, options: EngineOptions = {}): () => void {
  const engine = new Engine(registry, options);
  const evaluator = new MaskEvaluator();
  let rawWell: EngineWell | null = null;
  let taskToken = 0, stopped = false;
  let activeTask: { gen: number; seq: number } | null = null;
  let gen = -1;
  let syncId = -1;
  let context: EngineContext | null = null;
  class InvalidDelta extends Error {}
  let curves = new Map<string, EngineCurve>();
  /** Versión de cada salida que ya tiene el cliente (para no reenviar datos sin cambios). */
  const sent = new Map<string, number>();

  const reply = (msg: FromEngine, transfer: Transferable[] = []) => { if (!stopped) endpoint.postMessage(msg, transfer); };

  const loadWell = (msg: Extract<ToEngine, { type: 'well' }>) => {
    const isNew = msg.gen !== gen || !!msg.depth;
    if (!validContext(msg.context) || msg.context.wellId !== msg.wellId) throw new InvalidDelta('Contexto de pozo inválido.');
    if (isNew && !msg.depth) throw new InvalidDelta('Mensaje de pozo nuevo sin profundidad.');
    if (!isNew && context && (context.wellId !== msg.context.wellId || context.depthKey !== msg.context.depthKey || context.preparationKey !== msg.context.preparationKey)) throw new InvalidDelta('Cambio de dominio sin profundidad completa.');
    if (msg.depth) { if(!(msg.depth instanceof Float64Array))throw new InvalidDelta('El índice requiere Float64Array.');makeDepthIndex(msg.depth); }
    const previous = isNew ? new Map<string, EngineCurve>() : curves;
    const next = new Map<string, EngineCurve>();
    for (const c of msg.curves) {
      if (next.has(c.id) || typeof c.id !== 'string' || !c.id || typeof c.mnemonic !== 'string' || !c.mnemonic || typeof c.unit !== 'string' || !c.unit || !(c.role === null || typeof c.role === 'string') || (c.data !== undefined && !(c.data instanceof Float64Array)) || typeof c.contentVersion !== 'string' || !c.contentVersion || c.depthKey !== msg.context.depthKey || !['original','prepared'].includes(c.origin) || !Array.isArray(c.ancestorToolIds) || c.ancestorToolIds.some((id) => typeof id !== 'string' || !id) || (c.qualityKey !== undefined && typeof c.qualityKey !== 'string')) throw new InvalidDelta('Procedencia de curva inválida.');
      const prev = previous.get(c.id);
      if (c.origin === 'prepared' && (msg.context.preparationKey === 'identity' || !/^prep:[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+$/.test(c.id) || !c.qualityKey || c.ancestorToolIds.some(id => !registry.tools.has(id)))) throw new InvalidDelta('Artefacto preparado sin identidad o ascendencia válida.');
      const data = c.data ?? (prev?.provenance?.contentVersion === c.contentVersion ? prev.data : undefined);
      if (!data) throw new InvalidDelta(`El motor no tiene datos de la versión solicitada para '${c.id}'.`);
      if (c.data && prev?.provenance?.contentVersion === c.contentVersion) {
        const a = new Uint8Array(data.buffer,data.byteOffset,data.byteLength), b = new Uint8Array(prev.data.buffer,prev.data.byteOffset,prev.data.byteLength);
        if (a.length !== b.length || !a.every((v,i) => v === b[i])) throw new InvalidDelta('Una versión de curva no puede cambiar sus bytes.');
      }
      next.set(c.id, { id: c.id, mnemonic: c.mnemonic, role: c.role, unit: c.unit, data,
        provenance: {origin:c.origin,contentVersion:c.contentVersion,depthKey:c.depthKey,ancestorToolIds:[...c.ancestorToolIds],...(c.qualityKey ? {qualityKey:c.qualityKey} : {})} });
    }
    if (isNew) {
      // Si setWell falla, el estado anterior queda intacto pero la generación se invalida.
      gen = -1;
      engine.setWell({ id: msg.wellId, depth: msg.depth!, curves: [...next.values()] });
      gen = msg.gen;
      sent.clear();
    } else {
      engine.updateCurves([...next.values()]);
    }
    rawWell = { id: msg.wellId, depth: msg.depth ?? rawWell!.depth, curves: [...next.values()] };
    curves = next; syncId = msg.syncId; context = {...msg.context};
  };

  const perform = (msg: Extract<ToEngine, { type: 'run' }>, prepared?: PreparedPayload[]) => {
    try {
        const result = engine.run(msg.interpretation);
        if (msg.preparation) result.diagnostics.unshift(...msg.preparation.diagnostics.filter(d => d.status !== 'disabled').map(d => ({ level: 'warning' as const, code: 'missing-input' as const, message: d.message })));
        const transfer: Transferable[] = [];
        // Lo que el cliente va a tener si este mensaje llega. Se confirma en `sent` solo después de enviarlo:
        // si postMessage falla (p. ej. una tabla con un valor no clonable), `sent` sigue describiendo lo que el
        // cliente tiene y la próxima corrida reenvía lo que falte.
        const delivered = new Map<string, number>();
        const outputs: WireOutput[] = result.outputs.map((o) => {
          delivered.set(o.key, o.version);
          if (!msg.full && sent.get(o.key) === o.version) {
            const { value: _omit, ...meta } = o;
            return meta;
          }
          if (o.value instanceof Float64Array) {
            // Copia: el original queda en la caché del motor; la copia se transfiere sin volver a copiar.
            const copy = o.value.slice();
            transfer.push(copy.buffer);
            return { ...o, value: copy };
          }
          return o;
        });
        const wirePrepared = prepared?.map(p => { const data = p.data.slice(), quality = p.quality.slice(); transfer.push(data.buffer, quality.buffer); return { ...p, data, quality }; });
        reply({ type: 'result', seq: msg.seq, gen: msg.gen, context:{...msg.context}, result: { ...result, outputs }, ...(wirePrepared ? { prepared: wirePrepared } : {}) }, transfer);
        // Llegó: lo que no está en esta respuesta ya no lo tiene el cliente (reconstruye el conjunto completo).
        sent.clear();
        for (const [key, version] of delivered) sent.set(key, version);
      } catch (err) {
        reply({ type: 'error', seq: msg.seq, gen: msg.gen, syncId:msg.syncId, context:msg.context, message: err instanceof Error ? err.message : String(err) });
      }
  };

  const onMessage = (ev: MessageEvent) => {
    const msg = ev.data as ToEngine;
    if (msg.type === 'cancel') { if (activeTask?.gen === msg.gen && activeTask.seq === msg.seq) taskToken++; return; }
    if (msg.type === 'well') {
      taskToken++;
      try {
        loadWell(msg);
      } catch (err) {
        if (err instanceof InvalidDelta) reply({type:'resync',seq:-1,gen:msg.gen,syncId:msg.syncId,context:msg.context,message:err.message});
        else reply({ type: 'error', seq: -1, gen: msg.gen, syncId:msg.syncId, context:msg.context, message: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    if (msg.type === 'run') {
      if (msg.gen !== gen || !engine.hasWell || msg.syncId !== syncId || !context || !validContext(msg.context) || !sameInputDomain(context,msg.context)) {
        reply({type:'resync',seq:msg.seq,gen:msg.gen,syncId:msg.syncId,context:msg.context,message:'El contexto del cálculo no coincide con las entradas residentes.'});
        return;
      }
      const token = ++taskToken;
      activeTask = { gen: msg.gen, seq: msg.seq };
      if (!msg.preparation && !msg.interpretation.preparation?.nodes.length) { perform(msg); return; }
      const originals = rawWell!;
      void (async () => {
        try {
          if (!msg.preparation || !msg.interpretation.preparation?.nodes.length) throw new Error('La preparación necesita un plan validado.');
          const plan = planPreparation(originals, msg.interpretation, msg.context.inputRevisionId, registry, msg.preparation.bindings, msg.context.depthKey);
          if (plan.stateKey !== msg.preparation.stateKey || !sameContext(plan.context, msg.context) || plan.originalKey !== msg.preparation.originalKey || JSON.stringify(plan.artifacts) !== JSON.stringify(msg.preparation.artifacts)) throw new Error('El plan de preparación no corresponde a las entradas residentes.');
          const prepared = await evaluator.evaluate(originals, plan, () => token !== taskToken || stopped);
          if (token !== taskToken || stopped) throw new PreparationCancelled();
          engine.updateCurves(projectedEngineCurves(originals, plan, prepared));
          perform(msg, prepared);
        } catch (error) {
          if (error instanceof PreparationCancelled) reply({ type: 'cancelled', gen: msg.gen, seq: msg.seq, context: msg.context });
          else reply({ type: 'error', gen: msg.gen, seq: msg.seq, syncId: msg.syncId, context: msg.context, message: error instanceof Error ? error.message : String(error) });
        }
      })();
    }
  };

  endpoint.addEventListener('message', onMessage);
  endpoint.start?.();
  return () => { stopped = true; taskToken++; endpoint.removeEventListener('message', onMessage); };
}

