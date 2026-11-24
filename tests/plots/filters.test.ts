/**
 * Filtros genéricos de muestras para gráficos del dock (histograma, crossplot, distribuciones por zona):
 * evaluación pura, operadores, banderas, saneamiento, codificación para tendencias y traducción entre pozos.
 */
import { describe, expect, it } from 'vitest';
import { emptyInterpretation } from '../../src/core/interpretation';
import { sanitizeCrossplot, sanitizeDistribution, sanitizeHistogram, type PlotFilterRule } from '../../src/core/plots';
import { createWell } from '../../src/core/well';
import { registry } from '../../src/modules';
import {
  availableFilterPresets,
  decodePlotFilters,
  defaultFilterRule,
  encodePlotFilters,
  evaluatePlotFilters,
  filterCurveOptions,
  formatFilterRule,
  isFlagCurve,
  matchesFilterRule,
  newFilterId,
  translatePlotFilters,
} from '../../src/plots/filters';
import type { SeriesContext } from '../../src/plots/trend/series';

const catalog = registry.catalog;

function makeCtx(): SeriesContext {
  const depth = Float64Array.from([1000, 1001, 1002, 1003, 1004, 1005]);
  const well = createWell({
    id: 'w1',
    name: 'Pozo 1',
    depth,
    curves: [
      { id: 'gr', mnemonic: 'GR', unit: 'gAPI', role: 'GR', data: Float64Array.from([25, 40, 75, 95, 30, NaN]), origin: { kind: 'measured' } },
      { id: 'nphi', mnemonic: 'NPHI', unit: 'v/v', role: 'NPHI', data: Float64Array.from([0.22, 0.18, 0.12, 0.08, 0.25, 0.2]), origin: { kind: 'measured' } },
      { id: 'rhob', mnemonic: 'RHOB', unit: 'g/cm3', role: 'RHOB', data: Float64Array.from([2.25, 2.35, 2.48, 2.58, 2.22, 2.3]), origin: { kind: 'measured' } },
    ],
  });
  const interpretation = emptyInterpretation();
  const computed = [
    { port: 'VSH', moduleId: 'vsh-linear', label: 'VSH', active: true, unit: 'v/v' as const, data: Float64Array.from([0.1, 0.25, 0.55, 0.8, 0.15, 0.2]) },
    { port: 'PHIE', moduleId: 'phi-e', label: 'PHIE', active: true, unit: 'v/v' as const, data: Float64Array.from([0.2, 0.15, 0.07, 0.03, 0.22, 0.18]) },
    { port: 'NET_RES', moduleId: 'cutoffs', label: 'NET_RES', active: true, unit: 'unitless' as const, data: Float64Array.from([1, 1, 0, 0, 1, 1]) },
    { port: 'NET_PAY', moduleId: 'cutoffs', label: 'NET_PAY', active: true, unit: 'unitless' as const, data: Float64Array.from([1, 0, 0, 0, 1, 0]) },
    { port: 'IND_WASHOUT', moduleId: 'washout', label: 'IND_WASHOUT', active: true, unit: 'unitless' as const, data: Float64Array.from([0, 0, 1, 0, 0, 1]) },
  ];
  return { well, interpretation, computed, catalog };
}

describe('matchesFilterRule', () => {
  it('evalúa todos los operadores y rechaza NaN/no finitos', () => {
    expect(matchesFilterRule(0.3, { op: 'le', value: 0.3 })).toBe(true);
    expect(matchesFilterRule(0.31, { op: 'le', value: 0.3 })).toBe(false);
    expect(matchesFilterRule(0.3, { op: 'lt', value: 0.3 })).toBe(false);
    expect(matchesFilterRule(0.29, { op: 'lt', value: 0.3 })).toBe(true);
    expect(matchesFilterRule(0.1, { op: 'ge', value: 0.1 })).toBe(true);
    expect(matchesFilterRule(0.09, { op: 'ge', value: 0.1 })).toBe(false);
    expect(matchesFilterRule(0.1, { op: 'gt', value: 0.1 })).toBe(false);
    expect(matchesFilterRule(0.11, { op: 'gt', value: 0.1 })).toBe(true);
    expect(matchesFilterRule(50, { op: 'between', value: 20, max: 80 })).toBe(true);
    expect(matchesFilterRule(20, { op: 'between', value: 80, max: 20 })).toBe(true);
    expect(matchesFilterRule(81, { op: 'between', value: 20, max: 80 })).toBe(false);
    expect(matchesFilterRule(1, { op: 'eq', value: 1 })).toBe(true);
    expect(matchesFilterRule(0, { op: 'eq', value: 1 })).toBe(false);
    expect(matchesFilterRule(0, { op: 'neq', value: 1 })).toBe(true);
    expect(matchesFilterRule(NaN, { op: 'le', value: 100 })).toBe(false);
    expect(matchesFilterRule(Infinity, { op: 'ge', value: 0 })).toBe(false);
  });
});

