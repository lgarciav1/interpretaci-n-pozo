/**
 * «¿De dónde sale este número?» (docs/decisiones/0074): lo que publica el motor por nodo (`inputs`, `params`,
 * `segments`) y la traza pura `traceSample`, con un registro chico armado para cubrir cada caso y con el pozo del TP.
 */
import { afterEach, describe, expect, it } from 'vitest';
import csvText from '../datos/pozo_tp_perfiles.csv?raw';
import { createInProcessClient, type ClientEvent, type ClientResult, type EngineClient } from '../src/core/engine/client';
import { Engine, toEngineWell, type EngineRunResult, type NodeReport } from '../src/core/engine/engine';
import { traceSample, type Trace, type TraceLink } from '../src/core/engine/provenance';
import { emptyInterpretation, type Interpretation } from '../src/core/interpretation';
import { defineModule, input, output } from '../src/core/module';
import { param } from '../src/core/params';
import { createRegistry } from '../src/core/registry';
import { readWellFile } from '../src/io';
import { registry as realRegistry } from '../src/modules';
import { outputKeyOfViewerCurve } from '../src/viewer/contextMenu';
import { curve, interp, well, zone } from './helpers';

const docs = { summary: 'prueba', equations: [], references: [] };
const base = { category: 'other', workspace: 'petrophysics', docs } as const;

// --- registro chico: GR → IGR → VSH → PHIE (con RHOB) ; RT → RT corregida ; TEMP (falla) → RW ; todo → SW ----------
const tIgr = defineModule({
  ...base,
  id: 't-igr',
  name: 'IGR de prueba',
  inputs: { gr: input.curve('GR') },
  params: { k: param.number({ label: 'Factor', default: 1, min: 0, max: 10, scope: 'zone' }) },
  outputs: { igr: output.curve('IGR') },
  compute({ n, inputs, segments }) {
    const out = new Float64Array(n);
    for (const s of segments) for (let i = s.start; i < s.end; i++) out[i] = ((inputs.gr[i]! - 20) / 100) * s.params.k;
    return { igr: out };
  },
});
const tVsh = defineModule({
  ...base,
  id: 't-vsh',
  name: 'Vsh de prueba',
  inputs: { igr: input.curve('IGR') },
  params: {},
  outputs: { vsh: output.curve('VSH') },
  compute: ({ inputs }) => ({ vsh: inputs.igr.map((v) => v * 0.9) }),
});
const phiOf = (rhob: number, vsh: number) => {
  const phi = (2.65 - rhob) / 1.65 - 0.1 * vsh;
  return phi > 0 ? phi : NaN;
};
const tPhi = defineModule({
  ...base,
  id: 't-phi',
  name: 'φ de prueba',
  inputs: { rhob: input.curve('RHOB'), vsh: input.curve('VSH') },
  params: {},
  outputs: { phi: output.curve('PHIE') },
  compute: ({ n, inputs }) => ({ phi: Float64Array.from({ length: n }, (_, i) => phiOf(inputs.rhob[i]!, inputs.vsh[i]!)) }),
});
/** Alternativa de PHIE (en comparación). */
const tPhi2 = defineModule({
  ...base,
  id: 't-phi2',
  name: 'φ alternativa',
  inputs: { rhob: input.curve('RHOB') },
  params: {},
  outputs: { phi: output.curve('PHIE') },
  compute: ({ inputs }) => ({ phi: inputs.rhob.map((r) => (2.65 - r) / 1.65) }),
});
/** Es la fuente elegida de su propio puerto (RT): toma la siguiente candidata (la curva medida). */
const tRtCorr = defineModule({
  ...base,
  id: 't-rtcorr',
  name: 'Rt corregida',
  inputs: { rt: input.curve('RT') },
  params: {},
  outputs: { rt: output.curve('RT') },
  compute: ({ inputs }) => ({ rt: inputs.rt.map((v) => v * 1.1) }),
});
/** Da TEMP y siempre falla: la entrada opcional de t-rw queda ausente en tiempo de ejecución. */
const tTempFail = defineModule({
  ...base,
  id: 't-temp-fail',
  name: 'Temperatura que falla',
  inputs: { gr: input.curve('GR') },
  params: {},
  outputs: { temp: output.curve('TEMP') },
  compute: () => {
    throw new Error('falla a propósito');
  },
});
const tRw = defineModule({
  ...base,
  id: 't-rw',
  name: 'Rw de prueba',
  inputs: { temp: input.optionalCurve('TEMP'), sp: input.optionalCurve('SP') },
  params: { rw: param.number({ label: 'Rw', default: 0.05, min: 0.001, max: 10, unit: 'ohm.m' }) },
  outputs: { rw: output.curve('RW') },
  compute: ({ n, inputs, params }) => ({ rw: new Float64Array(n).fill(inputs.temp ? 0 : params.rw) }),
});
const swOf = (rt: number, phi: number, rw: number, vsh: number) => Math.min(1, Math.sqrt(rw / (phi * phi * rt)) + 0 * vsh);
const tSw = defineModule({
  ...base,
  id: 't-sw',
  name: 'Sw de prueba',
  inputs: { rt: input.curve('RT'), phi: input.curve('PHIE'), rw: input.curve('RW'), vsh: input.curve('VSH') },
  params: {},
  outputs: { sw: output.curve('SW') },
  compute: ({ n, inputs }) => ({ sw: Float64Array.from({ length: n }, (_, i) => swOf(inputs.rt[i]!, inputs.phi[i]!, inputs.rw[i]!, inputs.vsh[i]!)) }),
});
/** Alternativa de SW (en comparación). */
const tSw2 = defineModule({
  ...base,
  id: 't-sw2',
  name: 'Sw alternativa',
  inputs: { rt: input.curve('RT'), phi: input.curve('PHIE'), rw: input.curve('RW') },
  params: {},
  outputs: { sw: output.curve('SW') },
  compute: ({ n, inputs }) => ({ sw: Float64Array.from({ length: n }, (_, i) => Math.min(1, inputs.rw[i]! / (inputs.phi[i]! * inputs.rt[i]!))) }),
});
const REG = createRegistry([tIgr, tVsh, tPhi, tPhi2, tRtCorr, tTempFail, tRw, tSw, tSw2]);

