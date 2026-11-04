/**
 * Distribuciones por zona (src/plots/distribution/, docs/decisiones/0066): filas en orden de profundidad, celdas por
 * zona y serie (zonas emparejadas por id o por nombre, banderas faltantes), calidad por zona (derrumbe y sin dato),
 * eje compartido, textos con coma decimal, CSV de estadísticas y de topes, opciones de propiedad y traducción de
 * claves entre pozos. Valores verificados con cuentas a mano (pesos iguales: Hazen).
 */
import { describe, expect, it } from 'vitest';
import { emptyInterpretation } from '../../src/core/interpretation';
import { defaultRoleCatalog } from '../../src/core/roles';
import { createWell, type Zone } from '../../src/core/well';
import { buildCells, cellQuality, hasBox, cellTooltip, distributionAxis, propertyStat, shownRows, statsCsv, topsCsv, zoneKey, zoneNotes, zoneRows, type SeriesData } from '../../src/plots/distribution/distribution';
import { laneAt, rowHeight } from '../../src/plots/distribution/draw';
import { defaultProperty, propertyOptions, seriesFromContext, thicknessOf, translateKey, usesOnlyDefaults } from '../../src/plots/distribution/series';
import type { SeriesContext } from '../../src/plots/trend/series';

const n = 20;
const depth = Float64Array.from({ length: n }, (_, i) => i);
// Definidas fuera de orden: las filas salen por tope.
const zones: Zone[] = [
  { id: 'zb', name: 'B', top: 10, base: 19, color: '#00aa00', kind: 'reservoir' },
  { id: 'za', name: 'A', top: 0, base: 9.5, color: '#aa0000', kind: 'formation' },
];
const phi = Float64Array.from({ length: n }, (_, i) => (i === 9 ? NaN : i / 100));
const washout = Float64Array.from({ length: n }, (_, i) => (i < 2 ? 1 : 0));
const ones = new Float64Array(n).fill(1);

const series = (over: Partial<SeriesData> = {}): SeriesData => ({ id: '#current', label: 'Actual', kind: 'current', depth, zones, values: phi, thickness: ones, washout, phi, ...over });
const SETTINGS = { filter: 'all' as const, excludeWashout: true, mean: 'thickness' as const };

describe('filas', () => {
  it('zonas en orden de tope con sus tramos de muestras', () => {
    const rows = zoneRows(depth, zones);
    expect(rows.map((r) => r.name)).toEqual(['A', 'B']);
    expect(rows[0]!.ranges).toEqual([{ start: 0, end: 10 }]);
    expect(rows[1]!.ranges).toEqual([{ start: 10, end: 20 }]);
  });
  it('ocultas y solo reservorio', () => {
    const rows = zoneRows(depth, zones);
    expect(shownRows(rows, { reservoirOnly: false, hidden: ['za'] }).map((r) => r.id)).toEqual(['zb']);
    expect(shownRows(rows, { reservoirOnly: true, hidden: [] }).map((r) => r.id)).toEqual(['zb']);
  });
  it('emparejar por nombre ignora mayúsculas, acentos y espacios', () => {
    expect(zoneKey('  Formación   Sur ')).toBe(zoneKey('formacion sur'));
  });
});

