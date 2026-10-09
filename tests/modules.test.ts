import { describe, expect, it } from 'vitest';
import { Engine, toEngineWell } from '../src/core/engine/engine';
import { emptyInterpretation } from '../src/core/interpretation';
import { defineModule, input, output, type TableValue } from '../src/core/module';
import { createRegistry } from '../src/core/registry';
import { MODULES, registry } from '../src/modules';
import { syntheticWell } from '../src/app/demo/syntheticWell';

/** Fuentes de las capas que carga el worker (Vite las incluye como texto). */
const PURE_SOURCES = import.meta.glob(['../src/core/**/*.ts', '../src/petro/**/*.ts', '../src/modules/**/*.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const MODULE_ENTRIES = Object.keys(import.meta.glob('../src/modules/*/index.ts'));

describe('módulos registrados', () => {
  it('el registro real es válido', () => {
    expect(registry.modules.map((m) => m.id)).toEqual(['igr', 'shale-flag']);
    expect(MODULES).toHaveLength(2);
  });

  it('cada módulo vive en una carpeta con su mismo id', () => {
    for (const m of registry.modules) expect(MODULE_ENTRIES).toContain(`../src/modules/${m.id}/index.ts`);
  });

  it('núcleo, petro y definiciones de módulos no importan React ni la interfaz (los carga el worker)', () => {
    const pure = Object.entries(PURE_SOURCES);
    expect(pure.length).toBeGreaterThan(10);
    for (const [f, src] of pure) {
      expect(src, f).not.toMatch(/from ['"](react|react-dom|zustand)(\/[^'"]*)?['"]/);
      expect(src, f).not.toMatch(/from ['"][./]*(app|ui|viewer|plots)\//);
      expect(src, f).not.toMatch(/\bpanel['"]/);
    }
  });

  it('IGR → bandera de arcilla sobre el pozo sintético, con parámetros por zona', () => {
    const demo = syntheticWell();
    const engine = new Engine(registry);
    engine.setWell(toEngineWell(demo.well));
    const base = emptyInterpretation(demo.zones);
    const r1 = engine.run(base);
    expect(r1.diagnostics.filter((d) => d.level === 'error')).toEqual([]);
    expect(r1.stats.recomputed).toEqual(['igr', 'shale-flag']);

    const igr = r1.outputs.find((o) => o.key === 'igr:IGR')!.value as Float64Array;
    const gr = demo.well.curves.find((c) => c.role === 'GR')!.data;
    // muestra puntual: definición de IGR con defaults 30/120
    const k = 1234;
    expect(igr[k]).toBeCloseTo(Math.min(1, Math.max(0, (gr[k]! - 30) / 90)), 12);

    const table = r1.outputs.find((o) => o.key === 'shale-flag:IGR_BY_ZONE')!.value as TableValue;
    expect(table.rows.map((r) => r['zone'])).toEqual(['A', 'B', 'C', 'D', 'E']);

    // mover el corte solo recalcula la bandera
    const r2 = engine.run({ ...base, params: { global: { 'shale-flag.cutoff': 0.3 }, zones: {} } });
    expect(r2.stats.recomputed).toEqual(['shale-flag']);

    // GR limpia en la zona C → recalcula ambos y cambia la media solo en C
    const zc = demo.zones[2]!.id;
    const r3 = engine.run({ ...base, params: { global: {}, zones: { [zc]: { grClean: 60 } } } });
    expect(r3.stats.recomputed).toEqual(['igr', 'shale-flag']);
    const t3 = r3.outputs.find((o) => o.key === 'shale-flag:IGR_BY_ZONE')!.value as TableValue;
    expect(t3.rows[2]!['meanIgr']).not.toBe(table.rows[2]!['meanIgr']);
    expect(t3.rows[1]!['meanIgr']).toBe(table.rows[1]!['meanIgr']);
  });

  it('avisa cuando GR de arcilla no supera a GR limpia en una zona', () => {
    const demo = syntheticWell();
    const engine = new Engine(registry);
    engine.setWell(toEngineWell(demo.well));
    const zc = demo.zones[2]!.id;
    const r = engine.run({ ...emptyInterpretation(demo.zones), params: { global: {}, zones: { [zc]: { grClean: 130 } } } });
    const warn = r.diagnostics.filter((d) => d.code === 'module-warning').map((d) => d.message);
    expect(warn).toEqual(['Índice de rayos gamma: en la zona C, el GR de arcilla no supera al de arena limpia: el índice queda sin dato.']);
  });

  it('el ejemplo de "cómo agregar un módulo" de docs/arquitectura.md funciona tal cual', () => {
    const larionovTertiary = (igr: number) => (Number.isNaN(igr) ? NaN : 0.083 * (2 ** (3.7 * igr) - 1));
    const vshLarionovTertiary = defineModule({
      id: 'vsh-larionov-tertiary',
      name: 'Vsh — Larionov (terciario)',
      category: 'shale',
      workspace: 'petrophysics',
      inputs: { igr: input.curve('IGR') },
      params: {},
      outputs: { vsh: output.curve('VSH') },
      compute({ n, inputs }) {
        const vsh = new Float64Array(n);
        for (let i = 0; i < n; i++) vsh[i] = larionovTertiary(inputs.igr[i]!);
        return { vsh };
      },
      docs: {
        summary: 'Volumen de arcilla a partir de IGR para rocas terciarias no consolidadas.',
        equations: [{ latex: 'V_{sh} = 0.083\\,(2^{3.7 I_{GR}} - 1)' }],
        references: ['Larionov, V. V. (1969).'],
      },
    });
    const extended = createRegistry([...MODULES, vshLarionovTertiary]);
    const demo = syntheticWell();
    const engine = new Engine(extended);
    engine.setWell(toEngineWell(demo.well));
    const r = engine.run(emptyInterpretation(demo.zones));
    expect(r.stats.recomputed).toEqual(['igr', 'shale-flag', 'vsh-larionov-tertiary']);
    const vsh = r.outputs.find((o) => o.key === 'vsh-larionov-tertiary:VSH')!;
    expect(vsh.active).toBe(true);
    // IGR = 1 → Vsh = 0,083·(2^3,7 − 1) = 0,083·11,996 ≈ 0,9957
    expect(larionovTertiary(1)).toBeCloseTo(0.9957, 4);
    expect(larionovTertiary(0)).toBe(0);
  });
});
