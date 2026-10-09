/**
 * Módulos de la fase 6a de cálculo (C4, C11, C12, C19, C21, C22) sobre un pozo sintético de 3 zonas (una `seal`):
 * valores por muestra contra cuentas independientes (fórmulas escritas en el test, no las funciones de petro),
 * cutoffs inclusivos, sumario y volumétrico contra cuentas a mano, overrides por zona de parámetros compartidos
 * y avisos. Ver docs/decisiones/0007-modulos-fase-6a.md.
 */
import { describe, expect, it } from 'vitest';
import { Engine, toEngineWell, type EngineRunResult } from '../src/core/engine/engine';
import { emptyInterpretation, type Interpretation } from '../src/core/interpretation';
import type { TableValue, ZoneScalarValue } from '../src/core/module';
import type { Zone } from '../src/core/well';
import { registry } from '../src/modules';
import csvText from '../datos/pozo_tp_perfiles.csv?raw';
import { readWellFile } from '../src/io';
import { curve, well, zone } from './helpers';

// --- pozo sintético: 30 muestras cada 0,5 m (1000–1014,5 m), tres zonas de 10 muestras -----------------------------
// ZA (reservorio) 0–9, ZB (sello) 10–19, ZC (formación) 20–29. Cada muestra representa 0,5 m.
const N = 30;
const DEPTH0 = 1000;
const STEP = 0.5;
const ZONES: Zone[] = [
  { ...zone('za', 1000, 1004.5), kind: 'reservoir' },
  { ...zone('zb', 1005, 1009.5), kind: 'seal' },
  { ...zone('zc', 1010, 1014.5), kind: 'formation' },
];
const [ZA, ZB, ZC] = ZONES.map((z) => z.id) as [string, string, string];
const zoneOf = (i: number) => (i < 10 ? 0 : i < 20 ? 1 : 2);

/** Rellena una serie de 30 muestras: `base` por zona y excepciones por índice. */
function series(perZone: [number, number, number], exceptions: Record<number, number> = {}): number[] {
  return Array.from({ length: N }, (_, i) => (i in exceptions ? exceptions[i]! : perZone[zoneOf(i)]!));
}

// Petrofísicas «de entrada» para los cutoffs (ningún módulo las produce acá: son curvas medidas con ese rol).
//  ZA: i=5 Vsh = 0,40 (borde, pasa); i=6 Vsh = 0,41 (no); i=7 φ = 0,08 (borde, pasa); i=8 φ = 0,05 (no);
//      i=2 Sw = 0,60 (borde del pay, pasa); i=3 Sw = 0,61 (no); i=9 Sw = 0,9 (reservorio sin pay).
//  ZB (sello): todo pasa con φ 0,15 y Sw 0,2.
//  ZC: i=24 Vsh NaN y i=25 φ NaN (sin dato); i=26 Sw NaN (reservorio sin dato de pay); i=27–29 Vsh 0,8 (arcilla);
//      i=27 φ 0,2/Sw 0,3; i=28 φ 0,2/Sw 0,9; i=29 φ 0,02/Sw 0,3 (solo se vuelven reservorio si se sube el corte de Vsh).
const VSH = series([0.1, 0.1, 0.2], { 5: 0.4, 6: 0.41, 24: NaN, 27: 0.8, 28: 0.8, 29: 0.8 });
const PHIE = series([0.2, 0.15, 0.25], { 7: 0.08, 8: 0.05, 25: NaN, 26: 0.1, 27: 0.2, 28: 0.2, 29: 0.02 });
const SW = series([0.3, 0.2, 0.4], { 2: 0.6, 3: 0.61, 9: 0.9, 26: NaN, 27: 0.3, 28: 0.9, 29: 0.3 });
const PERM = Array.from({ length: N }, (_, i) => i + 1); // mD

// Para sónico, SP, Rt y temperatura.
const DT = Array.from({ length: N }, (_, i) => 70 + 2 * (i % 10)); // µs/ft
const TEMP = Array.from({ length: N }, (_, i) => 50 + 0.03 * (i * STEP)); // °C, aprox. un gradiente de 3 °C/100 m
const RT = Array.from({ length: N }, (_, i) => 5 + (i % 7) * 3);
const SP = Array.from({ length: N }, (_, i) => -20 - (i % 5) * 10);

const WELL = well(
  [
    curve('DT', 'DT', DT),
    curve('SP', 'SP', SP),
    curve('RT', 'RT', RT),
    curve('TEMP', 'TEMP', TEMP),
    curve('VSH', 'VSH', VSH),
    curve('PHIE', 'PHIE', PHIE),
    curve('SW', 'SW', SW),
    curve('PERM', 'PERM', PERM),
  ],
  N,
  DEPTH0,
  STEP,
);

const params = (global: Record<string, number | string | boolean>, zones: Record<string, Record<string, number | string | boolean>> = {}) => ({
  global,
  zones,
});

function run(partial: Partial<Interpretation> = {}, w = WELL): EngineRunResult {
  const engine = new Engine(registry, { checkInputs: true });
  engine.setWell(w);
  return engine.run({ ...emptyInterpretation(ZONES), ...partial });
}

function out(r: EngineRunResult, key: string) {
  const o = r.outputs.find((x) => x.key === key);
  if (!o) throw new Error(`Falta la salida ${key}`);
  return o.value;
}
const curveOf = (r: EngineRunResult, key: string) => out(r, key) as Float64Array;
const tableOf = (r: EngineRunResult, key: string) => (out(r, key) as TableValue).rows;
const zoneScalarOf = (r: EngineRunResult, key: string) => out(r, key) as ZoneScalarValue;
const scalarOf = (r: EngineRunResult, key: string) => out(r, key) as number;
const warnings = (r: EngineRunResult) => r.diagnostics.filter((d) => d.code === 'module-warning').map((d) => d.message);
/** Errores de los módulos de este archivo (el pozo sintético no trae GR, RHOB ni NPHI: otros módulos informan su falta). */
const MINE = ['phi-sonic-wyllie', 'rw-sp', 'rw-rwa', 'cutoffs', 'zone-summary', 'volumetrics'];
const errors = (r: EngineRunResult) => r.diagnostics.filter((d) => d.level === 'error' && MINE.includes(d.moduleId ?? ''));

function expectSamples(actual: Float64Array, expected: (i: number) => number, digits = 12) {
  expect(actual.length).toBe(N);
  for (let i = 0; i < N; i++) {
    const e = expected(i);
    if (Number.isNaN(e)) expect(actual[i], `muestra ${i}`).toBeNaN();
    else expect(actual[i], `muestra ${i}`).toBeCloseTo(e, digits);
  }
}

