/**
 * Capacidad de almacenaje/flujo y curvas de Lorenz (src/petro/flowCapacity.ts y módulo flow-capacity).
 * Todos los valores esperados son cuentas a mano (fracciones exactas, verificadas aparte con aritmética racional) o
 * propiedades definitorias de Lorenz (Lake y Jensen 1991; Gunter et al. 1997, SPE 38679).
 */
import { describe, expect, it } from 'vitest';
import { Engine, type EngineRunResult } from '../src/core/engine/engine';
import { emptyInterpretation } from '../src/core/interpretation';
import type { TableValue, ZoneScalarValue } from '../src/core/module';
import type { Zone } from '../src/core/well';
import {
  buildFlowUnits,
  flowCapacity,
  lorenzCoefficient,
  lorenzOrdered,
  lorenzStratigraphic,
  type FlowSamples,
} from '../src/petro/flowCapacity';
import { registry } from '../src/modules';
import { curve, well, zone } from './helpers';

/** Muestras de espesor `h`, con profundidad creciente de 1 m en 1 m. */
function samples(h: number[], phi: number[], k: number[], include?: number[]): FlowSamples {
  return { depth: h.map((_, i) => 1000 + i), thickness: h, phi, k, include };
}

// Caso de libro de 4 capas (a mano): h [m] / φ / k [mD]
//   1: 2 / 0,10 / 1    → φh 0,2   kh 2
//   2: 2,5 / 0,20 / 100 → φh 0,5   kh 250
//   3: 1 / 0,10 / 10   → φh 0,1   kh 10
//   4: 2 / 0,10 / 19   → φh 0,2   kh 38          Σφh = 1, Σkh = 300
//   k/φ = 10, 500, 100, 190 → orden por productividad: 2, 4, 3, 1
const BOOK = samples([2, 2.5, 1, 2], [0.1, 0.2, 0.1, 0.1], [1, 100, 10, 19]);

describe('flowCapacity: caso de 4 capas calculado a mano', () => {
  const c = flowCapacity(BOOK);

  it('φh, kh, totales y promedios ponderados', () => {
    expect(c.units.map((u) => u.phiH)).toEqual([expect.closeTo(0.2, 12), 0.5, expect.closeTo(0.1, 12), expect.closeTo(0.2, 12)]);
    expect(c.units.map((u) => u.kH)).toEqual([2, 250, 10, 38]);
    expect(c.h).toBeCloseTo(7.5, 12);
    expect(c.phiH).toBeCloseTo(1, 12);
    expect(c.kH).toBeCloseTo(300, 12);
    expect(c.phiMean).toBeCloseTo(1 / 7.5, 12); // Σφh/Σh
    expect(c.kMean).toBeCloseTo(300 / 7.5, 12); // 40 mD
  });

  it('porcentajes y acumulados normalizados', () => {
    expect(c.units.map((u) => u.phiHFrac)).toEqual([0.2, 0.5, 0.1, 0.2].map((x) => expect.closeTo(x, 12)));
    expect(c.units.map((u) => u.kHFrac)).toEqual([2 / 300, 250 / 300, 10 / 300, 38 / 300].map((x) => expect.closeTo(x, 12)));
    expect(c.units.map((u) => u.cumPhiH)).toEqual([0.2, 0.7, 0.8, 1].map((x) => expect.closeTo(x, 12)));
    expect(c.units.map((u) => u.cumKH)).toEqual([2 / 300, 252 / 300, 262 / 300, 1].map((x) => expect.closeTo(x, 12)));
    expect(c.units.map((u) => u.kOverPhi)).toEqual([10, 500, 100, 190].map((x) => expect.closeTo(x, 9)));
    expect(c.units.map((u) => u.index)).toEqual([1, 2, 3, 4]);
  });

  it('Lorenz estratigráfico: de (0,0) a (1,1) en orden de profundidad', () => {
    const xs = [0, 0.2, 0.7, 0.8, 1];
    const ys = [0, 2 / 300, 252 / 300, 262 / 300, 1];
    expect(c.lorenzStrat).toHaveLength(5);
    c.lorenzStrat.forEach((p, i) => {
      expect(p.x).toBeCloseTo(xs[i]!, 12);
      expect(p.y).toBeCloseTo(ys[i]!, 12);
    });
    expect(c.lorenzStrat[4]).toEqual({ x: 1, y: 1 });
  });

  it('Lorenz ordenado por k/φ decreciente y Lc = 277/750 = 0,369333', () => {
    // orden 2, 4, 3, 1: x = 0,5 / 0,7 / 0,8 / 1;  y = 250/300, 288/300, 298/300, 1
    const xs = [0, 0.5, 0.7, 0.8, 1];
    const ys = [0, 250 / 300, 288 / 300, 298 / 300, 1];
    c.lorenzOrdered.forEach((p, i) => {
      expect(p.x).toBeCloseTo(xs[i]!, 12);
      expect(p.y).toBeCloseTo(ys[i]!, 12);
    });
    // A = 0,25·(5/6) + 0,1·(5/6 + 24/25) + 0,05·(24/25 + 149/150) + 0,1·(149/150 + 1) = 1027/1500
    expect(lorenzCoefficient(c.lorenzOrdered)).toBeCloseTo(2 * (1027 / 1500 - 0.5), 12);
    expect(c.lc).toBeCloseTo(277 / 750, 12);
  });

  it('la estratigráfica queda por debajo de la ordenada (área 182/375 < 1027/1500) y Lc estratigráfico no es el clásico', () => {
    let area = 0;
    for (let i = 1; i < c.lorenzStrat.length; i++) {
      const a = c.lorenzStrat[i - 1]!;
      const b = c.lorenzStrat[i]!;
      area += ((b.x - a.x) * (a.y + b.y)) / 2;
    }
    expect(area).toBeCloseTo(182 / 375, 12);
    expect(area).toBeLessThan(1027 / 1500);
    // El orden estratigráfico de este caso es mayormente un barrido cerca de la diagonal: no se usa para Lc.
    expect(lorenzCoefficient(c.lorenzStrat)).toBeCloseTo(0, 12); // área < 1/2 → 2(A − 1/2) < 0 → se lleva a 0
  });
});