// 12 muestras cada 0,5 m desde 1000 m. Z1 = 0–4, Z2 = 5–9, 10–11 fuera de las zonas.
// i = 3: RHOB 2,8 g/cm³ (> matriz) → φ sin dato con entradas válidas: la cadena se corta en t-phi.
// i = 7: GR sin dato: el hueco viene de una curva medida.
const GR = [30, 40, 50, 60, 70, 80, 90, NaN, 50, 60, 70, 80];
const RHOB_KG = [2300, 2310, 2320, 2800, 2340, 2350, 2360, 2370, 2380, 2390, 2400, 2410];
const RT = [10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32];
const AT60 = RT.map((v) => v * 0.8);
const W = well([curve('GR', 'GR', GR), curve('ZDEN', 'RHOB', RHOB_KG, 'kg/m3'), curve('RT', 'RT', RT), curve('AT60', 'RM', AT60)]);
const ZONES = [zone('z1', 1000, 1002), zone('z2', 1002.5, 1004.5)];
const INTERP: Interpretation = interp({
  zones: ZONES,
  sources: { RT: { kind: 'module', moduleId: 't-rtcorr' } },
  compare: ['t-sw2', 't-phi2'],
  params: { global: {}, zones: { z1: { 't-igr.k': 2 } } },
});

const run = (i: Interpretation = INTERP): EngineRunResult => {
  const e = new Engine(REG, { checkInputs: true });
  e.setWell(W);
  return e.run(i);
};
const ok = (t: ReturnType<typeof traceSample>): Trace => {
  if (t.status !== 'ok') throw new Error(`traza no ok: ${t.status}`);
  return t;
};
const link = (t: Trace, id: string): TraceLink => t.links.find((l) => l.moduleId === id)!;
const curveOut = (r: EngineRunResult, key: string) => r.outputs.find((o) => o.key === key)!.value as Float64Array;

