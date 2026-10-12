/** Comparación del sumario por zona entre snapshots (docs/decisiones/0026). */
import { describe, expect, it } from 'vitest';
import { syntheticWell } from '../src/app/demo/syntheticWell';
import { computeOnce, toEngineWell, type OutputRecord } from '../src/core/engine/engine';
import { emptyInterpretation } from '../src/core/interpretation';
import { createSnapshot, describeDiff, diffInterpretations } from '../src/core/state/snapshots';
import { addWell, createProject } from '../src/core/state/project';
import {
  compareCell,
  compareSummaries,
  extractSummary,
  SUMMARY_METRICS,
  TOTAL_KEY,
  type SummarySide,
  type SummaryZone,
} from '../src/core/state/snapshotCompare';
import { registry } from '../src/modules';
import { PLOT_PARAMS } from '../src/plots/params';
import { zone } from './helpers';

const z = (key: string, values: SummaryZone['values'], name = key.toUpperCase()): SummaryZone => ({ key, name, seal: false, values });
const side = (zones: SummaryZone[], total?: SummaryZone['values']): SummarySide => ({ zones, total: total ? { key: TOTAL_KEY, name: 'Total', seal: false, values: total } : null, missing: null });

describe('compareCell', () => {
  it('Δ = B − A con signo y % relativo a A', () => {
    expect(compareCell(10, 12, true)).toEqual({ a: 10, b: 12, delta: 2, pct: 20, sign: 1 });
    const down = compareCell(10, 7.5, true);
    expect(down.delta).toBeCloseTo(-2.5, 12);
    expect(down.pct).toBeCloseTo(-25, 12);
    expect(down.sign).toBe(-1);
    // A negativo: el % se refiere a |A| (el signo sigue el de Δ).
    expect(compareCell(-4, -2, true).pct).toBeCloseTo(50, 12);
  });

  it('valores iguales dan Δ = 0, % = 0 y signo 0; el ruido de punto flotante también', () => {
    expect(compareCell(0.25, 0.25, true)).toEqual({ a: 0.25, b: 0.25, delta: 0, pct: 0, sign: 0 });
    expect(compareCell(0.1 + 0.2, 0.3, true).sign).toBe(0);
  });

  it('división por cero: A = 0 y B ≠ 0 da % nulo; A = B = 0 da 0 %', () => {
    expect(compareCell(0, 3, true)).toEqual({ a: 0, b: 3, delta: 3, pct: null, sign: 1 });
    expect(compareCell(0, 0, true).pct).toBe(0);
  });

  it('sin % en las métricas que no lo usan', () => {
    expect(compareCell(0.2, 0.3, false).pct).toBeNull();
  });

  it('nulos, undefined, NaN e infinitos: sin Δ ni signo, conservando el lado conocido', () => {
    expect(compareCell(null, 2, true)).toEqual({ a: null, b: 2, delta: null, pct: null, sign: null });
    expect(compareCell(NaN, 2, true)).toEqual({ a: null, b: 2, delta: null, pct: null, sign: null });
    expect(compareCell(1, undefined, true)).toEqual({ a: 1, b: null, delta: null, pct: null, sign: null });
    expect(compareCell(Infinity, 1, true).a).toBeNull();
  });
});

describe('compareSummaries', () => {
  it('estados iguales: Δ = 0 en todas las celdas y ninguna fila cambiada', () => {
    const s = side([z('a', { netRes: 10, netPay: 5, phi: 0.2, sw: 0.4, vsh: 0.1, k: 50 })], { netRes: 10, netPay: 5 });
    const c = compareSummaries(s, structuredClone(s));
    expect(c.changed).toBe(0);
    for (const r of c.rows) for (const m of c.metrics) if (r.cells[m.id].a !== null) expect(r.cells[m.id].delta).toBe(0);
    expect(c.rows.map((r) => r.key)).toEqual(['a', TOTAL_KEY]);
    expect(c.rows.at(-1)!.total).toBe(true);
  });

  it('zonas agregadas y eliminadas: orden de A, las nuevas al final, total último', () => {
    const a = side([z('a', { netPay: 1 }), z('b', { netPay: 2 })], { netPay: 3 });
    const b = side([z('a', { netPay: 1 }), z('c', { netPay: 4 })], { netPay: 5 });
    const c = compareSummaries(a, b);
    expect(c.rows.map((r) => [r.key, r.presence])).toEqual([
      ['a', 'both'],
      ['b', 'onlyA'],
      ['c', 'onlyB'],
      [TOTAL_KEY, 'both'],
    ]);
    expect(c.rows[1]!.cells.netPay).toMatchObject({ a: 2, b: null, delta: null });
    expect(c.rows[2]!.cells.netPay).toMatchObject({ a: null, b: 4, delta: null });
    expect(c.changed).toBe(2);
  });

  it('una zona renombrada se empareja por id y toma el nombre de B', () => {
    const c = compareSummaries(side([z('a', { netPay: 1 }, 'Vieja')]), side([z('a', { netPay: 1 }, 'Nueva')]));
    expect(c.rows[0]).toMatchObject({ name: 'Nueva', presence: 'both' });
  });

  it('un valor que pasa de dato a sin dato cuenta como cambio', () => {
    const c = compareSummaries(side([z('a', { sw: 0.3 })]), side([z('a', {})]));
    expect(c.changed).toBe(1);
    expect(c.rows[0]!.cells.sw.sign).toBeNull();
  });

  it('OOIP/OGIP solo si algún estado los entrega con un valor ≠ 0', () => {
    expect(compareSummaries(side([z('a', { netPay: 1 })]), side([z('a', { netPay: 1 })])).metrics.map((m) => m.id)).not.toContain('ooip');
    expect(compareSummaries(side([z('a', { ooip: 0 })]), side([z('a', { ooip: 0 })])).metrics.map((m) => m.id)).not.toContain('ooip');
    const ids = compareSummaries(side([z('a', { ooip: 0 })]), side([z('a', { ooip: 1.5 })])).metrics.map((m) => m.id);
    expect(ids).toContain('ooip');
    expect(ids).not.toContain('ogip');
  });

  it('sin total en ninguno: no hay fila de total', () => {
    expect(compareSummaries(side([]), side([])).rows).toEqual([]);
  });
});

