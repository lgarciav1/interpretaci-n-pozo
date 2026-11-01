/**
 * Corte opcional de permeabilidad y arena neta (docs/decisiones/0054): motor puro (tabla de verdad a mano), sumario,
 * barrido de sensibilidad, módulo de cutoffs en el motor (por zona, PERM ausente, compatibilidad) y cutoffs de los
 * gráficos. Los cutoffs son decisiones del intérprete: los casos se verifican a mano.
 */
import { describe, expect, it } from 'vitest';
import { Engine, toEngineWell, type EngineRunResult } from '../src/core/engine/engine';
import { emptyInterpretation, type Interpretation } from '../src/core/interpretation';
import type { TableValue } from '../src/core/module';
import type { Zone } from '../src/core/well';
import { registry } from '../src/modules';
import { SHARED_PARAMS } from '../src/modules/sharedParams';
import { netFlagsInto, netReservoirFlag, netReservoirFlagK, netSandFlag } from '../src/petro/cutoffs';
import { cutoffSweep } from '../src/petro/sensitivity';
import { summarizeRanges } from '../src/petro/summary';
import { CUTOFF_PASSES, cutoffActive, cutoffParamFor, guideStep, normalizeCutoff, paramStep, resolveCutoffLine } from '../src/plots/cutoffs';
import { syntheticWell } from '../src/app/demo/syntheticWell';
import { curve, well, zone } from './helpers';

const sameArray = (a: ArrayLike<number>, b: ArrayLike<number>) => {
  expect(a.length).toBe(b.length);
  for (let i = 0; i < a.length; i++) {
    if (Number.isNaN(b[i]!)) expect(a[i], `muestra ${i}`).toBeNaN();
    else expect(a[i], `muestra ${i}`).toBe(b[i]);
  }
};

// ===============================================================================================================
describe('petro/cutoffs: arena neta', () => {
  it('borde inclusivo, epsilon afuera, NaN', () => {
    expect(netSandFlag(0.3, 0.3)).toBe(1);
    expect(netSandFlag(0.3 + 1e-12, 0.3)).toBe(0);
    expect(netSandFlag(0, 0.3)).toBe(1);
    expect(netSandFlag(NaN, 0.3)).toBeNaN();
  });
});

describe('petro/cutoffs: reservorio con corte de k', () => {
  // Cortes de la planilla de la cátedra: Vsh 0,3; φ 0,08; Sw 0,5; k mínima 1 mD.
  const V = 0.3;
  const P = 0.08;
  const K = 1;

  it('k desactivado (NaN) = netReservoirFlag, con cualquier k', () => {
    for (const v of [0.1, 0.3, 0.5, NaN]) for (const p of [0.02, 0.08, 0.2, NaN]) for (const k of [0, 1, 50, NaN]) {
      const a = netReservoirFlagK(v, p, k, V, P, NaN);
      const b = netReservoirFlag(v, p, V, P);
      if (Number.isNaN(b)) expect(a).toBeNaN();
      else expect(a).toBe(b);
    }
  });

  it('borde inclusivo de k; un epsilon por debajo no pasa', () => {
    expect(netReservoirFlagK(0.1, 0.2, 1, V, P, K)).toBe(1);
    expect(netReservoirFlagK(0.1, 0.2, 1 - 1e-12, V, P, K)).toBe(0);
  });

  it('tabla de verdad a mano (Vsh, φ, k: pasa / falla / NaN)', () => {
    const cases = { v: { pasa: 0.1, falla: 0.9, NaN }, p: { pasa: 0.2, falla: 0.02, NaN }, k: { pasa: 10, falla: 0.1, NaN } };
    // 0 si alguna conocida falla; si ninguna falla: 1 si todas pasan, NaN si falta alguna.
    const expected = (kv: string, kp: string, kk: string) =>
      kv === 'falla' || kp === 'falla' || kk === 'falla' ? 0 : kv === 'NaN' || kp === 'NaN' || kk === 'NaN' ? NaN : 1;
    for (const [kv, v] of Object.entries(cases.v)) for (const [kp, p] of Object.entries(cases.p)) for (const [kk, k] of Object.entries(cases.k)) {
      const e = expected(kv, kp, kk);
      const got = netReservoirFlagK(v, p, k, V, P, K);
      if (Number.isNaN(e)) expect(got, `${kv}/${kp}/${kk}`).toBeNaN();
      else expect(got, `${kv}/${kp}/${kk}`).toBe(e);
    }
  });
});