// Fórmulas independientes (no las de src/petro): Arps en °C = R1·(1,8·T1 + 32 + 6,77)/(1,8·T2 + 32 + 6,77).
const arps = (r1: number, t1C: number, t2C: number) => (r1 * (1.8 * t1C + 38.77)) / (1.8 * t2C + 38.77);
/** Percentil tipo 7 escrito de otra manera (ordenar y entrelazar). */
function pct7(xs: number[], p: number): number {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (s.length === 0) return NaN;
  const pos = p * (s.length - 1);
  const k = Math.floor(pos);
  return k + 1 < s.length ? s[k]! + (pos - k) * (s[k + 1]! - s[k]!) : s[k]!;
}

// ===============================================================================================================
describe('C4 phi-sonic-wyllie', () => {
  const wyllie = (dt: number, ma: number, fl: number, cp: number) => Math.min(0.5, Math.max(0, (dt - ma) / (fl - ma) / cp));

  it('valores por muestra con los defaults (Δtma 55,5; Δtf 189; Cp 1)', () => {
    const r = run({ compare: ['phi-sonic-wyllie'] });
    expect(errors(r)).toEqual([]);
    expectSamples(curveOf(r, 'phi-sonic-wyllie:PHIS'), (i) => wyllie(DT[i]!, 55.5, 189, 1));
  });

  it('Cp y Δtf propios por zona y Δtma compartido por zona (override por zona de un parámetro compartido)', () => {
    const r = run({
      compare: ['phi-sonic-wyllie'],
      params: params({}, { [ZB]: { 'phi-sonic-wyllie.cp': 1.2 }, [ZC]: { dtMa: 47.5, 'phi-sonic-wyllie.dtFl': 180 } }),
    });
    expectSamples(curveOf(r, 'phi-sonic-wyllie:PHIS'), (i) => {
      const z = zoneOf(i);
      return z === 0 ? wyllie(DT[i]!, 55.5, 189, 1) : z === 1 ? wyllie(DT[i]!, 55.5, 189, 1.2) : wyllie(DT[i]!, 47.5, 180, 1);
    });
    // hand: ZB muestra 10, Δt = 70 → (70 − 55,5)/133,5/1,2 = 0,090511
    expect(curveOf(r, 'phi-sonic-wyllie:PHIS')[10]).toBeCloseTo(14.5 / 133.5 / 1.2, 12);
  });

  it('avisa, nombrando la zona, si Δtf no supera a Δtma', () => {
    const r = run({ compare: ['phi-sonic-wyllie'], params: params({}, { [ZB]: { 'phi-sonic-wyllie.dtFl': 55 } }) });
    expect(warnings(r).some((m) => m.includes('zona ZB') && m.includes('Δt del fluido'))).toBe(true);
    expect(curveOf(r, 'phi-sonic-wyllie:PHIS')[12]).toBeNaN();
    expect(curveOf(r, 'phi-sonic-wyllie:PHIS')[2]).toBeGreaterThan(0);
  });
});

// ===============================================================================================================
describe('C19 cutoffs', () => {
  const r = run({ compare: ['cutoffs'] });
  const res = curveOf(r, 'cutoffs:NET_RES');
  const pay = curveOf(r, 'cutoffs:NET_PAY');

  it('corre en ok y las banderas respetan los bordes inclusivos (vsh = 0,4; φ = 0,08; Sw = 0,6)', () => {
    expect(r.nodes.find((n) => n.moduleId === 'cutoffs')?.status).toBe('ok');
    expect(errors(r)).toEqual([]);
    // ZA: reservorio en 0–5 (i=5 Vsh 0,4 pasa), 7 (φ 0,08 pasa) y 9; no en 6 (Vsh 0,41) ni 8 (φ 0,05)
    expect(Array.from(res.subarray(0, 10))).toEqual([1, 1, 1, 1, 1, 1, 0, 1, 0, 1]);
    // pay: Sw ≤ 0,6 → i=2 (0,6) sí; i=3 (0,61) no; i=9 (0,9) no
    expect(Array.from(pay.subarray(0, 10))).toEqual([1, 1, 1, 0, 1, 1, 0, 1, 0, 0]);
  });

  it('ZB (sello) también se clasifica; ZC: NaN donde falta Vsh o φ y pay NaN donde falta Sw', () => {
    expect(Array.from(res.subarray(10, 20))).toEqual(Array(10).fill(1));
    expect(Array.from(pay.subarray(10, 20))).toEqual(Array(10).fill(1));
    // i=20–23 pasan; 24 Vsh NaN; 25 φ NaN; 26 reservorio sin Sw; 27–29 Vsh 0,8 > 0,4
    expect(Array.from(res.subarray(20, 30))).toEqual([1, 1, 1, 1, NaN, NaN, 1, 0, 0, 0]);
    expect(Array.from(pay.subarray(20, 30))).toEqual([1, 1, 1, 1, NaN, NaN, NaN, 0, 0, 0]);
  });

  it('pay ⊆ reservorio en todo el pozo', () => {
    for (let i = 0; i < N; i++) if (pay[i] === 1) expect(res[i]).toBe(1);
  });

  it('override por zona de un parámetro compartido: Vsh máxima 0,8 en ZC sube solo ZC (borde inclusivo)', () => {
    const r2 = run({ compare: ['cutoffs'], params: params({}, { [ZC]: { vshCutoff: 0.8 } }) });
    const res2 = curveOf(r2, 'cutoffs:NET_RES');
    const pay2 = curveOf(r2, 'cutoffs:NET_PAY');
    expect(Array.from(res2.subarray(0, 20))).toEqual(Array.from(res.subarray(0, 20)));
    expect(Array.from(res2.subarray(26, 30))).toEqual([1, 1, 1, 0]); // 27, 28 (Vsh 0,8 pasa); 29 φ 0,02 < 0,08
    expect(Array.from(pay2.subarray(26, 30))).toEqual([NaN, 1, 0, 0]); // 27 Sw 0,3 sí; 28 Sw 0,9 no
  });

  it('cambiar un cutoff recalcula las banderas y lo que depende de ellas, no los módulos aguas arriba', () => {
    const e = new Engine(registry, { checkInputs: true });
    e.setWell(WELL);
    const base = { ...emptyInterpretation(ZONES), compare: ['cutoffs', 'zone-summary', 'volumetrics'] };
    e.run(base);
    const r2 = e.run({ ...base, params: params({ swCutoff: 0.5 }) });
    expect(r2.stats.recomputed).toEqual(expect.arrayContaining(['cutoffs', 'zone-summary', 'volumetrics']));
    expect(r2.stats.recomputed).not.toContain('phi-sonic-wyllie');
  });
});

