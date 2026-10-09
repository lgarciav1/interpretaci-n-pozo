/**
 * Tablas como entrada y escalares por zona (`input.table`, `input.zoneScalar`, `output.zoneScalar`), y `kind` de la
 * zona en `ctx.zones` y en la firma. Ver docs/decisiones/0007-modulos-fase-6a.md.
 */
import { afterEach, beforeEach, describe, expect, expectTypeOf, it } from 'vitest';
import { createInProcessClient, type ClientEvent, type ClientResult, type EngineClient } from '../src/core/engine/client';
import { activeOutput, computeOnce, Engine, type EngineRunResult } from '../src/core/engine/engine';
import { serveEngine } from '../src/core/engine/serve';
import { EngineClient as Client } from '../src/core/engine/client';
import type { FromEngine } from '../src/core/engine/protocol';
import {
  defineModule,
  input,
  output,
  type ReadonlyTableValue,
  type ReadonlyZoneScalarValue,
  type ZoneScalarValue,
} from '../src/core/module';
import { param } from '../src/core/params';
import { createRegistry, RegistryError } from '../src/core/registry';
import { layoutZones } from '../src/core/well';
import { calls, curve, depthRange, interp, resetCalls, well, zone } from './helpers';

const docs = { summary: '', equations: [], references: [] };
const base = { name: 'M', category: 'other', workspace: 'petrophysics', docs } as const;

