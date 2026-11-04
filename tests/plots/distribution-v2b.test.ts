/**
 * Distribuciones por zona, V2 — datos (docs/decisiones/0066, D15–D19): plugs de corona como serie (mapeo por rol,
 * puesta en zona por la muestra más cercana, filtro por bandera, pesos iguales, media geométrica para k), vista de
 * histogramas (clases del histograma del dock, peso de la caja, normalización por serie), lectura del volumen in situ y
 * de la incertidumbre, y configuración saneada. Cuentas a mano (Hazen con pesos iguales).
 */
import { describe, expect, it } from 'vitest';
import { defaultDistribution, sanitizeDistribution } from '../../src/core/plots';
import type { Zone } from '../../src/core/well';
import { emptyInterpretation } from '../../src/core/interpretation';
import { weightedQuantiles } from '../../src/petro/distribution';
import { autoBinCount } from '../../src/plots/histogram/histogram';
import { cellTooltip, distributionAxis, statsCsv, zoneNotes, zoneRows } from '../../src/plots/distribution/distribution';
import { drawZoneRow, withoutPlugs } from '../../src/plots/distribution/draw';
import { THEMES } from '../../src/ui/tokens';
import { axisFraction } from '../../src/plots/xy/axes';
import { histogramAxis, histogramEdges, histTooltip, laneHistogram, usedSamples } from '../../src/plots/distribution/hist';
import { CORE_MIN_BOX, corePropertyOf, plugCells, plugColumn, plugDiffText, plugLogCells, plugMean, plugWarnings, tiePlugs, type CorePlugs } from '../../src/plots/distribution/plugs';
import { hasRange, volumeFraction, volumeMax, volumeText, zoneVolumes } from '../../src/plots/distribution/volume';
import { wellCorePlugs } from '../../src/plots/distribution/corePlugs';
import { createPointSet } from '../../src/core/pointSets';

// Pozo de 20 muestras cada 1 m (0…19); zona A = 0–9,5 (muestras 0–9), B = 10–19 (muestras 10–19).
const depth = Float64Array.from({ length: 20 }, (_, i) => i);
const zones: Zone[] = [
  { id: 'za', name: 'A', top: 0, base: 9.5, color: '#aa0000', kind: 'formation' },
  { id: 'zb', name: 'B', top: 10, base: 19, color: '#00aa00', kind: 'reservoir' },
];
const rows = zoneRows(depth, zones);

describe('mapeo por rol', () => {
  it('φ, k y densidad de grano por ROL; el resto no tiene corona', () => {
    expect(corePropertyOf('PHIE')).toBe('phi');
    expect(corePropertyOf('PHIT')).toBe('phi');
    expect(corePropertyOf('phie_nmr')).toBe('phi');
    expect(corePropertyOf('PERM')).toBe('k');
    expect(corePropertyOf('RHOMAA')).toBe('rhog');
    for (const r of ['SW', 'VSH', 'RHOB', 'GR', 'PHID', null, undefined, '']) expect(corePropertyOf(r)).toBeNull();
  });
  it('media: geométrica para k, aritmética para φ y densidad de grano', () => {
    expect(plugMean('k')).toBe('geometric');
    expect(plugMean('phi')).toBe('thickness');
    expect(plugMean('rhog')).toBe('thickness');
  });
  it('unidades: misma, convertible (% → v/v) o no comparable', () => {
    const plugs: CorePlugs = { ids: ['a'], depth: [1], sets: ['s'], columns: { phi: { values: [20], unit: '%' }, k: { values: [5], unit: 'mD' } } };
    const phi = plugColumn(plugs, 'phi', 'v/v')!;
    expect(phi.values[0]).toBeCloseTo(0.2, 12);
    expect(phi.convertedFrom).toBe('%');
    expect(plugColumn(plugs, 'k', 'mD')).toEqual({ values: Float64Array.from([5]), convertedFrom: null });
    expect(plugColumn(plugs, 'k', 'v/v')).toBeNull();
    expect(plugColumn(plugs, 'rhog', 'g/cm3')).toBeNull();
    expect(plugColumn(null, 'phi', 'v/v')).toBeNull();
  });
});