// ===============================================================================================================
describe('C21 zone-summary (cuentas a mano; cutoffs por defecto 0,4 / 0,08 / 0,6)', () => {
  const r = run({ compare: ['zone-summary'] });
  const rows = tableOf(r, 'zone-summary:ZONE_SUMMARY');

  it('una fila por zona más «Total», con el tipo en español', () => {
    expect(errors(r)).toEqual([]);
    expect(rows.map((x) => x['zone'])).toEqual(['ZA', 'ZB', 'ZC', 'Total']);
    expect(rows.map((x) => x['kind'])).toEqual(['Reservorio', 'Sello', 'Formación', null]);
    expect(rows[0]!['top']).toBe(1000);
    expect(rows[0]!['base']).toBe(1004.5);
    expect(rows[3]!['top']).toBe(1000);
    expect(rows[3]!['base']).toBe(1014.5);
  });

  it('ZA: bruto 5; neto reservorio 4 (8 muestras); neto pay 3 (6 muestras)', () => {
    const a = rows[0]!;
    expect(a['gross']).toBeCloseTo(5, 12);
    expect(a['netRes']).toBeCloseTo(4, 12);
    expect(a['netPay']).toBeCloseTo(3, 12);
    expect(a['ntgRes']).toBeCloseTo(0.8, 12);
    expect(a['ntgPay']).toBeCloseTo(0.6, 12);
    expect(a['noData']).toBeCloseTo(0, 12);
  });

  it('ZA, promedios del pay: φ = 0,54/3 = 0,18; Sw = 0,192/0,54; Vsh = 0,45/3; k = 12,5/3; kh = 12,5', () => {
    // pay = i 0,1,2,4,5,7. Σhφ = 0,5·(5·0,2 + 0,08) = 0,54; Σhφ·Sw = 0,5·(0,2·(0,3+0,3+0,6+0,3+0,3) + 0,08·0,3) = 0,192
    const a = rows[0]!;
    expect(a['phiPay']).toBeCloseTo(0.18, 12);
    expect(a['swPay']).toBeCloseTo(0.192 / 0.54, 12);
    expect(a['vshPay']).toBeCloseTo(0.15, 12); // 0,5·(0,1·5 + 0,4) = 0,45
    expect(a['kPay']).toBeCloseTo(12.5 / 3, 12); // perm = i + 1 → 1+2+3+5+6+8 = 25 → kh = 12,5
    expect(a['khPay']).toBeCloseTo(12.5, 12);
    expect(a['hphiPay']).toBeCloseTo(0.54, 12);
    expect(a['hphiShPay']).toBeCloseTo(0.348, 12); // 0,54 − 0,192
    // identidad h·φ̄·(1 − S̄w) = h·φ·Sh
    expect((a['netPay'] as number) * (a['phiPay'] as number) * (1 - (a['swPay'] as number))).toBeCloseTo(0.348, 12);
  });

  it('ZA, reservorio (8 muestras): φ = 0,74/4 = 0,185; Sw ponderada por volumen poral', () => {
    // reservorio = i 0–5, 7, 9; Σhφ = 0,5·(0,2·7 + 0,08) = 0,74 → /4 = 0,185
    const a = rows[0]!;
    expect(a['phiRes']).toBeCloseTo(0.185, 12);
    // Sw por muestra: i0 .3, i1 .3, i2 .6, i3 .61, i4 .3, i5 .3 (φ .2); i7 .3 (φ .08); i9 .9 (φ .2); la 3 y la 9 son
    // reservorio aunque no sean pay. Σhφ·Sw / Σhφ (el espesor 0,5 se simplifica):
    const num = 0.2 * (0.3 + 0.3 + 0.6 + 0.61 + 0.3 + 0.3 + 0.9) + 0.08 * 0.3;
    const den = 0.2 * 7 + 0.08;
    expect(a['swRes']).toBeCloseTo(num / den, 12);
  });

  it('ZB (sello) aparece en el sumario: bruto 5, todo pay, φ 0,15, Sw 0,2, h·φ·Sh = 0,6', () => {
    const b = rows[1]!;
    expect(b['gross']).toBeCloseTo(5, 12);
    expect(b['netRes']).toBeCloseTo(5, 12);
    expect(b['netPay']).toBeCloseTo(5, 12);
    expect(b['phiPay']).toBeCloseTo(0.15, 12);
    expect(b['swPay']).toBeCloseTo(0.2, 12);
    expect(b['hphiShPay']).toBeCloseTo(0.6, 12); // 5·0,15·0,8
    expect(b['kPay']).toBeCloseTo(15.5, 12); // perm 11…20 → media 15,5
    expect(b['khPay']).toBeCloseTo(77.5, 12);
  });

  it('ZC: sin dato 1 m (i=24 y 25), neto reservorio 2,5 (i=20–23 y 26), pay 2 (i=20–23), h·φ·Sh = 0,3', () => {
    const c = rows[2]!;
    expect(c['gross']).toBeCloseTo(5, 12);
    expect(c['noData']).toBeCloseTo(1, 12);
    expect(c['noDataPay']).toBeCloseTo(0.5, 12); // i=26: reservorio sin Sw
    expect(rows[0]!['noDataPay']).toBe(0);
    expect(rows[1]!['noDataPay']).toBe(0);
    expect(rows[3]!['noDataPay']).toBeCloseTo(0.5, 12);
    expect(c['netRes']).toBeCloseTo(2.5, 12);
    expect(c['netPay']).toBeCloseTo(2, 12);
    expect(c['ntgRes']).toBeCloseTo(0.5, 12);
    expect(c['ntgPay']).toBeCloseTo(0.4, 12);
    expect(c['phiPay']).toBeCloseTo(0.25, 12);
    expect(c['swPay']).toBeCloseTo(0.4, 12);
    expect(c['hphiShPay']).toBeCloseTo(0.3, 12); // 2·0,25·0,6
    // la muestra 26 (φ 0,1) entra en φ̄ de reservorio: 0,5·(4·0,25 + 0,1)/2,5 = 0,22
    expect(c['phiRes']).toBeCloseTo(0.22, 12);
    expect(c['kPay']).toBeCloseTo(22.5, 12); // perm 21–24
    expect(c['khPay']).toBeCloseTo(45, 12);
  });

  it('Total: sumas de las zonas; promedios desde las sumas, no promedios de promedios', () => {
    const t = rows[3]!;
    expect(t['gross']).toBeCloseTo(15, 12);
    expect(t['netRes']).toBeCloseTo(11.5, 12); // 4 + 5 + 2,5
    expect(t['netPay']).toBeCloseTo(10, 12); // 3 + 5 + 2
    expect(t['noData']).toBeCloseTo(1, 12);
    expect(t['hphiPay']).toBeCloseTo(0.54 + 0.75 + 0.5, 12);
    expect(t['hphiShPay']).toBeCloseTo(0.348 + 0.6 + 0.3, 12);
    expect(t['phiPay']).toBeCloseTo(1.79 / 10, 12); // media de promedios sería (0,18+0,15+0,25)/3 = 0,1933
    expect(t['khPay']).toBeCloseTo(12.5 + 77.5 + 45, 12);
    expect(t['kPay']).toBeCloseTo(13.5, 12);
  });

  it('puertos por zona y escalares totales', () => {
    const h = zoneScalarOf(r, 'zone-summary:NET_PAY_H');
    expect(Object.keys(h).sort()).toEqual([ZA, ZB, ZC]);
    expect(h[ZA]).toBeCloseTo(3, 12);
    expect(h[ZB]).toBeCloseTo(5, 12);
    expect(h[ZC]).toBeCloseTo(2, 12);
    const hp = zoneScalarOf(r, 'zone-summary:HPHISH_PAY');
    expect(hp[ZA]).toBeCloseTo(0.348, 12);
    expect(hp[ZB]).toBeCloseTo(0.6, 12);
    expect(hp[ZC]).toBeCloseTo(0.3, 12);
    expect(scalarOf(r, 'zone-summary:NET_PAY_TOTAL')).toBeCloseTo(10, 12);
    expect(scalarOf(r, 'zone-summary:HPHISH_TOTAL')).toBeCloseTo(1.248, 12);
  });

  it('el override por zona del cutoff compartido llega al sumario (Vsh máxima 0,8 en ZC: pay 2,5 m)', () => {
    const r2 = run({ compare: ['zone-summary'], params: params({}, { [ZC]: { vshCutoff: 0.8 } }) });
    const c = tableOf(r2, 'zone-summary:ZONE_SUMMARY')[2]!;
    expect(c['netRes']).toBeCloseTo(3.5, 12); // + i=27, 28
    expect(c['netPay']).toBeCloseTo(2.5, 12); // + i=27 (Sw 0,3)
    expect(c['hphiShPay']).toBeCloseTo(0.3 + 0.5 * 0.2 * 0.7, 12);
    expect(zoneScalarOf(r2, 'zone-summary:NET_PAY_H')[ZC]).toBeCloseTo(2.5, 12);
  });

  it('sin zonas: una fila «Pozo completo» y el Total; los valores por zona quedan vacíos', () => {
    const r0 = run({ zones: [], compare: ['zone-summary'] });
    const t = tableOf(r0, 'zone-summary:ZONE_SUMMARY');
    expect(t.map((x) => x['zone'])).toEqual(['Pozo completo', 'Total']);
    expect(t[0]!['gross']).toBeCloseTo(15, 12);
    expect(t[0]!['netPay']).toBeCloseTo(10, 12); // cutoffs globales (los mismos valores por defecto)
    expect(zoneScalarOf(r0, 'zone-summary:NET_PAY_H')).toEqual({});
    expect(scalarOf(r0, 'zone-summary:NET_PAY_TOTAL')).toBeCloseTo(10, 12);
  });

  it('zona sin muestras: la fila existe y los valores por zona son NaN (sin dato), no 0', () => {
    const far = [...ZONES, { ...zone('zd', 5000, 5100), kind: 'formation' as const }];
    const r2 = run({ zones: far, compare: ['zone-summary'] });
    const rowsD = tableOf(r2, 'zone-summary:ZONE_SUMMARY');
    expect(rowsD.map((x) => x['zone'])).toEqual(['ZA', 'ZB', 'ZC', 'ZD', 'Total']);
    expect(rowsD[3]!['gross']).toBe(0);
    expect(zoneScalarOf(r2, 'zone-summary:NET_PAY_H')['zd']).toBeNaN();
    expect(zoneScalarOf(r2, 'zone-summary:HPHISH_PAY')['zd']).toBeNaN();
    expect(scalarOf(r2, 'zone-summary:NET_PAY_TOTAL')).toBeCloseTo(10, 12);
  });
});

