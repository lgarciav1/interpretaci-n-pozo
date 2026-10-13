/**
 * C20 `cutoff-sensitivity` sobre un pozo sintético de 3 zonas (una `seal`) y sobre el pozo del TP:
 * forma de la tabla, coincidencia exacta con el sumario (neto pay, h·φ·Sh) y el volumétrico en el cutoff vigente,
 * cada umbral de la grilla contra correr la cadena con ese cutoff, overrides por zona y tiempo ante un cambio de
 * cutoff. Ver docs/decisiones/0007-modulos-fase-6a.md (C20, D5, D6).
 */
import { describe, expect, it } from 'vitest';
import csvText from '../datos/pozo_tp_perfiles.csv?raw';
import { Engine, toEngineWell, type EngineRunResult } from '../src/core/engine/engine';
import { emptyInterpretation, type Interpretation } from '../src/core/interpretation';
import type { TableCell, TableValue, ZoneScalarValue } from '../src/core/module';
import type { Zone } from '../src/core/well';
import { readWellFile } from '../src/io';
import { registry } from '../src/modules';
import { curve, well, zone } from './helpers';

// --- pozo sintético (mismo diseño que tests/modules-6a-calc.test.ts) -------------------------------------------
const N = 30;
const ZONES: Zone[] = [
  { ...zone('za', 1000, 1004.5), kind: 'reservoir' },
  { ...zone('zb', 1005, 1009.5), kind: 'seal' },
  { ...zone('zc', 1010, 1014.5), kind: 'formation' },
];
const [ZA, ZB, ZC] = ZONES.map((z) => z.id) as [string, string, string];
const zoneOf = (i: number) => (i < 10 ? 0 : i < 20 ? 1 : 2);
function series(perZone: [number, number, number], exceptions: Record<number, number> = {}): number[] {
  return Array.from({ length: N }, (_, i) => (i in exceptions ? exceptions[i]! : perZone[zoneOf(i)]!));
}
const VSH = series([0.1, 0.1, 0.2], { 5: 0.4, 6: 0.41, 24: NaN, 27: 0.8, 28: 0.8, 29: 0.8 });
const PHIE = series([0.2, 0.15, 0.25], { 7: 0.08, 8: 0.05, 25: NaN, 26: 0.1, 27: 0.2, 28: 0.2, 29: 0.02 });
const SW = series([0.3, 0.2, 0.4], { 2: 0.6, 3: 0.61, 9: 0.9, 26: NaN, 27: 0.3, 28: 0.9, 29: 0.3 });
const WELL = well([curve('VSH', 'VSH', VSH), curve('PHIE', 'PHIE', PHIE), curve('SW', 'SW', SW)], N, 1000, 0.5);

const MINE = ['cutoffs', 'cutoff-sensitivity', 'zone-summary', 'volumetrics'];
type P = Record<string, number | string | boolean>;

function run(partial: Partial<Interpretation> = {}, zones: Zone[] = ZONES): EngineRunResult {
  const engine = new Engine(registry, { checkInputs: true });
  engine.setWell(WELL);
  return engine.run({ ...emptyInterpretation(zones), ...partial });
}
const withParams = (global: P, zones: Record<string, P> = {}): Partial<Interpretation> => ({ params: { global, zones } });

function out(r: EngineRunResult, key: string) {
  const o = r.outputs.find((x) => x.key === key);
  if (!o) throw new Error(`Falta la salida ${key}`);
  return o.value;
}
const sweepRows = (r: EngineRunResult) => (out(r, 'cutoff-sensitivity:CUTOFF_SWEEP') as TableValue).rows;
const zs = (r: EngineRunResult, key: string) => out(r, key) as ZoneScalarValue;
const sc = (r: EngineRunResult, key: string) => out(r, key) as number;

type Row = Record<string, TableCell>;
const series_ = (rows: Row[], variable: string, zoneId: string) => rows.filter((x) => x.variable === variable && x.zoneId === zoneId && x.current === 0);
const current = (rows: Row[], variable: string, zoneId: string) => {
  const c = rows.filter((x) => x.variable === variable && x.zoneId === zoneId && x.current === 1);
  expect(c, `fila vigente ${variable}/${zoneId || 'total'}`).toHaveLength(1);
  return c[0]!;
};