describe('el motor publica lo que usó (NodeReport.inputs / params, EngineRunResult.segments)', () => {
  it('fuentes usadas por entrada, con la opcional soltada en tiempo de ejecución en null', () => {
    const r = run();
    const rep = (id: string) => r.nodes.find((n) => n.moduleId === id)!;
    expect(rep('t-temp-fail').status).toBe('error');
    expect(rep('t-temp-fail').inputs).toBeUndefined();
    expect(rep('t-rw').status).toBe('ok');
    // El plan le daba TEMP desde t-temp-fail; como falló, la corrida la usó ausente.
    expect(rep('t-rw').inputs).toEqual({ temp: null, sp: null });
    expect(rep('t-rtcorr').inputs).toEqual({ rt: { kind: 'curve', curveId: 'RT' } });
    expect(rep('t-sw').inputs).toEqual({
      rt: { kind: 'module', moduleId: 't-rtcorr' },
      phi: { kind: 'module', moduleId: 't-phi' },
      rw: { kind: 'module', moduleId: 't-rw' },
      vsh: { kind: 'module', moduleId: 't-vsh' },
    });
    expect(rep('t-igr').params).toEqual({ global: { k: 1 }, byZone: { z1: { k: 2 }, z2: { k: 1 } } });
    expect(r.segments).toEqual([
      { start: 0, end: 5, zoneId: 'z1' },
      { start: 5, end: 10, zoneId: 'z2' },
      { start: 10, end: 12, zoneId: null },
    ]);
  });

  it('en vivo: un cambio de parámetro por zona se refleja en params después de run; los reusados también publican', () => {
    const e = new Engine(REG);
    e.setWell(W);
    const r1 = e.run(INTERP);
    expect(r1.nodes.find((n) => n.moduleId === 't-igr')!.params!.byZone['z1']!['k']).toBe(2);
    const r2 = e.run({ ...INTERP, params: { global: {}, zones: { z1: { 't-igr.k': 3 }, z2: { 't-igr.k': 0.5 } } } });
    const igr = r2.nodes.find((n) => n.moduleId === 't-igr')!;
    expect(igr.computed).toBe(true);
    expect(igr.params!.byZone).toEqual({ z1: { k: 3 }, z2: { k: 0.5 } });
    expect(igr.params!.global).toEqual({ k: 1 });
    // t-rtcorr no cambió: viene de caché y publica igual sus entradas y parámetros.
    const rt = r2.nodes.find((n) => n.moduleId === 't-rtcorr')!;
    expect(rt.computed).toBe(false);
    expect(r2.stats.reused).toContain('t-rtcorr');
    expect(rt.inputs).toEqual({ rt: { kind: 'curve', curveId: 'RT' } });
    expect(rt.params).toEqual({ global: {}, byZone: { z1: {}, z2: {} } });
    // Y la traza lee el valor nuevo.
    const t = ok(traceSample(r2, REG, W.curves, 1, 't-sw:SW'));
    expect(link(t, 't-igr').params[0]).toMatchObject({ key: 'k', value: 3, fromZone: true });
    expect(link(t, 't-igr').outputs[0]!.value).toBeCloseTo(((40 - 20) / 100) * 3, 12);
  });

  describe('viaja por el worker', () => {
    let client: EngineClient | null = null;
    afterEach(() => client?.dispose());
    it('el cliente en proceso entrega inputs, params y segments', async () => {
      client = createInProcessClient(REG);
      client.syncWell(W);
      const p = new Promise<ClientResult>((resolve, reject) => {
        const off = client!.subscribe((e: ClientEvent) => {
          if (e.type === 'result') {
            off();
            resolve(e.result);
          } else if (e.type === 'error') {
            off();
            reject(new Error(e.message));
          }
        });
      });
      client.run(INTERP);
      const r = await p;
      const direct = run();
      const strip = (n: NodeReport) => ({ moduleId: n.moduleId, status: n.status, inputs: n.inputs, params: n.params });
      expect(r.nodes.map(strip)).toEqual(direct.nodes.map(strip));
      expect(r.segments).toEqual(direct.segments);
      expect(ok(traceSample(r, REG, W.curves, 1, 't-sw:SW')).target.value).toBe(curveOut(direct, 't-sw:SW')[1]);
    });
  });
});