// ===============================================================================================================
describe('C22 volumetrics (cuentas a mano)', () => {
  // ZA: oil, 2 km², Bo 1,25 → OOIP = 2e6·0,348/1,25 = 556 800 m³; ZB (sello, 1 km² oil) → 0;
  // ZC: gas, 3 km², Bg 0,004 → OGIP = 3e6·0,3/0,004 = 2,25e8 m³.
  const over = params(
    {},
    {
      [ZA]: { area: 2, bo: 1.25 },
      [ZC]: { fluid: 'gas', area: 3, bg: 0.004 },
    },
  );
  const r = run({ compare: ['volumetrics'], params: over });

  it('OOIP/OGIP por zona en m³ estándar: el sello da 0', () => {
    expect(errors(r)).toEqual([]);
    const ooip = zoneScalarOf(r, 'volumetrics:OOIP');
    const ogip = zoneScalarOf(r, 'volumetrics:OGIP');
    expect(Object.keys(ooip).sort()).toEqual([ZA, ZB, ZC]);
    expect(ooip[ZA]).toBeCloseTo(556800, 6);
    expect(ooip[ZB]).toBe(0);
    expect(ooip[ZC]).toBe(0);
    expect(ogip[ZA]).toBe(0);
    expect(ogip[ZB]).toBe(0);
    expect(ogip[ZC]).toBeCloseTo(2.25e8, 3);
  });

  it('totales por suma de zonas', () => {
    expect(scalarOf(r, 'volumetrics:OOIP_TOTAL')).toBeCloseTo(556800, 6);
    expect(scalarOf(r, 'volumetrics:OGIP_TOTAL')).toBeCloseTo(2.25e8, 3);
  });

  it('tabla: unidades de campo (MMbbl, Bcf) y SI (Mm³, MMm³); filas por tipo de fluido', () => {
    const rows = tableOf(r, 'volumetrics:VOLUMETRICS');
    expect(rows.map((x) => x['zone'])).toEqual(['ZA', 'ZB', 'ZC', 'Total']);
    expect(rows.map((x) => x['fluid'])).toEqual(['Petróleo', 'Sello', 'Gas', null]);
    const a = rows[0]!;
    expect(a['area']).toBe(2);
    expect(a['hphiSh']).toBeCloseTo(0.348, 12);
    expect(a['b']).toBe(1.25);
    expect(a['ooipSi']).toBeCloseTo(556.8, 9); // Mm³
    expect(a['ooipField']).toBeCloseTo(556800 / 158987.294928, 9); // 3,50217 MMbbl (1 bbl = 0,158987294928 m³)
    expect(a['ogipSi']).toBeNull();
    const c = rows[2]!;
    expect(c['b']).toBe(0.004);
    expect(c['ogipSi']).toBeCloseTo(225, 6); // MMm³
    expect(c['ogipField']).toBeCloseTo(2.25e8 / 28316846.592, 9); // 7,9458 Bcf (1 ft³ = 0,028316846592 m³)
    const t = rows[3]!;
    expect(t['ooipField']).toBeCloseTo(556800 / 158987.294928, 9);
    expect(t['ogipField']).toBeCloseTo(7.9458, 3);
    expect(t['hphiSh']).toBeCloseTo(0.348 + 0.3, 12); // sin el sello
  });

  it('defaults (1 km², petróleo, Bo 1,2): ZA 290 000 m³; el sello sigue en 0; ZC también petróleo', () => {
    const r2 = run({ compare: ['volumetrics'] });
    const ooip = zoneScalarOf(r2, 'volumetrics:OOIP');
    expect(ooip[ZA]).toBeCloseTo((1e6 * 0.348) / 1.2, 6);
    expect(ooip[ZB]).toBe(0);
    expect(ooip[ZC]).toBeCloseTo((1e6 * 0.3) / 1.2, 6);
    expect(scalarOf(r2, 'volumetrics:OOIP_TOTAL')).toBeCloseTo((1e6 * 0.648) / 1.2, 6);
    expect(scalarOf(r2, 'volumetrics:OGIP_TOTAL')).toBe(0);
  });

  it("fluido 'none' en una zona da 0 y se informa «Sin hidrocarburo»", () => {
    const r2 = run({ compare: ['volumetrics'], params: params({}, { [ZA]: { fluid: 'none' } }) });
    expect(zoneScalarOf(r2, 'volumetrics:OOIP')[ZA]).toBe(0);
    expect(tableOf(r2, 'volumetrics:VOLUMETRICS')[0]!['fluid']).toBe('Sin hidrocarburo');
  });

  it('una zona sin muestras (hφSh NaN) da volumen NaN y no entra en el total', () => {
    const far = [...ZONES, { ...zone('zd', 5000, 5100), kind: 'formation' as const }];
    const r2 = run({ zones: far, compare: ['volumetrics'], params: over });
    expect(zoneScalarOf(r2, 'volumetrics:OOIP')['zd']).toBeNaN();
    expect(scalarOf(r2, 'volumetrics:OOIP_TOTAL')).toBeCloseTo(556800, 6);
  });

  it('sin zonas avisa y no entrega volumen', () => {
    const r0 = run({ zones: [], compare: ['volumetrics', 'zone-summary'] });
    expect(warnings(r0).some((m) => m.includes('Definí zonas'))).toBe(true);
    expect(zoneScalarOf(r0, 'volumetrics:OOIP')).toEqual({});
    expect(scalarOf(r0, 'volumetrics:OOIP_TOTAL')).toBeNaN();
  });

  it('el volumen sigue al cutoff: Sw máxima 0,5 en ZA deja fuera i=2 (Sw 0,6) y baja el OOIP', () => {
    // pay ZA sin i=2: h·φ·Sh = 0,348 − 0,5·0,2·0,4 = 0,308
    const r2 = run({ compare: ['volumetrics'], params: params({}, { [ZA]: { area: 2, bo: 1.25, swCutoff: 0.5 } }) });
    expect(zoneScalarOf(r2, 'volumetrics:OOIP')[ZA]).toBeCloseTo((2e6 * 0.308) / 1.25, 6);
  });
});

