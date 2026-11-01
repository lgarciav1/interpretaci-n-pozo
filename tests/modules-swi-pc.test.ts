/**
 * Módulo swi-pc (tarea 8; docs/decisiones/0055-swi-desde-scal.md): curva SWI por ley de potencia en √(k/φ), bandera
 * SW_LT_SWI y tabla por zona, corridos con el motor sobre PERM, PHIE y SW sintéticas. Los valores esperados son
 * cuentas de mano / numpy (scripts/qa/swi-pc-reference.py), no las funciones de petro.
 */
import { describe, expect, it } from 'vitest';
import { Engine, type EngineCurve, type EngineRunResult } from '../src/core/engine/engine';
import { emptyInterpretation, type Interpretation } from '../src/core/interpretation';
import type { TableValue } from '../src/core/module';
import { registry } from '../src/modules';
import { SWI_PC_ID, SWI_ZONES } from '../src/modules/swi-pc';
import { curve, well, zone } from './helpers';

// 12 muestras cada 0,5 m. Zona A: 0–5 (1000–1002,5), zona B: 6–11 (1003–1005,5).
const K = [100, 1, 0, -2, NaN, 100, 100, 1, 0.01, 100, 5, 1];
const PHI = [0.2, 0.1, 0.2, 0.2, 0.2, NaN, 0.2, 0.1, 0.05, 0.2, 0.2, 0];
const SW = [0.1, 0.4, 0.5, 0.5, 0.5, 0.5, 0.3, 0.3, 0.9, 0.12, NaN, 0.5];
const N = K.length;
const ZONES = [zone('za', 1000, 1002.5), zone('zb', 1003, 1005.5)];

// Swi de mano (numpy) con x = √(k/φ%):
//   k=100, φ=20 %  → x = 2,236068:  nivel 1 = 0,221294147, nivel 6 = 0,017408200
//   k=1,   φ=10 %  → x = 0,316228:  nivel 1 = 0,424471400, nivel 6 = 0,054344317
//   k=0,01, φ=5 %  → x = 0,044721:  nivel 1 = 0,814192204, nivel 6 = 0,169650213
const L1 = { a: 0.22129414724670962, b: 0.4244713999424127, c: 0.8141922035028004 };
const L6 = { a: 0.01740819992106007, b: 0.0543443172467464, c: 0.16965021256690488 };

const run = (curves: EngineCurve[], partial: Partial<Interpretation> = {}): EngineRunResult => {
  const engine = new Engine(registry, { checkInputs: true });
  engine.setWell(well(curves, N, 1000, 0.5));
  return engine.run({ ...emptyInterpretation(ZONES), ...partial });
};
const base = (): EngineCurve[] => [curve('K', 'PERM', K), curve('PHIE_X', 'PHIE', PHI), curve('SW_X', 'SW', SW)];
const noSw = (): EngineCurve[] => base().slice(0, 2);
const params = (g: Record<string, number | string>, zones: Record<string, Record<string, number | string>> = {}) => ({
  params: {
    global: Object.fromEntries(Object.entries(g).map(([k, v]) => [`${SWI_PC_ID}.${k}`, v])),
    zones: Object.fromEntries(Object.entries(zones).map(([z, o]) => [z, Object.fromEntries(Object.entries(o).map(([k, v]) => [`${SWI_PC_ID}.${k}`, v]))])),
  },
});

function out<T = Float64Array>(r: EngineRunResult, port: string): T {
  const o = r.outputs.find((x) => x.key === `${SWI_PC_ID}:${port}`);
  if (!o) throw new Error(`Falta la salida ${SWI_PC_ID}:${port}`);
  return o.value as T;
}
const warnings = (r: EngineRunResult) => r.diagnostics.filter((d) => d.level === 'warning' && d.moduleId === SWI_PC_ID).map((d) => d.message);
const errors = (r: EngineRunResult) => r.diagnostics.filter((d) => d.level === 'error' && d.moduleId === SWI_PC_ID);
const rows = (r: EngineRunResult) => out<TableValue>(r, SWI_ZONES).rows;
function same(actual: Float64Array, expected: number[]) {
  expect(actual.length).toBe(expected.length);
  expected.forEach((e, i) => {
    if (Number.isNaN(e)) expect(actual[i], `muestra ${i}`).toBeNaN();
    else expect(actual[i], `muestra ${i}`).toBeCloseTo(e, 12);
  });
}

