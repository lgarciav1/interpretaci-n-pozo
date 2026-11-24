/**
 * Distribuciones por zona, V2 (src/plots/distribution/interact.ts, docs/decisiones/0066, D10–D14): fracción que pasa
 * un cutoff con cada ponderación y NaN, filtro base del %, rango → máscara con filtro y zonas ocultas, fracción y caja
 * de una selección de otra fuente, cutoff vigente por zona con vista previa, pasos de teclado, mapeo px ↔ valor (lineal
 * y log), eje que incluye los cutoffs, configuración saneada y título de la selección. Cuentas a mano.
 */
import { describe, expect, it } from 'vitest';
import type { ParamState } from '../../src/core/params';
import { defaultDistribution, sanitizeDistribution } from '../../src/core/plots';
import { intervalDistribution, type DistributionInput } from '../../src/petro/distribution';
import { distributionAxis, type DistributionCell } from '../../src/plots/distribution/distribution';
import { laneValue, laneX } from '../../src/plots/distribution/draw';
import {
  cutoffDragValue,
  cutoffPassFraction,
  forEachUsed,
  maskedRanges,
  maskFraction,
  nudgeCutoff,
  passBaseFilter,
  passesCutoff,
  rangeFraction,
  rangeMask,
  summaryPay,
  zoneCutoff,
} from '../../src/plots/distribution/interact';
import { makeSelection, selectionTitle } from '../../src/plots/link';
import type { XYAxis } from '../../src/plots/xy/axes';

// 10 muestras: valores 0,00…0,09 (la 3 sin dato), espesores 1 salvo la 9 (2 m).
const values = Float64Array.from([0, 0.01, 0.02, NaN, 0.04, 0.05, 0.06, 0.07, 0.08, 0.09]);
const thickness = Float64Array.from([1, 1, 1, 1, 1, 1, 1, 1, 1, 2]);
const netRes = Float64Array.from([0, 0, 1, 1, 1, 1, 1, 1, NaN, 1]);
const netPay = Float64Array.from([0, 0, 0, 1, 1, 0, 1, 1, 1, 1]);
const washout = Float64Array.from([0, 0, 0, 0, 1, 0, 0, 0, 0, 0]);
const phi = Float64Array.from([0.1, 0.1, 0.2, 0.2, 0.2, 0.3, 0.3, 0, 0.1, NaN]);
const input: DistributionInput = { values, thickness, netRes, netPay, washout, phi };
const ALL = [{ start: 0, end: 10 }];
const emptyParams = (): ParamState => ({ global: {}, zones: {} });
const opts = (over: Partial<{ filter: 'all' | 'netRes' | 'netPay'; excludeWashout: boolean; mean: 'thickness' | 'poreVolume' | 'geometric' }> = {}) => ({ filter: 'all' as const, excludeWashout: false, mean: 'thickness' as const, ...over });

describe('muestras usadas (mismas reglas que la caja)', () => {
  it('filtro, derrumbe y sin dato; el peso total coincide con el espesor usado del motor', () => {
    const seen: number[] = [];
    forEachUsed(input, opts({ filter: 'netRes', excludeWashout: true }), ALL, (i) => seen.push(i));
    // netRes = 1: 2,3,4,5,6,7,9; la 3 sin dato, la 4 en derrumbe.
    expect(seen).toEqual([2, 5, 6, 7, 9]);
    let total = 0;
    forEachUsed(input, opts({ filter: 'netRes', excludeWashout: true }), ALL, (_, __, w) => (total += w));
    expect(total).toBeCloseTo(intervalDistribution(input, opts({ filter: 'netRes', excludeWashout: true }), ALL).thickness, 12);
  });
  it('pay neto exige también reservorio (como el sumario); sin la bandera pedida no visita nada', () => {
    const seen: number[] = [];
    forEachUsed(input, opts({ filter: 'netPay' }), ALL, (i) => seen.push(i));
    expect(seen).toEqual([4, 6, 7, 9]); // 8: netRes NaN
    const none: number[] = [];
    forEachUsed({ values, thickness }, opts({ filter: 'netRes' }), ALL, (i) => none.push(i));
    expect(none).toEqual([]);
  });
});