// ===============================================================================================================
describe('C11 rw-sp', () => {
  // Defaults: Rmf 0,5 Ω·m a 24 °C; SP de arena limpia −60 mV, línea base 0 mV.
  const rwSpFor = (tZone: number, ssp: number, rmf = 0.5, tRmf = 24) => {
    const tF = 1.8 * tZone + 32;
    const rmfT = arps(rmf, tRmf, tZone);
    const rmf75F = arps(rmf, tRmf, (75 - 32) / 1.8);
    const rmfe = rmf75F > 0.1 ? 0.85 * rmfT : rmfT;
    const k = 60 + 0.133 * tF;
    return { rmfT, rmfe, k, rw: rmfe * Math.pow(10, ssp / k) };
  };
  const zoneMeanTemp = (z: number) => TEMP.slice(z * 10, z * 10 + 10).reduce((a, b) => a + b, 0) / 10;
  const r = run({ compare: ['rw-sp'] });

  it('tabla por zona: T media, Rmf a T, Rmfe = 0,85·Rmf, K, SSP y Rw (cuentas independientes)', () => {
    expect(errors(r)).toEqual([]);
    const rows = tableOf(r, 'rw-sp:RW_SP_BY_ZONE');
    expect(rows.map((x) => x['zone'])).toEqual(['ZA', 'ZB', 'ZC']);
    for (let z = 0; z < 3; z++) {
      const T = zoneMeanTemp(z);
      const e = rwSpFor(T, -60);
      expect(rows[z]!['temp'] as number).toBeCloseTo(T, 10);
      expect(rows[z]!['rmfT'] as number).toBeCloseTo(e.rmfT, 10);
      expect(rows[z]!['rmfe'] as number).toBeCloseTo(e.rmfe, 10);
      expect(rows[z]!['ssp']).toBe(-60);
      expect(rows[z]!['k'] as number).toBeCloseTo(e.k, 10);
      expect(rows[z]!['rw'] as number).toBeCloseTo(e.rw, 10);
    }
    // el filtrado a 75 °F no pasa del umbral → rama 0,85
    expect(rows[0]!['rmfe'] as number).toBeCloseTo(0.85 * (rows[0]!['rmfT'] as number), 12);
  });

  it('curva RW: Rw de la zona llevada con Arps a la temperatura de cada muestra', () => {
    const rw = curveOf(r, 'rw-sp:RW');
    for (let i = 0; i < N; i++) {
      const z = zoneOf(i);
      const T = zoneMeanTemp(z);
      expect(rw[i], `muestra ${i}`).toBeCloseTo(arps(rwSpFor(T, -60).rw, T, TEMP[i]!), 10);
    }
  });

  it('spClean propio por zona (−80 mV en ZC) cambia solo ZC', () => {
    const r2 = run({ compare: ['rw-sp'], params: params({}, { [ZC]: { 'rw-sp.spClean': -80 } }) });
    const rows = tableOf(r2, 'rw-sp:RW_SP_BY_ZONE');
    expect(rows[2]!['ssp']).toBe(-80);
    expect(rows[2]!['rw'] as number).toBeCloseTo(rwSpFor(zoneMeanTemp(2), -80).rw, 10);
    expect(rows[0]!['rw'] as number).toBeCloseTo(rwSpFor(zoneMeanTemp(0), -60).rw, 10);
    expect(rows[2]!['rw'] as number).toBeLessThan(rows[2]!['rmfe'] as number); // SSP negativo → Rwe < Rmfe
  });

  it('SSP ≥ 0 avisa con la zona; Rmf a 75 °F ≤ 0,1 avisa que Rmfe se tomó igual a Rmf', () => {
    const r2 = run({ compare: ['rw-sp'], params: params({}, { [ZB]: { 'rw-sp.spClean': 10 } }) });
    expect(warnings(r2).some((m) => m.includes('zona ZB') && m.includes('deflexión'))).toBe(true);
    const r3 = run({ compare: ['rw-sp'], params: params({ rmf: 0.05 }) });
    expect(warnings(r3).some((m) => m.includes('Rmf a 75 °F ≤ 0,1'))).toBe(true);
    const rows = tableOf(r3, 'rw-sp:RW_SP_BY_ZONE');
    expect(rows[0]!['rmfe'] as number).toBeCloseTo(rows[0]!['rmfT'] as number, 12); // aproximación Rmfe ≈ Rmf(Tf)
  });

  it('SP sin datos en la zona: aviso', () => {
    const sp = SP.map((v, i) => (zoneOf(i) === 2 ? NaN : v));
    const w2 = well(WELL.curves.map((c) => (c.role === 'SP' ? curve('SP', 'SP', sp) : c)), N, DEPTH0, STEP);
    const r2 = run({ compare: ['rw-sp'] }, w2);
    expect(warnings(r2).some((m) => m.includes('zona ZC') && m.includes('SP no tiene datos'))).toBe(true);
  });
});

