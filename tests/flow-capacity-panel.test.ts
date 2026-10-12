/**
 * Panel de capacidad de flujo (src/modules/flow-capacity/model.ts y panel.tsx): lectura de las tablas del módulo,
 * tramos por zona y del total, series de Lorenz decimadas y empalme del panel con el módulo.
 */
import { describe, expect, it } from 'vitest';
import { Engine } from '../src/core/engine/engine';
import { emptyInterpretation } from '../src/core/interpretation';
import type { TableValue } from '../src/core/module';
import type { Zone } from '../src/core/well';
import { TOTAL_KEY, decimateIndices, lorenzSeries, unitsFor, viewRangeFor } from '../src/modules/flow-capacity/model';
import { panel } from '../src/modules/flow-capacity/panel';
import { registry } from '../src/modules';
import { curve, well, zone } from './helpers';

const ZONES: Zone[] = [
  { ...zone('za', 1000, 1003), kind: 'reservoir' },
  { ...zone('zb', 1004, 1007), kind: 'seal' },
  { ...zone('zc', 1008, 1011), kind: 'formation' },
];
const PHI = [0.2, 0.5, 0.1, 0.2, 0.3, 0.3, 0.3, 0.3, 0.1, 0.1, 0.1, 0.1];
const PERM = [2, 250, 10, 38, 7, 7, 7, 7, 5, 5, NaN, 5];
const WELL = well([curve('PHIE', 'PHIE', PHI), curve('PERM', 'PERM', PERM)], 12, 1000, 1);

function tables(zones: Zone[]) {
  const engine = new Engine(registry, { checkInputs: true });
  engine.setWell(WELL);
  const r = engine.run({ ...emptyInterpretation(zones), compare: ['flow-capacity'], params: { global: { filter: 'all' }, zones: {} } });
  const rows = (port: string) => (r.outputs.find((o) => o.key === `flow-capacity:${port}`)!.value as TableValue).rows;
  return { units: rows('FLOW_UNITS'), lorenz: rows('FLOW_LORENZ'), summary: rows('FLOW_SUMMARY') };
}

describe('panel de capacidad de flujo', () => {
  it('se engancha al módulo', () => {
    expect(panel.moduleId).toBe('flow-capacity');
    expect(registry.get('flow-capacity')).toBeDefined();
  });

  it('tramos de una zona: los porcentajes del motor, en orden de profundidad', () => {
    const t = tables(ZONES);
    const za = unitsFor(t.units, 'za');
    expect(za.map((u) => u.top)).toEqual([...za.map((u) => u.top)].sort((a, b) => a - b));
    expect(za.at(-1)!.cumPhiHPct).toBeCloseTo(100, 9);
    expect(za.at(-1)!.cumKHPct).toBeCloseTo(100, 9);
  });

  it('tramos del total: todas las zonas calculadas, con porcentajes del total que coinciden con el Lorenz total', () => {
    const t = tables(ZONES);
    const all = unitsFor(t.units, TOTAL_KEY);
    expect(all.length).toBe(t.units.length);
    expect(all.reduce((s, u) => s + u.phiHPct, 0)).toBeCloseTo(100, 9);
    const strat = lorenzSeries(t.lorenz, TOTAL_KEY, 'strat');
    expect(strat.n).toBe(all.length + 1);
    all.forEach((u, i) => {
      expect(strat.x[i + 1]).toBeCloseTo(u.cumPhiHPct, 9);
      expect(strat.y[i + 1]).toBeCloseTo(u.cumKHPct, 9);
    });
  });

  it('sin zonas: una sola fila «Pozo completo» y sus tramos', () => {
    const t = tables([]);
    expect(t.summary).toHaveLength(1);
    const all = unitsFor(t.units, TOTAL_KEY);
    expect(all.length).toBe(t.units.length);
    expect(all.at(-1)!.cumKHPct).toBeCloseTo(100, 9);
    expect(lorenzSeries(t.lorenz, TOTAL_KEY, 'ordered').n).toBeGreaterThan(1);
  });

  it('decimación: a lo sumo max puntos, con extremos y monótona', () => {
    expect(decimateIndices(5, 1000)).toEqual([0, 1, 2, 3, 4]);
    const d = decimateIndices(5811, 1000);
    expect(d.length).toBeLessThanOrEqual(1000);
    expect(d[0]).toBe(0);
    expect(d.at(-1)).toBe(5810);
    for (let i = 1; i < d.length; i++) expect(d[i]!).toBeGreaterThan(d[i - 1]!);
  });

  it('ir al tramo: centrado y con contexto mínimo', () => {
    const r = viewRangeFor(1000, 1000.15);
    expect(r.base - r.top).toBeCloseTo(20, 9);
    expect((r.top + r.base) / 2).toBeCloseTo(1000.075, 9);
  });
});
