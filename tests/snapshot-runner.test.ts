/** Corridas aisladas para comparar snapshots: atribución, cancelación de pedidos viejos y caché (docs/decisiones/0026). */
import { describe, expect, it } from 'vitest';
import { IsolatedRunner, runKey, type RunEntry } from '../src/app/snapshots/runner';
import { createInProcessClient } from '../src/core/engine/client';
import { EngineSupervisor } from '../src/core/engine/supervisor';
import { createRegistry } from '../src/core/registry';
import { curve, interp, linearModule, well } from './helpers';

const registry = createRegistry([linearModule('igr', 'GR', 'IGR'), linearModule('vsh', 'IGR', 'VSH')]);
const w = well([curve('GR1', 'GR', [10, 20, 30, 40])]);
const withOffset = (k: number) => interp({ params: { global: { 'vsh.offset': k }, zones: {} } });

function makeRunner() {
  return new IsolatedRunner(() => new EngineSupervisor({ createInProcess: () => createInProcessClient(registry) }));
}

/** Espera hasta que la entrada deje de estar pendiente. */
function settled(r: IsolatedRunner, key: string): Promise<RunEntry> {
  return new Promise((resolve) => {
    const check = () => {
      const e = r.get(key);
      if (e && e.status !== 'pending') {
        off();
        resolve(e);
      }
    };
    const off = r.subscribe(check);
    check();
  });
}

const vshOf = (e: RunEntry) => {
  if (e.status !== 'ready') throw new Error('sin resultado');
  return Array.from(e.result.outputs.find((o) => o.key === 'vsh:VSH')!.value as Float64Array);
};

describe('IsolatedRunner', () => {
  it('cada resultado corresponde a su pedido aunque se pidan varios seguidos', async () => {
    const r = makeRunner();
    const i1 = withOffset(1);
    const i2 = withOffset(2);
    const k1 = runKey('s1', i1, { id: w.id, depth: w.depth, curves: w.curves });
    const k2 = runKey('s2', i2, { id: w.id, depth: w.depth, curves: w.curves });
    r.acquire(k1, w, i1);
    r.acquire(k2, w, i2);
    expect(vshOf(await settled(r, k1))).toEqual([11, 21, 31, 41]);
    expect(vshOf(await settled(r, k2))).toEqual([12, 22, 32, 42]);
    expect(r.runCount).toBe(2);
  });

  it('un pedido en cola que ya nadie quiere se cancela sin calcular', async () => {
    const r = makeRunner();
    const [i1, i2, i3] = [withOffset(1), withOffset(2), withOffset(3)];
    const key = (id: string, i: ReturnType<typeof interp>) => runKey(id, i, { id: w.id, depth: w.depth, curves: w.curves });
    r.acquire(key('a', i1), w, i1); // sale enseguida
    const release2 = r.acquire(key('b', i2), w, i2); // queda en cola
    r.acquire(key('c', i3), w, i3);
    release2(); // la selección cambió antes de que saliera
    expect(r.get(key('b', i2))).toBeUndefined();
    expect(vshOf(await settled(r, key('c', i3)))).toEqual([13, 23, 33, 43]);
    expect(r.runCount).toBe(2);
  });

  it('la misma clave no vuelve a calcular (caché); otra revisión de la interpretación sí', async () => {
    const r = makeRunner();
    const i1 = withOffset(1);
    const k = runKey('s', i1, { id: w.id, depth: w.depth, curves: w.curves });
    const rel = r.acquire(k, w, i1);
    await settled(r, k);
    rel();
    r.acquire(k, w, i1);
    expect(r.get(k)?.status).toBe('ready');
    expect(r.runCount).toBe(1);
    const copy = structuredClone(i1);
    expect(runKey('s', copy, { id: w.id, depth: w.depth, curves: w.curves })).not.toBe(k);
  });
});
