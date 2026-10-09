/**
 * Series para tendencias (proveedor `curve` y registro) y ajuste sobre la serie (`evaluateTrend`):
 * docs/decisiones/0008, D3–D4.
 */
import { describe, expect, it } from 'vitest';
import { emptyInterpretation } from '../../src/core/interpretation';
import { defaultRoleCatalog } from '../../src/core/roles';
import type { TrendSpec } from '../../src/core/trends';
import { createWell, type Curve } from '../../src/core/well';
import { fitTrend } from '../../src/petro/regression';
import { evaluateTrend, excludedIndices } from '../../src/plots/trend/compute';
import { formatGradientValue, trendCanvasLabel, trendTooltip } from '../../src/plots/trend/format';
import { createSeriesRegistry, curveSeriesKey, curveSeriesProvider, depthPointKey, type SeriesContext, type TrendSeriesProvider } from '../../src/plots/trend/series';

const n = 2001;
const depth = Float64Array.from({ length: n }, (_, i) => 2000 + i * 0.1524);
const c = (id: string, role: string | null, unit: string, f: (d: number, i: number) => number): Curve => ({
  id,
  mnemonic: id,
  role,
  unit,
  data: Float64Array.from(depth, f),
  origin: { kind: 'measured' },
});
// DT con compactación exponencial exacta; RHOB en kg/m³ (se convierte a g/cm³); una bandera.
const dt = c('DT', 'DT', 'us/ft', (d) => 160 * Math.exp(-1.2e-4 * d));
const rhob = c('ZDEN', 'RHOB', 'kg/m3', (d) => 2000 + 0.2 * (d - 2000));
const flag = c('FLAG', 'NET_RES', 'unitless', () => 1);
const well = createWell({ id: 'w', name: 'W', depth, curves: [dt, rhob, flag] });
const temp = Float64Array.from(depth, (d) => 15 + 0.03 * d); // 3 °C/100 m
const ctx: SeriesContext = {
  well,
  interpretation: emptyInterpretation(),
  computed: [
    { port: 'TEMP', moduleId: 'temp-gradient', label: 'T', data: temp, active: true },
    { port: 'PHIE', moduleId: 'phie-alt', label: 'alt', data: new Float64Array(n), active: false },
  ],
  catalog: defaultRoleCatalog,
};

const spec = (over: Partial<TrendSpec> = {}): TrendSpec => ({
  id: 't',
  name: 'T',
  visible: true,
  series: { provider: 'curve', key: 'm:DT' },
  model: 'linear',
  mode: 'fit',
  selection: { top: 2050, base: 2200, excluded: [] },
  extend: false,
  ...over,
});

describe('proveedor de curvas', () => {
  it('lista medidas (sin banderas) y calculadas activas', () => {
    const list = curveSeriesProvider.list(ctx);
    expect(list.map((o) => o.key)).toEqual(['m:DT', 'm:ZDEN', 'r:TEMP']);
    expect(list.find((o) => o.key === 'm:ZDEN')!.unit).toBe('g/cm³');
  });

  it('resuelve en la unidad canónica, con x = profundidad e identidad estable', () => {
    const s = curveSeriesProvider.resolve(ctx, 'm:ZDEN')!;
    expect(s.xIsDepth).toBe(true);
    expect(s.x).toBe(depth);
    expect(s.yUnit).toBe('g/cm3');
    expect(s.y[0]).toBeCloseTo(2.0, 12);
    expect(s.placement).toEqual({ roleOrKey: 'm:ZDEN' });
    expect(curveSeriesProvider.resolve(ctx, 'm:ZDEN')).toBe(s);
    const t = curveSeriesProvider.resolve(ctx, 'r:TEMP')!;
    expect(t.y).toBe(temp);
    expect(t.yUnit).toBe('degC');
    expect(t.placement).toEqual({ roleOrKey: 'TEMP' });
    // Rol sin calculada: la medida con ese rol.
    expect(curveSeriesProvider.resolve(ctx, 'r:DT')!.y).toBe(dt.data);
    expect(curveSeriesProvider.resolve(ctx, 'm:NADA')).toBeNull();
    expect(curveSeriesProvider.resolve(ctx, 'r:PHIE')).toBeNull(); // solo alternativa
    expect(curveSeriesProvider.resolve(ctx, 'raro')).toBeNull();
  });

  it('clave de punto estable (profundidad redondeada) e índice de una clave', () => {
    const s = curveSeriesProvider.resolve(ctx, 'm:DT')!;
    for (const i of [0, 7, 1234, n - 1]) expect(s.indexOfKey!(s.pointKey(i))).toBe(i);
    expect(s.pointKey(1)).toBe(depthPointKey(2000.1524));
    expect(s.indexOfKey!('1999')).toBe(-1);
    expect(s.indexOfKey!('abc')).toBe(-1);
  });

  it('clave de serie de una curva del visor', () => {
    expect(curveSeriesKey({ origin: 'measured', curveId: 'DT', role: 'DT' })).toBe('m:DT');
    expect(curveSeriesKey({ origin: 'computed', role: 'PHIE' })).toBe('r:PHIE');
  });

  it('registro: proveedores de módulos, repetidos e inválidos se ignoran, errores aislados', () => {
    const warns: string[] = [];
    const mdt: TrendSeriesProvider = {
      id: 'mdt',
      label: 'MDT',
      list: () => [{ key: 'all', label: 'Presiones' }],
      resolve: () => {
        throw new Error('roto');
      },
    };
    const reg = createSeriesRegistry([curveSeriesProvider, mdt, { ...mdt, label: 'otro' }, {} as TrendSeriesProvider], (m) => warns.push(m));
    expect(reg.providers.map((p) => p.id)).toEqual(['curve', 'mdt']);
    expect(warns).toHaveLength(2);
    expect(reg.list(ctx).at(-1)).toMatchObject({ ref: { provider: 'mdt', key: 'all' } });
    expect(reg.resolve(ctx, { provider: 'mdt', key: 'all' })).toBeNull();
    expect(reg.resolve(ctx, { provider: 'nada', key: 'x' })).toBeNull();
  });
});

