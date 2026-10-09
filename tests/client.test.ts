/**
 * Protocolo motor ↔ cliente sobre un MessageChannel real (misma semántica de copia/transferencia que un worker).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createInProcessClient, type ClientEvent, type ClientResult, type EngineClient } from '../src/core/engine/client';
import { serveEngine } from '../src/core/engine/serve';
import { EngineClient as Client } from '../src/core/engine/client';
import type { FromEngine, ToEngine } from '../src/core/engine/protocol';
import { createRegistry } from '../src/core/registry';
import { curve, interp, linearModule, well } from './helpers';

const registry = createRegistry([linearModule('igr', 'GR', 'IGR'), linearModule('vsh', 'IGR', 'VSH')]);
const gr = curve('GR1', 'GR', [10, 20, 30, 40]);

function nextResult(client: EngineClient): Promise<ClientResult> {
  return new Promise((resolve, reject) => {
    const off = client.subscribe((e: ClientEvent) => {
      if (e.type === 'result') {
        off();
        resolve(e.result);
      } else if (e.type === 'error') {
        off();
        reject(new Error(e.message));
      }
    });
  });
}

let clients: EngineClient[] = [];
afterEach(() => {
  clients.forEach((c) => c.dispose());
  clients = [];
});

function makeClient() {
  const c = createInProcessClient(registry);
  clients.push(c);
  return c;
}

describe('cliente del motor', () => {
  it('calcula y devuelve todas las salidas', async () => {
    const client = makeClient();
    client.syncWell(well([gr]));
    const p = nextResult(client);
    client.run(interp());
    const r = await p;
    expect(r.outputs.map((o) => o.key)).toEqual(['igr:IGR', 'vsh:VSH']);
    expect([...(r.outputs[1]!.value as Float64Array)]).toEqual([10, 20, 30, 40]);
  });

  it('coalesce cambios rápidos: gana el último', async () => {
    const client = makeClient();
    client.syncWell(well([gr]));
    const results: ClientResult[] = [];
    client.subscribe((e) => e.type === 'result' && results.push(e.result));
    for (let k = 1; k <= 20; k++) client.run(interp({ params: { global: { 'vsh.offset': k }, zones: {} } }));
    await new Promise<void>((resolve) => {
      const off = client.subscribe((e) => {
        if (e.type === 'busy' && !e.busy) {
          off();
          resolve();
        }
      });
    });
    // 1 en vuelo + 1 pendiente (el último): nunca 20 cálculos.
    expect(results).toHaveLength(2);
    expect(results[1]!.coalesced).toBe(18);
    expect((results.at(-1)!.outputs.find((o) => o.key === 'vsh:VSH')!.value as Float64Array)[0]).toBe(30);
  });

  it('las salidas sin cambios no se reenvían pero el cliente las conserva', async () => {
    // Endpoint espía para ver qué viaja realmente.
    const channel = new MessageChannel();
    const seen: FromEngine[] = [];
    channel.port1.addEventListener('message', (ev) => seen.push(ev.data as FromEngine));
    const stop = serveEngine(channel.port2, registry);
    const client = new Client(channel.port1, () => {
      stop();
      channel.port1.close();
      channel.port2.close();
    });
    clients.push(client);
    client.syncWell(well([gr]));
    let p = nextResult(client);
    client.run(interp());
    await p;
    p = nextResult(client);
    client.run(interp({ params: { global: { 'vsh.offset': 1 }, zones: {} } }));
    const r = await p;
    const wire = seen.filter((m): m is Extract<FromEngine, { type: 'result' }> => m.type === 'result').at(-1)!;
    const igrWire = wire.result.outputs.find((o) => o.key === 'igr:IGR')!;
    expect(igrWire.value).toBeUndefined(); // no viajó
    expect(r.outputs.find((o) => o.key === 'igr:IGR')!.value).toBeInstanceOf(Float64Array); // pero el cliente la tiene
    expect(r.stats.recomputed).toEqual(['vsh']);
  });

  it('syncWell manda los datos una sola vez; después solo metadatos y arrays nuevos', () => {
    const sent: ToEngine[] = [];
    const fake = {
      postMessage: (m: unknown) => sent.push(m as ToEngine),
      addEventListener: () => {},
      removeEventListener: () => {},
    };
    const client = new Client(fake);
    const w = well([gr, curve('RT', 'RT', [1, 2, 3, 4])]);
    client.syncWell(w);
    client.syncWell({ ...w, curves: [{ ...w.curves[0]!, role: 'SP' }, w.curves[1]!] });
    const newData = Float64Array.from([5, 6, 7, 8]);
    client.syncWell({ ...w, curves: [w.curves[0]!, { ...w.curves[1]!, data: newData }] });
    const wells = sent.filter((m): m is Extract<ToEngine, { type: 'well' }> => m.type === 'well');
    expect(wells[0]!.depth).toBeDefined();
    expect(wells[0]!.curves.every((c) => c.data)).toBe(true);
    expect(wells[1]!.depth).toBeUndefined();
    expect(wells[1]!.curves.some((c) => c.data)).toBe(false);
    expect(wells[1]!.curves[0]!.role).toBe('SP');
    expect(wells[2]!.curves.map((c) => !!c.data)).toEqual([false, true]);
  });

  it('descarta resultados de un pozo anterior', async () => {
    const client = makeClient();
    client.syncWell(well([gr]));
    const results: ClientResult[] = [];
    client.subscribe((e) => e.type === 'result' && results.push(e.result));
    client.run(interp()); // en vuelo con el pozo 1
    const other = { ...well([curve('GR1', 'GR', [100, 200, 300, 400])]), id: 'w2' };
    client.syncWell(other); // generación nueva
    const p = nextResult(client);
    client.run(interp());
    const r = await p;
    expect(results).toHaveLength(1);
    expect((r.outputs[0]!.value as Float64Array)[0]).toBe(100);
  });

  it('informa errores de carga del pozo', async () => {
    const client = makeClient();
    const errors: string[] = [];
    client.subscribe((e) => e.type === 'error' && errors.push(e.message));
    client.syncWell({ id: 'mal', depth: Float64Array.from([1, 2, 3]), curves: [curve('GR1', 'GR', [1, 2])] });
    await new Promise((r) => setTimeout(r, 20));
    expect(errors[0]).toMatch(/2 muestras y la profundidad 3/);
  });
});
