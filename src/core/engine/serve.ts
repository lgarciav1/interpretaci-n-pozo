/**
 * Lado "servidor" del motor: escucha mensajes en un Endpoint (el `self` de un Web Worker, o un MessagePort en
 * proceso) y mantiene residentes el pozo y la caché del motor.
 */
import type { Registry } from '../registry';
import { Engine, type EngineCurve } from './engine';
import type { Endpoint, FromEngine, ToEngine, WireOutput } from './protocol';

export function serveEngine(endpoint: Endpoint, registry: Registry): () => void {
  const engine = new Engine(registry);
  let gen = -1;
  let curves = new Map<string, EngineCurve>();
  /** Versión de cada salida que ya tiene el cliente (para no reenviar datos sin cambios). */
  const sent = new Map<string, number>();

  const reply = (msg: FromEngine, transfer: Transferable[] = []) => endpoint.postMessage(msg, transfer);

  const loadWell = (msg: Extract<ToEngine, { type: 'well' }>) => {
    const isNew = msg.gen !== gen || !!msg.depth;
    if (isNew && !msg.depth) throw new Error('Mensaje de pozo nuevo sin profundidad.');
    const previous = isNew ? new Map<string, EngineCurve>() : curves;
    const next = new Map<string, EngineCurve>();
    for (const c of msg.curves) {
      const data = c.data ?? previous.get(c.id)?.data;
      if (!data) throw new Error(`El motor no tiene datos para la curva '${c.id}'.`);
      next.set(c.id, { id: c.id, mnemonic: c.mnemonic, role: c.role, unit: c.unit, data });
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
    curves = next;
  };

  const onMessage = (ev: MessageEvent) => {
    const msg = ev.data as ToEngine;
    if (msg.type === 'well') {
      try {
        loadWell(msg);
      } catch (err) {
        reply({ type: 'error', seq: -1, gen: msg.gen, message: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    if (msg.type === 'run') {
      if (msg.gen !== gen || !engine.hasWell) {
        reply({ type: 'error', seq: msg.seq, gen: msg.gen, message: 'Cálculo descartado: el pozo cambió.' });
        return;
      }
      try {
        const result = engine.run(msg.interpretation);
        const transfer: Transferable[] = [];
        const present = new Set<string>();
        const outputs: WireOutput[] = result.outputs.map((o) => {
          present.add(o.key);
          if (sent.get(o.key) === o.version) {
            const { value: _omit, ...meta } = o;
            return meta;
          }
          sent.set(o.key, o.version);
          if (o.value instanceof Float64Array) {
            // Copia: el original queda en la caché del motor; la copia se transfiere sin volver a copiar.
            const copy = o.value.slice();
            transfer.push(copy.buffer);
            return { ...o, value: copy };
          }
          return o;
        });
        for (const key of [...sent.keys()]) if (!present.has(key)) sent.delete(key);
        reply({ type: 'result', seq: msg.seq, gen: msg.gen, result: { ...result, outputs } }, transfer);
      } catch (err) {
        reply({ type: 'error', seq: msg.seq, gen: msg.gen, message: err instanceof Error ? err.message : String(err) });
      }
    }
  };

  endpoint.addEventListener('message', onMessage);
  endpoint.start?.();
  return () => endpoint.removeEventListener('message', onMessage);
}