// ===============================================================================================================
describe('C12 rw-rwa', () => {
  // RWA = Rt·φ^m/a (a = 1, m = 2 por defecto). Se necesita VSH, PHIE, RT y TEMP (medidas en el pozo sintético).
  const vsh = VSH.map((v) => (Number.isNaN(v) ? 0.9 : v)); // sin NaN para este test
  const phi = PHIE.map((v) => (Number.isNaN(v) ? 0.2 : v));
  const w2 = well(
    WELL.curves.map((c) => (c.role === 'VSH' ? curve('VSH', 'VSH', vsh) : c.role === 'PHIE' ? curve('PHIE', 'PHIE', phi) : c)),
    N,
    DEPTH0,
    STEP,
  );
  const rwa = (i: number, a = 1, m = 2) => (RT[i]! * Math.pow(phi[i]!, m)) / a;

  it('RWA por muestra y Rw de todo el pozo = percentil 10 de Rwa a 24 °C (Vsh ≤ 0,2), llevado a la T de cada muestra', () => {
    const r = run({ compare: ['rw-rwa'] }, w2);
    expect(errors(r)).toEqual([]);
    expectSamples(curveOf(r, 'rw-rwa:RWA'), (i) => rwa(i), 12);
    const ref = pct7(
      Array.from({ length: N }, (_, i) => (vsh[i]! <= 0.2 ? arps(rwa(i), TEMP[i]!, 24) : NaN)),
      0.1,
    );
    expect(Number.isFinite(ref)).toBe(true);
    const rw = curveOf(r, 'rw-rwa:RW');
    for (let i = 0; i < N; i++) expect(rw[i], `muestra ${i}`).toBeCloseTo(arps(ref, 24, TEMP[i]!), 12);
    // el mismo valor en toda la columna «Rw a T» a igual T: la tabla informa Rw a la T media de cada zona
    const rows = tableOf(r, 'rw-rwa:RW_RWA_BY_ZONE');
    expect(rows.map((x) => x['zone'])).toEqual(['ZA', 'ZB', 'ZC']);
    const used = Array.from({ length: N }, (_, i) => vsh[i]! <= 0.2).filter(Boolean).length;
    expect(rows[0]!['count']).toBe(used); // modo pozo: cantidad de muestras usadas en el pozo
    expect(rows[1]!['rw'] as number).toBeCloseTo(arps(ref, 24, TEMP.slice(10, 20).reduce((a, b) => a + b, 0) / 10), 10);
  });

  it("modo 'zone': un Rw por zona con el percentil de sus muestras; la zona sin muestras limpias queda NaN y avisa", () => {
    const r = run({ compare: ['rw-rwa'], params: params({ 'rw-rwa.mode': 'zone', 'rw-rwa.percentile': 0.25, 'rw-rwa.vshMax': 0.15 }) }, w2);
    const rw = curveOf(r, 'rw-rwa:RW');
    for (let z = 0; z < 3; z++) {
      const idx = Array.from({ length: 10 }, (_, k) => z * 10 + k);
      const ref = pct7(idx.map((i) => (vsh[i]! <= 0.15 ? arps(rwa(i), TEMP[i]!, 24) : NaN)), 0.25);
      for (const i of idx) {
        if (Number.isNaN(ref)) expect(rw[i]).toBeNaN();
        else expect(rw[i], `muestra ${i}`).toBeCloseTo(arps(ref, 24, TEMP[i]!), 12);
      }
    }
    // ZC tiene Vsh = 0,2 / 0,8 / 0,9: con vshMax 0,15 no queda ninguna muestra
    expect(rw[25]).toBeNaN();
    expect(warnings(r).some((m) => m.includes('zona ZC') && m.includes('ninguna muestra'))).toBe(true);
  });

  it("'a' y 'm' compartidos por zona: m = 2,3 en ZB solo cambia RWA en ZB", () => {
    const r = run({ compare: ['rw-rwa'], params: params({}, { [ZB]: { m: 2.3 } }) }, w2);
    expectSamples(curveOf(r, 'rw-rwa:RWA'), (i) => rwa(i, 1, zoneOf(i) === 1 ? 2.3 : 2), 12);
  });

  it('sin la curva VSH usa todas las muestras (la entrada es opcional)', () => {
    const w3 = well(w2.curves.filter((c) => c.role !== 'VSH'), N, DEPTH0, STEP);
    const r = run({ compare: ['rw-rwa'], disabled: ['vsh'] }, w3);
    const ref = pct7(Array.from({ length: N }, (_, i) => arps(rwa(i), TEMP[i]!, 24)), 0.1);
    expect(curveOf(r, 'rw-rwa:RW')[0]).toBeCloseTo(arps(ref, 24, TEMP[0]!), 12);
  });
});

// ===============================================================================================================
describe('cadena completa con los módulos de este agente', () => {
  it('GR → … → DT (Wyllie) → PHIE → Rw (SP) → Sw → cutoffs → sumario → volumétrico, todo en ok', () => {
    // Sólo medidas GR, DT y RT: el resto lo produce la cadena (TEMP por gradiente, Rw del SP, Wyllie para PHIS).
    const n = 60;
    const dt = Array.from({ length: n }, (_, i) => 80 + 15 * Math.sin(i / 4));
    const gr = Array.from({ length: n }, (_, i) => 70 + 40 * Math.sin(i / 5 + 1));
    const sp = Array.from({ length: n }, () => -40);
    const rt = Array.from({ length: n }, (_, i) => 8 + 6 * Math.sin(i / 3 + 2) + 6);
    const w = well([curve('GR', 'GR', gr), curve('DT', 'DT', dt), curve('SP', 'SP', sp), curve('RT', 'RT', rt)], n, 2000, 0.5);
    const zs = [{ ...zone('a', 2000, 2014.5), kind: 'reservoir' as const }, { ...zone('b', 2015, 2029.5), kind: 'seal' as const }];
    const r = run({ zones: zs, sources: { RW: { kind: 'module', moduleId: 'rw-sp' } } }, w);
    const chain = ['igr', 'vsh', 'phi-sonic-wyllie', 'phit', 'phie-vsh', 'temp-gradient', 'rw-sp', 'sw-archie', 'cutoffs', 'zone-summary', 'volumetrics'];
    for (const id of chain) expect(r.nodes.find((x) => x.moduleId === id)?.status, id).toBe('ok');
    expect(r.sources['PHIS']).toEqual({ kind: 'module', moduleId: 'phi-sonic-wyllie' });
    expect(r.sources['RW']).toEqual({ kind: 'module', moduleId: 'rw-sp' });
    expect(Number.isFinite(scalarOf(r, 'volumetrics:OOIP_TOTAL'))).toBe(true);
    expect(zoneScalarOf(r, 'volumetrics:OOIP')['b']).toBe(0); // zona sello
  });
});

