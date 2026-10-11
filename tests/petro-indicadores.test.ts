/**
 * Indicadores automáticos (fase 7c, docs/decisiones/0017): crossover de gas, arcilla, carbón y derrumbe.
 * Las reglas son criterios prácticos (no hay resultados de libro que reproducir): cada una se prueba con muestras
 * sintéticas cuyo resultado se razona a mano, con los bordes (inclusivos, salvo el derrumbe) y los sin dato.
 */
import { describe, expect, it } from 'vitest';
import { Engine, type EngineRunResult } from '../src/core/engine/engine';
import { emptyInterpretation, type Interpretation } from '../src/core/interpretation';
import { registry } from '../src/modules';
import {
  coalFlag,
  coalFlagInto,
  gasCrossoverFlag,
  gasCrossoverFlagInto,
  isWashout,
  shaleFlag,
  washoutFlag,
  washoutFlagInto,
} from '../src/petro/indicators';
import { runQc } from '../src/io/qc';
import { createWell } from '../src/core/well';
import { curve, well, zone } from './helpers';

describe('crossover de gas', () => {
  it('1 si φD − φN ≥ mínimo (borde inclusivo) y Vsh ≤ máximo (borde inclusivo)', () => {
    // 0,75 − 0,25 = 0,5 exacto en binario: el borde se prueba sin error de redondeo.
    expect(gasCrossoverFlag(0.75, 0.25, 0.4, 0.5, 0.4)).toBe(1);
    expect(gasCrossoverFlag(0.75, 0.25, 0.4, 0.5000001, 0.4)).toBe(0);
    expect(gasCrossoverFlag(0.75, 0.25, 0.4000001, 0.5, 0.4)).toBe(0); // Vsh apenas sobre el máximo: arcilla
  });

  it('el neutrón por encima de la densidad (arcilla/separación) no es gas', () => {
    expect(gasCrossoverFlag(0.15, 0.3, 0.1, 0.03, 0.4)).toBe(0);
  });

  it('sin dato: falta una porosidad o Vsh y no se puede decidir', () => {
    expect(gasCrossoverFlag(NaN, 0.2, 0.1, 0.03, 0.4)).toBeNaN();
    expect(gasCrossoverFlag(0.3, NaN, 0.1, 0.03, 0.4)).toBeNaN();
    expect(gasCrossoverFlag(0.3, 0.2, NaN, 0.03, 0.4)).toBeNaN(); // cruce sí, Vsh desconocida
  });

  it('descarte seguro: si una curva conocida ya descarta, 0 aunque falte otra', () => {
    expect(gasCrossoverFlag(NaN, 0.2, 0.9, 0.03, 0.4)).toBe(0); // arcilla segura
    expect(gasCrossoverFlag(0.2, 0.2, NaN, 0.03, 0.4)).toBe(0); // sin cruce, Vsh desconocida
  });

  it('sin curva de Vsh no se excluye arcilla', () => {
    const phid = [0.3, 0.3];
    const phin = [0.2, 0.29];
    const out = gasCrossoverFlagInto(phid, phin, undefined, new Float64Array(2), 0.03, 0.4);
    expect(Array.from(out)).toEqual([1, 0]);
  });

  it('respeta el tramo [start, end)', () => {
    const out = new Float64Array(4).fill(-1);
    gasCrossoverFlagInto([0.3, 0.3, 0.3, 0.3], [0.1, 0.1, 0.1, 0.1], [0, 0, 0, 0], out, 0.03, 0.4, 1, 3);
    expect(Array.from(out)).toEqual([-1, 1, 1, -1]);
  });
});

describe('arcilla', () => {
  it('1 si Vsh > máximo; Vsh = máximo NO es arcilla (complemento del corte de reservorio)', () => {
    expect(shaleFlag(0.4000001, 0.4)).toBe(1);
    expect(shaleFlag(0.4, 0.4)).toBe(0);
    expect(shaleFlag(0, 0.4)).toBe(0);
    expect(shaleFlag(1, 0.4)).toBe(1);
  });
  it('sin dato → NaN', () => {
    expect(shaleFlag(NaN, 0.4)).toBeNaN();
  });
});