describe('plugs → zonas', () => {
  it('muestra más cercana con tolerancia de un paso; fuera → −1', () => {
    expect(Array.from(tiePlugs(depth, [3.4, 3.6, 9.4, 19.9, 20.5, -1.2]))).toEqual([3, 4, 9, 19, -1, -1]);
  });

  // Plugs: tres en A (uno sin φ), cinco en B, uno fuera del perfil.
  const plugs: CorePlugs = {
    ids: ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9'],
    depth: [1.2, 2.1, 4, 11, 12, 13, 14, 15.2, 25],
    sets: ['Corona'],
    columns: { phi: { values: [0.1, 0.3, NaN, 0.1, 0.2, 0.3, 0.4, 0.5, 0.2], unit: 'v/v' } },
  };
  const col = plugColumn(plugs, 'phi', 'v/v')!;

  it('cada plug en la zona de su muestra; pesos iguales (Hazen); n < 5 sin caja', () => {
    const { cells, outside } = plugCells(rows, plugs, col, 'phi', depth, {}, 'all');
    expect(outside).toBe(1);
    const [a, b] = cells;
    expect(a!.plugs).toMatchObject({ inZone: 3, values: [0.1, 0.3], ids: ['p1', 'p2'], noValue: 1, filteredOut: 0 });
    expect(a!.stats!.n).toBeLessThan(CORE_MIN_BOX);
    expect(b!.stats!.n).toBe(5);
    // Hazen con 5 pesos iguales: c = 0,1 0,3 0,5 0,7 0,9 → P10 = 0,1, P25 = 0,175, P50 = 0,3, P90 = 0,5.
    expect(b!.stats!.p10).toBeCloseTo(0.1, 12);
    expect(b!.stats!.p25).toBeCloseTo(0.175, 12);
    expect(b!.stats!.p50).toBeCloseTo(0.3, 12);
    expect(b!.stats!.p90).toBeCloseTo(0.5, 12);
    expect(b!.stats!.mean).toBeCloseTo(0.3, 12);
    // Igual que el motor con pesos 1.
    expect([b!.stats!.p10, b!.stats!.p25, b!.stats!.p50, b!.stats!.p75, b!.stats!.p90]).toEqual(weightedQuantiles([0.1, 0.2, 0.3, 0.4, 0.5], [1, 1, 1, 1, 1]));
  });

  it('k: media geométrica (eje log), k ≤ 0 sin dato', () => {
    const kp: CorePlugs = { ids: ['a', 'b', 'c', 'd'], depth: [11, 12, 13, 14], sets: ['s'], columns: { k: { values: [1, 10, 100, 0], unit: 'mD' } } };
    const { cells } = plugCells(rows, kp, plugColumn(kp, 'k', 'mD')!, 'k', depth, {}, 'all');
    expect(cells[1]!.stats!.n).toBe(3);
    expect(cells[1]!.stats!.mean).toBeCloseTo(10, 10);
    expect(cells[1]!.plugs!.noValue).toBe(1);
  });

  it('filtro: bandera de la muestra más cercana; sin bandera → «sin banderas netas»; zona sin plugs', () => {
    const netRes = Float64Array.from({ length: 20 }, (_, i) => (i === 11 || i === 13 ? 1 : 0));
    const { cells } = plugCells(rows, plugs, col, 'phi', depth, { netRes }, 'netRes');
    expect(cells[1]!.stats!.n).toBe(2);
    expect(cells[1]!.plugs!.values).toEqual([0.1, 0.3]);
    expect(cells[1]!.plugs!.filteredOut).toBe(3);
    expect(plugCells(rows, plugs, col, 'phi', depth, {}, 'netPay').cells[1]!.missing).toBe('flags');
    const none = plugCells(rows, { ...plugs, depth: [11, 11, 11, 11, 11, 11, 11, 11, 11] }, col, 'phi', depth, {}, 'all').cells[0]!;
    expect(none).toMatchObject({ stats: null, missing: 'plugs' });
    expect(zoneNotes(none)).toEqual([{ text: 'sin plugs', tone: 'muted' }]);
  });

  it('textos: n de plugs, aviso con pocos, tooltip y CSV sin espesor', () => {
    const { cells } = plugCells(rows, plugs, col, 'phi', depth, {}, 'all');
    expect(zoneNotes(cells[0])).toEqual([{ text: 'n 2 plugs', tone: 'warn' }]);
    expect(zoneNotes(cells[1])).toEqual([{ text: 'n 5 plugs', tone: 'muted' }]);
    const tip = cellTooltip('B', 'Corona', cells[1]!, 'thickness', 'v/v', ['nota']);
    expect(tip).toContain('Media aritmética 0,3 v/v · cada plug pesa igual');
    expect(tip.at(-1)).toBe('nota');
    expect(cellTooltip('A', 'Corona', cells[0]!, 'thickness', 'v/v').join('\n')).toContain('pocos plugs');
    const csv = statsCsv(rows, [{ label: 'Corona' }], cells.map((c) => [c]), { property: 'PHIE', unit: 'v/v', filter: 'all', excludeWashout: false, mean: 'thickness' }).split('\n');
    expect(csv[2]).toBe('B,Corona,PHIE,Toda la zona,no,Media aritmética,5,,0.1,0.175,0.3,0.425,0.5,0.3,0.2605171085,,,"plugs de corona, pesos iguales"');
  });

  it('perfil en plugs: la curva en la muestra de cada plug con valor, pesos iguales, mismo filtro, derrumbe', () => {
    // Perfil: φ = i/100 en la muestra i. Plugs de B atados a 11…15 (p8 a 15,2 → 15).
    const log = Float64Array.from({ length: 20 }, (_, i) => i / 100);
    const cells = plugLogCells(rows, plugs, col, 'phi', depth, log, {}, 'all', false);
    // A: p1 (1) y p2 (2); p3 sin φ de corona no entra (las mismas profundidades que la caja de la corona).
    expect(cells[0]!.plugs).toMatchObject({ source: 'log', inZone: 2, values: [0.01, 0.02], ids: ['p1', 'p2'] });
    expect(cells[1]!.stats!.n).toBe(5);
    expect(cells[1]!.stats!.mean).toBeCloseTo(0.13, 12);
    expect(cells[1]!.stats!.p50).toBeCloseTo(0.13, 12);
    // Filtro por la bandera de la muestra y derrumbe excluido sobre el perfil.
    const netRes = Float64Array.from({ length: 20 }, (_, i) => (i === 11 || i === 13 || i === 14 ? 1 : 0));
    const washout = Float64Array.from({ length: 20 }, (_, i) => (i === 14 ? 1 : 0));
    const f = plugLogCells(rows, plugs, col, 'phi', depth, log, { netRes, washout }, 'netRes', true)[1]!;
    expect(f.plugs!.values).toEqual([0.11, 0.13]);
    expect(f.stats!.excludedWashout).toBe(1);
    expect(f.plugs!.filteredOut).toBe(2);
    expect(plugLogCells(rows, plugs, col, 'phi', depth, log, {}, 'netPay', false)[1]!.missing).toBe('flags');
    // Diferencia de medias corona (0,3) − perfil en plugs (0,13).
    const core = plugCells(rows, plugs, col, 'phi', depth, {}, 'all').cells;
    expect(plugDiffText(core[1], cells[1], 'phi', 'v/v')).toBe('Corona − perfil en plugs: +0,17 v/v');
    expect(plugDiffText(core[0], { stats: null, filtered: 0 }, 'phi')).toBeNull();
    // Con n distintos (el perfil perdió plugs por filtro/derrumbe) la diferencia lo aclara.
    expect(plugDiffText(core[1], f, 'phi', 'v/v')).toMatch(/ · n 5 vs 2 plugs$/);
    expect(zoneNotes(cells[1])).toEqual([{ text: 'n 5 muestras (una por plug)', tone: 'muted' }]);
  });

  it('perfil en plugs con k: media geométrica y cociente', () => {
    const kp: CorePlugs = { ids: ['a', 'b', 'c'], depth: [11, 12, 13], sets: ['s'], columns: { k: { values: [10, 100, 1000], unit: 'mD' } } };
    const kc = plugColumn(kp, 'k', 'mD')!;
    const log = Float64Array.from({ length: 20 }, (_, i) => (i === 11 ? 1 : i === 12 ? 10 : 100));
    const lc = plugLogCells(rows, kp, kc, 'k', depth, log, {}, 'all', false)[1]!;
    expect(lc.stats!.mean).toBeCloseTo(10, 10);
    const cc = plugCells(rows, kp, kc, 'k', depth, {}, 'all').cells[1]!;
    expect(cc.stats!.mean).toBeCloseTo(100, 10);
    expect(plugDiffText(cc, lc, 'k', 'mD')).toBe('Corona − perfil en plugs: +90 mD (×10)');
  });

  it('avisos: base de φ distinta de la de calibración y unidad convertida', () => {
    const c = { values: new Float64Array(1), convertedFrom: '%' as const };
    expect(plugWarnings('phi', c, 'PHIT', 'PHIE').map((w) => w.tone)).toEqual(['muted', 'warn']);
    expect(plugWarnings('phi', { ...c, convertedFrom: null }, 'PHIE', 'PHIE')).toEqual([{ text: expect.stringContaining('compara con PHIE'), tone: 'muted' }]);
    expect(plugWarnings('k', { ...c, convertedFrom: null }, 'PERM', null)).toEqual([]);
  });

  it('plugs del pozo: solo los incluidos y con la profundidad corrida', () => {
    const set = createPointSet({
      id: 'c1',
      kind: 'core',
      name: 'Corona',
      depth: Float64Array.from([5, 6, 7]),
      pointIds: ['a', 'b', 'c'],
      columns: { phi: { label: 'φ', unit: 'v/v', values: Float64Array.from([0.2, 0.9, 0.1]) }, k: { label: 'k', unit: 'mD', values: Float64Array.from([3, 4, 5]) } },
    });
    const well = { pointSets: [set], curves: [] };
    const interp = { ...emptyInterpretation(), pointSets: { c1: { points: {}, depthShift: 2 } } };
    const p = wellCorePlugs(well, interp)!;
    // φ = 0,9 fuera de rango: la calidad propone descartarlo.
    expect(p.ids).toEqual(['a', 'c']);
    expect(Array.from(p.depth)).toEqual([7, 9]);
    expect(Object.keys(p.columns).sort()).toEqual(['k', 'phi']);
    expect(p.phiMatch).toBe('PHIE');
    expect(wellCorePlugs(well, interp)).toBe(p);
    expect(wellCorePlugs({ ...well, pointSets: [] }, interp)).toBeNull();
  });
});

