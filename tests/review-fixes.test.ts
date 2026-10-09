/**
 * Regresiones encontradas en la revisión de la fase 1.
 */
import { describe, expect, it } from 'vitest';
import { Engine } from '../src/core/engine/engine';
import { EngineClient, type ClientEvent, type ClientResult } from '../src/core/engine/client';
import { serveEngine } from '../src/core/engine/serve';
import { defineModule, input, output, type TableValue } from '../src/core/module';
import { param } from '../src/core/params';
import { createRegistry } from '../src/core/registry';
import { addWell, clearParam, createProject, setCompare, setModuleEnabled, setParam, setSource } from '../src/core/state/project';
import { createWell } from '../src/core/well';
import { curve, depthRange, interp, linearModule, well, zone } from './helpers';

const gr = curve('GR1', 'GR', [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);

describe('nombres de zona en resultados en caché', () => {
  const byZone = defineModule({
    id: 'by-zone',
    name: 'Por zona',
    category: 'other',
    workspace: 'petrophysics',
    inputs: { x: input.curve('GR') },
    params: {},
    outputs: { t: output.table('BY_ZONE', { label: 'Por zona', columns: [{ key: 'zone', label: 'Zona', kind: 'text' }] }) },
    compute: ({ zones }) => ({ t: { rows: zones.map((z) => ({ zone: z.name })) } }),
    docs: { summary: '', equations: [], references: [] },
  });

  it('renombrar una zona actualiza las salidas que muestran su nombre', () => {
    const engine = new Engine(createRegistry([byZone]));
    engine.setWell(well([gr]));
    engine.run(interp({ zones: [zone('a', 1000, 1002)] }));
    const renamed = engine.run(interp({ zones: [{ ...zone('a', 1000, 1002), name: 'Arenisca' }] }));
    const rows = (renamed.outputs[0]!.value as TableValue).rows;
    expect(rows).toEqual([{ zone: 'Arenisca' }]);
  });

  it('cambiar solo el color de una zona no recalcula; cambiar su tipo sí (fase 6a)', () => {
    const engine = new Engine(createRegistry([byZone]));
    engine.setWell(well([gr]));
    engine.run(interp({ zones: [zone('a', 1000, 1002)] }));
    let r = engine.run(interp({ zones: [{ ...zone('a', 1000, 1002), color: '#f00' }] }));
    expect(r.stats.recomputed).toEqual([]);
    r = engine.run(interp({ zones: [{ ...zone('a', 1000, 1002), color: '#f00', kind: 'reservoir' }] }));
    expect(r.stats.recomputed).toEqual(['by-zone']);
  });
});

describe('protocolo: una respuesta que no se pudo enviar no cuenta como enviada', () => {
  it('si postMessage falla, la corrida siguiente reenvía todas las salidas', async () => {
    let bad = true;
    const flaky = defineModule({
      id: 'flaky',
      name: 'Tabla rara',
      category: 'other',
      workspace: 'petrophysics',
      inputs: {},
      params: { k: param.number({ label: 'K', default: 1, min: 0, max: 10 }) },
      // Una celda no clonable (función) hace fallar el structured clone de la respuesta completa.
      outputs: { t: output.table('T', { label: 'T', columns: [] }) },
      compute: () => ({ t: { rows: bad ? [{ f: (() => 1) as unknown as number }] : [] } }),
      docs: { summary: '', equations: [], references: [] },
    });
    const registry = createRegistry([linearModule('igr', 'GR', 'IGR'), flaky]);
    const channel = new MessageChannel();
    const stop = serveEngine(channel.port2, registry);
    const client = new EngineClient(channel.port1, () => {
      stop();
      channel.port1.close();
      channel.port2.close();
    });
    const next = () =>
      new Promise<{ result?: ClientResult; errors: string[] }>((resolve) => {
        const errors: string[] = [];
        const off = client.subscribe((e: ClientEvent) => {
          if (e.type === 'error') errors.push(e.message);
          if (e.type === 'busy' && !e.busy) {
            off();
            resolve({ errors });
          }
          if (e.type === 'result') {
            off();
            resolve({ result: e.result, errors });
          }
        });
      });
    try {
      client.syncWell(well([gr]));
      let p = next();
      client.run(interp());
      const first = await p;
      expect(first.result).toBeUndefined();
      expect(first.errors).toHaveLength(1);

      bad = false;
      p = next();
      client.run(interp({ params: { global: { 'flaky.k': 2 }, zones: {} } }));
      const second = await p;
      expect(second.errors).toEqual([]);
      expect(second.result!.outputs.map((o) => o.key)).toEqual(['igr:IGR', 'flaky:T']);
    } finally {
      client.dispose();
    }
  });
});

describe('acciones del proyecto sin cambios devuelven el mismo proyecto', () => {
  const w = createWell({
    id: 'w1',
    name: 'Pozo 1',
    depth: depthRange(10),
    curves: [{ id: 'GR', mnemonic: 'GR', role: 'GR', unit: 'gAPI', data: new Float64Array(10), origin: { kind: 'measured' } }],
  });
  const p0 = setParam(addWell(createProject('Demo'), w, [zone('a', 1000, 1002)]), 'w1', 'k', 1);

  it('fijar el mismo valor, limpiar lo ausente, comparar o activar sin cambios', () => {
    expect(setParam(p0, 'w1', 'k', 1)).toBe(p0);
    expect(clearParam(p0, 'w1', 'nada')).toBe(p0);
    expect(clearParam(p0, 'w1', 'k', 'a')).toBe(p0);
    expect(setCompare(p0, 'w1', 'igr', false)).toBe(p0);
    expect(setModuleEnabled(p0, 'w1', 'igr', true)).toBe(p0);
    expect(setSource(p0, 'w1', 'VSH', null)).toBe(p0);
  });
});