/** El sumario y el volumétrico en el cutoff vigente, por zona y en total, contra las filas `current` del barrido. */
function expectMatchesSummaryAndVolumetrics(r: EngineRunResult) {
  const rows = sweepRows(r);
  const netPayH = zs(r, 'zone-summary:NET_PAY_H');
  const hphiSh = zs(r, 'zone-summary:HPHISH_PAY');
  const ooip = zs(r, 'volumetrics:OOIP');
  const ogip = zs(r, 'volumetrics:OGIP');
  for (const variable of ['vsh', 'phi', 'sw']) {
    for (const z of ZONES) {
      const c = current(rows, variable, z.id);
      expect(c.netPay, `${variable} ${z.name} neto pay`).toBeCloseTo(netPayH[z.id]!, 12);
      expect(c.hphiSh, `${variable} ${z.name} h·φ·Sh`).toBeCloseTo(hphiSh[z.id]!, 12);
      expect(c.ooip, `${variable} ${z.name} OOIP`).toBeCloseTo(ooip[z.id]!, 6);
      expect(c.ogip, `${variable} ${z.name} OGIP`).toBeCloseTo(ogip[z.id]!, 6);
    }
    const t = current(rows, variable, '');
    expect(t.netPay).toBeCloseTo(sc(r, 'zone-summary:NET_PAY_TOTAL'), 12);
    expect(t.hphiSh).toBeCloseTo(sc(r, 'zone-summary:HPHISH_TOTAL'), 12);
    expect(t.ooip).toBeCloseTo(sc(r, 'volumetrics:OOIP_TOTAL'), 6);
    expect(t.ogip).toBeCloseTo(sc(r, 'volumetrics:OGIP_TOTAL'), 6);
  }
}

describe('C20 cutoff-sensitivity: tabla', () => {
  const r = run();
  const rows = sweepRows(r);

  it('corre en ok, sin errores, y la tabla es oculta (no se lista en Resultados)', () => {
    expect(r.nodes.find((x) => x.moduleId === 'cutoff-sensitivity')?.status).toBe('ok');
    expect(r.diagnostics.filter((d) => d.level === 'error' && MINE.includes(d.moduleId ?? ''))).toEqual([]);
    expect(r.outputs.find((o) => o.key === 'cutoff-sensitivity:CUTOFF_SWEEP')?.hidden).toBe(true);
  });

  it('por variable: 3 zonas + Total, cada una con 41 umbrales y una fila en el cutoff vigente', () => {
    expect(rows).toHaveLength(3 * 4 * 42);
    for (const variable of ['vsh', 'phi', 'sw']) {
      for (const id of [ZA, ZB, ZC, '']) expect(series_(rows, variable, id)).toHaveLength(41);
    }
    expect(new Set(rows.filter((x) => x.zoneId === '').map((x) => x.zone))).toEqual(new Set(['Total']));
  });

  it('grillas fijas: Vsh y Sw de 0 a 1, φ de 0 a 0,4', () => {
    const th = (v: string) => series_(rows, v, ZA).map((x) => x.threshold as number);
    expect(th('vsh')[0]).toBe(0);
    expect(th('vsh')[40]).toBe(1);
    expect(th('phi')[40]).toBe(0.4);
    expect(th('sw')[20]).toBeCloseTo(0.5, 15);
  });

  it('cada umbral de la grilla = correr la cadena con ese cutoff (sumario por zona y total)', () => {
    for (const [variable, key] of [
      ['vsh', 'vshCutoff'],
      ['phi', 'phiCutoff'],
      ['sw', 'swCutoff'],
    ] as const) {
      const grid = series_(rows, variable, '');
      for (const j of [0, 4, 9, 16, 24, 33, 40]) {
        const t = grid[j]!.threshold as number;
        const rt = run(withParams({ [key]: t }));
        expect(grid[j]!.netPay, `${variable} t=${t} total`).toBeCloseTo(sc(rt, 'zone-summary:NET_PAY_TOTAL'), 12);
        expect(grid[j]!.hphiSh, `${variable} t=${t} total h·φ·Sh`).toBeCloseTo(sc(rt, 'zone-summary:HPHISH_TOTAL'), 12);
        expect(grid[j]!.ooip, `${variable} t=${t} total OOIP`).toBeCloseTo(sc(rt, 'volumetrics:OOIP_TOTAL'), 6);
        for (const z of ZONES) {
          const zr = series_(rows, variable, z.id)[j]!;
          expect(zr.netPay, `${variable} t=${t} ${z.name}`).toBeCloseTo(zs(rt, 'zone-summary:NET_PAY_H')[z.id]!, 12);
        }
      }
    }
  });

  it('el Total es la suma de las zonas en cada umbral', () => {
    for (const variable of ['vsh', 'phi', 'sw']) {
      const tot = series_(rows, variable, '');
      const parts = [ZA, ZB, ZC].map((id) => series_(rows, variable, id));
      tot.forEach((row, j) => {
        for (const k of ['netRes', 'netPay', 'hphiSh', 'ooip', 'ogip']) {
          const sum = parts.reduce((s, p) => s + (p[j]![k] as number), 0);
          expect(row[k], `${variable} ${k} j=${j}`).toBeCloseTo(sum, 9);
        }
      });
    }
  });

  it('monotonía: aflojar un corte no reduce el neto pay (Vsh y Sw crecen con el umbral, φ decrece)', () => {
    const pay = (v: string) => series_(rows, v, '').map((x) => x.netPay as number);
    const inc = (a: number[]) => a.every((x, i) => i === 0 || x >= a[i - 1]!);
    expect(inc(pay('vsh'))).toBe(true);
    expect(inc(pay('sw'))).toBe(true);
    expect(inc([...pay('phi')].reverse())).toBe(true);
  });

  it('el sello (ZB) tiene neto pay pero volumen 0 en todo el barrido', () => {
    const zb = series_(rows, 'sw', ZB);
    expect(zb.some((x) => (x.netPay as number) > 0)).toBe(true);
    expect(zb.every((x) => x.ooip === 0 && x.ogip === 0)).toBe(true);
  });
});

