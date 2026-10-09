import { beforeEach, describe, expect, it } from 'vitest';
import { computeOnce, Engine } from '../src/core/engine/engine';
import { defineModule, input, output } from '../src/core/module';
import { param } from '../src/core/params';
import { createRegistry } from '../src/core/registry';
import { calls, curve, interp, linearModule, resetCalls, well, zone } from './helpers';

const gr = curve('GR1', 'GR', [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);

function chainRegistry() {
  // igr: GR → IGR ; vsh: IGR → VSH ; other: GR → PHIE (rama independiente)
  return createRegistry([linearModule('igr', 'GR', 'IGR'), linearModule('vsh', 'IGR', 'VSH'), linearModule('other', 'GR', 'PHIE')]);
}

function valueOf(result: ReturnType<Engine['run']>, key: string) {
  return result.outputs.find((o) => o.key === key)!.value as Float64Array;
}

describe('motor incremental', () => {
  beforeEach(resetCalls);

  it('calcula toda la cadena la primera vez', () => {
    const engine = new Engine(chainRegistry());
    engine.setWell(well([gr]));
    const r = engine.run(interp());
    expect(r.stats.recomputed).toEqual(['igr', 'vsh', 'other']);
    expect([...valueOf(r, 'vsh:VSH')]).toEqual([...gr.data]);
    expect(r.diagnostics).toEqual([]);
  });

  it('sin cambios no recalcula nada', () => {
    const engine = new Engine(chainRegistry());
    engine.setWell(well([gr]));
    const state = interp();
    engine.run(state);
    const r = engine.run(structuredClone(state));
    expect(r.stats.recomputed).toEqual([]);
    expect(r.stats.reused).toHaveLength(3);
  });

  it('cambiar un parámetro recalcula solo ese módulo y lo que está aguas abajo', () => {
    const engine = new Engine(chainRegistry());
    engine.setWell(well([gr]));
    engine.run(interp());
    // parámetro del último eslabón → solo vsh
    let r = engine.run(interp({ params: { global: { 'vsh.offset': 1 }, zones: {} } }));
    expect(r.stats.recomputed).toEqual(['vsh']);
    expect(valueOf(r, 'vsh:VSH')[0]).toBe(11);
    // parámetro del primero → igr y vsh, pero no la rama independiente
    r = engine.run(interp({ params: { global: { 'vsh.offset': 1, 'igr.offset': 100 }, zones: {} } }));
    expect(r.stats.recomputed).toEqual(['igr', 'vsh']);
    expect(valueOf(r, 'vsh:VSH')[0]).toBe(111);
    expect(calls.get('other')).toBe(1);
  });

  it('las versiones de salida solo cambian cuando se recalcula', () => {
    const engine = new Engine(chainRegistry());
    engine.setWell(well([gr]));
    const a = engine.run(interp());
    const b = engine.run(interp({ params: { global: { 'vsh.offset': 1 }, zones: {} } }));
    const v = (r: typeof a, k: string) => r.outputs.find((o) => o.key === k)!.version;
    expect(v(b, 'igr:IGR')).toBe(v(a, 'igr:IGR'));
    expect(v(b, 'vsh:VSH')).not.toBe(v(a, 'vsh:VSH'));
  });

  it('cambiar el array de una curva medida recalcula sus consumidores', () => {
    const engine = new Engine(chainRegistry());
    engine.setWell(well([gr]));
    engine.run(interp());
    const doubled = gr.data.map((x) => x * 2);
    engine.updateCurves([{ ...gr, data: doubled }]);
    const r = engine.run(interp());
    expect(r.stats.recomputed).toEqual(['igr', 'vsh', 'other']);
    expect(valueOf(r, 'igr:IGR')[0]).toBe(20);
    // mismo array y mismo rol (solo cambia el mnemónico) → nada que recalcular
    engine.updateCurves([{ ...gr, mnemonic: 'GR_RENOMBRADA', data: doubled }]);
    expect(engine.run(interp()).stats.recomputed).toEqual([]);
    // cambiar la unidad sí invalida
    engine.updateCurves([{ ...gr, unit: 'unitless', data: doubled }]);
    expect(engine.run(interp()).nodes[0]!.status).toBe('error');
  });

  it('resuelve parámetros por zona: global por defecto, override por zona', () => {
    const engine = new Engine(createRegistry([linearModule('igr', 'GR', 'IGR')]));
    engine.setWell(well([gr])); // profundidades 1000 … 1004.5
    const zones = [zone('a', 1000, 1001.5), zone('b', 1002, 1004.5)];
    const r = engine.run(interp({ zones, params: { global: { 'igr.offset': 1 }, zones: { b: { 'igr.offset': 1000 } } } }));
    expect([...valueOf(r, 'igr:IGR')]).toEqual([11, 21, 31, 41, 1050, 1060, 1070, 1080, 1090, 1100]);
  });

  it('un override en una zona recalcula el módulo (la firma incluye zonas)', () => {
    const engine = new Engine(createRegistry([linearModule('igr', 'GR', 'IGR')]));
    engine.setWell(well([gr]));
    const zones = [zone('a', 1000, 1001.5)];
    engine.run(interp({ zones }));
    expect(engine.run(interp({ zones, params: { global: {}, zones: { a: { 'igr.offset': 5 } } } })).stats.recomputed).toEqual(['igr']);
    // mover una zona también invalida
    expect(engine.run(interp({ zones: [zone('a', 1000, 1003)], params: { global: {}, zones: { a: { 'igr.offset': 5 } } } })).stats.recomputed).toEqual(['igr']);
    // cambiar solo el nombre o el color de la zona no invalida
    const renamed = [{ ...zone('a', 1000, 1003), name: 'Otra', color: '#f00' }];
    expect(engine.run(interp({ zones: renamed, params: { global: {}, zones: { a: { 'igr.offset': 5 } } } })).stats.recomputed).toEqual([]);
  });

  it('un override en un parámetro global-only se ignora', () => {
    const m = defineModule({
      id: 'g',
      name: 'G',
      category: 'other',
      workspace: 'petrophysics',
      inputs: { x: input.curve('GR') },
      params: { k: param.number({ label: 'K', default: 1, min: 0, max: 10 }) },
      outputs: { y: output.curve('IGR') },
      compute: ({ n, segments }) => {
        const y = new Float64Array(n);
        for (const s of segments) y.fill(s.params.k, s.start, s.end);
        return { y };
      },
      docs: { summary: '', equations: [], references: [] },
    });
    const r = computeOnce(createRegistry([m]), well([gr]), interp({ zones: [zone('a', 1000, 1004.5)], params: { global: { 'g.k': 2 }, zones: { a: { 'g.k': 9 } } } }));
    expect(valueOf(r, 'g:IGR')[0]).toBe(2);
  });

  it('convierte las curvas de entrada a la unidad canónica del rol', () => {
    const nphiPct = curve('NPHI', 'NPHI', [25, 30], '%');
    const m = linearModule('n', 'NPHI', 'PHIT');
    const r = computeOnce(createRegistry([m]), well([nphiPct]), interp());
    expect(valueOf(r, 'n:PHIT')[0]).toBeCloseTo(0.25, 12);
  });

  it('una unidad incompatible bloquea el módulo con un mensaje claro', () => {
    const bad = curve('NPHI', 'NPHI', [1, 2], 'ohm.m');
    const r = computeOnce(createRegistry([linearModule('n', 'NPHI', 'PHIT'), linearModule('s', 'PHIT', 'SW')]), well([bad]), interp());
    expect(r.nodes.find((x) => x.moduleId === 'n')!.status).toBe('error');
    expect(r.nodes.find((x) => x.moduleId === 's')!.status).toBe('blocked');
    expect(r.diagnostics.find((d) => d.code === 'unit-mismatch')!.message).toMatch(/está en ohm·m y se esperaba una magnitud en v\/v/);
  });

  it('un error en compute no rompe el motor: bloquea aguas abajo y se informa', () => {
    const boom = defineModule({
      id: 'boom',
      name: 'Explota',
      category: 'other',
      workspace: 'petrophysics',
      inputs: { x: input.curve('GR') },
      params: {},
      outputs: { y: output.curve('IGR') },
      compute: () => {
        throw new Error('división por cero');
      },
      docs: { summary: '', equations: [], references: [] },
    });
    const r = computeOnce(createRegistry([boom, linearModule('vsh', 'IGR', 'VSH'), linearModule('other', 'GR', 'PHIE')]), well([gr]), interp());
    expect(r.diagnostics.find((d) => d.code === 'compute-error')!.message).toBe("Error al calcular 'Explota': división por cero");
    expect(r.nodes.find((x) => x.moduleId === 'vsh')!.status).toBe('blocked');
    expect(r.outputs.map((o) => o.key)).toEqual(['other:PHIE']);
  });

  it('valida las salidas (largo y tipo)', () => {
    const short = defineModule({
      id: 'short',
      name: 'Corta',
      category: 'other',
      workspace: 'petrophysics',
      inputs: {},
      params: {},
      outputs: { y: output.curve('IGR') },
      compute: () => ({ y: new Float64Array(3) }),
      docs: { summary: '', equations: [], references: [] },
    });
    const r = computeOnce(createRegistry([short]), well([gr]), interp());
    expect(r.diagnostics[0]!.message).toMatch(/'y' tiene 3 muestras y el pozo 10/);
  });

  it('salidas escalares alimentan a otros módulos', () => {
    const producer = defineModule({
      id: 'rw-calc',
      name: 'Rw',
      category: 'other',
      workspace: 'petrophysics',
      inputs: {},
      params: { rw: param.number({ label: 'Rw', default: 0.05, min: 0.01, max: 1 }) },
      outputs: { rw: output.scalar('RW', { label: 'Rw', unit: 'ohm.m' }) },
      compute: ({ params }) => ({ rw: params.rw * 2 }),
      docs: { summary: '', equations: [], references: [] },
    });
    const consumer = defineModule({
      id: 'use-rw',
      name: 'Usa Rw',
      category: 'other',
      workspace: 'petrophysics',
      inputs: { rw: input.scalar('RW'), gr: input.curve('GR') },
      params: {},
      outputs: { y: output.curve('SW') },
      compute: ({ n, inputs }) => ({ y: new Float64Array(n).fill(inputs.rw) }),
      docs: { summary: '', equations: [], references: [] },
    });
    const engine = new Engine(createRegistry([producer, consumer]));
    engine.setWell(well([gr]));
    let r = engine.run(interp());
    expect(valueOf(r, 'use-rw:SW')[0]).toBeCloseTo(0.1);
    r = engine.run(interp({ params: { global: { 'rw-calc.rw': 0.2 }, zones: {} } }));
    expect(r.stats.recomputed).toEqual(['rw-calc', 'use-rw']);
    expect(valueOf(r, 'use-rw:SW')[0]).toBeCloseTo(0.4);
  });

  it('las advertencias de compute se informan y persisten mientras el resultado está en caché', () => {
    const m = defineModule({
      id: 'w',
      name: 'Avisa',
      category: 'other',
      workspace: 'petrophysics',
      inputs: {},
      params: { k: param.number({ label: 'K', default: 1, min: 0, max: 10 }) },
      outputs: { y: output.scalar('Y', { label: 'Y' }) },
      compute: ({ params, warn }) => {
        if (params.k > 5) warn('K demasiado grande.');
        return { y: params.k };
      },
      docs: { summary: '', equations: [], references: [] },
    });
    const engine = new Engine(createRegistry([m]));
    engine.setWell(well([gr]));
    const state = interp({ params: { global: { 'w.k': 7 }, zones: {} } });
    expect(engine.run(state).diagnostics.map((d) => d.message)).toEqual(['Avisa: K demasiado grande.']);
    const again = engine.run(state);
    expect(again.stats.recomputed).toEqual([]);
    expect(again.diagnostics.map((d) => d.message)).toEqual(['Avisa: K demasiado grande.']);
    expect(engine.run(interp()).diagnostics).toEqual([]);
  });

  it('marca como activa solo la salida del método elegido', () => {
    const r = computeOnce(
      createRegistry([linearModule('igr', 'GR', 'IGR'), linearModule('vsh-a', 'IGR', 'VSH'), linearModule('vsh-b', 'IGR', 'VSH', { factor: 2 })]),
      well([gr]),
      interp({ sources: { VSH: { kind: 'module', moduleId: 'vsh-b' } }, compare: ['vsh-a'] }),
    );
    const vsh = r.outputs.filter((o) => o.port === 'VSH').map((o) => [o.key, o.active]);
    expect(vsh).toEqual(
      expect.arrayContaining([
        ['vsh-a:VSH', false],
        ['vsh-b:VSH', true],
      ]),
    );
  });

  it('los módulos no mutan sus entradas (la caché queda intacta)', () => {
    const engine = new Engine(chainRegistry());
    engine.setWell(well([gr]));
    const before = [...gr.data];
    engine.run(interp());
    expect([...gr.data]).toEqual(before);
  });

  it('rinde con 50 000 muestras y zonas (cadena de 3 módulos)', () => {
    const n = 50_000;
    const big = curve('GR1', 'GR', Float64Array.from({ length: n }, (_, i) => 50 + 40 * Math.sin(i / 50)));
    const engine = new Engine(chainRegistry());
    engine.setWell(well([big], n));
    const zones = [zone('a', 1000, 10000), zone('b', 10000, 30000)];
    const first = engine.run(interp({ zones }));
    const t0 = performance.now();
    for (let k = 0; k < 20; k++) engine.run(interp({ zones, params: { global: { 'vsh.offset': k }, zones: {} } }));
    const perRun = (performance.now() - t0) / 20;
    expect(first.stats.samples).toBe(n);
    expect(perRun).toBeLessThan(50);
  });
});