describe('swi-pc: registro y esquema', () => {
  const m = registry.modules.find((x) => x.id === SWI_PC_ID)!;

  it('registrado en Saturación (Petrofísica); entradas PERM y PHIE obligatorias y SW opcional', () => {
    expect(m).toBeDefined();
    expect(m.category).toBe('saturation');
    expect(m.workspace).toBe('petrophysics');
    expect(Object.values(m.inputs).map((i) => ('role' in i ? [i.role, !!i.optional] : null))).toEqual([
      ['PERM', false],
      ['PHIE', false],
      ['SW', true],
    ]);
  });

  it('roles nuevos SWI (v/v, saturación) y SW_LT_SWI (bandera) con el SWI producido solo por este módulo', () => {
    expect(registry.roles.get('SWI')).toMatchObject({ unit: 'v/v', family: 'saturation', display: { scale: 'linear', min: 0, max: 1, reversed: true } });
    expect(registry.roles.get('SW_LT_SWI')).toMatchObject({ unit: 'unitless', family: 'flag' });
    for (const role of ['SWI', 'SW_LT_SWI']) {
      expect(registry.modules.filter((x) => Object.values(x.outputs).some((o) => o.kind === 'curve' && o.role === role)).map((x) => x.id)).toEqual([SWI_PC_ID]);
    }
  });

  it('enum con los 6 niveles de la cátedra y «Manual»; todo por zona; nivel 1 = menor presión capilar', () => {
    const level = m.params['level'] as unknown as { type: string; options: { value: string; label: string }[]; default: string; scope: string };
    expect(level.type).toBe('enum');
    expect(level.options.map((o) => o.value)).toEqual(['level1', 'level2', 'level3', 'level4', 'level5', 'level6', 'manual']);
    expect(level.options[0]!.label).toBe('Nivel 1 (menor presión capilar)');
    expect(level.options[5]!.label).toBe('Nivel 6 (mayor presión capilar)');
    expect(level.options[6]!.label).toBe('Manual');
    for (const k of ['level', 'manualA', 'manualB', 'tolerance']) expect((m.params[k] as { scope?: string }).scope, k).toBe('zone');
    for (const k of ['manualA', 'manualB', 'tolerance']) expect((m.params[k] as { tooltip?: string }).tooltip, k).toBeTruthy();
  });

  it('documentación con ecuaciones, referencias (Buckles y la planilla de la cátedra) y advertencia de rango', () => {
    expect(m.docs.equations.length).toBeGreaterThanOrEqual(4);
    expect(m.docs.references.join(' ')).toContain('Buckles');
    expect(m.docs.references.join(' ')).toContain('cátedra');
    expect(m.docs.notes).toMatch(/rango/);
  });

  it('las ecuaciones no aparecen en la interfaz: ni nombre, ni descripción, ni tooltips llevan símbolos de fórmula', () => {
    const texts = [m.name, m.description ?? '', ...Object.values(m.params).map((p) => (p as { tooltip?: string }).tooltip ?? '')];
    for (const t of texts) expect(t, t).not.toMatch(/[=^]/);
  });
});

