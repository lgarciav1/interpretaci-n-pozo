import { describe, expect, it } from 'vitest';
import { Engine, toEngineWell } from '../src/core/engine/engine';
import { emptyInterpretation } from '../src/core/interpretation';
import { defineModule, input, output } from '../src/core/module';
import { createRegistry } from '../src/core/registry';
import { MODULES, registry } from '../src/modules';
import { syntheticWell } from '../src/app/demo/syntheticWell';

/** Fuentes de las capas que carga el worker (Vite las incluye como texto). */
// `src/modules/<id>/overlay.ts` (superposiciones del visor) y `series.ts` (proveedores de series para tendencias)
// son de la interfaz: el worker no los importa.
const PURE_SOURCES = import.meta.glob(['../src/core/**/*.ts', '../src/petro/**/*.ts', '../src/modules/**/*.ts', '!../src/modules/*/overlay.ts', '!../src/modules/*/series.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;
const MODULE_ENTRIES = Object.keys(import.meta.glob('../src/modules/*/index.ts'));

/** Módulos de la fase 6a (parte petrofísica) en el orden del catálogo (0007). */
const CATALOG_6A_PETRO = [
  'vsh', 'phi-density', 'phi-neutron', 'phi-sonic-raymer', 'phit', 'phie-vsh', 'phie-shale-corrected',
  'temp-gradient', 'rw-manual', 'sw-archie', 'sw-simandoux', 'sw-indonesia', 'bvw-sh', 'perm-timur', 'perm-coates',
];

describe('módulos registrados', () => {
  it('el registro real es válido y respeta el orden del catálogo', () => {
    const ids = registry.modules.map((m) => m.id);
    expect(ids[0]).toBe('igr');
    expect(ids).not.toContain('shale-flag');
    expect(ids.filter((id) => id === 'igr' || CATALOG_6A_PETRO.includes(id))).toEqual(['igr', ...CATALOG_6A_PETRO]);
    expect(MODULES).toHaveLength(ids.length);
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
      expect(src, f).not.toMatch(/\/overlay['"]/);
    }
  });

  it('IGR → VSH sobre el pozo sintético, con método por zona', () => {
    const demo = syntheticWell();
    const engine = new Engine(registry, { checkInputs: true });
    engine.setWell(toEngineWell(demo.well));
    const base = emptyInterpretation(demo.zones);
    const r1 = engine.run(base);
    expect(r1.stats.recomputed).toEqual(expect.arrayContaining(['igr', 'vsh']));

    const igr = r1.outputs.find((o) => o.key === 'igr:IGR')!.value as Float64Array;
    const vsh = r1.outputs.find((o) => o.key === 'vsh:VSH')!.value as Float64Array;
    const gr = demo.well.curves.find((c) => c.role === 'GR')!.data;
    // muestra puntual: definición de IGR con defaults 30/120; Vsh lineal por defecto
    const k = 1234;
    expect(igr[k]).toBeCloseTo(Math.min(1, Math.max(0, (gr[k]! - 30) / 90)), 12);
    expect(vsh[k]).toBe(igr[k]);

    // cambiar el método de la zona C recalcula VSH (no IGR) y cambia solo esa zona
    const zc = demo.zones[2]!.id;
    const r2 = engine.run({ ...base, params: { global: {}, zones: { [zc]: { 'vsh.method': 'larionovTertiary' } } } });
    expect(r2.stats.recomputed).toContain('vsh');
    expect(r2.stats.recomputed).not.toContain('igr');
    const vsh2 = r2.outputs.find((o) => o.key === 'vsh:VSH')!.value as Float64Array;
    const inC = demo.well.depth.values.findIndex((d) => d >= demo.zones[2]!.top + 20);
    const inB = demo.well.depth.values.findIndex((d) => d >= demo.zones[1]!.top + 20);
    expect(vsh2[inC]).not.toBe(vsh[inC]);
    expect(vsh2[inB]).toBe(vsh[inB]);

    // GR limpia en la zona C → recalcula IGR
    const r3 = engine.run({ ...base, params: { global: {}, zones: { [zc]: { grClean: 60 } } } });
    expect(r3.stats.recomputed).toContain('igr');
  });

  it('avisa cuando GR de arcilla no supera a GR limpia en una zona', () => {
    const demo = syntheticWell();
    const engine = new Engine(registry, { checkInputs: true });
    engine.setWell(toEngineWell(demo.well));
    const zc = demo.zones[2]!.id;
    const r = engine.run({ ...emptyInterpretation(demo.zones), params: { global: {}, zones: { [zc]: { grClean: 130 } } } });
    const warn = r.diagnostics.filter((d) => d.code === 'module-warning').map((d) => d.message);
    expect(warn).toContain('Índice de rayos gamma: en la zona C, el GR de arcilla no supera al de arena limpia: el índice queda sin dato.');
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
    const extended = createRegistry([vshLarionovTertiary, ...MODULES]);
    const demo = syntheticWell();
    const engine = new Engine(extended, { checkInputs: true });
    engine.setWell(toEngineWell(demo.well));
    const r = engine.run(emptyInterpretation(demo.zones));
    expect(r.stats.recomputed).toContain('vsh-larionov-tertiary');
    const vsh = r.outputs.find((o) => o.key === 'vsh-larionov-tertiary:VSH')!;
    expect(vsh.active).toBe(true);
    // IGR = 1 → Vsh = 0,083·(2^3,7 − 1) = 0,083·11,996 ≈ 0,9957
    expect(larionovTertiary(1)).toBeCloseTo(0.9957, 4);
    expect(larionovTertiary(0)).toBe(0);
  });
});