describe('carbón', () => {
  const C = [2.0, 100, 0.4] as const; // ρ máx, Δt mín, φN mín
  it('densidad baja confirmada por Δt o por neutrón; bordes inclusivos', () => {
    expect(coalFlag(1.5, 120, 0.2, ...C)).toBe(1); // por Δt
    expect(coalFlag(1.5, 80, 0.55, ...C)).toBe(1); // por neutrón
    expect(coalFlag(2.0, 100, 0.1, ...C)).toBe(1); // bordes de ρ y Δt
    expect(coalFlag(2.0, 80, 0.4, ...C)).toBe(1); // bordes de ρ y φN
    expect(coalFlag(2.0001, 130, 0.5, ...C)).toBe(0); // apenas más densa que el máximo
    expect(coalFlag(1.5, 99.9, 0.39, ...C)).toBe(0); // densidad baja sin confirmación (ambas conocidas)
  });
  it('sin dato: densidad faltante, o confirmación imposible por una curva faltante', () => {
    expect(coalFlag(NaN, 120, 0.5, ...C)).toBeNaN();
    expect(coalFlag(1.5, NaN, 0.3, ...C)).toBeNaN(); // falta Δt y el neutrón no confirma
    expect(coalFlag(1.5, 90, NaN, ...C)).toBeNaN();
  });
  it('una confirmación alcanza aunque falte la otra curva; la densidad alta descarta aunque falten', () => {
    expect(coalFlag(1.5, NaN, 0.5, ...C)).toBe(1);
    expect(coalFlag(1.5, 110, NaN, ...C)).toBe(1);
    expect(coalFlag(2.4, NaN, NaN, ...C)).toBe(0);
  });
  it('curvas ausentes (undefined) equivalen a sin dato', () => {
    const out = coalFlagInto([1.5, 2.4], undefined, [0.5, 0.5], new Float64Array(2), ...C);
    expect(Array.from(out)).toEqual([1, 0]);
    const sinNada = coalFlagInto([1.5, 2.4], undefined, undefined, new Float64Array(2), ...C);
    expect(Array.from(sinNada).map((v) => (Number.isNaN(v) ? 'nan' : v))).toEqual(['nan', 0]);
  });
});

describe('derrumbe', () => {
  it('CALI − BS > tolerancia es ESTRICTO (criterio del control de calidad)', () => {
    expect(isWashout(9.5, 8.5, 1)).toBe(false); // 1,0 exacto: no es derrumbe
    expect(isWashout(9.5001, 8.5, 1)).toBe(true);
    expect(washoutFlag(9.5, 8.5, 8.5, 1, 5)).toBe(0);
    expect(washoutFlag(9.6, 8.5, 8.5, 1, 5)).toBe(1);
    expect(washoutFlag(8.0, 8.5, 8.5, 1, 5)).toBe(0); // caliper menor que el trépano (revoque)
  });
  it('caliper sin dato o inválido (< 5 in, borde inclusivo válido) → NaN', () => {
    expect(washoutFlag(NaN, 8.5, 8.5, 1, 5)).toBeNaN();
    expect(washoutFlag(1.098, 8.5, 8.5, 1, 5)).toBeNaN();
    expect(washoutFlag(4.99, 8.5, 8.5, 1, 5)).toBeNaN();
    expect(washoutFlag(5, 5, 8.5, 1, 5)).toBe(0); // 5 in es válido
  });
  it('sin BS (NaN o curva ausente) usa el trépano nominal', () => {
    expect(washoutFlag(9.6, NaN, 8.5, 1, 5)).toBe(1);
    expect(washoutFlag(9.6, NaN, 9, 1, 5)).toBe(0);
    const out = washoutFlagInto([9.6, 8.6], undefined, new Float64Array(2), 8.5, 1, 5);
    expect(Array.from(out)).toEqual([1, 0]);
  });
  it('coincide muestra a muestra con la bandera de derrumbe del control de calidad', () => {
    const n = 12;
    const cal = [8.6, 9.5, 9.6, 10, 12, 1.098, 8.5, 9.4999, 9.5001, 7, 20, 8.5];
    const w = createWell({
      id: 'w',
      name: 'w',
      depth: Float64Array.from({ length: n }, (_, i) => 1000 + i * 0.5),
      curves: [{ id: 'cal', mnemonic: 'CAL', unit: 'in', role: 'CALI', data: Float64Array.from(cal), origin: { kind: 'measured' } }],
    });
    const report = runQc(w, { bitSize: 8.5 });
    const flags = washoutFlagInto(cal, undefined, new Float64Array(n), 8.5, 1, 5);
    const mask = report.borehole!.mask;
    for (let i = 0; i < n; i++) {
      const qcWashout = cal[i]! >= 5 && cal[i]! - 8.5 > 1;
      expect(flags[i] === 1, `muestra ${i}`).toBe(qcWashout);
      expect(mask[i] === 1, `máscara ${i}`).toBe(qcWashout || cal[i]! < 5);
    }
  });
});