describe('swi-pc: curva SWI por muestra', () => {
  it('nivel 1: valores de mano; NaN con k ≤ 0, k o φ sin dato; φ = 0 sin dato', () => {
    const r = run(base(), params({ level: 'level1' }));
    expect(errors(r)).toEqual([]);
    // k=5 mD, φ=20 %: x = √(5/20) = 0,5 → 28,93·0,5^−0,333/100 = 0,36441
    const k10 = (28.93 * Math.pow(0.5, -0.333)) / 100;
    expect(k10).toBeCloseTo(0.36441, 5);
    same(out(r, 'SWI'), [L1.a, L1.b, NaN, NaN, NaN, NaN, L1.a, L1.b, L1.c, L1.a, k10, NaN]);
  });

  it('nivel 6 por defecto: Swi mucho menor que el nivel 1 en todas las muestras con dato', () => {
    const r = run(base());
    const swi = out(r, 'SWI');
    same(swi.slice(0, 2), [L6.a, L6.b]);
    expect(swi[8]).toBeCloseTo(L6.c, 12);
    const r1 = run(base(), params({ level: 'level1' }));
    out(r1, 'SWI').forEach((v, i) => {
      if (Number.isFinite(v)) expect(swi[i]!).toBeLessThan(v);
    });
  });

  it('Swi crece al bajar el nivel de presión capilar: orden 1 > 2 > … > 6 para una muestra', () => {
    const vals = ['level1', 'level2', 'level3', 'level4', 'level5', 'level6'].map((l) => out(run(base(), params({ level: l })), 'SWI')[0]!);
    const expected = [0.22129414724670962, 0.16325964919397873, 0.10919229901897949, 0.06168618766734745, 0.04340874656694675, 0.01740819992106007];
    vals.forEach((v, i) => expect(v).toBeCloseTo(expected[i]!, 12));
  });

  it('manual: A = 15,102 y B = −0,403 reproducen el nivel 3; recorta a 1 la roca muy cerrada y avisa', () => {
    const r3 = run(base(), params({ level: 'level3' }));
    const rm = run(base(), params({ level: 'manual', manualA: 15.102, manualB: -0.403 }));
    same(out(rm, 'SWI'), Array.from(out(r3, 'SWI')));
    expect(rows(rm)[0]!['level']).toBe('Manual');

    // A = 100, B = −1 con x = 0,0447 (k=0,01, φ=5 %): 100·22,36/100 = 22,4 → recortado a 1
    const rc = run(base(), params({ level: 'manual', manualA: 100, manualB: -1 }));
    expect(out(rc, 'SWI')[8]).toBe(1);
    expect(warnings(rc).some((w) => /recortan a 1/.test(w))).toBe(true);
  });

  it('manual con A ≤ 0 (inválido): sin Swi, un aviso claro y un renglón marcado en la tabla; sin error', () => {
    const rm = run(base(), params({ level: 'manual', manualA: 0, manualB: -0.4 }));
    expect(errors(rm)).toEqual([]);
    expect(Array.from(out(rm, 'SWI')).every(Number.isNaN)).toBe(true);
    expect(Array.from(out(rm, 'SW_LT_SWI')).every(Number.isNaN)).toBe(true);
    expect(warnings(rm).some((w) => /coeficientes manuales no son válidos/.test(w))).toBe(true);
    expect(rows(rm)[0]).toMatchObject({ level: 'Manual (inválido)', nSwi: 0, swiMean: null });
  });
});

describe('swi-pc: bandera SW_LT_SWI', () => {
  it('nivel 1, tolerancia 0,02: 1 si Sw < Swi − 0,02; 0 si no; NaN sin Sw o sin Swi', () => {
    const r = run(base(), params({ level: 'level1' }));
    const f = out(r, 'SW_LT_SWI');
    // Swi: 0:0,2213 (Sw 0,10 → 1) 1:0,4245 (Sw 0,40 → 1) 2:NaN 3:NaN 4:NaN 5:NaN
    //      6:0,2213 (Sw 0,30 → 0) 7:0,4245 (Sw 0,30 → 1) 8:0,8142 (Sw 0,90 → 0) 9:0,2213 (Sw 0,12 → 1)
    //      10:0,5·: Sw NaN → NaN  11: φ=0 → NaN
    same(f, [1, 1, NaN, NaN, NaN, NaN, 0, 1, 0, 1, NaN, NaN]);
  });

  it('la tolerancia es estricta y por zona: con 0,1 en la zona A se deja de marcar la muestra 1 (0,4245 − 0,1 < 0,40)', () => {
    const r = run(base(), params({ level: 'level1' }, { za: { tolerance: 0.1 } }));
    const f = out(r, 'SW_LT_SWI');
    expect(f[0]).toBe(1); // 0,10 < 0,2213 − 0,1 = 0,1213
    expect(f[1]).toBe(0); // 0,40 no es < 0,3245
    expect(f[7]).toBe(1); // la zona B conserva 0,02
    const r0 = run(base(), params({ level: 'level1', tolerance: 0 }));
    expect(out(r0, 'SW_LT_SWI')[6]).toBe(0); // 0,30 > 0,2213 aun sin tolerancia
  });

  it('sin SW: la curva SWI se calcula igual, la bandera es toda NaN y se avisa; sin error', () => {
    const r = run(noSw(), params({ level: 'level1' }));
    expect(errors(r)).toEqual([]);
    expect(out(r, 'SWI')[0]).toBeCloseTo(L1.a, 12);
    expect(Array.from(out(r, 'SW_LT_SWI')).every(Number.isNaN)).toBe(true);
    expect(warnings(r).some((w) => /Sin curva Sw/.test(w))).toBe(true);
    const row = rows(r)[0]!;
    expect(row['swMean']).toBeNull();
    expect(row['pctBelow']).toBeNull();
    expect(row['nBoth']).toBe(0);
    expect(row['swiMean']).not.toBeNull();
  });
});