describe('petro/cutoffs: netFlagsInto con arena y k', () => {
  // 0 pasa todo; 1 en los cuatro bordes; 2 k baja; 3 k NaN (sin dato); 4 Vsh alto con k NaN (descarte seguro);
  // 5 arena sin φ; 6 reservorio sin Sw; 7 Vsh NaN.
  const vsh = [0.1, 0.3, 0.1, 0.1, 0.9, 0.2, 0.2, NaN];
  const phi = [0.2, 0.08, 0.2, 0.2, 0.2, NaN, 0.15, 0.2];
  const sw = [0.3, 0.5, 0.3, 0.3, 0.3, 0.3, NaN, 0.3];
  const perm = [50, 1, 0.5, NaN, NaN, 20, 20, 20];
  const cut = { vshMax: 0.3, phiMin: 0.08, swMax: 0.5 };

  it('k desactivado: resultados idénticos a la firma anterior y a la de 3 curvas; la arena sale igual', () => {
    const r0 = new Float64Array(8);
    const p0 = new Float64Array(8);
    netFlagsInto(vsh, phi, sw, r0, p0, cut);
    const r1 = new Float64Array(8);
    const p1 = new Float64Array(8);
    const s1 = new Float64Array(8);
    netFlagsInto(vsh, phi, sw, r1, p1, cut, 0, 8, { perm, outSand: s1 });
    sameArray(r1, r0);
    sameArray(p1, p0);
    // permMin no finito también es «desactivado»
    const r2 = new Float64Array(8);
    const p2 = new Float64Array(8);
    netFlagsInto(vsh, phi, sw, r2, p2, { ...cut, permMin: NaN }, 0, 8, { perm });
    sameArray(r2, r0);
    sameArray(p2, p0);
    expect(Array.from(r0)).toEqual([1, 1, 1, 1, 0, NaN, 1, NaN]);
    expect(Array.from(s1)).toEqual([1, 1, 1, 1, 0, 1, 1, NaN]);
  });

  it('k activo (1 mD): descarta la k baja, deja sin dato la k faltante y respeta el descarte seguro', () => {
    const res = new Float64Array(8);
    const pay = new Float64Array(8);
    const sand = new Float64Array(8);
    netFlagsInto(vsh, phi, sw, res, pay, { ...cut, permMin: 1 }, 0, 8, { perm, outSand: sand });
    expect(Array.from(res)).toEqual([1, 1, 0, NaN, 0, NaN, 1, NaN]);
    expect(Array.from(pay)).toEqual([1, 1, 0, NaN, 0, NaN, NaN, NaN]);
    // La arena no depende de φ ni de k.
    expect(Array.from(sand)).toEqual([1, 1, 1, 1, 0, 1, 1, NaN]);
  });

  it('k activo sin curva de permeabilidad: todo lo que Vsh y φ no descartan queda sin dato (no se ignora el corte)', () => {
    const res = new Float64Array(8);
    const pay = new Float64Array(8);
    netFlagsInto(vsh, phi, sw, res, pay, { ...cut, permMin: 1 }, 0, 8);
    expect(Array.from(res)).toEqual([NaN, NaN, NaN, NaN, 0, NaN, NaN, NaN]);
    expect(Array.from(pay)).toEqual([NaN, NaN, NaN, NaN, 0, NaN, NaN, NaN]);
  });

  it('anidamiento pay ⊆ reservorio ⊆ arena (propiedad, 3000 muestras pseudoaleatorias con k log-uniforme)', () => {
    let s = 4242;
    const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
    const n = 3000;
    const v = Float64Array.from({ length: n }, () => (rnd() < 0.05 ? NaN : rnd()));
    const p = Float64Array.from({ length: n }, () => (rnd() < 0.05 ? NaN : rnd() * 0.35));
    const w = Float64Array.from({ length: n }, () => (rnd() < 0.05 ? NaN : rnd()));
    const k = Float64Array.from({ length: n }, () => (rnd() < 0.05 ? NaN : 10 ** (rnd() * 6 - 3)));
    const res = new Float64Array(n);
    const pay = new Float64Array(n);
    const sand = new Float64Array(n);
    netFlagsInto(v, p, w, res, pay, { ...cut, permMin: 1 }, 0, n, { perm: k, outSand: sand });
    let nPay = 0;
    let nResNotPay = 0;
    for (let i = 0; i < n; i++) {
      if (pay[i] === 1) {
        nPay++;
        expect(res[i]).toBe(1);
      }
      if (res[i] === 1) {
        expect(sand[i]).toBe(1);
        if (pay[i] !== 1) nResNotPay++;
      }
    }
    expect(nPay).toBeGreaterThan(0);
    expect(nResNotPay).toBeGreaterThan(0);
  });
});