describe('C20 cutoff-sensitivity: en el cutoff vigente coincide con el sumario y el volumétrico', () => {
  it('con los valores por defecto', () => {
    expectMatchesSummaryAndVolumetrics(run());
  });

  it('con overrides por zona (cutoffs fuera de la grilla, fluido gas, área y Bo propios)', () => {
    const r = run(
      withParams(
        { vshCutoff: 0.413, phiCutoff: 0.0777, swCutoff: 0.6 },
        {
          [ZA]: { swCutoff: 0.555, area: 2.5, bo: 1.35 },
          [ZC]: { vshCutoff: 0.8, fluid: 'gas', bg: 0.004 },
        },
      ),
    );
    expectMatchesSummaryAndVolumetrics(r);
    // la fila vigente lleva el cutoff de su zona; el Total, el global
    const rows = sweepRows(r);
    expect(current(rows, 'sw', ZA).threshold).toBe(0.555);
    expect(current(rows, 'vsh', ZC).threshold).toBe(0.8);
    expect(current(rows, 'vsh', '').threshold).toBe(0.413);
    // ZC es gas: el petróleo del barrido es 0 y el gas positivo en el cutoff vigente
    expect(current(rows, 'sw', ZC).ooip).toBe(0);
    expect(current(rows, 'sw', ZC).ogip as number).toBeGreaterThan(0);
  });

  it('el override por zona cambia solo esa zona del barrido', () => {
    const base = sweepRows(run());
    const over = sweepRows(run(withParams({}, { [ZC]: { vshCutoff: 0.8 } })));
    // barrer φ y Sw depende del corte de Vsh de la zona; barrer Vsh no
    expect(series_(over, 'sw', ZA)).toEqual(series_(base, 'sw', ZA));
    expect(series_(over, 'sw', ZC)).not.toEqual(series_(base, 'sw', ZC));
    expect(series_(over, 'vsh', ZC)).toEqual(series_(base, 'vsh', ZC));
  });
});