describe('swi-pc: tabla por zona', () => {
  it('nivel 1: Swi medio, Sw medio y % con Sw < Swi por zona (cuentas de mano)', () => {
    const r = run(base(), params({ level: 'level1' }));
    const [za, zb] = rows(r);
    expect(za).toMatchObject({ zoneId: 'za', zone: 'ZA', level: 'Nivel 1 (menor presión capilar)', a: 28.93, b: -0.333, nSwi: 2, nBoth: 2, pctBelow: 100 });
    expect(za!['swiMean']).toBeCloseTo((L1.a + L1.b) / 2, 12);
    expect(za!['swMean']).toBeCloseTo((0.1 + 0.4) / 2, 12);
    // Zona B: muestras 6,7,8,9 con Swi; 10 (Sw NaN) y 11 (φ=0) no entran en la comparación
    expect(zb).toMatchObject({ zoneId: 'zb', nBoth: 4, pctBelow: 50 });
    expect(zb!['nSwi']).toBe(5);
    const k10 = (28.93 * Math.pow(0.5, -0.333)) / 100;
    expect(zb!['swiMean']).toBeCloseTo((L1.a + L1.b + L1.c + L1.a + k10) / 5, 12);
    expect(zb!['swMean']).toBeCloseTo((0.3 + 0.3 + 0.9 + 0.12) / 4, 12);
  });

  it('% fuera del rango SCAL (√(k/φ) de 0,366 a 1,9955) con presets; nulo en manual', () => {
    const r = run(base(), params({ level: 'level1' }));
    // x por muestra con Swi. Zona A: 2,236 y 0,316, ambas fuera → 100 %. Zona B: 2,236, 0,316, 0,0447, 2,236 fuera y 0,5 dentro → 80 %
    const [za, zb] = rows(r);
    expect(za!['pctOutRange']).toBe(100);
    expect(zb!['pctOutRange']).toBeCloseTo(80, 12);
    // el rango se informa en la tabla; no es un aviso (el módulo corre por defecto con cualquier PERM y PHIE)
    expect(warnings(r).some((w) => /rango/.test(w))).toBe(false);
    const rm = run(base(), params({ level: 'manual' }));
    expect(rows(rm)[0]!['pctOutRange']).toBeNull();
  });

  it('niveles por zona: la zona A con nivel 6 y la B con nivel 1', () => {
    const r = run(base(), params({ level: 'level1' }, { za: { level: 'level6' } }));
    const swi = out(r, 'SWI');
    expect(swi[0]).toBeCloseTo(L6.a, 12);
    expect(swi[6]).toBeCloseTo(L1.a, 12);
    const [za, zb] = rows(r);
    expect(za!['level']).toBe('Nivel 6 (mayor presión capilar)');
    expect(zb!['level']).toBe('Nivel 1 (menor presión capilar)');
    expect(za!['a']).toBe(2.7807);
    expect(zb!['b']).toBe(-0.333);
  });

  it('sin zonas: un renglón «Pozo completo»; las muestras fuera de las zonas también llevan Swi', () => {
    const r = run(base(), { ...params({ level: 'level1' }), zones: [] });
    const rs = rows(r);
    expect(rs).toHaveLength(1);
    expect(rs[0]).toMatchObject({ zoneId: '', zone: 'Pozo completo', nSwi: 7 });
    const solo = run(base(), { ...params({ level: 'level1' }), zones: [zone('zc', 1000, 1000.5)] });
    expect(rows(solo)).toHaveLength(1);
    expect(out(solo, 'SWI')[9]).toBeCloseTo(L1.a, 12); // fuera de la zona
  });

  it('datos todos fuera de dominio: tabla con nulos, sin error ni avisos de recorte', () => {
    const bad = [curve('K', 'PERM', new Array(N).fill(0)), curve('PHIE_X', 'PHIE', new Array(N).fill(0.2)), curve('SW_X', 'SW', SW)];
    const r = run(bad, params({ level: 'level1' }));
    expect(errors(r)).toEqual([]);
    for (const row of rows(r)) {
      expect(row).toMatchObject({ nSwi: 0, nBoth: 0, swiMean: null, swMean: null, pctBelow: null, pctOutRange: null });
    }
    expect(Array.from(out(r, 'SWI')).every(Number.isNaN)).toBe(true);
  });
});