// ===============================================================================================================
// Datos faltantes en los cutoffs (regla 1: descarte seguro; regla 2: Sw faltante en reservorio = «sin dato pay»).
describe('datos faltantes: descarte seguro y «sin dato pay»', () => {
  const withCurves = (over: { vsh?: number[]; phi?: number[]; sw?: number[] }) =>
    well(
      WELL.curves.map((c) =>
        c.role === 'VSH' && over.vsh ? curve('VSH', 'VSH', over.vsh)
        : c.role === 'PHIE' && over.phi ? curve('PHIE', 'PHIE', over.phi)
        : c.role === 'SW' && over.sw ? curve('SW', 'SW', over.sw)
        : c,
      ),
      N,
      DEPTH0,
      STEP,
    );
  const NAMES = ['cutoffs', 'zone-summary', 'volumetrics', 'cutoff-sensitivity'];
  const chain = (w: ReturnType<typeof well>, partial: Partial<Interpretation> = {}, zones: Zone[] = ZONES) =>
    run({ zones, compare: NAMES, ...partial }, w);

  it('regla 1: Vsh 0,9 con φ NaN da NET_RES = 0 (antes NaN) y deja de contar como «sin dato»', () => {
    // ZC i=25 tenía φ NaN con Vsh 0,2 (sin dato); con Vsh 0,9 la descarta Vsh. i=24: Vsh NaN con φ 0,02 → 0 por φ.
    const vsh = VSH.map((v, i) => (i === 25 ? 0.9 : v));
    const phi = PHIE.map((v, i) => (i === 24 ? 0.02 : v));
    const r = chain(withCurves({ vsh, phi }));
    const res = curveOf(r, 'cutoffs:NET_RES');
    const pay = curveOf(r, 'cutoffs:NET_PAY');
    expect(res[24]).toBe(0);
    expect(res[25]).toBe(0);
    expect(pay[24]).toBe(0);
    expect(pay[25]).toBe(0);
    const c = tableOf(r, 'zone-summary:ZONE_SUMMARY')[2]!;
    expect(c['noData']).toBe(0);
    expect(c['gross']).toBeCloseTo(5, 12);
  });

  it('regla 1: sigue siendo «sin dato» si ninguna curva conocida descarta (Vsh NaN con φ que pasa)', () => {
    const r = chain(WELL);
    expect(curveOf(r, 'cutoffs:NET_RES')[24]).toBeNaN(); // Vsh NaN, φ 0,25
    expect(curveOf(r, 'cutoffs:NET_RES')[25]).toBeNaN(); // Vsh 0,2, φ NaN
  });

  it('regla 2: reservorio con Sw NaN da NET_PAY = NaN (i=26 en ZC) y no cuenta como no pay', () => {
    const pay = curveOf(chain(WELL), 'cutoffs:NET_PAY');
    expect(pay[26]).toBeNaN();
    expect(pay[28]).toBe(0); // Vsh 0,8 > 0,4: no reservorio, 0
  });

  describe('zona con reservorio pero todo el Sw NaN (ZC)', () => {
    const sw = SW.map((v, i) => (zoneOf(i) === 2 ? NaN : v));
    const r = chain(withCurves({ sw }), { params: params({}, { [ZA]: { area: 2, bo: 1.25 } }) });
    const rows = tableOf(r, 'zone-summary:ZONE_SUMMARY');

    it('sumario: ZC tiene netPay, h·φ·Sh y kh en null (NaN), «sin dato pay» = todo el reservorio (2,5 m)', () => {
      const c = rows[2]!;
      expect(c['netRes']).toBeCloseTo(2.5, 12);
      expect(c['noDataPay']).toBeCloseTo(2.5, 12);
      expect(c['netPay']).toBeNull();
      expect(c['ntgPay']).toBeNull();
      expect(c['hphiShPay']).toBeNull();
      expect(c['khPay']).toBeNull();
      expect(c['phiRes']).toBeCloseTo(0.22, 12);
    });

    it('puertos: ZC es NaN; ZA y ZB siguen; los totales suman lo conocido', () => {
      const h = zoneScalarOf(r, 'zone-summary:NET_PAY_H');
      const hp = zoneScalarOf(r, 'zone-summary:HPHISH_PAY');
      expect(h[ZC]).toBeNaN();
      expect(hp[ZC]).toBeNaN();
      expect(h[ZA]).toBeCloseTo(3, 12);
      expect(scalarOf(r, 'zone-summary:NET_PAY_TOTAL')).toBeCloseTo(8, 12); // 3 + 5
      expect(scalarOf(r, 'zone-summary:HPHISH_TOTAL')).toBeCloseTo(0.348 + 0.6, 12);
      const total = rows[3]!;
      expect(total['netPay']).toBeCloseTo(8, 12);
      expect(total['noDataPay']).toBeCloseTo(2.5, 12);
    });

    it('volumétrico: el volumen de ZC es NaN (no 0), avisa y el total suma las demás zonas', () => {
      expect(zoneScalarOf(r, 'volumetrics:OOIP')[ZC]).toBeNaN();
      expect(zoneScalarOf(r, 'volumetrics:OOIP')[ZA]).toBeCloseTo(556800, 6);
      expect(scalarOf(r, 'volumetrics:OOIP_TOTAL')).toBeCloseTo(556800, 6);
      const vrow = tableOf(r, 'volumetrics:VOLUMETRICS')[2]!;
      expect(vrow['hphiSh']).toBeNull();
      expect(vrow['ooipSi']).toBeNull();
      expect(warnings(r).some((m) => m.includes('zona ZC') && m.includes('h·φ·Sh'))).toBe(true);
    });

    it('sumario avisa que ZC no tiene Sw en el reservorio; ZA no avisa', () => {
      const w = warnings(r);
      expect(w.some((m) => m.includes('zona ZC') && m.includes('ningún tramo de reservorio tiene Sw'))).toBe(true);
      expect(w.some((m) => m.includes('zona ZA') && m.includes('Sw'))).toBe(false);
    });

    it('sensibilidad: en el cutoff vigente coincide con el sumario (NaN ↔ nulo) por zona y en total', () => {
      const rows2 = tableOf(r, 'cutoff-sensitivity:CUTOFF_SWEEP');
      const h = zoneScalarOf(r, 'zone-summary:NET_PAY_H');
      for (const variable of ['vsh', 'phi', 'sw']) {
        for (const z of [ZA, ZB, ZC]) {
          const cur = rows2.find((x) => x['variable'] === variable && x['zoneId'] === z && x['current'] === 1)!;
          if (Number.isNaN(h[z]!)) expect(cur['netPay'], `${variable} ${z}`).toBeNull();
          else expect(cur['netPay'] as number, `${variable} ${z}`).toBeCloseTo(h[z]!, 12);
          expect(cur['noDataPay'] as number).toBeCloseTo(z === ZC ? 2.5 : 0, 12);
        }
        const tot = rows2.find((x) => x['variable'] === variable && x['zoneId'] === '' && x['current'] === 1)!;
        expect(tot['netPay'] as number).toBeCloseTo(8, 12);
        expect(tot['ooip'] as number).toBeCloseTo(scalarOf(r, 'volumetrics:OOIP_TOTAL'), 6);
      }
    });
  });

  describe('sin Sw en todo el pozo: el pay total es NaN', () => {
    const r = chain(withCurves({ sw: SW.map(() => NaN) }));
    it('NET_PAY_TOTAL y HPHISH_TOTAL son NaN; el reservorio sigue contado', () => {
      expect(scalarOf(r, 'zone-summary:NET_PAY_TOTAL')).toBeNaN();
      expect(scalarOf(r, 'zone-summary:HPHISH_TOTAL')).toBeNaN();
      const t = tableOf(r, 'zone-summary:ZONE_SUMMARY')[3]!;
      expect(t['netRes']).toBeCloseTo(11.5, 12);
      expect(t['noDataPay']).toBeCloseTo(11.5, 12);
      expect(t['netPay']).toBeNull();
      const rows2 = tableOf(r, 'cutoff-sensitivity:CUTOFF_SWEEP');
      const tot = rows2.find((x) => x['variable'] === 'vsh' && x['zoneId'] === '' && x['current'] === 1)!;
      expect(tot['netPay']).toBeNull();
      expect(tot['netRes']).toBeCloseTo(11.5, 12);
    });
  });

  describe('aviso del sumario: solo si el faltante supera el 5 % del neto de reservorio de la zona', () => {
    // una zona de 60 muestras (30 m) con reservorio en todas: 1 muestra sin Sw (0,5 m = 1,7 %) no avisa; 4 (6,7 %) sí
    const M = 60;
    const zx: Zone[] = [{ ...zone('zx', 1000, 1029.5), kind: 'reservoir' }];
    const mk = (missing: number) =>
      well(
        [
          curve('VSH', 'VSH', Array(M).fill(0.1)),
          curve('PHIE', 'PHIE', Array(M).fill(0.2)),
          curve('SW', 'SW', Array.from({ length: M }, (_, i) => (i < missing ? NaN : 0.3))),
        ],
        M,
        DEPTH0,
        STEP,
      );
    const gapWarnings = (missing: number) => warnings(run({ zones: zx, compare: NAMES }, mk(missing))).filter((m) => m.includes('Sw') && m.includes('ZX'));

    it('1 muestra (1,7 %): sin aviso, pero la columna «sin dato pay» muestra 0,5 m', () => {
      expect(gapWarnings(1)).toEqual([]);
      const rowsX = tableOf(run({ zones: zx, compare: NAMES }, mk(1)), 'zone-summary:ZONE_SUMMARY');
      expect(rowsX[0]!['noDataPay']).toBeCloseTo(0.5, 12);
      expect(rowsX[0]!['netPay']).toBeCloseTo(29.5, 12);
    });

    it('3 muestras (5 %, no lo supera): sin aviso; 4 muestras (6,7 %): avisa con el porcentaje', () => {
      expect(gapWarnings(3)).toEqual([]);
      const w = gapWarnings(4);
      expect(w).toHaveLength(1);
      expect(w[0]).toContain('7 %');
    });
  });

  it('el sello no avisa aunque le falte Sw (no aporta volumen)', () => {
    const sw = SW.map((v, i) => (zoneOf(i) === 1 ? NaN : v));
    const r = chain(withCurves({ sw }));
    expect(warnings(r).some((m) => m.includes('zona ZB'))).toBe(false);
    expect(zoneScalarOf(r, 'volumetrics:OOIP')[ZB]).toBe(0);
  });
});