// ===============================================================================================================
// Los cuatro módulos sobre un pozo sintético (cuentas hechas a mano, independientes de src/petro).
// ===============================================================================================================
const N = 12;
const RHOB = [2.32, 2.15, 2.15, 2.15, 1.5, 1.8, 1.9, NaN, 2.0, 2.0001, 1.9, 1.9];
const NPHI = [0.2, 0.2, 0.2, 0.2, 0.55, 0.45, 0.3, 0.3, 0.1, 0.38, 0.3, 0.4];
const VSH = [0.1, 0.1, 0.6, NaN, 0.1, 0.4, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1];
const DT = [80, 80, 80, 80, 120, 90, 90, 90, 100, 130, 130, 130];
const DT_GAPS = DT.map((v, i) => (i === 10 || i === 11 ? NaN : v));
const CALI = [8.6, 9.6, 8.6, 8.6, 10, 9.5, 1.098, NaN, 8.6, 8.6, 8.6, 8.6];
const BS = Array.from({ length: N }, () => 8.5);

const ZONES = [zone('za', 1000, 1002.5), zone('zb', 1003, 1005.5)];

function makeWell(opts: { dt?: number[] | null; bs?: boolean; vsh?: boolean } = {}) {
  const curves = [curve('RHOB', 'RHOB', RHOB), curve('NPHI', 'NPHI', NPHI), curve('CALI', 'CALI', CALI)];
  if (opts.vsh !== false) curves.push(curve('VSH', 'VSH', VSH));
  if (opts.dt !== null) curves.push(curve('DT', 'DT', opts.dt ?? DT_GAPS));
  if (opts.bs !== false) curves.push(curve('BS', 'BS', BS));
  return well(curves, N, 1000, 0.5);
}

function run(w = makeWell(), partial: Partial<Interpretation> = {}): EngineRunResult {
  const engine = new Engine(registry, { checkInputs: true });
  engine.setWell(w);
  return engine.run({ ...emptyInterpretation(ZONES), ...partial });
}
const flag = (r: EngineRunResult, key: string) => Array.from(r.outputs.find((o) => o.key === key)!.value as Float64Array).map((v) => (Number.isNaN(v) ? 'nan' : v));
const warnings = (r: EngineRunResult) => r.diagnostics.filter((d) => d.code === 'module-warning').map((d) => d.message);