describe('vista de histogramas', () => {
  it('histograma ponderado y normalizado por serie', () => {
    const h = laneHistogram([0.5, 1.5, 1.5, 3], [1, 2, 1, 4], [0, 1, 2])!;
    expect(Array.from(h.fraction)).toEqual([0.125, 0.375]);
    expect(h.total).toBe(8);
    expect(h.outside).toBe(0.5);
    expect(h.peak).toBe(0.375);
    expect(laneHistogram([], [], [0, 1])).toBeNull();
  });
  it('muestras usadas con el peso de la caja (h·φ para Sw)', () => {
    const input = { values: [0.2, 0.5, NaN, 0.8], thickness: [1, 1, 1, 2], phi: [0.1, 0.2, 0.3, 0.25] };
    const u = usedSamples(input, { filter: 'all', excludeWashout: false, mean: 'poreVolume' }, [{ start: 0, end: 4 }]);
    expect(u.xs).toEqual([0.2, 0.5, 0.8]);
    expect(u.ws.map((w) => +w.toFixed(12))).toEqual([0.1, 0.2, 0.5]);
  });
  it('clases: Freedman–Diaconis como el dock, de extremo a extremo del eje; log en décadas', () => {
    const xs = Float64Array.from({ length: 200 }, (_, i) => i / 1000);
    const axis = histogramAxis(xs, 'linear', 'PHIE', 'v/v')!;
    expect(axis.min).toBe(0);
    expect(axis.max).toBeGreaterThanOrEqual(0.199);
    const e = histogramEdges(axis, xs);
    const sorted = Array.from(xs);
    const q = (p: number) => sorted[Math.floor(199 * p)]! + (199 * p - Math.floor(199 * p)) * (sorted[Math.floor(199 * p) + 1]! - sorted[Math.floor(199 * p)]!);
    expect(e.length - 1).toBe(autoBinCount(200, q(0.75) - q(0.25), axis.max - axis.min));
    expect(e[0]).toBe(axis.min);
    expect(e[e.length - 1]).toBe(axis.max);
    const k = histogramEdges({ kind: 'log', min: 0.1, max: 1000, label: 'k' }, [1, 10, 100, 0.5, 5, 50]);
    const ratios = Array.from(k).slice(1).map((v, j) => v / k[j]!);
    for (const r of ratios) expect(r).toBeCloseTo(ratios[0]!, 9);
    expect(histogramAxis([1], 'linear', 'x')).toBeNull();
  });
  it('tooltip: fracción de la clase por serie y marcas', () => {
    const h = laneHistogram([0.5, 1.5], [1, 3], [0, 1, 2])!;
    const tip = histTooltip('B', 1.2, [0, 1, 2], [{ label: 'Actual', hist: h, stats: { n: 2, p50: 1.2, mean: 1.25 }, plugs: false }, { label: 'Corona', hist: null, stats: null, plugs: true }], 'espesor', 'v/v');
    expect(tip).toEqual(['B', 'Clase 1–2 v/v', 'Actual: 75,0 % del espesor en la clase · P50 1,2 · media 1,25 v/v', 'Corona: sin dato']);
  });
});