describe('muestras usadas con máscara de filtros (mask)', () => {
  it('la máscara se suma al filtro y al derrumbe, y el peso coincide con el motor', () => {
    const mask = Uint8Array.from([1, 1, 1, 1, 1, 0, 1, 1, 1, 0]);
    const masked: DistributionInput = { ...input, mask };
    const o = opts({ filter: 'netRes', excludeWashout: true });
    const seen: number[] = [];
    let total = 0;
    forEachUsed(masked, o, ALL, (i, _, w) => {
      seen.push(i);
      total += w;
    });
    // Sin máscara serían 2,5,6,7,9; la máscara saca la 5 y la 9.
    expect(seen).toEqual([2, 6, 7]);
    expect(total).toBeCloseTo(intervalDistribution(masked, o, ALL).thickness, 12);
  });
});

describe('fracción que pasa el cutoff', () => {
  it('por espesor, inclusiva en el corte (φ ≥ mínimo; Vsh/Sw ≤ máximo)', () => {
    // Usadas (toda la zona): 0,1,2,4,5,6,7,8 (h 1) y 9 (h 2) → total 10 m.
    const above = cutoffPassFraction(input, opts(), ALL, 0.05, 'above');
    expect(above.total).toBe(10);
    expect(above.part).toBe(1 + 1 + 1 + 1 + 2); // 0,05 0,06 0,07 0,08 0,09
    expect(above.fraction).toBeCloseTo(0.6, 12);
    const below = cutoffPassFraction(input, opts(), ALL, 0.05, 'below');
    expect(below.part).toBe(5); // 0 0,01 0,02 0,04 0,05
    expect(passesCutoff(0.05, 0.05, 'above') && passesCutoff(0.05, 0.05, 'below')).toBe(true);
  });
  it('Sw por volumen poral: pesos h·φ; φ NaN fuera; φ = 0 no pesa', () => {
    const r = cutoffPassFraction(input, opts({ mean: 'poreVolume' }), ALL, 0.05, 'below');
    // Pesos: 0,1 0,1 0,2 (3: sin dato) 0,2 0,3 0,3 0 (7) 0,1 (9: φ NaN) → total 1,3; ≤ 0,05: 0,1+0,1+0,2+0,2+0,3 = 0,9.
    expect(r.total).toBeCloseTo(1.3, 12);
    expect(r.part).toBeCloseTo(0.9, 12);
    expect(r.fraction).toBeCloseTo(0.9 / 1.3, 12);
  });
  it('derrumbe excluido y sin muestras → NaN (nunca 0)', () => {
    const w = cutoffPassFraction(input, opts({ excludeWashout: true }), ALL, 0.05, 'above');
    expect(w.total).toBe(9);
    expect(cutoffPassFraction(input, opts(), [{ start: 3, end: 4 }], 0.05, 'above').fraction).toBeNaN();
    expect(cutoffPassFraction(input, opts(), ALL, NaN, 'above').fraction).toBeNaN();
  });
  it('filtro base: si el filtro ya aplica el cutoff, el % se mide un nivel más arriba', () => {
    expect(passBaseFilter('all', 'phiCutoff')).toBe('all');
    expect(passBaseFilter('netRes', 'phiCutoff')).toBe('all');
    expect(passBaseFilter('netRes', 'vshCutoff')).toBe('all');
    expect(passBaseFilter('netRes', 'permCutoff')).toBe('all');
    expect(passBaseFilter('netRes', 'swCutoff')).toBe('netRes');
    expect(passBaseFilter('netPay', 'swCutoff')).toBe('netRes');
    expect(passBaseFilter('netPay', 'phiCutoff')).toBe('all');
    expect(passBaseFilter('netPay', null)).toBe('netPay');
  });
});