describe('módulos de indicadores', () => {
  it('están registrados con sus roles de bandera y la categoría «Indicadores»', () => {
    for (const id of ['ind-gas-crossover', 'ind-shale', 'ind-coal', 'ind-washout']) {
      const m = registry.get(id)!;
      expect(m.category).toBe('indicators');
      expect(m.docs.references.length).toBeGreaterThan(0);
      expect(m.docs.equations.length).toBeGreaterThan(0);
    }
    for (const role of ['IND_GAS', 'IND_SHALE', 'IND_COAL', 'IND_WASHOUT']) expect(registry.roles.get(role)?.family).toBe('flag');
    expect(registry.categories.find((c) => c.id === 'indicators')?.label).toBe('Indicadores');
  });

  it('crossover de gas (φD con ρma 2,65 / ρf 1,0 y φN = NPHI): cuentas a mano', () => {
    // i  φD (recortada a 0,5)   φN      Vsh    →  gas
    // 0  0,2000                 0,20    0,1       diferencia 0 → 0
    // 1  0,3030                 0,20    0,1       0,103 ≥ 0,03 → 1
    // 2  0,3030                 0,20    0,6       arcilla (Vsh > 0,4) → 0
    // 3  0,3030                 0,20    NaN       cruce pero Vsh desconocida → NaN
    // 4  0,5 (0,697 recortada)  0,5     0,1       ambas recortadas a 0,5: diferencia 0 → 0
    // 5  0,5 (0,515 recortada)  0,45    0,4       0,05 ≥ 0,03 y Vsh = máx (borde, no arcilla) → 1
    // 6  0,4545                 0,30     0,1       1
    // 7  NaN                    0,30     0,1       falta φD → NaN
    // 8  0,3939                 0,10     0,1       1
    // 9  0,3939                 0,38     0,1       0,0139 < 0,03 → 0
    // 10 0,4545                 0,30     0,1       1
    // 11 0,4545                 0,40     0,1       0,0545 → 1
    const r = run();
    expect(flag(r, 'ind-gas-crossover:IND_GAS')).toEqual([0, 1, 0, 'nan', 0, 1, 1, 'nan', 1, 0, 1, 1]);
  });

  it('el mínimo del cruce y la Vsh máxima compartida cambian el resultado (y por zona)', () => {
    const base = { ...emptyInterpretation(ZONES) };
    const hi = run(makeWell(), { params: { global: { 'ind-gas-crossover.crossoverMin': 0.1 }, zones: {} } });
    // con Δmín = 0,10: solo i1, i2(arcilla→0), i6 (0,1545), i8 (0,2939), i10 (0,1545) y i11 (0,0545→no)
    expect(flag(hi, 'ind-gas-crossover:IND_GAS')).toEqual([0, 1, 0, 'nan', 0, 0, 1, 'nan', 1, 0, 1, 0]);
    // Vsh máxima 0,7 en la zona A (muestras 0–5): i2 (Vsh 0,6) ya no es arcilla
    const zoneOverride = run(makeWell(), { ...base, params: { global: {}, zones: { za: { vshCutoff: 0.7 } } } });
    expect(flag(zoneOverride, 'ind-gas-crossover:IND_GAS')[2]).toBe(1);
    expect(flag(zoneOverride, 'ind-shale:IND_SHALE')[2]).toBe(0);
  });

  it('sin Vsh el gas no excluye arcilla y se avisa; el indicador de arcilla no puede correr', () => {
    const r = run(makeWell({ vsh: false }));
    // sin VSH tampoco hay otro módulo que lo calcule (no hay GR): i2 y i3 pasan a 1 si hay cruce
    const gas = flag(r, 'ind-gas-crossover:IND_GAS');
    expect(gas[2]).toBe(1);
    expect(gas[3]).toBe(1);
    expect(warnings(r).some((m) => m.includes('Sin curva de Vsh'))).toBe(true);
    expect(r.outputs.some((o) => o.key === 'ind-shale:IND_SHALE')).toBe(false);
  });

  it('arcilla: Vsh > 0,4 (borde fuera); NaN sin dato', () => {
    const r = run();
    expect(flag(r, 'ind-shale:IND_SHALE')).toEqual([0, 0, 1, 'nan', 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('carbón con Δt y neutrón (ρ ≤ 2,0; Δt ≥ 100; φN ≥ 0,40)', () => {
    // 0 ρ 2,32 → 0 | 1,2,3 ρ 2,15 → 0 | 4 ρ 1,5, Δt 120 → 1 | 5 ρ 1,8, φN 0,45 → 1 | 6 ρ 1,9, Δt 90 y φN 0,3 → 0
    // 7 ρ NaN → NaN | 8 ρ = 2,0 y Δt = 100 (bordes) → 1 | 9 ρ 2,0001 → 0
    // 10 ρ 1,9, Δt NaN y φN 0,3 → NaN (no se puede descartar) | 11 ρ 1,9, Δt NaN y φN = 0,40 (borde) → 1
    const r = run();
    expect(flag(r, 'ind-coal:IND_COAL')).toEqual([0, 0, 0, 0, 1, 1, 0, 'nan', 1, 0, 'nan', 1]);
  });

  it('carbón sin sónico: confirma solo el neutrón; sin sónico ni neutrón avisa', () => {
    const sinDt = run(makeWell({ dt: null }));
    // i4: ρ 1,5, φN 0,55 → 1 | i6: ρ 1,9, φN 0,3 → NaN (falta Δt) | i8: ρ 2,0, φN 0,1 → NaN
    expect(flag(sinDt, 'ind-coal:IND_COAL')).toEqual([0, 0, 0, 0, 1, 1, 'nan', 'nan', 'nan', 0, 'nan', 1]);
    const sinNada = run(well([curve('RHOB', 'RHOB', RHOB), curve('CALI', 'CALI', CALI)], N, 1000, 0.5));
    expect(warnings(sinNada).some((m) => m.includes('Sin sónico ni neutrón'))).toBe(true);
    expect(flag(sinNada, 'ind-coal:IND_COAL')).toEqual([0, 0, 0, 0, 'nan', 'nan', 'nan', 'nan', 'nan', 0, 'nan', 'nan']);
  });

  it('derrumbe: CALI − BS > 1 estricto; caliper inválido o ausente → NaN', () => {
    // 0: 0,1 → 0 | 1: 1,1 → 1 | 2: 0,1 → 0 | 3: 0,1 → 0 | 4: 1,5 → 1 | 5: 1,0 exacto → 0 | 6: 1,098 in inválido → NaN
    // 7: NaN | 8–11: 0,1 → 0
    const r = run();
    expect(flag(r, 'ind-washout:IND_WASHOUT')).toEqual([0, 1, 0, 0, 1, 0, 'nan', 'nan', 0, 0, 0, 0]);
  });

  it('derrumbe sin curva de trépano usa el nominal; la tolerancia se puede cambiar', () => {
    const sinBs = run(makeWell({ bs: false }), { params: { global: { 'ind-washout.bitSize': 9.5 }, zones: {} } });
    // trépano nominal 9,5: solo i4 (10,0 → 0,5 < 1) ya no es derrumbe; i1 (9,6 → 0,1) tampoco
    expect(flag(sinBs, 'ind-washout:IND_WASHOUT').slice(0, 6)).toEqual([0, 0, 0, 0, 0, 0]);
    const estricto = run(makeWell(), { params: { global: { 'ind-washout.tolerance': 0.4 }, zones: {} } });
    expect(flag(estricto, 'ind-washout:IND_WASHOUT').slice(0, 6)).toEqual([0, 1, 0, 0, 1, 1]);
  });
});
