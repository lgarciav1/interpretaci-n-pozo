import { afterEach, describe, expect, it } from 'vitest';
import { EngineClient, createInProcessClient, type ClientResult } from '../src/core/engine/client';
import { engineContext, sameContext, sameComputation, entryEngineContext } from '../src/core/engine/context';
import { serveEngine } from '../src/core/engine/serve';
import { EngineSupervisor, type WorkerLike } from '../src/core/engine/supervisor';
import type { Endpoint, ToEngine, FromEngine } from '../src/core/engine/protocol';
import { Engine } from '../src/core/engine/engine';
import { createRegistry } from '../src/core/registry';
import { curve, well, interp, linearModule } from './helpers';
import { createWell } from '../src/core/well';
import { addWell, createProject, updateWell, setParam } from '../src/core/state/project';
import { enableProjectInputRevisions } from '../src/core/state/inputRevisions';
import { computedCurves } from '../src/app/computed';
import { exportSources } from '../src/app/export/exportActions';
const registry = createRegistry([linearModule('igr', 'GR', 'IGR'), linearModule('vsh', 'IGR', 'VSH')]);
const w = well([curve('gr', 'GR', [10, 20, 30, 40])]);
const disposables: {
  dispose(): void;
}[] = [];
afterEach(() => { for (const x of disposables)
  x.dispose(); disposables.length = 0; });