describe('ajuste de una tendencia sobre su serie', () => {
  const s = curveSeriesProvider.resolve(ctx, 'm:DT')!;

  it('el tramo se busca por bisección: igual que ajustar los índices a mano', () => {
    const r = evaluateTrend(spec(), s, []);
    const i0 = depth.findIndex((d) => d >= 2050);
    const i1 = depth.findIndex((d) => d > 2200);
    const ref = fitTrend(depth, dt.data, 'linear', { start: i0, end: i1 });
    expect(r.fit).toEqual(ref);
    expect(r.n).toBe(i1 - i0);
    expect(r.span).toEqual([2050, 2200]);
  });

  it('exponencial recupera la compactación y da la pendiente en el centro del tramo, en µs/ft por m', () => {
    const r = evaluateTrend(spec({ model: 'exp' }), s, []);
    expect(r.coeffs!.a).toBeCloseTo(160, 6);
    expect(r.coeffs!.b).toBeCloseTo(-1.2e-4, 12);
    expect(r.r2).toBeCloseTo(1, 12);
    expect(r.slope!.local).toBe(true);
    expect(r.slope!.at).toBeCloseTo(2125, 9);
    const expected = 160 * -1.2e-4 * Math.exp(-1.2e-4 * 2125);
    expect(r.slope!.value).toBeCloseTo(expected, 12);
    const g = r.gradients.find((x) => x.primary)!;
    expect(g.unit).toBe('µs/ft por m');
    expect(g.value).toBeCloseTo(expected, 12);
    expect(trendCanvasLabel(spec({ model: 'exp' }), r, s)[1]).toMatch(/\(centro\)$/);
  });

  it('temperatura lineal: 3 °C/100 m', () => {
    const t = curveSeriesProvider.resolve(ctx, 'r:TEMP')!;
    const r = evaluateTrend(spec({ series: { provider: 'curve', key: 'r:TEMP' } }), t, []);
    expect(r.slope).toMatchObject({ local: false });
    expect(r.gradients[0]).toMatchObject({ unit: '°C/100 m', primary: true });
    expect(r.gradients[0]!.value).toBeCloseTo(3, 10);
    expect(trendTooltip(spec(), r, t)).toMatch(/Gradiente: 3 °C\/100 m/);
  });

  it('puntos excluidos por clave: no entran al ajuste y se cuentan dentro del tramo', () => {
    const i0 = depth.findIndex((d) => d >= 2050);
    const keys = [s.pointKey(i0 + 3), s.pointKey(i0 + 10), s.pointKey(5) /* fuera del tramo */, 'no-existe'];
    const r = evaluateTrend(spec({ selection: { top: 2050, base: 2200, excluded: keys } }), s, []);
    const r0 = evaluateTrend(spec(), s, []);
    expect(r.n).toBe(r0.n - 2);
    expect(r.excluded).toBe(2);
    // Caché por identidad de la lista de claves.
    expect(excludedIndices(keys, s)).toBe(excludedIndices(keys, s));
  });

  it('el tramo sigue a la zona', () => {
    const zones = [{ id: 'z', top: 2100, base: 2150 }];
    const r = evaluateTrend(spec({ selection: { zoneId: 'z', top: 0, base: 1, excluded: [] } }), s, zones);
    expect(r.span).toEqual([2100, 2150]);
    expect(r.range).toEqual({ top: 2100, base: 2150 });
  });

  it('a mano: dos puntos, R² no aplica, n cuenta las muestras entre los puntos', () => {
    const r = evaluateTrend(spec({ mode: 'manual', manual: [{ x: 2100, y: 100 }, { x: 2200, y: 90 }], selection: { top: 2100, base: 2200, excluded: [] } }), s, []);
    expect(r.r2).toBeNull();
    expect(r.coeffs).toMatchObject({ model: 'linear', b: expect.closeTo(-0.1, 12) });
    expect(r.gradients[0]!.value).toBeCloseTo(-0.1, 12);
    expect(r.n).toBeGreaterThan(600);
    const bad = evaluateTrend(spec({ mode: 'manual', manual: [{ x: 2100, y: 100 }, { x: 2100, y: 100 }] }), s, []);
    expect(bad.coeffs).toBeNull();
    expect(bad.problem).toMatch(/dos puntos/);
  });

  it('sin datos suficientes: problema explicado; la vista previa no usa la caché', () => {
    const sp = spec({ selection: { top: 2050, base: 2050.1, excluded: [] } });
    const zones: { id: string; top: number; base: number }[] = [];
    const r1 = evaluateTrend(sp, s, zones);
    expect(r1.problem).toMatch(/dos puntos/);
    expect(evaluateTrend(sp, s, zones)).toBe(r1); // caché por identidad de spec, serie y zonas
    expect(evaluateTrend(sp, s, [])).not.toBe(r1);
    const pv = evaluateTrend(sp, s, zones, { selection: { top: 2050, base: 2100, excluded: [] } });
    expect(pv).not.toBe(r1);
    expect(pv.coeffs).not.toBeNull();
  });

  it('formato de gradientes con signo menos tipográfico', () => {
    expect(formatGradientValue(-0.003452)).toBe('−0,00345');
    expect(formatGradientValue(3)).toBe('3');
    expect(formatGradientValue(NaN)).toBe('—');
  });
});