// ===============================================================================================================
describe('«sin dato pay» en el pozo del TP (datos/pozo_tp_perfiles.csv)', () => {
  // Hay 15 muestras sin Sw (φ = 0 en lutitas con Vsh = 1, de 0,1524 m cada una): en A–E con los cutoffs por defecto
  // las descarta Vsh, así que no hay faltante de pay. Aflojando los cortes al máximo (Vsh ≤ 1, φ ≥ 0) pasan a
  // reservorio sin Sw: 8 muestras en B, 3 en D y 4 en E (2,286 m en total).
  const { well: tp, zones } = readWellFile(csvText, 'pozo_tp_perfiles.csv');
  const run2 = (global: Record<string, number>) => {
    const e = new Engine(registry);
    e.setWell(toEngineWell(tp));
    return e.run({ ...emptyInterpretation(zones), params: { global, zones: {} } });
  };
  const gapOf = (r: EngineRunResult) => Object.fromEntries(tableOf(r, 'zone-summary:ZONE_SUMMARY').map((x) => [x['zone'] as string, x['noDataPay'] as number]));

  it('cutoffs por defecto: sin dato pay = 0 en todas las zonas y en el total', () => {
    const g = gapOf(run2({}));
    for (const k of ['A', 'B', 'C', 'D', 'E', 'Total']) expect(g[k], k).toBe(0);
  });

  it('cortes al máximo: B 8, D 3 y E 4 muestras sin Sw (0,1524 m); el pay sigue finito', () => {
    const r = run2({ vshCutoff: 1, phiCutoff: 0 });
    const g = gapOf(r);
    expect(g['A']).toBe(0);
    expect(g['C']).toBe(0);
    expect(g['B']).toBeCloseTo(8 * 0.1524, 9);
    expect(g['D']).toBeCloseTo(3 * 0.1524, 9);
    expect(g['E']).toBeCloseTo(4 * 0.1524, 9);
    expect(g['Total']).toBeCloseTo(15 * 0.1524, 9);
    expect(Number.isFinite(scalarOf(r, 'zone-summary:NET_PAY_TOTAL'))).toBe(true);
    // B: 1,22 m sobre 181,66 m de reservorio (0,7 %): bajo el umbral del 5 %, sin aviso de Sw
    expect(warnings(r).some((m) => m.includes('le falta Sw'))).toBe(false);
  });
});