// ===============================================================================================================
describe('petro/summary: arena neta', () => {
  it('suma la arena, su N/G y el sin dato de arena; sin bandera de arena da NaN y el resto no cambia', () => {
    const thickness = [1, 1, 1, 1, 2];
    const netSand = [1, 1, 0, NaN, 1];
    const netRes = [1, 0, 0, NaN, 1];
    const netPay = [1, 0, 0, NaN, 0];
    const phi = [0.2, 0.2, 0.1, 0.2, 0.1];
    const sw = [0.3, 0.3, 0.3, 0.3, 0.8];
    const all = [{ start: 0, end: 5 }];
    const s = summarizeRanges({ thickness, netSand, netRes, netPay, phi, sw }, all);
    expect(s.netSand).toBe(4); // 1 + 1 + 2
    expect(s.noDataSand).toBe(1);
    expect(s.ntgSand).toBeCloseTo(4 / 6, 12);
    expect(s.netRes).toBe(3);
    expect(s.netPay).toBe(1);
    const old = summarizeRanges({ thickness, netRes, netPay, phi, sw }, all);
    expect(old.netSand).toBeNaN();
    expect(old.ntgSand).toBeNaN();
    expect({ ...old, netSand: 0, noDataSand: 0, ntgSand: 0 }).toEqual({ ...s, netSand: 0, noDataSand: 0, ntgSand: 0 });
  });
});

// ===============================================================================================================
describe('petro/sensitivity: corte fijo de k', () => {
  const vsh = [0.1, 0.1, 0.2, 0.2, 0.3];
  const phi = [0.2, 0.15, 0.1, 0.2, 0.25];
  const sw = [0.3, 0.4, 0.5, 0.2, 0.6];
  const perm = [100, 0.5, 5, NaN, 20];
  const h = [1, 1, 1, 1, 1];
  const all = [{ start: 0, end: 5 }];
  const grid = { min: 0, max: 1, steps: 11 };
  const base = { vshMax: 0.4, phiMin: 0.08, swMax: 0.5 };

  it('sin permMin el barrido no cambia aunque se pase la permeabilidad', () => {
    for (const v of ['vsh', 'phi', 'sw'] as const) {
      const g = v === 'phi' ? { min: 0, max: 0.4, steps: 9 } : grid;
      const a = cutoffSweep(vsh, phi, sw, h, base, v, g, all);
      const b = cutoffSweep(vsh, phi, sw, h, base, v, g, all, perm);
      sameArray(b.netRes, a.netRes);
      sameArray(b.netPay, a.netPay);
    }
  });

  it('con permMin = 1 mD cada umbral coincide con las banderas de netFlagsInto', () => {
    const c = { ...base, permMin: 1 };
    for (const v of ['vsh', 'phi', 'sw'] as const) {
      const g = v === 'phi' ? { min: 0, max: 0.4, steps: 9 } : grid;
      const s = cutoffSweep(vsh, phi, sw, h, c, v, g, all, perm);
      for (let j = 0; j < s.thresholds.length; j++) {
        const t = s.thresholds[j]!;
        const cj = { ...c, ...(v === 'vsh' ? { vshMax: t } : v === 'phi' ? { phiMin: t } : { swMax: t }) };
        const res = new Float64Array(5);
        const pay = new Float64Array(5);
        netFlagsInto(vsh, phi, sw, res, pay, cj, 0, 5, { perm });
        expect(s.netRes[j], `${v} ${t}`).toBe(res.reduce((a, x) => a + (x === 1 ? 1 : 0), 0));
        expect(s.netPay[j], `${v} ${t}`).toBe(pay.reduce((a, x) => a + (x === 1 ? 1 : 0), 0));
      }
    }
    // A mano, en los cortes vigentes: solo las muestras 0, 2 y 4 tienen k ≥ 1; las tres son reservorio.
    const cur = cutoffSweep(vsh, phi, sw, h, c, 'sw', { min: 0.5, max: 1.5, steps: 2 }, all, perm);
    expect(cur.netRes[0]).toBe(3);
    expect(cur.netPay[0]).toBe(2); // Sw 0,3 y 0,5 (borde); la 4 tiene Sw 0,6
  });
});

