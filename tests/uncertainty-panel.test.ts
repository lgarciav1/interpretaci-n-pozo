/**
 * Panel de incertidumbre (src/modules/uncertainty/model.ts y panel.tsx): lectura de las tablas del módulo en unidades
 * de campo, curva de excedencia, tornado, firma de dependencias (resultados desactualizados) y empalme con el módulo.
 */
import { describe, expect, it } from 'vitest';
import { Engine } from '../src/core/engine/engine';
import { emptyInterpretation } from '../src/core/interpretation';
import type { TableValue } from '../src/core/module';
import type { Zone } from '../src/core/well';
import { registry } from '../src/modules';
import {
  CALCULATE_KEY,
  dependencySignature,
  exceedanceFor,
  histogramFor,
  niceRange,
  paramValueText,
  statsOf,
  targetsOf,
  tornadoFor,
} from '../src/modules/uncertainty/model';
import { panel } from '../src/modules/uncertainty/panel';
import { curve, well, zone } from './helpers';

const N = 40;
const ZONES: Zone[] = [
  { ...zone('za', 1000, 1009.5), kind: 'reservoir' },
  { ...zone('zb', 1010, 1019.5), kind: 'reservoir' },
];
const WELL = well(
  [
    curve('VSH', 'VSH', Array.from({ length: N }, (_, i) => 0.1 + 0.005 * (i % 7))),
    curve('PHIE', 'PHIE', Array.from({ length: N }, (_, i) => 0.18 + 0.002 * (i % 5))),
    curve('SW', 'SW', Array.from({ length: N }, (_, i) => 0.3 + 0.01 * (i % 6))),
  ],
  N,
  1000,
  0.5,
);
const fmt = (v: number, d: number) => v.toFixed(d);

function tables(calculate: boolean) {
  const engine = new Engine(registry, { checkInputs: true });
  engine.setWell(WELL);
  const params = { global: { [CALCULATE_KEY]: calculate, area: 2, 'uncertainty.iterations': 1000 }, zones: { zb: { fluid: 'gas' } } };
  const r = engine.run({ ...emptyInterpretation(ZONES), params });
  const rows = (port: string) => (r.outputs.find((o) => o.key === `uncertainty:${port}`)!.value as TableValue).rows;
  return { summary: rows('UNCERTAINTY'), hist: rows('UNCERTAINTY_HIST'), cdf: rows('UNCERTAINTY_CDF'), tornado: rows('UNCERTAINTY_TORNADO') };
}

describe('panel de incertidumbre', () => {
  it('se engancha al módulo y la correlación entre zonas es «correlacionadas» por defecto', () => {
    expect(panel.moduleId).toBe('uncertainty');
    const m = registry.get('uncertainty')!;
    expect(m.params.zoneCorrelation!.default).toBe('full');
    expect(m.params.calculate!.default).toBe(false);
  });

  it('sin «Calcular» las tablas quedan vacías', () => {
    expect(tables(false).summary).toHaveLength(0);
  });

  it('destinos: zonas con fluido y totales por fluido, con su unidad de campo', () => {
    const t = targetsOf(tables(true).summary);
    expect(t.map((x) => x.key)).toEqual(['za', 'zb', 'TOTAL_OIL', 'TOTAL_GAS']);
    expect(t.find((x) => x.key === 'TOTAL_OIL')).toMatchObject({ label: 'Total petróleo', fieldUnit: 'MMbbl', total: true });
    expect(t.find((x) => x.key === 'zb')).toMatchObject({ fluid: 'gas', fieldUnit: 'Bcf', total: false });
  });

  it('percentiles en unidades de campo iguales a los del módulo, P90 ≤ P50 ≤ P10', () => {
    const { summary } = tables(true);
    for (const r of summary) {
      const s = statsOf(r);
      expect(s.p90).toBeCloseTo(r.p90Field as number, 9);
      expect(s.p50).toBeCloseTo(r.p50Field as number, 9);
      expect(s.det).toBeCloseTo(r.detField as number, 9);
      expect(s.p90).toBeLessThanOrEqual(s.p50);
      expect(s.p50).toBeLessThanOrEqual(s.p10);
    }
  });

  it('histograma (frecuencias suman 100 %) y excedencia: vale 90 % en P90 y 10 % en P10', () => {
    const t = tables(true);
    const row = t.summary.find((r) => r.key === 'za')!;
    const s = statsOf(row);
    const h = histogramFor(t.hist, 'za', s.unit);
    expect(h.edges.length).toBe(h.values.length + 1);
    expect(h.values.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6);
    const e = exceedanceFor(t.cdf, 'za', s.unit);
    expect(e.y[0]).toBeCloseTo(100, 9);
    expect(e.y.at(-1)).toBeCloseTo(0, 9);
    const at = (p: number) => e.x[e.y.findIndex((y) => Math.abs(y - p) < 1e-9)]!;
    expect(at(90)).toBeCloseTo(s.p90, 6);
    expect(at(10)).toBeCloseTo(s.p10, 6);
  });

  it('tornado ordenado por amplitud, centrado en el caso base, con los valores del parámetro', () => {
    const t = tables(true);
    const s = statsOf(t.summary.find((r) => r.key === 'TOTAL_OIL')!);
    const bars = tornadoFor(t.tornado, 'TOTAL_OIL', s.unit, fmt);
    expect(bars.length).toBeGreaterThan(0);
    for (let i = 1; i < bars.length; i++) expect(bars[i]!.swing).toBeLessThanOrEqual(bars[i - 1]!.swing + 1e-12);
    const area = bars.find((b) => b.param === 'area')!;
    expect(area.lowText).toBe('1.40 km²');
    expect(area.highText).toBe('2.60 km²');
    expect(Math.min(area.vLow, area.vHigh)).toBeLessThanOrEqual(area.base);
    expect(paramValueText('phiMult', 0.9, fmt)).toBe('×0.90');
    expect(paramValueText('b', NaN, fmt)).toBe('por zona');
  });

  it('firma: cambia con cualquier parámetro o zona, no con el interruptor de cálculo', () => {
    const base = emptyInterpretation(ZONES);
    const sig = dependencySignature(base);
    expect(dependencySignature({ ...base, params: { global: { [CALCULATE_KEY]: true }, zones: {} } })).toBe(sig);
    expect(dependencySignature({ ...base, params: { global: { swCutoff: 0.55 }, zones: {} } })).not.toBe(sig);
    expect(dependencySignature({ ...base, params: { global: {}, zones: { za: { 'uncertainty.areaLow': 0.5 } } } })).not.toBe(sig);
    expect(dependencySignature({ ...base, zones: [ZONES[0]!] })).not.toBe(sig);
    // El orden de las claves no importa.
    const a = { ...base, params: { global: { a: 1, b: 2 }, zones: {} } };
    const b = { ...base, params: { global: { b: 2, a: 1 }, zones: {} } };
    expect(dependencySignature(a)).toBe(dependencySignature(b));
  });

  it('rango de ejes: contiene los valores y no baja de cero con volúmenes positivos', () => {
    const r = niceRange([3.2, 7.9, 5])!;
    expect(r.min).toBeGreaterThanOrEqual(0);
    expect(r.min).toBeLessThanOrEqual(3.2);
    expect(r.max).toBeGreaterThanOrEqual(7.9);
    expect(niceRange([NaN])).toBeNull();
  });
});