describe('celdas', () => {
  const rows = zoneRows(depth, zones);
  it('excluye derrumbe y separa lo sin dato (zona A)', () => {
    const [[a]] = buildCells(rows, [series()], SETTINGS);
    // Muestras 0 y 1 con derrumbe (2 m), 9 sin dato (1 m), usadas 2…8 → n = 7, media 0,05.
    expect(a!.stats!.n).toBe(7);
    expect(a!.stats!.excludedWashout).toBe(2);
    expect(a!.stats!.noData).toBe(1);
    expect(a!.stats!.mean).toBeCloseTo(0.05, 12);
    expect(a!.filtered).toBe(10);
    const q = cellQuality(a!);
    expect(q.washout).toBeCloseTo(0.2, 12);
    expect(q.noData).toBeCloseTo(0.1, 12);
  });
  it('sin excluir derrumbe: P10 de Hazen con pesos iguales', () => {
    const [[a]] = buildCells(rows, [series()], { ...SETTINGS, excludeWashout: false });
    // 9 valores 0…0,08: c₁ = 0,5/9 ≈ 0,0556, c₂ ≈ 0,1667 → P10 = 0 + (0,1 − 0,0556)/(0,1111)·0,01 = 0,004.
    expect(a!.stats!.p10).toBeCloseTo(0.004, 12);
    expect(a!.stats!.p50).toBeCloseTo(0.04, 12);
  });
  it('zona ausente, curva ausente y banderas ausentes no tiran: dicen por qué', () => {
    const other = series({ id: 'well:x', kind: 'well', zones: [{ ...zones[0]!, id: 'otra', name: ' b ' }] });
    const cells = buildCells(rows, [series({ values: null }), other], SETTINGS);
    expect(cells[0]![0]!.missing).toBe('curve');
    expect(cells[0]![1]!.missing).toBe('zone');
    // B del otro pozo se empareja por nombre.
    expect(cells[1]![1]!.stats!.n).toBe(10);
    const flags = buildCells(rows, [series()], { ...SETTINGS, filter: 'netRes' });
    expect(flags[0]![0]!.missing).toBe('flags');
    const pv = buildCells(rows, [series({ phi: undefined })], { ...SETTINGS, mean: 'poreVolume' });
    expect(pv[0]![0]!.missing).toBe('phi');
  });
  it('Sw por volumen poral en una zona con φ = 0 (lutita): n > 0 pero sin caja, se lee «sin dato»', () => {
    const phiZeroA = Float64Array.from({ length: n }, (_, i) => (i < 10 ? 0 : 0.2));
    const sw = new Float64Array(n).fill(1);
    const [[a], [b]] = buildCells(rows, [series({ values: sw, phi: phiZeroA })], { ...SETTINGS, excludeWashout: false, mean: 'poreVolume' });
    expect(a!.stats!.n).toBe(10);
    expect(a!.stats!.p50).toBeNaN();
    expect(hasBox(a!)).toBe(false);
    expect(hasBox(b!)).toBe(true);
  });
  it('un snapshot del mismo pozo se empareja por id aunque cambie el nombre', () => {
    const snap = series({ id: 'snap-1', kind: 'snapshot', zones: zones.map((z) => ({ ...z, name: `${z.name}2` })) });
    expect(buildCells(rows, [snap], SETTINGS)[1]![0]!.stats!.n).toBe(10);
  });
  it('avisos de la zona: n, % derrumbe y % sin dato con coma decimal', () => {
    const [[a]] = buildCells(rows, [series()], SETTINGS);
    expect(zoneNotes(a)).toEqual([
      { text: 'n 7 · 7,0 m', tone: 'muted' },
      { text: '20 % derrumbe (excluido)', tone: 'warn' },
      { text: '10 % sin dato', tone: 'muted' },
    ]);
    const tip = cellTooltip('A', 'Actual', a!, 'thickness', 'v/v');
    expect(tip[0]).toBe('A · Actual');
    expect(tip).toContain('Media (por espesor) 0,05 v/v');
    expect(tip.at(-1)).toBe('20 % excluido por derrumbe · 10 % sin dato');
    // Sin excluir, el derrumbe se sigue informando (incluido en la estadística).
    const [[b]] = buildCells(rows, [series()], { ...SETTINGS, excludeWashout: false });
    expect(zoneNotes(b)[1]).toEqual({ text: '20 % derrumbe', tone: 'warn' });
    expect(cellTooltip('A', 'Actual', b!, 'thickness', 'v/v').at(-1)).toBe('20 % en derrumbe (incluido) · 10 % sin dato');
  });
});

describe('eje', () => {
  const rows = zoneRows(depth, zones);
  it('lineal: contiene P10–P90 y no baja de 0 si todo es ≥ 0', () => {
    const ax = distributionAxis(buildCells(rows, [series()], SETTINGS), 'linear', 'PHIE', 'v/v')!;
    expect(ax.kind).toBe('linear');
    expect(ax.min).toBe(0);
    expect(ax.max).toBeGreaterThanOrEqual(0.19);
    expect(ax.unit).toBe('v/v');
  });
  it('log: décadas enteras', () => {
    const k = Float64Array.from({ length: n }, (_, i) => 0.5 * 1.4 ** i);
    const cells = buildCells(rows, [series({ values: k })], { ...SETTINGS, mean: 'geometric' });
    const ax = distributionAxis(cells, 'log', 'PERM', 'mD')!;
    expect(ax.min).toBe(1);
    expect(ax.max).toBe(1000);
  });
  it('sin cajas → null', () => {
    expect(distributionAxis(buildCells(rows, [series({ values: null })], SETTINGS), 'linear', 'X')).toBeNull();
  });
  it('media según el rol: Sw por volumen poral (por espesor si falta φ), k geométrica en log', () => {
    expect(propertyStat('SW', true)).toEqual({ mean: 'poreVolume', scale: 'linear', fallback: false });
    expect(propertyStat('SW', false)).toEqual({ mean: 'thickness', scale: 'linear', fallback: true });
    expect(propertyStat('PERM', true).scale).toBe('log');
  });
  it('resistividad (curva en escala log): eje log como en el visor y el histograma, media por espesor', () => {
    expect(propertyStat('RT', true, 'log')).toEqual({ mean: 'thickness', scale: 'log', fallback: false });
    expect(propertyStat('GR', true, 'linear').scale).toBe('linear');
    expect(propertyStat('PERM', true, 'linear').scale).toBe('log');
  });
});