describe('traceSample con un registro chico', () => {
  const r = run();

  it('orden del motor, cada módulo una vez y referencias al eslabón que alimenta a varios', () => {
    const t = ok(traceSample(r, REG, W.curves, 1, 't-sw:SW'));
    expect(t.links.map((l) => l.moduleId)).toEqual(['t-igr', 't-vsh', 't-phi', 't-rtcorr', 't-rw', 't-sw']);
    // Mismo orden que el reporte del motor.
    const engineOrder = r.nodes.map((n) => n.moduleId).filter((id) => t.links.some((l) => l.moduleId === id));
    expect(t.links.map((l) => l.moduleId)).toEqual(engineOrder);
    // VSH entra en φ y en Sw: un solo eslabón citado dos veces.
    const vshLink = t.links.findIndex((l) => l.moduleId === 't-vsh');
    const refs = t.links.flatMap((l) => l.inputs).filter((i) => i.source.kind === 'module' && i.source.moduleId === 't-vsh');
    expect(refs).toHaveLength(2);
    for (const i of refs) expect(i.source).toMatchObject({ kind: 'module', link: vshLink });
    expect(t.zoneId).toBe('z1');
    expect(t.alternative).toBe(false);
    expect(t.gap).toBeNull();
    // Ni el módulo que falló ni las alternativas son eslabones.
    expect(t.links.some((l) => l.moduleId === 't-temp-fail' || l.moduleId === 't-sw2' || l.moduleId === 't-phi2')).toBe(false);
  });

  it('los valores son las salidas publicadas en ese índice y la cuenta a mano da Sw', () => {
    for (const i of [0, 1, 5, 11]) {
      const t = ok(traceSample(r, REG, W.curves, i, 't-sw:SW'));
      for (const l of t.links) for (const o of l.outputs) expect(o.value, o.key).toBe(curveOut(r, o.key)[i]);
      const sw = link(t, 't-sw');
      const v = (k: string) => sw.inputs.find((x) => x.key === k)!.value!;
      expect(t.target.value).toBeCloseTo(swOf(v('rt'), v('phi'), v('rw'), v('vsh')), 12);
      // Las entradas desde módulos leen la misma salida publicada.
      for (const inp of t.links.flatMap((l) => l.inputs)) {
        if (inp.source.kind === 'module') expect(inp.value).toBe(curveOut(r, `${inp.source.moduleId}:${inp.port}`)[i]);
      }
    }
  });

  it('salidas que siguen la cadena', () => {
    const t = ok(traceSample(r, REG, W.curves, 1, 't-sw:SW'));
    expect(t.links.every((l) => l.outputs.some((o) => o.inChain))).toBe(true);
    expect(link(t, 't-rtcorr').outputs[0]).toMatchObject({ port: 'RT', inChain: true, active: true });
  });

  it('curva medida con conversión a la unidad del rol', () => {
    const t = ok(traceSample(r, REG, W.curves, 1, 't-sw:SW'));
    const rhob = link(t, 't-phi').inputs.find((i) => i.key === 'rhob')!;
    expect(rhob.source).toMatchObject({ kind: 'curve', curveId: 'ZDEN', mnemonic: 'ZDEN', unit: 'kg/m3', prepared: false, crossRole: false, unknownUnit: false });
    expect(rhob.unit).toBe('g/cm3');
    expect(rhob.value).toBeCloseTo(2.31, 12);
  });

  it('fuente distinta de la elegida: el módulo es la fuente elegida de su propio puerto', () => {
    const t = ok(traceSample(r, REG, W.curves, 1, 't-sw:SW'));
    const rt = link(t, 't-rtcorr').inputs[0]!;
    expect(rt.chosenIsSelf).toBe(true);
    expect(rt.source).toMatchObject({ kind: 'curve', curveId: 'RT' });
    expect(rt.others).toEqual([]);
    // En Sw, la RT viene del módulo elegido y la curva medida queda como otra fuente disponible.
    const swRt = link(t, 't-sw').inputs.find((i) => i.key === 'rt')!;
    expect(swRt.chosenIsSelf).toBe(false);
    expect(swRt.others).toEqual([{ kind: 'curve', id: 'RT', label: 'RT', alternative: false }]);
    // La alternativa en comparación se marca.
    expect(link(t, 't-sw').inputs.find((i) => i.key === 'phi')!.others).toEqual([{ kind: 'module', id: 't-phi2', label: 'φ alternativa', alternative: true }]);
  });

  it('entradas opcionales ausentes: sin fuente, o porque el módulo que la daba falló', () => {
    const t = ok(traceSample(r, REG, W.curves, 1, 't-sw:SW'));
    const rw = link(t, 't-rw');
    expect(rw.inputs.find((i) => i.key === 'temp')).toMatchObject({ optional: true, value: null, source: { kind: 'absent', failed: { moduleId: 't-temp-fail', name: 'Temperatura que falla' } } });
    expect(rw.inputs.find((i) => i.key === 'sp')).toMatchObject({ optional: true, value: null, source: { kind: 'absent' } });
    expect(rw.inputs.find((i) => i.key === 'sp')!.source).not.toHaveProperty('failed');
  });

  it('parámetro de zona vs global', () => {
    const inZ1 = link(ok(traceSample(r, REG, W.curves, 1, 't-sw:SW')), 't-igr').params[0]!;
    expect(inZ1).toMatchObject({ key: 'k', label: 'Factor', value: 2, zoneScoped: true, fromZone: true });
    const inZ2 = ok(traceSample(r, REG, W.curves, 6, 't-sw:SW'));
    expect(inZ2.zoneId).toBe('z2');
    expect(link(inZ2, 't-igr').params[0]).toMatchObject({ value: 1, fromZone: false });
    const outside = ok(traceSample(r, REG, W.curves, 11, 't-sw:SW'));
    expect(outside.zoneId).toBeNull();
    expect(link(outside, 't-igr').params[0]).toMatchObject({ value: 1, fromZone: false });
    expect(link(outside, 't-rw').params[0]).toMatchObject({ key: 'rw', value: 0.05, unit: 'ohm.m', zoneScoped: false, fromZone: false });
  });

  it('NaN: la cadena se corta en el primer eslabón con entradas válidas y salida sin dato', () => {
    const t = ok(traceSample(r, REG, W.curves, 3, 't-sw:SW'));
    expect(Number.isNaN(t.target.value)).toBe(true);
    expect(t.gap).toEqual({ moduleId: 't-phi' });
    expect(t.links.filter((l) => l.gap).map((l) => l.moduleId)).toEqual(['t-phi']);
  });

  it('NaN que viene de una curva medida: se señala esa entrada', () => {
    const t = ok(traceSample(r, REG, W.curves, 7, 't-sw:SW'));
    expect(t.gap).toEqual({ moduleId: 't-igr', inputKey: 'gr' });
    expect(t.links.some((l) => l.gap)).toBe(false);
    expect(link(t, 't-igr').inputs[0]!.gap).toBe(true);
  });

  it('salida alternativa: la traza se arma igual y lo dice', () => {
    const t = ok(traceSample(r, REG, W.curves, 1, 't-sw2:SW'));
    expect(t.alternative).toBe(true);
    expect(t.links.map((l) => l.moduleId)).toEqual(['t-igr', 't-vsh', 't-phi', 't-rtcorr', 't-rw', 't-sw2']);
    expect(t.target.value).toBe(curveOut(r, 't-sw2:SW')[1]);
  });

  it('curva con otro rol elegida a mano (AT60 como RT)', () => {
    const r2 = run({ ...INTERP, sources: { RT: { kind: 'curve', curveId: 'AT60' } } });
    const t = ok(traceSample(r2, REG, W.curves, 1, 't-sw:SW'));
    const rt = link(t, 't-sw').inputs.find((i) => i.key === 'rt')!;
    expect(rt.source).toMatchObject({ kind: 'curve', curveId: 'AT60', role: 'RM', crossRole: true });
    expect(rt.value).toBe(AT60[1]);
    expect(t.links.some((l) => l.moduleId === 't-rtcorr')).toBe(false);
  });

  it('curva preparada: se marca «preparada» y su valor sale del paquete de la corrida', () => {
    const prepared = { ...curve('prep:n1:gr', 'GR', GR.map((v) => v + 5)), mnemonic: 'GR', provenance: { origin: 'prepared' as const, contentVersion: 'v1', depthKey: 'd', ancestorToolIds: [] } };
    const w = { ...W, curves: [...W.curves, prepared] };
    const e = new Engine(REG);
    e.setWell(w);
    const r2 = e.run({ ...INTERP, sources: { ...INTERP.sources, GR: { kind: 'curve', curveId: 'prep:n1:gr' } } });
    const t = ok(traceSample(r2, REG, w.curves, 1, 't-sw:SW'));
    const gr = link(t, 't-igr').inputs[0]!;
    expect(gr.source).toMatchObject({ kind: 'curve', curveId: 'prep:n1:gr', prepared: true, crossRole: false });
    expect(gr.value).toBe(45);
    expect(link(t, 't-igr').outputs[0]!.value).toBe(curveOut(r2, 't-igr:IGR')[1]);
  });

  it('casos sin traza: salida inexistente, fuera de rango; clave del visor', () => {
    expect(traceSample(r, REG, W.curves, 1, 't-temp-fail:TEMP').status).toBe('no-output');
    expect(traceSample(r, REG, W.curves, 12, 't-sw:SW').status).toBe('out-of-range');
    expect(traceSample(r, REG, W.curves, -1, 't-sw:SW').status).toBe('out-of-range');
    expect(outputKeyOfViewerCurve({ key: 'c:sw-archie:SW', origin: 'computed' })).toBe('sw-archie:SW');
    expect(outputKeyOfViewerCurve({ key: 'm:GR', origin: 'measured' })).toBeNull();
    expect(outputKeyOfViewerCurve({ key: 'm:prep:a:b', origin: 'prepared' })).toBeNull();
  });
});