describe('opciones y reglas por defecto', () => {
  it('incluye banderas y curvas continuas en filterCurveOptions', () => {
    const ctx = makeCtx();
    const opts = filterCurveOptions(ctx);
    expect(opts.some((o) => o.value === 'r:NET_PAY' && o.group === 'Banderas')).toBe(true);
    expect(opts.some((o) => o.value === 'r:IND_WASHOUT' && o.group === 'Banderas')).toBe(true);
    expect(opts.some((o) => o.value === 'r:VSH')).toBe(true);
    expect(opts.some((o) => o.value === 'm:gr')).toBe(true);
    expect(isFlagCurve(ctx, 'r:NET_PAY')).toBe(true);
    expect(isFlagCurve(ctx, 'r:VSH')).toBe(false);
  });

  it('elige valores y operadores iniciales acordes al tipo de curva', () => {
    const ctx = makeCtx();
    expect(defaultFilterRule(ctx, 'r:NET_PAY', 'f1')).toEqual({ id: 'f1', curve: 'r:NET_PAY', op: 'eq', value: 1, enabled: true });
    expect(defaultFilterRule(ctx, 'r:IND_WASHOUT', 'f2')).toEqual({ id: 'f2', curve: 'r:IND_WASHOUT', op: 'eq', value: 0, enabled: true });
    const vshRule = defaultFilterRule(ctx, 'r:VSH', 'f3');
    expect(vshRule.op).toBe('le');
    expect(vshRule.value).toBeGreaterThan(0);
    const phiRule = defaultFilterRule(ctx, 'r:PHIE', 'f4');
    expect(phiRule.op).toBe('ge');
    expect(phiRule.value).toBeGreaterThan(0);
    const grRule = defaultFilterRule(ctx, 'm:gr', 'f5');
    expect(grRule.op).toBe('le');
    expect(grRule.value).toBe(40);
    expect(newFilterId([vshRule, phiRule])).toBe('f3');
    expect(availableFilterPresets(ctx).map((p) => p.id)).toEqual(['netPay', 'netRes', 'noWashout']);
  });
});

describe('evaluatePlotFilters', () => {
  it('filtra GR por VSH y combina varias reglas por intersección (AND)', () => {
    const ctx = makeCtx();
    const rules: PlotFilterRule[] = [
      { id: 'f1', curve: 'r:VSH', op: 'le', value: 0.3, enabled: true },
      { id: 'f2', curve: 'r:NET_PAY', op: 'eq', value: 1, enabled: true },
    ];
    const res = evaluatePlotFilters(ctx, rules);
    expect(res.activeCount).toBe(2);
    expect(res.baseTotal).toBe(6);
    expect(res.passed).toBe(2); // índices 0 y 4
    expect([0, 1, 2, 3, 4, 5].map((i) => res.include(i))).toEqual([true, false, false, false, true, false]);
    expect(res.summary).toContain('VSH');
    expect(res.summary).toContain('Pay neto = Sí');
  });

  it('permite filtrar por NO pay neto (NET_PAY = 0) y respeta reglas apagadas', () => {
    const ctx = makeCtx();
    const rules: PlotFilterRule[] = [
      { id: 'f1', curve: 'r:NET_PAY', op: 'eq', value: 0, enabled: true },
      { id: 'f2', curve: 'r:PHIE', op: 'ge', value: 0.9, enabled: false },
    ];
    const res = evaluatePlotFilters(ctx, rules);
    expect(res.activeCount).toBe(1);
    expect(res.passed).toBe(4); // índices 1, 2, 3, 5
    expect(formatFilterRule(rules[0]!, null, true)).toBe('Pay neto = No');
  });

  it('omite reglas cuya curva no existe sin vaciar el gráfico y combina con baseInclude', () => {
    const ctx = makeCtx();
    const rules: PlotFilterRule[] = [
      { id: 'f1', curve: 'r:SW', op: 'le', value: 0.5, enabled: true },
      { id: 'f2', curve: 'r:PHIE', op: 'ge', value: 0.15, enabled: true },
    ];
    const res = evaluatePlotFilters(ctx, rules, (i) => i < 4);
    expect(res.skippedCount).toBe(1);
    expect(res.activeCount).toBe(1);
    expect(res.rules[0]!.status).toBe('missing');
    expect(res.baseTotal).toBe(4);
    expect(res.passed).toBe(2); // índices 0 y 1
  });
});