// ===============================================================================================================
// Motor: pozo sintético de 20 muestras cada 0,5 m, dos zonas de 10 muestras (5 m cada una).
const N = 20;
const ZONES: Zone[] = [
  { ...zone('za', 1000, 1004.5), kind: 'reservoir' },
  { ...zone('zb', 1005, 1009.5), kind: 'reservoir' },
];
const VSH = Array.from({ length: N }, (_, i) => (i % 5 === 4 ? 0.6 : 0.1)); // 4 de cada zona son arcilla
const PHIE = Array.from({ length: N }, (_, i) => (i % 5 === 3 ? 0.04 : 0.2)); // 3, 8, 13, 18: φ baja
const SW = Array.from({ length: N }, (_, i) => (i % 2 === 0 ? 0.3 : 0.7));
const PERM = Array.from({ length: N }, (_, i) => [0.05, 0.5, 5, 50, 500][i % 5]!); // mD
const WELL = well([curve('VSH', 'VSH', VSH), curve('PHIE', 'PHIE', PHIE), curve('SW', 'SW', SW), curve('PERM', 'PERM', PERM)], N, 1000, 0.5);
const WELL_NO_K = well(WELL.curves.filter((c) => c.role !== 'PERM'), N, 1000, 0.5);

function run(partial: Partial<Interpretation> = {}, w = WELL): EngineRunResult {
  const engine = new Engine(registry, { checkInputs: true });
  engine.setWell(w);
  return engine.run({ ...emptyInterpretation(ZONES), ...partial });
}
const valueOf = (r: EngineRunResult, key: string) => {
  const o = r.outputs.find((x) => x.key === key);
  if (!o) throw new Error(`Falta la salida ${key}`);
  return o.value;
};
const curveOf = (r: EngineRunResult, key: string) => valueOf(r, key) as Float64Array;
const rowsOf = (r: EngineRunResult) => (valueOf(r, 'zone-summary:ZONE_SUMMARY') as TableValue).rows;
const warnings = (r: EngineRunResult) => r.diagnostics.filter((d) => d.code === 'module-warning' && d.moduleId === 'cutoffs').map((d) => d.message);
const SUMMARY = { compare: ['cutoffs', 'zone-summary'] };