describe('flowCapacity: casos límite de Lorenz', () => {
  it('reservorio homogéneo (k/φ constante): curvas = diagonal y Lc = 0', () => {
    // espesores distintos, φ y k constantes
    const c = flowCapacity(samples([1, 3, 0.5, 2.5], [0.15, 0.15, 0.15, 0.15], [20, 20, 20, 20]));
    for (const p of [...c.lorenzStrat, ...c.lorenzOrdered]) expect(p.y).toBeCloseTo(p.x, 12);
    expect(c.lc).toBeCloseTo(0, 12);
    // k/φ constante con φ variable también es «homogéneo» en Lorenz
    const d = flowCapacity(samples([1, 1, 1], [0.1, 0.2, 0.3], [10, 20, 30]));
    expect(d.lc).toBeCloseTo(0, 12);
    d.lorenzOrdered.forEach((p) => expect(p.y).toBeCloseTo(p.x, 12));
  });

  it('N tramos de igual φh con todo el flujo en uno: Lc = 1 − 1/N (N = 4 → 0,75); k ≤ 0 aporta 0', () => {
    // k = [0, 50, −3, 0]: los k ≤ 0 se tratan como 0, su φh sí cuenta
    const c = flowCapacity(samples([1, 1, 1, 1], [0.2, 0.2, 0.2, 0.2], [0, 50, -3, 0]));
    expect(c.units.map((u) => u.kH)).toEqual([0, 50, 0, 0]);
    expect(c.units.map((u) => u.k)).toEqual([0, 50, 0, 0]);
    expect(c.phiH).toBeCloseTo(0.8, 12);
    expect(c.lorenzOrdered).toEqual([
      { x: 0, y: 0 },
      expect.objectContaining({ x: expect.closeTo(0.25, 12), y: 1 }),
      expect.objectContaining({ x: expect.closeTo(0.5, 12), y: 1 }),
      expect.objectContaining({ x: expect.closeTo(0.75, 12), y: 1 }),
      { x: 1, y: 1 },
    ]);
    expect(c.lc).toBeCloseTo(0.75, 12);
    // más tramos → más cerca de 1: N = 10 → 0,9
    const k10 = Array.from({ length: 10 }, (_, i) => (i === 3 ? 7 : 0));
    expect(flowCapacity(samples(Array(10).fill(1), Array(10).fill(0.1), k10)).lc).toBeCloseTo(0.9, 12);
  });

  it('el orden por k/φ no depende del orden de entrada (Lorenz ordenado idéntico al permutar los tramos)', () => {
    const a = flowCapacity(BOOK);
    const perm = [2, 0, 3, 1];
    const b = flowCapacity(samples(perm.map((i) => BOOK.thickness[i]!), perm.map((i) => BOOK.phi[i]!), perm.map((i) => BOOK.k[i]!)));
    expect(b.lc).toBeCloseTo(a.lc, 12);
    expect(b.lorenzStrat[1]!.x).toBeCloseTo(0.1, 12); // la estratigráfica sí cambia: primero el tramo 3 (φh 0,1)
  });

  it('φ = 0 con k > 0 (k/φ infinito) va primero y no rompe el orden', () => {
    const o = lorenzOrdered([
      { top: 0, base: 0, h: 1, phi: 0.2, k: 10, phiH: 0.2, kH: 10 },
      { top: 1, base: 1, h: 1, phi: 0, k: 5, phiH: 0, kH: 5 },
      { top: 2, base: 2, h: 1, phi: 0, k: 0, phiH: 0, kH: 0 }, // no aporta: se omite
    ]);
    expect(o).toEqual([{ x: 0, y: 0 }, { x: 0, y: 5 / 15 }, { x: 1, y: 1 }]);
  });

  it('Σφh = 0 o Σkh = 0: no normalizable (curvas vacías, Lc y fracciones NaN)', () => {
    const c = flowCapacity(samples([1, 1], [0.2, 0.1], [0, -4]));
    expect(c.lorenzStrat).toEqual([]);
    expect(c.lc).toBeNaN();
    expect(c.units[0]!.kHFrac).toBeNaN();
    expect(c.units[0]!.phiHFrac).toBeCloseTo(0.2 / 0.3, 12);
    expect(lorenzStratigraphic([])).toEqual([]);
    expect(flowCapacity(samples([], [], [])).lc).toBeNaN();
    expect(flowCapacity(samples([], [], [])).phiMean).toBeNaN();
  });
});