describe('extractSummary', () => {
  const table = (rows: Record<string, unknown>[]): OutputRecord => ({
    key: 'zone-summary:ZONE_SUMMARY',
    moduleId: 'zone-summary',
    port: 'ZONE_SUMMARY',
    kind: 'table',
    active: true,
    version: 1,
    label: 'Sumario',
    value: { rows } as OutputRecord['value'],
  });
  const depth = Float64Array.from({ length: 21 }, (_, i) => 1000 + i);

  it('empareja cada fila con el id de su zona en orden de profundidad (no en el de la lista)', () => {
    const zones = [zone('b', 1010, 1020), zone('a', 1000, 1009)];
    const out = extractSummary(
      {
        outputs: [
          table([
            { zone: 'A', netRes: 4, netPay: 2, phiPay: 0.2, swPay: 0.3, vshPay: null, kPay: 10 },
            { zone: 'B', netRes: 6, netPay: 0, phiPay: null, swPay: null, vshPay: null, kPay: null },
            { zone: 'Total', netRes: 10, netPay: 2, phiPay: 0.2, swPay: 0.3, vshPay: null, kPay: 10 },
          ]),
        ],
      },
      zones,
      depth,
    );
    expect(out.missing).toBeNull();
    expect(out.zones.map((x) => x.key)).toEqual(['a', 'b']);
    expect(out.zones[0]!.values).toEqual({ netRes: 4, netPay: 2, phi: 0.2, sw: 0.3, k: 10 });
    expect(out.zones[1]!.values).toEqual({ netRes: 6, netPay: 0 });
    expect(out.total?.values.netRes).toBe(10);
  });

  it('sin tabla: explica qué falta', () => {
    const out = extractSummary({ outputs: [], nodes: [{ moduleId: 'zone-summary', reason: 'new' as never, status: 'missing-input', computed: false, ms: 0 }] }, [], depth);
    expect(out.zones).toEqual([]);
    expect(out.missing).toMatch(/Faltan entradas/);
  });
});

describe('con el motor y el pozo de demostración', () => {
  const demo = syntheticWell();
  const w = toEngineWell(demo.well);
  const base = emptyInterpretation(demo.zones);
  const summaryOf = (i: typeof base) => extractSummary(computeOnce(registry, w, i), i.zones, demo.well.depth.values);

  it('un snapshot sin cambios respecto de la actual da Δ = 0 en todo', () => {
    const { project, snapshot: snap } = createSnapshot(addWell(createProject(), demo.well, demo.zones), demo.well.id, 'base');
    expect(snap.interpretation).not.toBe(project.wells[0]!.interpretation);
    const a = summaryOf(snap.interpretation);
    const b = summaryOf(project.wells[0]!.interpretation);
    expect(a.missing).toBeNull();
    expect(a.zones.length).toBe(demo.zones.length);
    const c = compareSummaries(a, b);
    expect(c.changed).toBe(0);
    for (const r of c.rows) for (const m of SUMMARY_METRICS) expect(r.cells[m.id].sign === 0 || r.cells[m.id].sign === null).toBe(true);
  });

  it('subir n de Archie en una zona cambia Sw solo ahí (y el total)', () => {
    const target = demo.zones.find((zz) => zz.kind === 'reservoir') ?? demo.zones[0]!;
    const changed = { ...base, params: { global: {}, zones: { [target.id]: { [PLOT_PARAMS.n.storage]: 2.6 } } } };
    const c = compareSummaries(summaryOf(base), summaryOf(changed));
    const row = c.rows.find((r) => r.key === target.id)!;
    expect(row.cells.sw.sign).toBe(1);
    for (const r of c.rows) if (!r.total && r.key !== target.id) expect(r.cells.sw.sign === 0 || r.cells.sw.sign === null).toBe(true);
    // La lista de diferencias de parámetros entre A y B nombra la zona y usa coma decimal.
    const lines = diffInterpretations(base, changed, registry).map((d) => describeDiff(d, { registry, zones: demo.zones }));
    expect(lines).toEqual([`Exponente de saturación (n) (${target.name}): 2 → 2,6`]);
  });
});