describe('con el pozo del TP y el registro real', () => {
  const { well: tp, zones } = readWellFile(csvText, 'pozo_tp_perfiles.csv');
  const e = new Engine(realRegistry);
  e.setWell(toEngineWell(tp));
  const r = e.run(emptyInterpretation(zones));
  const swOut = r.outputs.find((o) => o.port === 'SW' && o.active)!;
  const sw = swOut.value as Float64Array;
  // Muestra de la zona B (la de más hidrocarburo: 472 muestras con Sw < 0,5): la de menor Sw sin recortar.
  const zb = zones.find((z) => z.name === 'B')!;
  const depth = tp.depth.values;
  let idx = -1;
  for (let i = 0; i < sw.length; i++) {
    if (depth[i]! < zb.top || depth[i]! > zb.base || !(sw[i]! > 0 && sw[i]! < 1)) continue;
    if (idx < 0 || sw[i]! < sw[idx]!) idx = i;
  }
  const t = ok(traceSample(r, realRegistry, tp.curves, idx, swOut.key));

  it('la muestra es de la zona B y tiene hidrocarburo', () => {
    expect(t.zoneId).toBe(zb.id);
    expect(t.target.value).toBeLessThan(0.5);
    expect(t.gap).toBeNull();
  });

  it('cada eslabón vale lo mismo que la salida publicada (lo que dibuja el visor)', () => {
    expect(t.links.length).toBeGreaterThanOrEqual(5);
    expect(t.links[t.links.length - 1]!.moduleId).toBe(swOut.moduleId);
    for (const l of t.links) {
      for (const o of l.outputs) {
        const published = r.outputs.find((x) => x.key === o.key)!.value;
        if (published instanceof Float64Array) expect(o.value, o.key).toBe(published[idx]);
      }
      for (const i of l.inputs) {
        if (i.source.kind === 'module') expect(i.value, `${l.moduleId}.${i.key}`).toBe((r.outputs.find((x) => x.key === `${(i.source as { moduleId: string }).moduleId}:${i.port}`)!.value as Float64Array)[idx]);
        if (i.source.kind === 'curve' && i.source.unit === i.unit) expect(i.value).toBe(tp.curves.find((c) => c.id === (i.source as { curveId: string }).curveId)!.data[idx]);
      }
    }
  });

  it('reemplazar los valores y parámetros de la traza en la ecuación de Archie da el Sw publicado', () => {
    expect(swOut.moduleId).toBe('sw-archie');
    const l = link(t, 'sw-archie');
    const v = (k: string) => l.inputs.find((x) => x.key === k)!.value!;
    const p = (k: string) => l.params.find((x) => x.key === k)!.value as number;
    const [rt, phi, rw, a, m, n] = [v('rt'), v('phi'), v('rw'), p('a'), p('m'), p('n')];
    // Sw = (a·Rw / (φ^m·Rt))^(1/n), recortada a [0, 1] (Asquith y Krygowski, 2004).
    const byHand = Math.min(1, Math.max(0, ((a * rw) / (phi ** m * rt)) ** (1 / n)));
    expect(Math.abs(byHand - sw[idx]!) / sw[idx]!).toBeLessThan(1e-9);
    expect(t.target.value).toBe(sw[idx]);
  });
});