function next(client: EngineClient | EngineSupervisor): Promise<ClientResult> { return new Promise((resolve, reject) => { const off = client.subscribe(e => { if (e.type === 'result') {
  off();
  resolve(e.result);
} if (e.type === 'error') {
  off();
  reject(new Error(e.message));
} }); }); }
function channel(output: (m: FromEngine) => FromEngine = m => m, input: (m: ToEngine) => ToEngine = m => m) {
  const pair = new MessageChannel();
  const sent: ToEngine[] = [], responses: FromEngine[] = [];
  const a: Endpoint = { postMessage: (m, t) => { sent.push(m as ToEngine); pair.port1.postMessage(input(m as ToEngine), t ?? []); }, addEventListener: (_, l) => pair.port1.addEventListener('message', l), removeEventListener: (_, l) => pair.port1.removeEventListener('message', l), start: () => pair.port1.start() };
  const b: Endpoint = { postMessage: (m, t) => { responses.push(m as FromEngine); pair.port2.postMessage(output(m as FromEngine), t ?? []); }, addEventListener: (_, l) => pair.port2.addEventListener('message', l), removeEventListener: (_, l) => pair.port2.removeEventListener('message', l), start: () => pair.port2.start() };
  const stop = serveEngine(b, registry);
  const client = new EngineClient(a, () => { stop(); pair.port1.close(); pair.port2.close(); });
  disposables.push(client);
  return { client, sent, responses };
}
const initial = () => { const c = createInProcessClient(registry); disposables.push(c); return c; };
describe('identidad del contexto', () => {
  it('params/zonas/fuentes/sarta/datos cambian engineKey; laboratorio, tendencias y display no', () => {
    const i = interp(), a = engineContext(w, i, 'rev-a');
    expect(sameComputation(a, engineContext(w, { ...i, trends: [] }, 'rev-b'))).toBe(true);
    expect(sameContext(a, engineContext(w, i, 'rev-b'))).toBe(false);
    for (const changed of [interp({ params: { global: { m: 3 }, zones: {} } }), interp({ zones: [{ id: 'a', name: 'A', top: 1000, base: 1002, kind: 'formation', color: '#888' }] }), interp({ sources: { GR: { kind: 'curve', curveId: 'missing' } } }), interp({ disabled: ['igr'] }), interp({ compare: ['vsh'] }), interp({ toolString: { mode: 'data', off: ['x'], order: [], plan: [], planOff: [] } })])
      expect(engineContext(w, changed).engineKey).not.toBe(a.engineKey);
    expect(engineContext({ ...w, curves: [{ ...w.curves[0]!, data: Float64Array.of(1, 2, 3, 4) }] }, i).engineKey).not.toBe(a.engineKey);
    expect(engineContext({ ...w, depth: w.depth.slice() }, i).depthKey).not.toBe(a.depthKey);
  });
  it('la misma identidad física mantiene arrays/fuentes y no inventa procedencia', () => {
    const i = interp();
    expect(engineContext(w, i)).toEqual(engineContext(w, i));
    expect(w.curves[0]!.data[0]).toBe(10);
    const { client, sent } = channel();
    client.syncWell(w);
    client.run(i);
    const msg = sent.find(m => m.type === 'well')!;
    if (msg.type !== 'well')
      throw new Error('well');
    expect(msg.curves[0]).toMatchObject({ origin: 'original', ancestorToolIds: [] });
    expect(msg.curves[0]!.data).toBe(w.curves[0]!.data);
  });
  it('un cambio exclusivo de laboratorio permite volver a vincular un resultado completo sin cálculo', () => {
    const real = createWell({ id: w.id, name: 'W', depth: w.depth, curves: w.curves.map(c => ({ ...c, origin: { kind: 'measured' as const } })) });
    const p = enableProjectInputRevisions(addWell(createProject(), real));
    const first = p.wells[0]!;
    const changed = updateWell(p, real.id, d => ({ ...d, name: 'Nombre nuevo' }));
    const after = changed.wells[0]!;
    expect(sameComputation(entryEngineContext(first), entryEngineContext(after))).toBe(true);
    expect(sameContext(entryEngineContext(first), entryEngineContext(after))).toBe(false);
    expect(sameComputation(entryEngineContext(after), entryEngineContext(setParam(changed, real.id, 'm', 3).wells[0]!))).toBe(false);
  });
});
describe('respuestas atómicas y resync', () => {
  it('pide completo una vez y nunca publica una respuesta incompleta', async () => {
    let bad = true;
    const { client, sent } = channel(m => { if (m.type === 'result' && bad) {
      bad = false;
      const outputs = m.result.outputs.map((o, i) => { const copy = { ...o }; if (i === 0)
        delete copy.value; return copy; });
      return { ...m, result: { ...m.result, outputs } };
    } return m; });
    const results: ClientResult[] = [];
    client.subscribe(e => { if (e.type === 'result')
      results.push(e.result); });
    client.syncWell(w);
    const promise = next(client);
    client.run(interp());
    const result = await promise;
    expect(results).toHaveLength(1);
    expect(result.outputs).toHaveLength(2);
    expect(sent.filter(m => m.type === 'run' && m.full)).toHaveLength(1);
    expect((result.outputs[0]!.value as Float64Array)[0]).toBe(10);
  });
  it.each(['context', 'dimension', 'duplicate', 'version'] as const)('rechaza %s y recupera el conjunto íntegro', async (fault) => {
    let bad = true;
    const { client } = channel(m => {
      if (m.type !== 'result' || !bad)
        return m;
      bad = false;
      if (fault === 'context')
        return { ...m, context: { ...m.context, preparationKey: 'wrong' } };
      const outputs = m.result.outputs.map(o => ({ ...o }));
      if (fault === 'dimension')
        outputs[0]!.value = Float64Array.of(1);
      if (fault === 'duplicate')
        outputs.push(outputs[0]!);
      if (fault === 'version')
        outputs[0]!.version = NaN;
      return { ...m, result: { ...m.result, outputs } };
    });
    client.syncWell(w);
    const promise = next(client);
    client.run(interp());
    const result = await promise;
    expect(result.outputs.map(o => o.key)).toEqual(['igr:IGR', 'vsh:VSH']);
    expect(result.context).toEqual(engineContext(w, interp()));
  });
  it('un delta de curva sin datos para su contentVersion pide pozo completo y se recupera', async () => {
    let corrupt = false;
    const { client, sent, responses } = channel(m => m, m => {
      if (m.type === 'well' && corrupt && !m.depth) {
        corrupt = false;
        return { ...m, curves: m.curves.map(c => { const copy = { ...c }; delete copy.data; return copy; }) };
      }
      return m;
    });
    client.syncWell(w);
    let promise = next(client);
    client.run(interp());
    await promise;
    corrupt = true;
    const changed = { ...w, curves: [{ ...w.curves[0]!, data: Float64Array.of(50, 60, 70, 80) }] };
    client.syncWell(changed);
    promise = next(client);
    client.run(interp());
    const result = await promise;
    expect((result.outputs[0]!.value as Float64Array)[0]).toBe(50);
    expect(responses.some(m => m.type === 'resync')).toBe(true);
    expect(sent.filter(m => m.type === 'well' && m.depth)).toHaveLength(2);
    expect(w.curves[0]!.data[0]).toBe(10);
    expect(changed.curves[0]!.data.byteLength).toBe(32);
  });
  it('reintentos fallidos no publican parciales ni dejan busy para siempre en el cliente directo', async () => {
    const { client, sent } = channel(m => m.type === 'result' ? { ...m, result: { ...m.result, outputs: m.result.outputs.map(o => { const x = { ...o }; delete x.value; return x; }) } } : m);
    client.syncWell(w);
    const promise = next(client);
    client.run(interp());
    await expect(promise).rejects.toThrow(/incompleto/);
    expect(client.busy).toBe(false);
    expect(sent.filter(m => m.type === 'run')).toHaveLength(2);
  });
  it('el contexto exacto viaja en una copia del resultado y se conserva al recibir deltas', async () => {
    const c = initial(), i = interp(), context = engineContext(w, i, 'input-revision');
    c.syncWell(w, context);
    let promise = next(c);
    c.run(i, context);
    const first = await promise;
    promise = next(c);
    c.run(i, context);
    const second = await promise;
    expect(second.context).toEqual(context);
    expect(second.context).not.toBe(context);
    expect(Object.isFrozen(second.context)).toBe(true);
    expect(second.outputs[0]!.value).toBe(first.outputs[0]!.value);
    expect(second.stats.recomputed).toEqual([]);
  });
  it('la API conserva el pedido anterior a syncWell y coalesce antes de disponer de datos', async () => {
    const c = initial();
    c.run(interp());
    c.run(interp({ params: { global: { 'vsh.offset': 5 }, zones: {} } }));
    const promise = next(c);
    c.syncWell(w);
    expect(((await promise).outputs.find(o => o.key === 'vsh:VSH')!.value as Float64Array)[0]).toBe(15);
  });
});
class BrokenWorker implements WorkerLike {
  private readonly pair = new MessageChannel();
  private readonly stop: () => void;
  private readonly listeners = new Map<Function, EventListener>();
  constructor(private readonly broken: boolean) { this.stop = serveEngine(this.pair.port2, registry); }
  postMessage(m: unknown, t: Transferable[] = []) { this.pair.port1.postMessage(m, t); }
  addEventListener(type: string, l: (e: {
    data?: unknown;
    message?: string;
  }) => void) { if (type !== 'message')
    return; const f: EventListener = ev => { const msg = (ev as MessageEvent).data as FromEngine; l({ data: this.broken && msg.type === 'result' ? { ...msg, result: { ...msg.result, outputs: msg.result.outputs.map(o => { const x = { ...o }; delete x.value; return x; }) } } : msg }); }; this.listeners.set(l, f); this.pair.port1.addEventListener('message', f); this.pair.port1.start(); }
  removeEventListener(type: string, l: Function) { if (type === 'message') {
    const f = this.listeners.get(l);
    if (f)
      this.pair.port1.removeEventListener('message', f);
    this.listeners.delete(l);
  } }
  terminate() { this.stop(); this.pair.port1.close(); this.pair.port2.close(); }
}
describe('límite del supervisor', () => {
  it('reinicia una vez por deltas persistentemente inválidos y luego informa error visible', async () => {
    let created = 0;
    const sup = new EngineSupervisor({ createWorker: () => { created++; return new BrokenWorker(true); }, createInProcess: () => createInProcessClient(registry) });
    disposables.push(sup);
    const results: ClientResult[] = [];
    sup.subscribe(e => { if (e.type === 'result')
      results.push(e.result); });
    sup.syncWell(w);
    const promise = next(sup);
    sup.run(interp());
    await expect(promise).rejects.toThrow(/No se pudo recuperar/);
    expect(created).toBe(2);
    expect(results).toEqual([]);
  });
  it('un pedido explícito nuevo puede recuperarse después del error terminal', async () => {
    let created = 0;
    const sup = new EngineSupervisor({ createWorker: () => new BrokenWorker(++created <= 2), createInProcess: () => createInProcessClient(registry) });
    disposables.push(sup);
    sup.syncWell(w);
    let promise = next(sup);
    sup.run(interp());
    await expect(promise).rejects.toThrow();
    promise = next(sup);
    sup.run(interp({ params: { global: { 'vsh.offset': 3 }, zones: {} } }));
    expect((await promise).outputs).toHaveLength(2);
    expect(created).toBe(3);
  });
  it('un motor limpio después del reinicio entrega un único resultado completo', async () => {
    let created = 0;
    const sup = new EngineSupervisor({ createWorker: () => new BrokenWorker(++created === 1), createInProcess: () => createInProcessClient(registry) });
    disposables.push(sup);
    sup.syncWell(w);
    const promise = next(sup);
    sup.run(interp());
    const result = await promise;
    expect(created).toBe(2);
    expect(result.outputs).toHaveLength(2);
    expect(result.context).toEqual(engineContext(w, interp()));
  });
});
describe('frontera de consumo', () => {
  it('visor/exportaciones rechazan resultados de otra profundidad o datos aunque wellId sea igual', async () => {
    const c = initial();
    c.syncWell(w);
    const promise = next(c);
    c.run(interp());
    const result = await promise;
    const raw = createWell({ id: w.id, name: 'W', depth: w.depth, curves: w.curves.map(curve => ({ ...curve, origin: { kind: 'measured' as const } })) });
    expect(computedCurves(result, raw)).not.toEqual([]);
    const changed = { ...raw, curves: raw.curves.map(c => ({ ...c, data: c.data.slice() })) };
    expect(computedCurves(result, changed)).toEqual([]);
    expect(exportSources(changed, result, false).columns.every(c => c.origin !== 'computed')).toBe(true);
    expect(exportSources(raw, result, false, engineContext(w, interp({ params: { global: { m: 3 }, zones: {} } }))).summary).toBeNull();
  });
});
describe('mensajes atrasados con ids de transporte engañosos', () => {
  function manual() {
    const sent: ToEngine[] = [];
    let receive: ((ev: MessageEvent) => void) | null = null;
    const endpoint: Endpoint = { postMessage: m => { sent.push(m as ToEngine); }, addEventListener: (_, l) => { receive = l; }, removeEventListener: () => { receive = null; } };
    const c = new EngineClient(endpoint);
    disposables.push(c);
    const engine = new Engine(registry);
    engine.setWell(w);
    const run = () => sent.filter((m): m is Extract<ToEngine, {
      type: 'run';
    }> => m.type === 'run').at(-1)!;
    const reply = (r: Extract<ToEngine, {
      type: 'run';
    }>, patch: Partial<Extract<FromEngine, {
      type: 'result';
    }>> = {}) => { const result = engine.run(r.interpretation); receive?.({ data: { type: 'result', gen: r.gen, seq: r.seq, context: r.context, result, ...patch } } as MessageEvent); };
    return { c, sent, engine, run, reply, receive: (m: unknown) => receive?.({ data: m } as MessageEvent) };
  }
  it('un gen/seq ajeno y mensajes desconocidos no liberan el pedido en vuelo', () => {
    const m = manual(), results: ClientResult[] = [];
    m.c.subscribe(e => { if (e.type === 'result')
      results.push(e.result); });
    m.c.syncWell(w);
    m.c.run(interp());
    const r = m.run();
    m.reply(r, { gen: r.gen - 1 });
    m.reply(r, { seq: r.seq + 10 });
    m.receive({ type: 'unknown', gen: r.gen, seq: r.seq });
    expect(m.c.busy).toBe(true);
    expect(results).toEqual([]);
    m.reply(r);
    expect(m.c.busy).toBe(false);
    expect(results).toHaveLength(1);
  });
  it('descarta un resultado del mismo pozo/profundidad cuando sus curvas ya fueron sustituidas', () => {
    const m = manual(), results: ClientResult[] = [];
    m.c.subscribe(e => { if (e.type === 'result')
      results.push(e.result); });
    m.c.syncWell(w);
    m.c.run(interp());
    const old = m.run(), oldResult = m.engine.run(old.interpretation);
    const changed = { ...w, curves: [{ ...w.curves[0]!, data: Float64Array.of(100, 200, 300, 400) }] };
    m.c.syncWell(changed);
    m.c.run(interp());
    m.receive({ type: 'result', seq: old.seq, gen: old.gen, context: old.context, result: oldResult });
    expect(results).toEqual([]);
    m.engine.updateCurves(changed.curves);
    m.reply(m.run());
    expect(results).toHaveLength(1);
    expect((results[0]!.outputs[0]!.value as Float64Array)[0]).toBe(100);
  });
  it('conserva la base incremental sin publicar el cálculo intermedio y atribuye todos los valores al último contexto', () => {
    const m = manual(), results: ClientResult[] = [];
    m.c.subscribe(e => { if (e.type === 'result')
      results.push(e.result); });
    m.c.syncWell(w);
    m.c.run(interp());
    const first = m.run();
    m.c.run(interp({ params: { global: { 'vsh.offset': 5 }, zones: {} } }));
    m.reply(first);
    expect(results).toEqual([]);
    const last = m.run(), r = m.engine.run(last.interpretation);
    const outputs = r.outputs.map(o => { if (o.key === 'igr:IGR') {
      const { value: _omit, ...meta } = o;
      return meta;
    } return o; });
    m.receive({ type: 'result', seq: last.seq, gen: last.gen, context: last.context, result: { ...r, outputs } });
    expect(results).toHaveLength(1);
    expect(results[0]!.context).toEqual(last.context);
    expect((results[0]!.outputs[1]!.value as Float64Array)[0]).toBe(15);
  });
  it('una revisión distinta con la misma física no admite publicar el contexto anterior', () => {
    const m = manual(), i = interp(), a = engineContext(w, i, 'a'), b = engineContext(w, i, 'b'), results: ClientResult[] = [];
    m.c.subscribe(e => { if (e.type === 'result')
      results.push(e.result); });
    m.c.syncWell(w, a);
    m.c.run(i, a);
    const first = m.run();
    m.c.syncWell(w, b);
    m.c.run(i, b);
    m.reply(first);
    expect(results).toEqual([]);
    m.reply(m.run());
    expect(results).toHaveLength(1);
    expect(results[0]!.context).toEqual(b);
    expect(results[0]!.stats.recomputed).toEqual([]);
  });
  it('errores de carga de una sincronización anterior no se atribuyen a la actual', () => {
    const m = manual(), errors: string[] = [];
    m.c.subscribe(e => { if (e.type === 'error')
      errors.push(e.message); });
    m.c.syncWell(w);
    const first = m.sent.find((x): x is Extract<ToEngine, {
      type: 'well';
    }> => x.type === 'well')!;
    m.c.syncWell(w);
    m.receive({ type: 'error', seq: -1, gen: first.gen, syncId: first.syncId, context: first.context, message: 'stale' });
    expect(errors).toEqual([]);
  });
  it('el orden de las claves JSON no genera una identidad científica distinta', () => {
    const a = interp({ params: { global: { m: 2, n: 3 }, zones: {} } }), b = interp({ params: { global: { n: 3, m: 2 }, zones: {} } });
    expect(engineContext(w, a)).toEqual(engineContext(w, b));
  });
  it('una proyección preparada no puede hacerse pasar por identidad', () => {
    expect(() => engineContext({ ...w, curves: [{ ...w.curves[0]!, provenance: { origin: 'prepared', contentVersion: 'x', depthKey: 'x', ancestorToolIds: [] } }] }, interp())).toThrow(/plan validado/);
  });
});