describe('C20 cutoff-sensitivity: casos de borde', () => {
  it('«Puntos del barrido» cambia la cantidad de umbrales', () => {
    const rows = sweepRows(run(withParams({ 'cutoff-sensitivity.steps': 11 })));
    expect(series_(rows, 'phi', ZA)).toHaveLength(11);
    expect(series_(rows, 'phi', ZA)[10]!.threshold).toBe(0.4);
  });

  it('sin zonas: una serie «Pozo completo» con cutoffs globales y sin volumen', () => {
    const r = run({}, []);
    expect(r.nodes.find((x) => x.moduleId === 'cutoff-sensitivity')?.status).toBe('ok');
    const rows = sweepRows(r);
    expect(rows).toHaveLength(3 * 42);
    expect(rows.every((x) => x.zone === 'Pozo completo' && x.zoneId === '' && x.ooip === null && x.ogip === null)).toBe(true);
    expect(current(rows, 'sw', '').netPay).toBeCloseTo(sc(r, 'zone-summary:NET_PAY_TOTAL'), 12);
  });

  it('zona sin muestras: sus filas quedan sin dato (como el sumario), el total no cambia', () => {
    const extra: Zone = { ...zone('zz', 2000, 2010), kind: 'reservoir' };
    const r = run({}, [...ZONES, extra]);
    const rows = sweepRows(r);
    expect(series_(rows, 'vsh', 'zz').every((x) => x.netPay === null && x.ooip === null)).toBe(true);
    expect(current(rows, 'vsh', '').netPay).toBeCloseTo(sc(r, 'zone-summary:NET_PAY_TOTAL'), 12);
  });

  it('cambiar un cutoff recalcula la sensibilidad, no lo que está aguas arriba', () => {
    const engine = new Engine(registry, { checkInputs: true });
    engine.setWell(WELL);
    engine.run(emptyInterpretation(ZONES));
    const r = engine.run({ ...emptyInterpretation(ZONES), ...withParams({ swCutoff: 0.5 }) });
    expect(r.stats.recomputed).toEqual(expect.arrayContaining(['cutoffs', 'cutoff-sensitivity', 'zone-summary', 'volumetrics']));
    expect(r.stats.recomputed).not.toContain('temp-gradient');
  });
});

describe('C20 sobre el pozo del TP (datos/pozo_tp_perfiles.csv)', () => {
  const { well: tp, zones } = readWellFile(csvText, 'pozo_tp_perfiles.csv');
  const engine = new Engine(registry, { checkInputs: true });
  engine.setWell(toEngineWell(tp));
  const first = engine.run(emptyInterpretation(zones));

  it('cadena por defecto: sensibilidad, cutoffs, sumario y volumétrico en ok', () => {
    for (const id of MINE) expect(first.nodes.find((x) => x.moduleId === id)?.status, id).toBe('ok');
    const rows = sweepRows(first);
    expect(rows).toHaveLength(3 * (zones.length + 1) * 42);
  });

  it('en el cutoff vigente coincide con el sumario y el volumétrico', () => {
    const rows = sweepRows(first);
    for (const z of zones) {
      expect(current(rows, 'sw', z.id).netPay).toBeCloseTo(zs(first, 'zone-summary:NET_PAY_H')[z.id]!, 9);
      expect(current(rows, 'phi', z.id).hphiSh).toBeCloseTo(zs(first, 'zone-summary:HPHISH_PAY')[z.id]!, 9);
      expect(current(rows, 'vsh', z.id).ooip).toBeCloseTo(zs(first, 'volumetrics:OOIP')[z.id]!, 3);
    }
    expect(current(rows, 'vsh', '').ooip).toBeCloseTo(sc(first, 'volumetrics:OOIP_TOTAL'), 3);
  });

  // Timeout amplio: siete motores nuevos con el pozo del TP; el primer cálculo incluye los modelos de facies (≈ 1 s, 10c).
  it('un cambio de cutoff recalcula la sensibilidad en menos de 20 ms (motor, mediana de 7)', () => {
    const times: number[] = [];
    const totals: number[] = [];
    for (let k = 0; k < 7; k++) {
      // Sin checkInputs: mide el costo del motor de producción.
      const e = new Engine(registry);
      e.setWell(toEngineWell(tp));
      e.run(emptyInterpretation(zones));
      const r = e.run({ ...emptyInterpretation(zones), params: { global: { swCutoff: 0.5 + k * 0.01 }, zones: {} } });
      const node = r.nodes.find((x) => x.moduleId === 'cutoff-sensitivity')!;
      expect(node.computed).toBe(true);
      times.push(node.ms);
      totals.push(r.stats.ms);
    }
    const median = (a: number[]) => [...a].sort((x, y) => x - y)[a.length >> 1]!;
    console.info(`[C20 TP] sensibilidad: mediana ${median(times).toFixed(2)} ms; cambio de cutoff completo: mediana ${median(totals).toFixed(2)} ms`);
    expect(median(times)).toBeLessThan(20);
    expect(median(totals)).toBeLessThan(20);
  }, 30_000);
});
