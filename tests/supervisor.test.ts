/**
 * Supervisor del motor: worker que no arranca, worker que se cae en medio de un cálculo, límite de reinicios,
 * y resultados etiquetados con pozo y generación.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createInProcessClient, type ClientResult } from '../src/core/engine/client';
import { serveEngine } from '../src/core/engine/serve';
import { EngineSupervisor, type SupervisorEvent, type WorkerLike } from '../src/core/engine/supervisor';
import { createRegistry } from '../src/core/registry';
import { curve, interp, linearModule, well } from './helpers';

const registry = createRegistry([linearModule('igr', 'GR', 'IGR'), linearModule('vsh', 'IGR', 'VSH')]);
const gr = curve('GR1', 'GR', [10, 20, 30, 40]);
const withOffset = (k: number) => interp({ params: { global: { 'vsh.offset': k }, zones: {} } });

type Listener = (ev: { data?: unknown; message?: string }) => void;

/** Worker falso: el motor real detrás de un MessageChannel, con un botón para "matarlo". */
class FakeWorker implements WorkerLike {
  private readonly channel = new MessageChannel();
  private readonly stop: () => void;
  private readonly errorListeners = new Set<Listener>();
  terminated = false;

  constructor() {
    this.stop = serveEngine(this.channel.port2, registry, { checkInputs: true });
  }
  postMessage(message: unknown, transfer: Transferable[] = []) {
    if (!this.terminated) this.channel.port1.postMessage(message, transfer);
  }
  addEventListener(type: string, l: Listener) {
    if (type === 'message') {
      this.channel.port1.addEventListener('message', l as (ev: MessageEvent) => void);
      this.channel.port1.start();
    } else this.errorListeners.add(l);
  }
  removeEventListener(type: string, l: Listener) {
    if (type === 'message') this.channel.port1.removeEventListener('message', l as (ev: MessageEvent) => void);
    else this.errorListeners.delete(l);
  }
  terminate() {
    this.terminated = true;
    this.stop();
    this.channel.port1.close();
    this.channel.port2.close();
  }
  /** Simula una caída: deja de responder y emite 'error'. */
  crash(message = 'se cayó') {
    this.stop();
    for (const l of [...this.errorListeners]) l({ message });
  }
}

let supervisors: EngineSupervisor[] = [];
afterEach(() => {
  supervisors.forEach((s) => s.dispose());
  supervisors = [];
});

function setup(opts: { maxRestarts?: number } = {}) {
  const workers: FakeWorker[] = [];
  const events: SupervisorEvent[] = [];
  const sup = new EngineSupervisor({
    createWorker: () => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    },
    createInProcess: () => createInProcessClient(registry, { checkInputs: true }),
    ...(opts.maxRestarts !== undefined ? { maxRestarts: opts.maxRestarts } : {}),
  });
  supervisors.push(sup);
  sup.subscribe((e) => events.push(e));
  return { sup, workers, events };
}

function nextResult(sup: EngineSupervisor): Promise<ClientResult> {
  return new Promise((resolve) => {
    const off = sup.subscribe((e) => {
      if (e.type === 'result') {
        off();
        resolve(e.result);
      }
    });
  });
}

const vshAt0 = (r: ClientResult) => (r.outputs.find((o) => o.key === 'vsh:VSH')!.value as Float64Array)[0];

describe('supervisor del motor', () => {
  it('los resultados llevan pozo y generación; cambiar de pozo emite reset con generación nueva', async () => {
    const { sup, events } = setup();
    sup.syncWell(well([gr]));
    let p = nextResult(sup);
    sup.run(interp());
    const r1 = await p;
    expect(r1.wellId).toBe('w1');
    const reset1 = events.find((e) => e.type === 'reset')!;
    expect(reset1).toEqual({ type: 'reset', wellId: 'w1', gen: r1.gen });

    p = nextResult(sup);
    sup.syncWell({ ...well([curve('GR1', 'GR', [1, 2, 3])], 3), id: 'w2' });
    sup.run(interp());
    const r2 = await p;
    expect(r2.wellId).toBe('w2');
    expect(r2.gen).toBeGreaterThan(r1.gen);
    expect(events.filter((e) => e.type === 'reset')).toHaveLength(2);
    expect((r2.outputs[0]!.value as Float64Array).length).toBe(3);
  });

  it('si el worker se cae con un cálculo en vuelo, lo recrea, reenvía el pozo y relanza el último pedido', async () => {
    const { sup, workers, events } = setup();
    sup.syncWell(well([gr]));
    let p = nextResult(sup);
    sup.run(withOffset(1));
    await p;
    // pedido en vuelo + otro pendiente; el worker muere antes de responder
    sup.run(withOffset(2));
    sup.run(withOffset(3));
    p = nextResult(sup);
    workers[0]!.crash();
    const r = await p;
    expect(workers).toHaveLength(2);
    expect(workers[0]!.terminated).toBe(true);
    expect(sup.currentMode).toBe('worker');
    expect(sup.restartCount).toBe(1);
    expect(vshAt0(r)).toBe(13); // el último pedido (offset 3) sobre el pozo reenviado
    expect(events.filter((e) => e.type === 'reset')).toHaveLength(1); // el reinicio no borra resultados
    const busy = events.filter((e) => e.type === 'busy');
    expect(busy.at(-1)).toEqual({ type: 'busy', busy: false });
  });

  it('si el worker falla antes de su primera respuesta, pasa al motor en proceso', async () => {
    const { sup, workers, events } = setup();
    sup.syncWell(well([gr]));
    sup.run(withOffset(5));
    const p = nextResult(sup);
    workers[0]!.crash('Blob bloqueado');
    const r = await p;
    expect(workers).toHaveLength(1);
    expect(sup.currentMode).toBe('in-process');
    expect(events.find((e) => e.type === 'mode' && e.mode === 'in-process')).toMatchObject({ reason: 'el worker no arrancó (Blob bloqueado)' });
    expect(vshAt0(r)).toBe(15);
  });

  it('después de maxRestarts caídas, pasa al motor en proceso', async () => {
    const { sup, workers } = setup({ maxRestarts: 1 });
    sup.syncWell(well([gr]));
    for (let k = 0; k < 2; k++) {
      const p = nextResult(sup);
      sup.run(withOffset(k));
      await p;
      workers.at(-1)!.crash();
    }
    // tras la segunda caída se relanza el último pedido (offset 1) y después llega el nuevo
    const results: number[] = [];
    const done = new Promise<void>((resolve) =>
      sup.subscribe((e) => {
        if (e.type === 'result') results.push(vshAt0(e.result)!);
        if (e.type === 'busy' && !e.busy) resolve();
      }),
    );
    sup.run(withOffset(9));
    await done;
    expect(results.at(-1)).toBe(19);
    expect(workers).toHaveLength(2);
    expect(sup.currentMode).toBe('in-process');
  });

  it('si no se puede crear el worker, arranca en proceso', async () => {
    const sup = new EngineSupervisor({
      createWorker: () => {
        throw new Error('sin Worker');
      },
      createInProcess: () => createInProcessClient(registry),
    });
    supervisors.push(sup);
    expect(sup.currentMode).toBe('in-process');
    sup.syncWell(well([gr]));
    const p = nextResult(sup);
    sup.run(interp());
    expect(vshAt0(await p)).toBe(10);
  });
});