describe('flowCapacity: datos faltantes, filtros, rangos y agrupamiento', () => {
  it('NaN en φ, k o espesor, φ fuera de [0,1] y k infinita se descartan y se cuentan', () => {
    const s = samples([1, 1, 1, NaN, 1, 1, 0], [0.2, NaN, 0.1, 0.1, 1.2, -0.1, 0.1], [5, 5, NaN, 5, 5, 5, 5]);
    const { units, used, noData } = buildFlowUnits(s);
    expect(units).toHaveLength(1);
    expect(used).toBe(1);
    expect(noData).toBe(6);
    expect(buildFlowUnits(samples([1], [0.1], [Infinity])).noData).toBe(1);
  });

  it('filtro por bandera: solo entra el 1; 0 y NaN quedan fuera y no cuentan como sin dato', () => {
    const s = samples([1, 1, 1, 1], [0.1, 0.1, 0.1, 0.1], [1, 2, 3, 4], [1, 0, NaN, 1]);
    const c = flowCapacity(s);
    expect(c.units.map((u) => u.k)).toEqual([1, 4]);
    expect(c.noData).toBe(0);
    expect(c.used).toBe(2);
    expect(c.units.map((u) => u.top)).toEqual([1000, 1003]);
  });

  it('rangos (zonas) en orden: cada rango recorta y se concatenan', () => {
    const c = flowCapacity(BOOK, [{ start: 0, end: 1 }, { start: 2, end: 4 }]);
    expect(c.units.map((u) => u.kH)).toEqual([2, 10, 38]);
    expect(c.phiH).toBeCloseTo(0.5, 12);
    expect(flowCapacity(BOOK, [{ start: 1, end: 2 }]).lc).toBeCloseTo(0, 12); // un solo tramo → homogéneo
  });

  it('agrupamiento de muestras: sumas de φh y kh se conservan, φ y k por espesor', () => {
    const c = flowCapacity(BOOK, undefined, 2);
    expect(c.units).toHaveLength(2);
    // [1,2] → h 4,5, φh 0,7, kh 252, φ 0,7/4,5, k 252/4,5;  [3,4] → h 3, φh 0,3, kh 48
    expect(c.units[0]!.h).toBeCloseTo(4.5, 12);
    expect(c.units[0]!.phiH).toBeCloseTo(0.7, 12);
    expect(c.units[0]!.kH).toBeCloseTo(252, 12);
    expect(c.units[0]!.phi).toBeCloseTo(0.7 / 4.5, 12);
    expect(c.units[0]!.k).toBeCloseTo(56, 12);
    expect(c.units[0]!.top).toBe(1000);
    expect(c.units[0]!.base).toBe(1001);
    expect(c.units[1]!.kH).toBeCloseTo(48, 12);
    expect(c.phiH).toBeCloseTo(1, 12);
    expect(c.kH).toBeCloseTo(300, 12);
    // 2 tramos: k/φ = 360 y 160 → ordenado: (0,7; 252/300), (1; 1). A = 0,35·0,84 + 0,3·(0,84+1)/2 = 0,294 + 0,276 = 0,57 → Lc = 0,14
    expect(c.lc).toBeCloseTo(0.14, 12);
    // groupSize > nº de muestras: un solo tramo; groupSize inválido: se toma 1
    expect(flowCapacity(BOOK, undefined, 99).units).toHaveLength(1);
    expect(flowCapacity(BOOK, undefined, 0).units).toHaveLength(4);
    expect(flowCapacity(BOOK, undefined, NaN).units).toHaveLength(4);
  });
});