describe('CSV', () => {
  const rows = zoneRows(depth, zones);
  it('estadísticas: una fila por zona y serie; sin dato vacío', () => {
    const cells = buildCells(rows, [series(), series({ id: 'well:x', label: 'Otro, pozo', kind: 'well', zones: [zones[0]!] })], SETTINGS);
    const csv = statsCsv(rows, [{ label: 'Actual' }, { label: 'Otro, pozo' }], cells, { property: 'PHIE', unit: 'v/v', filter: 'all', excludeWashout: true, mean: 'thickness' });
    const lines = csv.trim().split('\n');
    expect(lines).toHaveLength(5);
    expect(lines[0]).toBe('Zona,Serie,Propiedad,Filtro,Excluye derrumbe,Media usada,n,Espesor (m),P10 (v/v),P25 (v/v),P50 (v/v),P75 (v/v),P90 (v/v),Media (v/v),Media geométrica (v/v),Excluido por derrumbe (m),Sin dato (m),Observación');
    expect(lines[1]!.startsWith('A,Actual,PHIE,Toda la zona,sí,Media (por espesor),7,7,')).toBe(true);
    expect(lines[1]!.endsWith(',2,1,')).toBe(true);
    // Otro pozo sin la zona A: celdas vacías y la observación; el nombre con coma va entre comillas.
    expect(lines[2]).toBe('A,"Otro, pozo",PHIE,Toda la zona,sí,Media (por espesor),,,,,,,,,,,,la zona no está');
  });
  it('topes', () => {
    expect(topsCsv(rows).trim().split('\n')).toEqual(['Zona,Tope (m),Base (m),Espesor (m),Tipo', 'A,0,9.5,9.5,Formación', 'B,10,19,9,Reservorio']);
  });
});

describe('series desde un contexto', () => {
  const curve = (id: string, role: string | null, unit: string, f: (i: number) => number) => ({ id, mnemonic: id, role, unit, data: Float64Array.from({ length: n }, (_, i) => f(i)), origin: { kind: 'measured' as const } });
  const well = createWell({ id: 'w', name: 'W', depth, curves: [curve('GR', 'GR', 'gAPI', (i) => 50 + i), curve('ILD', 'RT', 'ohm.m', (i) => 1 + i)] });
  const data = (v: number) => Float64Array.from({ length: n }, () => v);
  const comp = (port: string, v: number) => ({ port, moduleId: 'm', label: port, data: data(v), active: true });
  const ctx: SeriesContext = { well, interpretation: { ...emptyInterpretation(zones) }, computed: [comp('SW', 0.4), comp('PHIE', 0.2), comp('VSH', 0.1), comp('NET_RES', 1), comp('IND_WASHOUT', 0)], catalog: defaultRoleCatalog };

  it('propiedades de interpretación primero (φe, Sw, Vsh), después el resto; por defecto φe', () => {
    const opts = propertyOptions(ctx);
    expect(opts.slice(0, 3).map((o) => o.value)).toEqual(['r:PHIE', 'r:SW', 'r:VSH']);
    expect(opts.slice(0, 3).every((o) => o.group === 'Interpretación')).toBe(true);
    expect(opts.some((o) => o.value === 'm:GR')).toBe(true);
    // Banderas fuera del selector.
    expect(opts.some((o) => o.value.includes('NET_RES'))).toBe(false);
    expect(defaultProperty(opts)).toBe('r:PHIE');
  });
  it('datos de la serie: valores, espesor del motor, banderas activas y φe', () => {
    const s = seriesFromContext(ctx, 'r:SW', { id: '#current', label: 'Actual', kind: 'current' });
    expect(s.values![0]).toBe(0.4);
    expect(s.netRes).toBeDefined();
    expect(s.netPay).toBeUndefined();
    expect(s.washout).toBeDefined();
    expect(s.phi![3]).toBe(0.2);
    expect(thicknessOf(well)).toBe(thicknessOf(well));
  });
  it('clave de otro pozo: r: igual, m: por rol o mnemónico', () => {
    const other = { well: createWell({ id: 'o', name: 'O', depth, curves: [curve('GR_X', 'GR', 'gAPI', () => 1)] }) };
    expect(translateKey(ctx, 'r:PHIE', other)).toBe('r:PHIE');
    expect(translateKey(ctx, 'm:GR', other)).toBe('m:GR_X');
    expect(translateKey(ctx, 'm:ILD', other)).toBeNull();
  });
  it('parámetros por defecto', () => {
    expect(usesOnlyDefaults({ global: {}, zones: {} })).toBe(true);
    expect(usesOnlyDefaults({ global: {}, zones: { za: { rw: 0.03 } } })).toBe(false);
  });
});

describe('geometría de las filas', () => {
  it('alto por carriles y carril bajo el puntero', () => {
    expect(rowHeight(1)).toBe(30);
    expect(rowHeight(3)).toBe(70);
    expect(laneAt(4, 3)).toBe(-1);
    expect(laneAt(6, 3)).toBe(0);
    expect(laneAt(30, 3)).toBe(1);
    expect(laneAt(66, 3)).toBe(-1);
  });
});