describe('volumen in situ', () => {
  const vol = [
    { zone: 'A', fluid: 'Petróleo', ooipField: 3.5, ogipField: null },
    { zone: 'B', fluid: 'Gas', ooipField: null, ogipField: 12 },
    { zone: 'C', fluid: 'Sello', ooipField: null, ogipField: null },
    { zone: 'Total', fluid: null, ooipField: 3.5, ogipField: 12 },
  ];
  const zs = [
    { id: 'za', name: 'A' },
    { id: 'zb', name: 'B' },
    { id: 'zc', name: 'C' },
    { id: 'zd', name: 'D' },
  ];
  const unc = [
    { key: 'za', fieldUnit: 'MMbbl', p90Field: 2, p50Field: 3.4, p10Field: 5 },
    { key: 'zb', fieldUnit: 'Bcf', p90Field: 9, p50Field: 11, p10Field: 15 },
    { key: 'TOTAL_OIL', fieldUnit: 'MMbbl', p90Field: 2, p50Field: 3.4, p10Field: 5 },
  ];
  it('sin incertidumbre: solo el determinista; petróleo y gas separados', () => {
    const d = zoneVolumes(vol, zs, null)!;
    expect(d.fluids).toEqual(['oil', 'gas']);
    expect(d.byZone['za']).toEqual({ oil: { det: 3.5 } });
    expect(d.byZone['zb']).toEqual({ gas: { det: 12 } });
    expect(d.byZone['zc']).toEqual({ note: 'sello' });
    expect(d.byZone['zd']).toBeUndefined();
    expect(d.uncertainty).toBe('none');
    expect(hasRange(d.byZone['za']!.oil)).toBe(false);
    expect(zoneVolumes(null, zs, null)).toBeNull();
  });
  it('con incertidumbre (P90 bajo, P10 alto) y su vigencia', () => {
    const d = zoneVolumes(vol, zs, { rows: unc, stale: false })!;
    expect(d.byZone['za']!.oil).toEqual({ det: 3.5, p90: 2, p50: 3.4, p10: 5 });
    expect(d.byZone['zb']!.gas).toEqual({ det: 12, p90: 9, p50: 11, p10: 15 });
    expect(d.total).toEqual({ oil: { det: 3.5, p90: 2, p50: 3.4, p10: 5 }, gas: { det: 12 } });
    expect(d.uncertainty).toBe('fresh');
    expect(zoneVolumes(vol, zs, { rows: unc, stale: true })!.uncertainty).toBe('stale');
    // Escala compartida por fluido (con aire) y posición.
    expect(volumeMax(d, 'oil', ['za', 'zb'])).toBeCloseTo(5 * 1.06, 12);
    expect(volumeFraction(2.65, 5.3)).toBeCloseTo(0.5, 12);
    expect(volumeFraction(undefined, 5)).toBeNaN();
    expect(volumeText(45.912)).toBe('45,9');
    expect(volumeText(NaN)).toBe('—');
  });
});