describe('módulo cutoffs con arena neta y corte de k', () => {
  it('el parámetro está en el catálogo, desactivado por defecto, con slider log 0,001–1000 mD y por zona', () => {
    expect(SHARED_PARAMS.permCutoffOn).toMatchObject({ type: 'boolean', default: false, scope: 'zone', shared: true });
    expect(SHARED_PARAMS.permCutoff).toMatchObject({ type: 'number', min: 0.001, max: 1000, unit: 'mD', scale: 'log', scope: 'zone', shared: true });
    const m = registry.get('cutoffs')!;
    expect(m.params['permCutoff']).toBe(SHARED_PARAMS.permCutoff);
    expect(m.inputs['perm']).toMatchObject({ role: 'PERM', optional: true });
    expect(Object.values(m.outputs).map((o) => (o as { role: string }).role)).toEqual(['NET_SAND', 'NET_RES', 'NET_PAY']);
  });

  it('corte desactivado: NET_RES y NET_PAY idénticos con y sin curva de permeabilidad; sumario con arena neta', () => {
    const a = run(SUMMARY);
    const b = run(SUMMARY, WELL_NO_K);
    sameArray(curveOf(a, 'cutoffs:NET_RES'), curveOf(b, 'cutoffs:NET_RES'));
    sameArray(curveOf(a, 'cutoffs:NET_PAY'), curveOf(b, 'cutoffs:NET_PAY'));
    expect(warnings(a)).toEqual([]);
    // A mano por zona (10 muestras de 0,5 m): arena = 8 (sin las de Vsh 0,6) = 4 m; reservorio = 6 (además sin φ
    // baja) = 3 m; pay = las pares de esas 6 = 3 muestras (i = 0, 2, 6 en ZA) = 1,5 m.
    const za = rowsOf(a)[0]!;
    expect(za['netSand']).toBeCloseTo(4, 12);
    expect(za['netRes']).toBeCloseTo(3, 12);
    expect(za['netPay']).toBeCloseTo(1.5, 12);
    expect(za['ntgSand']).toBeCloseTo(0.8, 12);
    const total = rowsOf(a).at(-1)!;
    expect(total['netSand']).toBeCloseTo(8, 12);
  });

  it('corte activo (1 mD): descarta las muestras de k baja; la arena no cambia', () => {
    const off = run(SUMMARY);
    const on = run({ ...SUMMARY, params: { global: { permCutoffOn: true, permCutoff: 1 }, zones: {} } });
    const res = curveOf(on, 'cutoffs:NET_RES');
    for (let i = 0; i < N; i++) {
      const expected = VSH[i]! <= 0.4 && PHIE[i]! >= 0.08 && PERM[i]! >= 1 ? 1 : 0;
      expect(res[i], `muestra ${i}`).toBe(expected);
    }
    sameArray(curveOf(on, 'cutoffs:NET_SAND'), curveOf(off, 'cutoffs:NET_SAND'));
    // ZA: reservorio con k ≥ 1 → i = 2 (5 mD) y 7 (5 mD); i = 3 y 8 tienen φ baja → 2 muestras = 1 m; pay: i = 2 → 0,5 m.
    const za = rowsOf(on)[0]!;
    expect(za['netSand']).toBeCloseTo(4, 12);
    expect(za['netRes']).toBeCloseTo(1, 12);
    expect(za['netPay']).toBeCloseTo(0.5, 12);
  });

  it('cortes por zona: k solo en ZB, con 100 mD', () => {
    const r = run({ ...SUMMARY, params: { global: {}, zones: { zb: { permCutoffOn: true, permCutoff: 100 } } } });
    const off = run(SUMMARY);
    const res = curveOf(r, 'cutoffs:NET_RES');
    const resOff = curveOf(off, 'cutoffs:NET_RES');
    for (let i = 0; i < 10; i++) expect(res[i]).toBe(resOff[i]);
    // ZB: solo k = 500 mD (i % 5 = 4) pasa, pero esas tienen Vsh 0,6 → ningún reservorio.
    for (let i = 10; i < 20; i++) expect(res[i], `muestra ${i}`).toBe(0);
    expect(rowsOf(r)[1]!['netRes']).toBe(0);
    expect(rowsOf(r)[1]!['netSand']).toBeCloseTo(4, 12);
  });

  it('PERM ausente con el corte activo: sin dato (no se ignora) y aviso nombrando la zona', () => {
    // Sin curva medida y sin los módulos que la calculan (Timur la sacaría de φ y Sw).
    const r = run({ ...SUMMARY, disabled: ['perm-timur', 'perm-coates', 'perm-core'], params: { global: {}, zones: { za: { permCutoffOn: true } } } }, WELL_NO_K);
    expect(r.nodes.find((n) => n.moduleId === 'cutoffs')?.status).toBe('ok');
    const res = curveOf(r, 'cutoffs:NET_RES');
    for (let i = 0; i < 10; i++) {
      const known0 = VSH[i]! > 0.4 || PHIE[i]! < 0.08;
      if (known0) expect(res[i], `muestra ${i}`).toBe(0);
      else expect(res[i], `muestra ${i}`).toBeNaN();
    }
    expect(warnings(r).some((m) => m.includes('zona ZA') && m.includes('permeabilidad'))).toBe(true);
    const za = rowsOf(r)[0]!;
    expect(za['netRes']).toBe(0);
    expect(za['noData']).toBeCloseTo(3, 12); // las 6 muestras de reservorio quedan sin dato
  });

  it('el barrido de sensibilidad aplica el corte de k fijo: su fila vigente coincide con el sumario', () => {
    const p = { global: { permCutoffOn: true, permCutoff: 1 }, zones: {} };
    const r = run({ compare: ['cutoffs', 'zone-summary', 'cutoff-sensitivity'], params: p });
    const rows = (valueOf(r, 'cutoff-sensitivity:CUTOFF_SWEEP') as TableValue).rows;
    const cur = rows.find((x) => x['variable'] === 'sw' && x['zone'] === 'ZA' && x['current'] === 1)!;
    expect(cur['netRes']).toBeCloseTo(rowsOf(r)[0]!['netRes'] as number, 12);
    expect(cur['netPay']).toBeCloseTo(rowsOf(r)[0]!['netPay'] as number, 12);
  });
});