describe('selección por rango', () => {
  it('rango → máscara: solo zonas visibles, filtro activo, sin dato fuera; el orden del rango no importa', () => {
    // Zonas visibles: [0, 5) y [7, 10) (la del medio, oculta).
    const ranges = [{ start: 0, end: 5 }, { start: 7, end: 10 }];
    const m = rangeMask(10, input, opts({ filter: 'netRes' }), ranges, 0.08, 0.02);
    // netRes = 1 en esos tramos: 2, 3 (NaN), 4, 7, 9; en [0,02; 0,08]: 2, 4, 7.
    expect(Array.from(m)).toEqual([0, 0, 1, 0, 1, 0, 0, 1, 0, 0]);
    const f = rangeFraction(input, opts({ filter: 'netRes' }), ranges, 0.02, 0.08);
    expect(f.total).toBe(1 + 1 + 1 + 2);
    expect(f.fraction).toBeCloseTo(3 / 5, 12);
  });
  it('máscara de otra fuente: fracción y caja con las mismas muestras', () => {
    const mask = Uint8Array.from([1, 1, 0, 1, 1, 0, 0, 1, 1, 1]);
    expect(maskedRanges(ALL, mask)).toEqual([{ start: 0, end: 2 }, { start: 3, end: 5 }, { start: 7, end: 10 }]);
    expect(maskedRanges([{ start: 2, end: 6 }], mask)).toEqual([{ start: 3, end: 5 }]);
    const f = maskFraction(input, opts(), ALL, mask);
    // Usadas en la máscara: 0,1,4,7,8 (h 1) y 9 (h 2) = 7 m de 10.
    expect(f.fraction).toBeCloseTo(0.7, 12);
    const sub = intervalDistribution(input, opts(), maskedRanges(ALL, mask));
    expect(sub.thickness).toBe(7);
  });
  it('la selección lleva la fuente nueva y su título', () => {
    const depth = Float64Array.from({ length: 10 }, (_, i) => 1000 + i);
    const sel = makeSelection('distribution', depth, Uint8Array.from([0, 0, 1, 1, 0, 0, 0, 0, 0, 0]), { kind: 'range', curve: 'r:PHIE', curveLabel: 'PHIE', min: 0.1, max: 0.185 })!;
    expect(sel.source).toBe('distribution');
    expect(sel.runs).toHaveLength(1);
    expect(selectionTitle(sel)).toBe('PHIE 0,1–0,185 en las distribuciones');
  });
});

describe('cutoff por zona', () => {
  const params = { ...emptyParams(), global: { phiCutoff: 0.1 }, zones: { zb: { phiCutoff: 0.12 } } };
  it('valor propio de la zona o el global; la vista previa del global no mueve a las zonas con valor propio', () => {
    expect(zoneCutoff(params, 'phiCutoff', null)).toMatchObject({ value: 0.1, own: false, side: 'above', inactive: false });
    expect(zoneCutoff(params, 'phiCutoff', 'za')).toMatchObject({ value: 0.1, own: false });
    expect(zoneCutoff(params, 'phiCutoff', 'zb')).toMatchObject({ value: 0.12, own: true });
    const g = { zoneId: null, value: 0.14 };
    expect(zoneCutoff(params, 'phiCutoff', null, g).value).toBe(0.14);
    expect(zoneCutoff(params, 'phiCutoff', 'za', g).value).toBe(0.14);
    expect(zoneCutoff(params, 'phiCutoff', 'zb', g).value).toBe(0.12);
    const z = { zoneId: 'za', value: 0.05 };
    expect(zoneCutoff(params, 'phiCutoff', 'za', z).value).toBe(0.05);
    expect(zoneCutoff(params, 'phiCutoff', null, z).value).toBe(0.1);
    // Sin nada guardado, el de fábrica (Sw máxima 0,6: pasa lo de abajo).
    expect(zoneCutoff(emptyParams(), 'swCutoff', 'za')).toMatchObject({ value: 0.6, side: 'below' });
  });
  it('corte de k: inactivo hasta que se activa (zona o global)', () => {
    expect(zoneCutoff(emptyParams(), 'permCutoff', null).inactive).toBe(true);
    const on = { ...emptyParams(), zones: { za: { permCutoffOn: true } } };
    expect(zoneCutoff(on, 'permCutoff', 'za').inactive).toBe(false);
    expect(zoneCutoff(on, 'permCutoff', 'zb').inactive).toBe(true);
  });
  it('teclado: el paso del slider (φ 0,005; Vsh 0,01), k un 1 % del eje log; libre, 1 % del eje', () => {
    const lin: XYAxis = { kind: 'linear', min: 0, max: 0.4, label: 'PHIE' };
    expect(nudgeCutoff(lin, 'phiCutoff', 0.08, 1)).toBe(0.085);
    expect(nudgeCutoff(lin, 'phiCutoff', 0.08, -10)).toBe(0.03);
    expect(nudgeCutoff(lin, 'vshCutoff', 0.4, 1)).toBe(0.41);
    expect(nudgeCutoff(lin, 'phiCutoff', 0.4, 5)).toBe(0.4); // acotado al rango del parámetro
    const log: XYAxis = { kind: 'log', min: 0.01, max: 1000, label: 'PERM' };
    // 5 décadas: 1 % = 0,05 décadas → ×1,122 (3 cifras).
    expect(nudgeCutoff(log, 'permCutoff', 1, 1)).toBe(1.12);
    expect(nudgeCutoff(log, 'permCutoff', 1, -1)).toBe(0.891);
    // Libre: 1 % de 150 = 1,5, a la grilla «linda» de las guías del x–y (paso 2).
    expect(nudgeCutoff({ kind: 'linear', min: 0, max: 150, label: 'GR' }, null, 60, 1)).toBe(62);
  });
  it('arrastre: el valor real se redondea como el slider; la línea libre, a un paso «lindo»', () => {
    const lin: XYAxis = { kind: 'linear', min: 0, max: 0.4, label: 'PHIE' };
    expect(cutoffDragValue(lin, 'phiCutoff', 0.0874)).toBe(0.085);
    expect(cutoffDragValue(lin, 'phiCutoff', 0.9)).toBe(0.4);
    // Libre: paso 1-2-5 de 1/400 del eje (150/400 → 0,5), como las guías del gráfico x–y.
    expect(cutoffDragValue({ kind: 'linear', min: 0, max: 150, label: 'GR' }, null, 61.234)).toBe(61);
  });
  it('pay neto del sumario del motor, por nombre de zona (sin dato → NaN)', () => {
    const rows = [{ zone: 'A', netPay: 8.7 }, { zone: 'B', netPay: null }, { zone: 'Total', netPay: 20 }];
    expect(summaryPay(rows, 'A')).toBe(8.7);
    expect(summaryPay(rows, 'B')).toBeNaN();
    expect(summaryPay(rows, 'Z')).toBeNaN();
    expect(summaryPay(null, 'A')).toBeNaN();
  });
});