describe('configuración', () => {
  it('vista, volumen y serie de corona saneados', () => {
    expect(defaultDistribution()).toMatchObject({ view: 'box', volume: false });
    expect(sanitizeDistribution({ view: 'hist', volume: true, series: ['#current', '#core', '#core-log', '#otra'] })).toMatchObject({ view: 'hist', volume: true, series: ['#current', '#core', '#core-log'] });
    expect(sanitizeDistribution({ view: 'violin', volume: 'sí' })).toMatchObject({ view: 'box', volume: false });
  });
});

describe('revisión de la V2', () => {
  const plugs: CorePlugs = { ids: ['a'], depth: [11], sets: ['s'], columns: { phi: { values: [0.1], unit: 'v/v' } } };
  const col = plugColumn(plugs, 'phi', 'v/v')!;

  it('el eje contiene TODOS los plugs dibujados, no solo P10–P90', () => {
    // 10 plugs en B: 0,05 y 0,40 quedan fuera de P10–P90 (Hazen con n = 10: P10 = 0,06 y P90 = 0,38).
    const vals = [0.05, 0.06, 0.07, 0.08, 0.09, 0.1, 0.11, 0.12, 0.38, 0.4];
    const many: CorePlugs = { ids: vals.map((_, i) => `p${i}`), depth: vals.map((_, i) => 10 + i * 0.5), sets: ['s'], columns: { phi: { values: vals, unit: 'v/v' } } };
    const { cells } = plugCells(rows, many, plugColumn(many, 'phi', 'v/v')!, 'phi', depth, {}, 'all');
    const s = cells[1]!.stats!;
    expect(s.p10).toBeGreaterThan(0.05);
    expect(s.p90).toBeLessThan(0.4);
    const axis = distributionAxis([[{ stats: null, missing: 'zone', filtered: 0 }], [cells[1]!]], 'linear', 'PHIE')!;
    expect(axis.min).toBeLessThanOrEqual(0.05);
    expect(axis.max).toBeGreaterThanOrEqual(0.4);
    for (const v of vals) {
      const f = axisFraction(axis, v);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
    }
    // En log (k): el plug más chico y el más grande también entran.
    const kp: CorePlugs = { ids: vals.map((_, i) => `k${i}`), depth: vals.map((_, i) => 10 + i * 0.5), sets: ['s'], columns: { k: { values: [0.01, 1, 2, 3, 4, 5, 6, 7, 8, 5000], unit: 'mD' } } };
    const kc = plugCells(rows, kp, plugColumn(kp, 'k', 'mD')!, 'k', depth, {}, 'all').cells[1]!;
    const kaxis = distributionAxis([[kc]], 'log', 'PERM')!;
    expect(kaxis.min).toBeLessThanOrEqual(0.01);
    expect(kaxis.max).toBeGreaterThanOrEqual(5000);
  });

  it('zona sin plugs: «sin plugs» una sola vez en la fila (corona y perfil en plugs)', () => {
    const none = plugCells(rows, plugs, col, 'phi', depth, {}, 'all').cells[0]!; // A no tiene plugs
    const noneLog = plugLogCells(rows, plugs, col, 'phi', depth, new Float64Array(20), {}, 'all', false)[0]!;
    expect(withoutPlugs(none)).toBe(true);
    expect(withoutPlugs(noneLog)).toBe(true);
    const texts: string[] = [];
    const noop = () => {};
    const ctx = new Proxy({ fillText: (t: string) => texts.push(t), measureText: () => ({ width: 10 }) } as Record<string, unknown>, {
      get: (t, k: string) => (k in t ? t[k] : noop),
      set: (t, k: string, v) => ((t[k] = v), true),
    }) as unknown as CanvasRenderingContext2D;
    const axis = { kind: 'linear' as const, min: 0, max: 1, label: 'PHIE' };
    const style = { color: '#000' };
    drawZoneRow(ctx, 400, 120, { axis, cells: [none, noneLog], styles: [style, style] }, THEMES.light);
    expect(texts.filter((t) => t === 'sin plugs')).toHaveLength(1);
    // Una zona con plugs en la corona y sin ninguno válido en el perfil NO se silencia: son mensajes distintos.
    texts.length = 0;
    drawZoneRow(ctx, 400, 120, { axis, cells: [none, { stats: null, missing: 'curve', filtered: 0 }], styles: [style, style] }, THEMES.light);
    expect(texts).toEqual(['sin plugs', 'sin dato']);
  });
});