// ===============================================================================================================
describe('compatibilidad: el pozo de demostración da los mismos espesores que la regla de 3 curvas', () => {
  it('con los parámetros de fábrica NET_RES/NET_PAY coinciden con netReservoirFlag sobre VSH, PHIE y SW del motor', () => {
    const demo = syntheticWell();
    const engine = new Engine(registry);
    engine.setWell(toEngineWell(demo.well));
    const r = engine.run(emptyInterpretation(demo.zones));
    const pick = (port: string) => {
      const src = r.sources[port];
      const o = r.outputs.find((x) => x.port === port && (src?.kind !== 'module' || x.moduleId === src.moduleId) && x.active);
      return o?.value as Float64Array;
    };
    const vsh = pick('VSH');
    const phi = pick('PHIE');
    const sw = pick('SW');
    const res = curveOf(r, 'cutoffs:NET_RES');
    const pay = curveOf(r, 'cutoffs:NET_PAY');
    expect(vsh && phi && sw).toBeTruthy();
    let nRes = 0;
    for (let i = 0; i < res.length; i++) {
      const e = netReservoirFlag(vsh[i]!, phi[i]!, 0.4, 0.08);
      if (Number.isNaN(e)) expect(res[i]).toBeNaN();
      else expect(res[i]).toBe(e);
      if (e === 1) {
        nRes++;
        const w = sw[i]!;
        if (Number.isNaN(w)) expect(pay[i]).toBeNaN();
        else expect(pay[i]).toBe(w <= 0.6 ? 1 : 0);
      }
    }
    expect(nRes).toBeGreaterThan(0);
  });
});

// ===============================================================================================================
describe('plots/cutoffs: cutoff de k arrastrable', () => {
  const empty = { global: {}, zones: {} };
  const scope = { zoneId: null, label: 'Cutoff global' };

  it('PERM tiene parámetro real, pasa por arriba (k ≥ mínimo) y se redondea a 3 cifras (slider log sin paso)', () => {
    expect(cutoffParamFor('PERM')).toBe('permCutoff');
    expect(CUTOFF_PASSES.permCutoff).toBe('above');
    expect(normalizeCutoff('permCutoff', 12.3456)).toBe(12.3);
    expect(normalizeCutoff('permCutoff', 5000)).toBe(1000);
    expect(normalizeCutoff('permCutoff', 0)).toBe(0.001);
    expect(paramStep('permCutoff')).toBeUndefined();
    expect(guideStep('permCutoff')).toEqual({});
    expect(guideStep('phiCutoff')).toEqual({ step: 0.005 });
  });

  it('la línea se muestra inactiva mientras el corte esté apagado (global o en la zona)', () => {
    const c = { key: 'k', role: 'PERM' };
    const off = resolveCutoffLine('x', c, { k: true }, empty, scope)!;
    expect(off).toMatchObject({ param: 'permCutoff', value: 1, inactive: true, title: 'Cutoff global (inactivo)' });
    const on = resolveCutoffLine('x', c, { k: true }, { global: { permCutoffOn: true, permCutoff: 0.1 }, zones: {} }, scope)!;
    expect(on.inactive).toBeUndefined();
    expect(on.value).toBe(0.1);
    const zoned = { global: { permCutoffOn: true }, zones: { za: { permCutoffOn: false } } };
    expect(cutoffActive(zoned, 'permCutoff', 'za')).toBe(false);
    expect(cutoffActive(zoned, 'permCutoff', 'zb')).toBe(true);
    expect(cutoffActive(empty, 'phiCutoff', null)).toBe(true);
    // Las de Vsh, φ y Sw nunca son inactivas.
    expect(resolveCutoffLine('x', { key: 'v', role: 'VSH' }, { v: true }, empty, scope)!.inactive).toBeUndefined();
  });
});