describe('px ↔ valor', () => {
  it('lineal: ida y vuelta, y acotado a los extremos', () => {
    const a: XYAxis = { kind: 'linear', min: 0, max: 0.3, label: 'PHIE' };
    const x = laneX(a, 328, 1);
    expect(x(0)).toBe(14);
    expect(x(0.3)).toBe(314);
    expect(laneValue(a, 328, 164, 1)).toBeCloseTo(0.15, 12);
    expect(laneValue(a, 328, x(0.123), 1)).toBeCloseTo(0.123, 12);
    expect(laneValue(a, 328, -50, 1)).toBe(0);
    expect(laneValue(a, 328, 999, 1)).toBeCloseTo(0.3, 12);
  });
  it('log: interpola en décadas; con tamaño de interfaz el margen escala', () => {
    const a: XYAxis = { kind: 'log', min: 0.1, max: 1000, label: 'PERM' };
    expect(laneValue(a, 428, 14 + 100, 1)).toBeCloseTo(1, 10); // 1 década de 4 en 400 px
    expect(laneValue(a, 428, laneX(a, 428, 1)(37), 1)).toBeCloseTo(37, 8);
    expect(laneValue(a, 856, laneX(a, 856, 2)(5), 2)).toBeCloseTo(5, 8);
  });
});

describe('eje con los cutoffs', () => {
  const cell = (p10: number, p90: number): DistributionCell => ({ stats: { n: 5, thickness: 5, excludedWashout: 0, washoutThickness: 0, noData: 0, min: p10, max: p90, p10, p25: p10, p50: (p10 + p90) / 2, p75: p90, p90, mean: (p10 + p90) / 2, geoMean: NaN }, filtered: 5 });
  it('incluye el cutoff aunque quede fuera de las cajas; sin cajas no hay eje', () => {
    const plain = distributionAxis([[cell(0.12, 0.2)]], 'linear', 'PHIE')!;
    expect(plain.min).toBeGreaterThan(0.08);
    const withCut = distributionAxis([[cell(0.12, 0.2)]], 'linear', 'PHIE', 'v/v', [0.08])!;
    expect(withCut.min).toBeLessThanOrEqual(0.08);
    expect(distributionAxis([[{ stats: null, filtered: 0 }]], 'linear', 'PHIE', undefined, [0.08])).toBeNull();
    // En log, un cutoff ≤ 0 se ignora.
    const log = distributionAxis([[cell(1, 100)]], 'log', 'PERM', 'mD', [0, 0.1])!;
    expect(log.min).toBeLessThanOrEqual(0.1);
  });
});

describe('configuración', () => {
  it('líneas libres: solo números con clave de curva válida', () => {
    expect(defaultDistribution().cutoffs).toEqual({});
    const d = sanitizeDistribution({ cutoffs: { 'm:GR': 60, 'r:VSH': true, x: 3, 'm:RT': 'a', 'm:DT': Infinity } });
    expect(d.cutoffs).toEqual({ 'm:GR': 60 });
    expect(sanitizeDistribution({ cutoffs: [1, 2] }).cutoffs).toEqual({});
    expect(sanitizeDistribution({}).cutoffs).toEqual({});
  });
});
