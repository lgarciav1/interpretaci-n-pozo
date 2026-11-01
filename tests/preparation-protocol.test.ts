import { describe, expect, it } from 'vitest';
import { EngineClient, type ClientResult } from '../src/core/engine/client';
import { EngineSupervisor } from '../src/core/engine/supervisor';
import { serveEngine } from '../src/core/engine/serve';
import type { Endpoint, FromEngine, ToEngine } from '../src/core/engine/protocol';
import { createRegistry } from '../src/core/registry';
import { addMaskInterval, entryPreparationPlan } from '../src/core/state/preparation';
import { addWell, createProject } from '../src/core/state/project';
import { createWell } from '../src/core/well';
import { toEngineWell } from '../src/core/engine/engine';
import { curve, linearModule } from './helpers';

const registry = createRegistry([linearModule('igr', 'GR', 'IGR')]);
function fixture(n = 4) {
  const well = createWell({ id: 'w', name: 'W', depth: Float64Array.from({ length: n }, (_, k) => k), curves: [{ ...curve('GR', 'GR', Float64Array.from({ length: n }, (_, k) => k * 10)), origin: { kind: 'measured' } }] });
  const project = addMaskInterval(addWell(createProject(), well), well.id, 'GR', { id: 'r', top: 1, base: 2 }, 'mask');
  const entry = project.wells[0]!, plan = entryPreparationPlan(project, entry, registry);
  return { entry, plan, well: toEngineWell(entry.well) };
}
function channel(output: (message: FromEngine) => FromEngine = m => m, input: (message: ToEngine) => ToEngine = m => m) {
  const pair = new MessageChannel(), requests: ToEngine[] = [];
  const clientSide: Endpoint = { postMessage: (m, t) => { requests.push(m as ToEngine); pair.port1.postMessage(input(m as ToEngine), t ?? []); }, addEventListener: (_, listener) => pair.port1.addEventListener('message', listener), removeEventListener: (_, listener) => pair.port1.removeEventListener('message', listener), start: () => pair.port1.start() };
  const serverSide: Endpoint = { postMessage: (m, t) => pair.port2.postMessage(output(m as FromEngine), t ?? []), addEventListener: (_, listener) => pair.port2.addEventListener('message', listener), removeEventListener: (_, listener) => pair.port2.removeEventListener('message', listener), start: () => pair.port2.start() };
  const stop = serveEngine(serverSide, registry);
  return { client: new EngineClient(clientSide, () => { stop(); pair.port1.close(); pair.port2.close(); }), requests };
}
function next(client: EngineClient | EngineSupervisor): Promise<ClientResult> {
  return new Promise((resolve, reject) => { const off = client.subscribe(e => { if (e.type === 'result') { off(); resolve(e.result); } else if (e.type === 'error') { off(); reject(new Error(e.message)); } }); });
}
describe('paquete atómico de preparación', () => {
  it.each(['missing', 'quality', 'version', 'duplicate'] as const)('rechaza %s y pide una sola recuperación completa antes de publicar', async fault => {
    let bad = true;
    const { client, requests } = channel(m => {
      if (m.type !== 'result' || !m.prepared || !bad) return m;
      bad = false;
      if (fault === 'missing') return { ...m, prepared: [] };
      const p = m.prepared.map(p => ({ ...p }));
      if (fault === 'quality') p[0]!.quality = Uint16Array.of(0);
      if (fault === 'version') p[0]!.version = 'stale';
      if (fault === 'duplicate') p.push(p[0]!);
      return { ...m, prepared: p };
    });
    const { entry, plan, well } = fixture(); let published = 0;
    client.subscribe(e => { if (e.type === 'result') published++; });
    try {
      client.syncWell(well, plan.context); const done = next(client); client.run(entry.interpretation, plan.context, plan);
      const result = await done;
      expect(published).toBe(1); expect(result.preparation?.artifacts[0]!.data).toEqual(Float64Array.of(0, NaN, NaN, 30));
      expect(requests.filter(m => m.type === 'run' && m.full)).toHaveLength(1);
      expect(well.curves[0]!.data.byteLength).toBe(32);
    } finally { client.dispose(); }
  });
  it('el supervisor reenvía la receta tras un solo reinicio, termina con error y permite otro pedido limpio', async () => {
    let bad = true, created = 0; const channels: ReturnType<typeof channel>[] = [];
    const supervisor = new EngineSupervisor({ createInProcess: () => { created++; const c = channel(m => m.type === 'result' && bad ? { ...m, prepared: [] } : m); channels.push(c); return c.client; } });
    const { entry, plan, well } = fixture();
    try {
      supervisor.syncWell(well, plan.context); const done = next(supervisor); supervisor.run(entry.interpretation, plan.context, plan);
      await expect(done).rejects.toThrow(/recuperar/); expect(created).toBe(2); expect(channels.flatMap(c => c.requests).filter(m => m.type === 'run')).toHaveLength(4);
      bad = false; const clean = next(supervisor); supervisor.run(entry.interpretation, plan.context, plan);
      expect((await clean).preparation?.artifacts).toHaveLength(1); expect(created).toBe(3);
    } finally { supervisor.dispose(); }
  });
  it('cancelar por bloques no publica el estado descartado y deja el canal utilizable', async () => {
    const { client } = channel(), { entry, plan, well } = fixture(33000); let published = 0;
    client.subscribe(e => { if (e.type === 'result') published++; });
    try {
      const cancelled = new Promise<void>(resolve => { const off = client.subscribe(e => { if (e.type === 'cancelled') { off(); resolve(); } }); });
      client.syncWell(well, plan.context); client.run(entry.interpretation, plan.context, plan); client.cancel();
      await cancelled; expect(published).toBe(0);
      const ready = next(client); client.run(entry.interpretation, plan.context, plan);
      expect((await ready).preparation?.artifacts[0]!.data.length).toBe(33000);
    } finally { client.dispose(); }
  });
  it('el worker vuelve a planificar y rechaza un alcance alterado en tránsito', async () => {
    const { client } = channel(m => m, m => m.type === 'run' && m.preparation ? { ...m, preparation: { ...m.preparation, artifacts: m.preparation.artifacts.map(a => ({ ...a, ranges: [{ top: 0, base: 3 }] })) } } : m);
    const { entry, plan, well } = fixture();
    try {
      client.syncWell(well, plan.context); const done = next(client); client.run(entry.interpretation, plan.context, plan);
      await expect(done).rejects.toThrow(/plan de preparación/);
    } finally { client.dispose(); }
  });
});