// ===============================================================================================================
// Módulo flow-capacity sobre un pozo sintético de 12 muestras de 1 m (1000–1011 m) y tres zonas.
//   za (reservorio) 0–3: el caso de libro con h = 1 m (φ 0,2/0,5/0,1/0,2 y k 2/250/10/38 → φh y kh iguales al caso de 4 capas)
//   zb (sello)      4–7
//   zc (formación)  8–11: φ 0,1; k 5, 5, NaN, 5; NET_RES 1, 0, 1, 1 → neto: muestras 8, 11 (la 10 no tiene k)
const ZONES: Zone[] = [
  { ...zone('za', 1000, 1003), kind: 'reservoir' },
  { ...zone('zb', 1004, 1007), kind: 'seal' },
  { ...zone('zc', 1008, 1011), kind: 'formation' },
];
const [ZA, ZB, ZC] = ZONES.map((z) => z.id) as [string, string, string];
const PHI = [0.2, 0.5, 0.1, 0.2, 0.3, 0.3, 0.3, 0.3, 0.1, 0.1, 0.1, 0.1];
const PERM = [2, 250, 10, 38, 7, 7, 7, 7, 5, 5, NaN, 5];
const NET_RES = [1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1];
const WELL = well([curve('PHIE', 'PHIE', PHI), curve('PERM', 'PERM', PERM), curve('NET_RES', 'NET_RES', NET_RES)], 12, 1000, 1);

function run(params: Record<string, Record<string, number | string | boolean>> = {}, w = WELL): EngineRunResult {
  const engine = new Engine(registry, { checkInputs: true });
  engine.setWell(w);
  return engine.run({ ...emptyInterpretation(ZONES), compare: ['flow-capacity'], params: { global: {}, zones: params } });
}
const out = (r: EngineRunResult, key: string) => {
  const o = r.outputs.find((x) => x.key === key);
  if (!o) throw new Error(`Falta la salida ${key}`);
  return o.value;
};
const rowsOf = (r: EngineRunResult, port: string) => (out(r, `flow-capacity:${port}`) as TableValue).rows;
const warnings = (r: EngineRunResult) => r.diagnostics.filter((d) => d.code === 'module-warning').map((d) => d.message);