describe('saneamiento, codificación y traducción', () => {
  it('sanea filtros en histograma, crossplot y distribuciones', () => {
    const raw = [
      { id: 'a', curve: 'r:VSH', op: 'le', value: 0.35, enabled: true },
      { id: 'b', curve: 'm:gr', op: 'between', value: 80, max: 20, enabled: false },
      { id: 'a', curve: 'r:PHIE', op: 'ge', value: 0.1, enabled: true }, // id repetido
      { id: 'c', curve: 'invalida', op: 'le', value: 1, enabled: true },
      { id: 'd', curve: 'r:PHIE', op: 'between', value: 0.1, enabled: true }, // falta max
    ];
    const expected: PlotFilterRule[] = [
      { id: 'a', curve: 'r:VSH', op: 'le', value: 0.35, enabled: true },
      { id: 'b', curve: 'm:gr', op: 'between', value: 20, max: 80, enabled: false },
    ];
    expect(sanitizeHistogram({ filters: raw }).filters).toEqual(expected);
    expect(sanitizeCrossplot({ filters: raw }).filters).toEqual(expected);
    expect(sanitizeDistribution({ filters: raw }).filters).toEqual(expected);
    expect('filters' in sanitizeHistogram({ filters: [] })).toBe(false);
  });

  it('codifica y decodifica reglas activas para claves de tendencia', () => {
    const rules: PlotFilterRule[] = [
      { id: 'f1', curve: 'r:PHIE', op: 'ge', value: 0.1, enabled: true },
      { id: 'f2', curve: 'm:gr', op: 'between', value: 20, max: 60, enabled: true },
      { id: 'f3', curve: 'r:VSH', op: 'le', value: 0.4, enabled: false },
    ];
    const encoded = encodePlotFilters(rules);
    expect(encoded).not.toContain('|');
    const decoded = decodePlotFilters(encoded);
    expect(decoded).toHaveLength(2);
    expect(decoded.map((r) => ({ curve: r.curve, op: r.op, value: r.value, max: r.max }))).toEqual([
      { curve: 'm:gr', op: 'between', value: 20, max: 60 },
      { curve: 'r:PHIE', op: 'ge', value: 0.1, max: undefined },
    ]);
  });

  it('traduce curvas medidas al comparar otro pozo', () => {
    const ctx1 = makeCtx();
    const well2 = createWell({
      id: 'w2',
      name: 'Pozo 2',
      depth: Float64Array.from([2000, 2001]),
      curves: [{ id: 'gr_otro', mnemonic: 'GR_CORR', unit: 'gAPI', role: 'GR', data: Float64Array.from([30, 50]), origin: { kind: 'measured' } }],
    });
    const rules: PlotFilterRule[] = [
      { id: 'f1', curve: 'm:gr', op: 'le', value: 50, enabled: true },
      { id: 'f2', curve: 'r:VSH', op: 'le', value: 0.3, enabled: true },
    ];
    const translated = translatePlotFilters(ctx1, rules, { well: well2 });
    expect(translated?.[0]?.curve).toBe('m:gr_otro');
    expect(translated?.[1]?.curve).toBe('r:VSH');
  });
});