describe('metadatos y formas de salidas incrementales',()=>{
 it.each(['unit','kind','scalar','table','zoneScalar'] as const)('no admite %s incompatible con la salida',async fault=>{
  let bad=false;const {client,sent}=channel(m=>{
   if(m.type!=='result'||!bad)return m;bad=false;
   const outputs=m.result.outputs.map(o=>({...o})),o=outputs[0]!;
   if(fault==='unit')o.unit='other-unit';
   if(fault==='kind')o.kind='scalar';
   if(fault==='scalar'){o.kind='scalar';o.version++;o.value='bad' as unknown as number;}
   if(fault==='table'){o.kind='table';o.version++;o.value={} as unknown as number;}
   if(fault==='zoneScalar'){o.kind='zoneScalar';o.version++;o.value={x:'bad'} as unknown as number;}
   return{...m,result:{...m.result,outputs}};
  });client.syncWell(w);let promise=next(client);client.run(interp());await promise;
  bad=true;promise=next(client);client.run(interp());const result=await promise;
  expect(result.outputs[0]!.kind).toBe('curve');expect(sent.filter(m=>m.type==='run'&&m.full)).toHaveLength(1);
 });
 it('un contexto inválido se rechaza antes de modificar los datos residentes del cliente',async()=>{
  const client=initial();client.syncWell(w);let promise=next(client);client.run(interp());await promise;
  expect(()=>client.syncWell({...w,id:'other'},engineContext(w,interp()))).toThrow(/Contexto/);
  promise=next(client);client.run(interp());expect((await promise).wellId).toBe(w.id);
 });
});