describe('módulo flow-capacity', () => {
  const r = run();

  it('está registrado y sin errores propios', () => {
    expect(registry.modules.map((m) => m.id)).toContain('flow-capacity');
    expect(r.diagnostics.filter((d) => d.level === 'error' && d.moduleId === 'flow-capacity')).toEqual([]);
  });

  it('tabla por tramo: la zona za reproduce el caso de libro; el sello no tiene renglones', () => {
    const rows = rowsOf(r, 'FLOW_UNITS');
    const za = rows.filter((x) => x.zoneId === ZA);
    expect(rows.some((x) => x.zoneId === ZB)).toBe(false);
    expect(za.map((x) => x.kH)).toEqual([2, 250, 10, 38]);
    expect(za.map((x) => x.phiHPct)).toEqual([20, 50, 10, 20].map((v) => expect.closeTo(v, 9)));
    expect(za.map((x) => x.cumKHPct)).toEqual([(2 / 300) * 100, (252 / 300) * 100, (262 / 300) * 100, 100].map((v) => expect.closeTo(v, 9)));
    expect(za.map((x) => x.top)).toEqual([1000, 1001, 1002, 1003]);
    // zc: neto = muestras 8 y 11 (la 9 está filtrada por la bandera; la 10 no tiene k)
    const zc = rows.filter((x) => x.zoneId === ZC);
    expect(zc.map((x) => x.top)).toEqual([1008, 1011]);
  });

  it('Lc por zona (za = 277/750, zc homogénea = 0, sello NaN) y total (41/93)', () => {
    const lc = out(r, 'flow-capacity:LORENZ_COEF') as ZoneScalarValue;
    expect(Object.keys(lc).sort()).toEqual([ZA, ZB, ZC]);
    expect(lc[ZA]).toBeCloseTo(277 / 750, 12);
    expect(lc[ZB]).toBeNaN();
    expect(lc[ZC]).toBeCloseTo(0, 12);
    // Total: 6 tramos (za 4 + zc 2), Σφh 1,2, Σkh 310; orden por k/φ: 500, 190, 100, 50, 50, 10 → Lc = 41/93
    expect(out(r, 'flow-capacity:LORENZ_COEF_TOTAL') as number).toBeCloseTo(41 / 93, 12);
  });

  it('resumen y puntos de las curvas (incluida la fila Total)', () => {
    const sum = rowsOf(r, 'FLOW_SUMMARY');
    expect(sum.map((x) => x.zone)).toEqual([ZONES[0]!.name, ZONES[2]!.name, 'Total']);
    const za = sum[0]!;
    expect(za).toMatchObject({ units: 4, noData: 0, filter: 'Reservorio neto' });
    expect(za.phiH).toBeCloseTo(1, 12);
    expect(za.kH).toBeCloseTo(300, 12);
    expect(za.lc).toBeCloseTo(277 / 750, 12);
    expect(sum[1]).toMatchObject({ units: 2, noData: 1 });
    expect(sum[2]).toMatchObject({ units: 6, noData: 1 });
    expect(sum[2]!.phiH).toBeCloseTo(1.2, 12);

    const lz = rowsOf(r, 'FLOW_LORENZ');
    const pts = (zoneId: string, curveName: string) => lz.filter((x) => x.zoneId === zoneId && x.curve === curveName);
    expect(pts(ZA, 'strat')).toHaveLength(5);
    expect(pts(ZA, 'strat').map((p) => p.x)).toEqual([0, 0.2, 0.7, 0.8, 1].map((v) => expect.closeTo(v, 12)));
    expect(pts(ZA, 'ordered').map((p) => p.y)).toEqual([0, 250 / 300, 288 / 300, 298 / 300, 1].map((v) => expect.closeTo(v, 12)));
    expect(pts('', 'ordered')).toHaveLength(7);
    expect(pts(ZB, 'strat')).toHaveLength(0);
    expect(pts('', 'strat')[6]).toMatchObject({ i: 6, x: 1, y: 1 });
  });

  it('filtro «todo el tramo» por zona: zc pasa a 3 tramos (muestra 9 incluida) y cambia el total', () => {
    const r2 = run({ [ZC]: { 'flow-capacity.filter': 'all' } });
    const sum = rowsOf(r2, 'FLOW_SUMMARY');
    expect(sum[1]).toMatchObject({ units: 3, noData: 1, filter: 'Todo el tramo' });
    expect(sum[2]).toMatchObject({ units: 7 });
  });

  it('agrupar muestras (zona za, 2 por tramo) reproduce Lc = 0,14', () => {
    const r2 = run({ [ZA]: { 'flow-capacity.groupSize': 2 } });
    const lc = out(r2, 'flow-capacity:LORENZ_COEF') as ZoneScalarValue;
    expect(lc[ZA]).toBeCloseTo(0.14, 12);
  });

  it('sin la curva NET_PAY: avisa y usa todo el tramo', () => {
    const r2 = run({ [ZA]: { 'flow-capacity.filter': 'netPay' } });
    expect(warnings(r2).some((m) => m.includes('NET_PAY'))).toBe(true);
    expect((out(r2, 'flow-capacity:LORENZ_COEF') as ZoneScalarValue)[ZA]).toBeCloseTo(277 / 750, 12);
  });

  it('zona sin muestras válidas: Lc NaN y aviso', () => {
    const allNaN = well([curve('PHIE', 'PHIE', PHI), curve('PERM', 'PERM', PERM.map(() => NaN)), curve('NET_RES', 'NET_RES', NET_RES)], 12, 1000, 1);
    const r2 = run({}, allNaN);
    const lc = out(r2, 'flow-capacity:LORENZ_COEF') as ZoneScalarValue;
    expect(lc[ZA]).toBeNaN();
    expect(out(r2, 'flow-capacity:LORENZ_COEF_TOTAL')).toBeNaN();
    expect(warnings(r2).length).toBeGreaterThan(0);
  });
});