const gr = curve('GR1', 'GR', [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
// Profundidad 1000..1004,5 cada 0,5 m. A: 1000–1002 (5 muestras), B: 1002,5–1004,5 (5), C: sin muestras.
const zones = [zone('a', 1000, 1002), zone('b', 1002.5, 1004.5), zone('c', 2000, 2001)];

function count(id: string) {
  calls.set(id, (calls.get(id) ?? 0) + 1);
}

/** Productor: suma de GR por zona (zoneScalar) y una tabla con una fila por zona. */
const producer = defineModule({
  ...base,
  id: 'producer',
  inputs: { gr: input.curve('GR') },
  params: { k: param.number({ label: 'K', default: 1, min: 0, max: 10, scope: 'zone' }) },
  outputs: {
    sum: output.zoneScalar('GR_SUM', { label: 'Suma de GR', unit: 'gAPI' }),
    table: output.table('GR_TABLE', { label: 'GR por zona', columns: [{ key: 'zone', label: 'Zona', kind: 'text' }] }),
  },
  compute({ inputs, zones: spans, paramsFor }) {
    count('producer');
    const sum: ZoneScalarValue = {};
    for (const z of spans) {
      let s = 0;
      for (let i = z.start; i < z.end; i++) s += inputs.gr[i]!;
      sum[z.id] = z.end > z.start ? s * paramsFor(z.id).k : NaN;
    }
    return { sum, table: { rows: spans.map((z) => ({ zone: z.name, kind: z.kind })) } };
  },
});

/** Consumidor: total de la suma por zona (escalar) y cantidad de filas de la tabla. */
const consumer = defineModule({
  ...base,
  id: 'consumer',
  inputs: { sum: input.zoneScalar('GR_SUM'), table: input.table('GR_TABLE') },
  params: {},
  outputs: { total: output.scalar('GR_TOTAL', { label: 'Total' }), rows: output.scalar('ROWS', { label: 'Filas' }) },
  compute({ inputs, zones: spans }) {
    count('consumer');
    let total = 0;
    for (const z of spans) if (!Number.isNaN(inputs.sum[z.id]!)) total += inputs.sum[z.id]!;
    return { total, rows: inputs.table.rows.length };
  },
});

function value(r: EngineRunResult, key: string) {
  return r.outputs.find((o) => o.key === key)!.value;
}

function problemsOf(mods: Parameters<typeof createRegistry>[0]): string[] {
  try {
    createRegistry(mods);
    return [];
  } catch (e) {
    return (e as RegistryError).problems;
  }
}

describe('registro: tablas y valores por zona', () => {
  it('acepta productores y consumidores con el mismo tipo de puerto', () => {
    const reg = createRegistry([producer, consumer]);
    expect(reg.ports.get('GR_SUM')).toMatchObject({ kind: 'zoneScalar', producers: ['producer'] });
    expect(reg.ports.get('GR_TABLE')).toMatchObject({ kind: 'table' });
  });

  it('rechaza consumir un puerto con otro tipo', () => {
    const asScalar = defineModule({ ...base, id: 'as-scalar', inputs: { x: input.scalar('GR_SUM') }, params: {}, outputs: { y: output.scalar('Y', { label: 'y' }) }, compute: () => ({ y: 1 }) });
    const asTable = defineModule({ ...base, id: 'as-table', inputs: { x: input.table('GR_SUM') }, params: {}, outputs: { y: output.scalar('Y2', { label: 'y' }) }, compute: () => ({ y: 1 }) });
    const asZone = defineModule({ ...base, id: 'as-zone', inputs: { x: input.zoneScalar('GR_TABLE') }, params: {}, outputs: { y: output.scalar('Y3', { label: 'y' }) }, compute: () => ({ y: 1 }) });
    const p = problemsOf([producer, asScalar, asTable, asZone]).join('\n');
    expect(p).toMatch(/'as-scalar'.*pide 'GR_SUM' como escalar pero es 'zoneScalar'/);
    expect(p).toMatch(/'as-table'.*pide 'GR_SUM' como tabla pero es 'zoneScalar'/);
    expect(p).toMatch(/'as-zone'.*pide 'GR_TABLE' como valor por zona pero es 'table'/);
  });

  it('una tabla o un valor por zona requeridos tienen que tener productor; los opcionales no', () => {
    const needs = defineModule({
      ...base,
      id: 'needs',
      inputs: { t: input.table('NOBODY_T'), z: input.zoneScalar('NOBODY_Z') },
      params: {},
      outputs: { y: output.scalar('Y', { label: 'y' }) },
      compute: () => ({ y: 1 }),
    });
    const p = problemsOf([needs]).join('\n');
    expect(p).toMatch(/ningún módulo produce la tabla requerida 'NOBODY_T'/);
    expect(p).toMatch(/ningún módulo produce el valor por zona requerido 'NOBODY_Z'/);
    const optional = defineModule({
      ...base,
      id: 'optional',
      inputs: { t: input.optionalTable('NOBODY_T'), z: input.optionalZoneScalar('NOBODY_Z') },
      params: {},
      outputs: { y: output.scalar('Y', { label: 'y' }) },
      compute: ({ inputs }) => ({ y: inputs.t === undefined && inputs.z === undefined ? 1 : 0 }),
    });
    expect(() => createRegistry([optional])).not.toThrow();
    expect(value(computeOnce(createRegistry([optional]), well([gr]), interp()), 'optional:Y')).toBe(1);
  });

  it('valida la unidad y el id del puerto de un valor por zona', () => {
    const bad = defineModule({
      ...base,
      id: 'bad',
      inputs: {},
      params: {},
      outputs: { a: output.zoneScalar('GR', { label: 'a' }), b: output.zoneScalar('OK_PORT', { label: 'b', unit: 'furlong' as never }), c: output.zoneScalar('minus', { label: 'c' }) },
      compute: () => ({ a: {}, b: {}, c: {} }),
    });
    const p = problemsOf([bad]).join('\n');
    expect(p).toMatch(/puerto \(valor por zona\) 'GR' coincide con un rol de curva/);
    expect(p).toMatch(/unidad desconocida 'furlong'/);
    expect(p).toMatch(/'minus' debe estar en MAYÚSCULAS/);
  });
});

describe('motor: tablas y valores por zona', () => {
  beforeEach(resetCalls);

  it('el valor por zona trae una clave por zona (incluso sin muestras) y alimenta al consumidor', () => {
    const r = computeOnce(createRegistry([producer, consumer]), well([gr]), interp({ zones }));
    expect(r.diagnostics).toEqual([]);
    const sum = value(r, 'producer:GR_SUM') as ZoneScalarValue;
    expect(Object.keys(sum).sort()).toEqual(['a', 'b', 'c']);
    expect(sum.a).toBe(150);
    expect(sum.b).toBe(400);
    expect(sum.c).toBeNaN();
    expect(value(r, 'consumer:GR_TOTAL')).toBe(550);
    expect(value(r, 'consumer:ROWS')).toBe(3);
    const rec = r.outputs.find((o) => o.key === 'producer:GR_SUM')!;
    expect(rec).toMatchObject({ kind: 'zoneScalar', unit: 'gAPI', label: 'Suma de GR', active: true });
    expect(activeOutput(r.outputs, 'GR_SUM')).toBe(rec);
    expect(activeOutput(r.outputs, 'NOPE')).toBeUndefined();
  });

  it('invalida aguas abajo solo cuando cambia el productor', () => {
    const engine = new Engine(createRegistry([producer, consumer]), { checkInputs: true });
    engine.setWell(well([gr]));
    engine.run(interp({ zones }));
    let r = engine.run(interp({ zones }));
    expect(r.stats.recomputed).toEqual([]);
    // override por zona en el productor → recalcula productor y consumidor
    r = engine.run(interp({ zones, params: { global: {}, zones: { a: { 'producer.k': 2 } } } }));
    expect(r.stats.recomputed).toEqual(['producer', 'consumer']);
    expect(value(r, 'consumer:GR_TOTAL')).toBe(700);
  });

  it('rechaza valores por zona con zonas de más, de menos o no numéricos', () => {
    const mk = (id: string, v: unknown) =>
      defineModule({
        ...base,
        id,
        inputs: {},
        params: {},
        outputs: { z: output.zoneScalar('Z', { label: 'z' }) },
        compute: () => ({ z: v as ZoneScalarValue }),
      });
    const msg = (v: unknown) => computeOnce(createRegistry([mk('m', v)]), well([gr]), interp({ zones })).diagnostics.map((d) => d.message).join('\n');
    expect(msg({ a: 1, b: 2 })).toMatch(/no tiene valor para la zona 'C' \(usá NaN si no hay dato\)/);
    expect(msg({ a: 1, b: 2, c: 3, x: 4 })).toMatch(/valor para la zona 'x', que no existe/);
    expect(msg({ a: 1, b: '2', c: 3 })).toMatch(/valor no numérico en la zona 'b'/);
    expect(msg([1, 2, 3])).toMatch(/debe ser un objeto \{ \[zona\]: número \}/);
    expect(msg({ a: 1, b: 2, c: NaN })).toBe('');
    // sin zonas: el objeto vacío es válido
    expect(computeOnce(createRegistry([mk('m', {})]), well([gr]), interp()).diagnostics).toEqual([]);
  });

  it('rechaza tablas con filas que no son objetos', () => {
    const m = defineModule({
      ...base,
      id: 'm',
      inputs: {},
      params: {},
      outputs: { t: output.table('T', { label: 't', columns: [] }) },
      compute: () => ({ t: { rows: [1 as never] } }),
    });
    expect(computeOnce(createRegistry([m]), well([gr]), interp()).diagnostics[0]!.message).toMatch(/fila que no es un objeto/);
  });

  it('tablas y valores por zona quedan congelados: un consumidor que escribe falla sin corromper la caché', () => {
    const vandal = defineModule({
      ...base,
      id: 'vandal',
      inputs: { sum: input.zoneScalar('GR_SUM'), table: input.table('GR_TABLE') },
      params: { target: param.enum({ label: 'Qué', options: [{ value: 'sum', label: 'suma' }, { value: 'row', label: 'fila' }], default: 'sum' }) },
      outputs: { y: output.scalar('Y', { label: 'y' }) },
      compute({ inputs, params }) {
        if (params.target === 'sum') (inputs.sum as Record<string, number>).a = -1;
        else (inputs.table.rows[0] as Record<string, unknown>).zone = 'X';
        return { y: 0 };
      },
    });
    const engine = new Engine(createRegistry([producer, vandal]));
    engine.setWell(well([gr]));
    for (const target of ['sum', 'row']) {
      const r = engine.run(interp({ zones, params: { global: { 'vandal.target': target }, zones: {} } }));
      expect(r.nodes.find((n) => n.moduleId === 'vandal')!.status).toBe('error');
      expect((value(r, 'producer:GR_SUM') as ZoneScalarValue).a).toBe(150);
      expect(((value(r, 'producer:GR_TABLE') as ReadonlyTableValue).rows[0] as { zone: string }).zone).toBe('A');
    }
  });

  it('una tabla marcada hidden lo informa en su registro de salida (el panel de Resultados no la lista)', () => {
    const m = defineModule({
      ...base,
      id: 'sweep',
      inputs: {},
      params: {},
      outputs: { t: output.table('SWEEP', { label: 's', columns: [], hidden: true }), u: output.table('SHOWN', { label: 'u', columns: [] }) },
      compute: () => ({ t: { rows: [] }, u: { rows: [] } }),
    });
    const r = computeOnce(createRegistry([m]), well([gr]), interp());
    expect(r.outputs.find((o) => o.port === 'SWEEP')!.hidden).toBe(true);
    expect('hidden' in r.outputs.find((o) => o.port === 'SHOWN')!).toBe(false);
  });

  it('una curva medida no puede alimentar un puerto de tabla', () => {
    const r = computeOnce(createRegistry([producer, consumer]), well([gr]), interp({ zones, sources: { GR_TABLE: { kind: 'curve', curveId: 'GR1' } } }));
    expect(r.diagnostics.map((d) => d.message).join('\n')).toMatch(/GR_TABLE no es una curva/);
    expect(value(r, 'consumer:ROWS')).toBe(3); // usa la fuente por defecto
  });

  it('informa con claridad un valor por zona que nadie calcula', () => {
    const lonely = defineModule({
      ...base,
      id: 'lonely',
      inputs: { z: input.zoneScalar('GR_SUM') },
      params: {},
      outputs: { y: output.scalar('Y', { label: 'y' }) },
      compute: () => ({ y: 1 }),
    });
    const r = computeOnce(createRegistry([producer, lonely]), well([gr]), interp({ disabled: ['producer'] }));
    expect(r.diagnostics.map((d) => d.message).join('\n')).toMatch(/necesita el dato \(valor por zona\) GR_SUM/);
  });
});

describe('tipo de zona en ctx.zones y en la firma', () => {
  beforeEach(resetCalls);

  it('layoutZones copia el tipo de la zona', () => {
    const layout = layoutZones(depthRange(10), [{ ...zone('a', 1000, 1002), kind: 'reservoir' }, zone('b', 1003, 1004)]);
    expect(layout.spans.map((s) => s.kind)).toEqual(['reservoir', 'formation']);
  });

  it('cambiar el tipo de una zona recalcula los módulos (y llega a ctx.zones)', () => {
    const engine = new Engine(createRegistry([producer, consumer]));
    engine.setWell(well([gr]));
    engine.run(interp({ zones }));
    const reservoir = zones.map((z) => (z.id === 'a' ? { ...z, kind: 'reservoir' as const } : z));
    const r = engine.run(interp({ zones: reservoir }));
    expect(r.stats.recomputed).toEqual(['producer', 'consumer']);
    expect((value(r, 'producer:GR_TABLE') as ReadonlyTableValue).rows.map((row) => row.kind)).toEqual(['reservoir', 'formation', 'formation']);
    // cambiar solo el color no invalida
    const recolored = reservoir.map((z) => ({ ...z, color: '#123456' }));
    expect(engine.run(interp({ zones: recolored })).stats.recomputed).toEqual([]);
  });
});

describe('tipos: tablas y valores por zona', () => {
  it('las entradas son de solo lectura y la salida por zona es un Record<string, number>', () => {
    defineModule({
      ...base,
      id: 't',
      inputs: { t: input.table('T'), z: input.zoneScalar('Z'), oz: input.optionalZoneScalar('OZ'), ot: input.optionalTable('OT') },
      params: {},
      outputs: { y: output.zoneScalar('Y', { label: 'y' }) },
      compute(ctx) {
        expectTypeOf(ctx.inputs.t).toEqualTypeOf<ReadonlyTableValue>();
        expectTypeOf(ctx.inputs.z).toEqualTypeOf<ReadonlyZoneScalarValue>();
        expectTypeOf(ctx.inputs.oz).toEqualTypeOf<ReadonlyZoneScalarValue | undefined>();
        expectTypeOf(ctx.inputs.ot).toEqualTypeOf<ReadonlyTableValue | undefined>();
        expectTypeOf(ctx.zones[0]!.kind).toEqualTypeOf<'formation' | 'reservoir' | 'seal' | 'other'>();
        // @ts-expect-error el valor por zona de entrada es de solo lectura
        ctx.inputs.z.a = 1;
        // @ts-expect-error las filas de una tabla de entrada son de solo lectura
        ctx.inputs.t.rows[0]!.x = 1;
        return { y: {} };
      },
    });
    defineModule({
      ...base,
      id: 'u',
      inputs: {},
      params: {},
      outputs: { y: output.zoneScalar('Y', { label: 'y' }) },
      // @ts-expect-error un valor por zona no es un número
      compute: () => ({ y: 3 }),
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Protocolo (worker ↔ cliente)

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

describe('cliente: tablas y valores por zona', () => {
  let clients: EngineClient[] = [];
  afterEach(() => {
    clients.forEach((c) => c.dispose());
    clients = [];
  });

  it('viajan por el canal y no se reenvían si no cambiaron', async () => {
    const registry = createRegistry([producer, consumer]);
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
    client.run(interp({ zones }));
    let r = await p;
    const sum = r.outputs.find((o) => o.key === 'producer:GR_SUM')!;
    expect(sum.kind).toBe('zoneScalar');
    expect(sum.value).toEqual({ a: 150, b: 400, c: NaN });
    // cambia solo el tipo de una zona → recalcula ambos; cambia el color → nada viaja
    p = nextResult(client);
    client.run(interp({ zones: zones.map((z) => ({ ...z, color: '#000' })) }));
    r = await p;
    const wire = seen.filter((m): m is Extract<FromEngine, { type: 'result' }> => m.type === 'result').at(-1)!;
    expect(wire.result.outputs.find((o) => o.key === 'producer:GR_SUM')!.value).toBeUndefined();
    expect(wire.result.outputs.find((o) => o.key === 'producer:GR_TABLE')!.value).toBeUndefined();
    expect(r.outputs.find((o) => o.key === 'producer:GR_SUM')!.value).toEqual({ a: 150, b: 400, c: NaN });
    expect((r.outputs.find((o) => o.key === 'producer:GR_TABLE')!.value as ReadonlyTableValue).rows).toHaveLength(3);
  });

  it('el cliente en proceso entrega los mismos valores que el motor directo', async () => {
    const registry = createRegistry([producer, consumer]);
    const client = createInProcessClient(registry);
    clients.push(client);
    client.syncWell(well([gr]));
    const p = nextResult(client);
    client.run(interp({ zones }));
    const r = await p;
    const direct = computeOnce(registry, well([gr]), interp({ zones }));
    for (const o of direct.outputs) expect(r.outputs.find((x) => x.key === o.key)!.value).toEqual(o.value);
  });
});
