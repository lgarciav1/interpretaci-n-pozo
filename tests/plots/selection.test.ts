/**
 * Gráficos conectados (fase 8b, docs/decisiones/0021, F): punto en polígono del lazo (también con ejes log e
 * invertidos), selección → tramos del visor, tramo del visor → muestras, clases del histograma → muestras, la
 * selección única compartida (`link.ts`) y la receta «Excluir del ajuste los puntos seleccionados».
 */
import { describe, expect, it } from 'vitest';
import { createProject, addWell } from '../../src/core/state/project';
import { addTrend, excludeTrendPoints, includeAllTrendPoints } from '../../src/core/state/trends';
import type { TrendSpec } from '../../src/core/trends';
import { clearPlotSelection, getPlotLink, makeSelection, selectionFor, selectionTitle, setPlotSelection } from '../../src/plots/link';
import { binsMask, cloudMask, intervalMask, intervalSamples, maskCount, maskFromCloud, maskRuns, pointInPolygon, pointsInPolygon, pointsInShape, simplifyPath, toggleBin, unionMask } from '../../src/plots/selection';
import { xyMapping, type XYAxis } from '../../src/plots/xy/axes';
import { syntheticWell } from '../../src/app/demo/syntheticWell';

const LIN: XYAxis = { kind: 'linear', min: 0, max: 10, label: 'x' };

describe('punto en polígono (lazo)', () => {
  // Una «U» (cóncava): el hueco del medio queda afuera.
  const ux = [0, 3, 3, 2, 2, 1, 1, 0];
  const uy = [0, 0, 3, 3, 1, 1, 3, 3];
  it('regla par-impar en un polígono cóncavo', () => {
    expect(pointInPolygon(0.5, 2, ux, uy)).toBe(true);
    expect(pointInPolygon(2.5, 2, ux, uy)).toBe(true);
    expect(pointInPolygon(1.5, 2, ux, uy)).toBe(false); // el hueco de la U
    expect(pointInPolygon(1.5, 0.5, ux, uy)).toBe(true);
    expect(pointInPolygon(4, 1, ux, uy)).toBe(false);
    expect(pointInPolygon(-1, 1, ux, uy)).toBe(false);
  });

  it('índices de una nube dentro del lazo, igual que la búsqueda exhaustiva', () => {
    let s = 3;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 10;
    const xs = Float64Array.from({ length: 4000 }, rnd);
    const ys = Float64Array.from({ length: 4000 }, rnd);
    // Estrella de cinco puntas (se cruza: la regla par-impar deja afuera el pentágono central).
    const px: number[] = [];
    const py: number[] = [];
    for (let k = 0; k < 5; k++) {
      const a = -Math.PI / 2 + (k * 4 * Math.PI) / 5;
      px.push(5 + 4 * Math.cos(a));
      py.push(5 + 4 * Math.sin(a));
    }
    const got = Array.from(pointsInPolygon({ x: px, y: py }, xs, ys, LIN, LIN));
    const want: number[] = [];
    for (let i = 0; i < xs.length; i++) if (pointInPolygon(xs[i]! / 10, ys[i]! / 10, px.map((v) => v / 10), py.map((v) => v / 10))) want.push(i);
    expect(got).toEqual(want);
    expect(got.length).toBeGreaterThan(200);
  });

  it('con eje log y eje invertido compara en el espacio en que se dibujó (fracción de eje)', () => {
    const X: XYAxis = { kind: 'log', min: 0.1, max: 1000, label: 'Rt' };
    const Y: XYAxis = { kind: 'linear', min: 1.9, max: 2.9, label: 'RHOB', reversed: true };
    // Un triángulo dibujado en px sobre esos ejes, convertido a datos como lo hace XYPlot (xInv / yInv).
    const m = xyMapping(X, Y, { x: 0, y: 0, width: 400, height: 400 });
    const tri = [
      { x: 100, y: 100 },
      { x: 300, y: 100 },
      { x: 200, y: 300 },
    ];
    const poly = { x: tri.map((p) => m.xInv(p.x)), y: tri.map((p) => m.yInv(p.y)) };
    // Puntos en px adentro y afuera, en datos.
    const pts = [
      { x: 200, y: 150, inside: true },
      { x: 200, y: 280, inside: true },
      { x: 120, y: 280, inside: false },
      { x: 350, y: 120, inside: false },
    ];
    const xs = pts.map((p) => m.xInv(p.x));
    const ys = pts.map((p) => m.yInv(p.y));
    const got = Array.from(pointsInPolygon(poly, xs, ys, X, Y));
    expect(got).toEqual(pts.flatMap((p, k) => (p.inside ? [k] : [])));
    // Un valor que no se puede ubicar en log (≤ 0) queda afuera.
    expect(Array.from(pointsInPolygon(poly, [-1], [2.3], X, Y))).toEqual([]);
  });

  it('rectángulo: los mismos puntos que pointsInRect de la 7a; un lazo de menos de 3 vértices no elige nada', () => {
    const xs = [1, 2, 3, 4];
    const ys = [1, 2, 3, 4];
    expect(Array.from(pointsInShape({ kind: 'rect', rect: { xMin: 1.5, xMax: 3.5, yMin: 0, yMax: 10 } }, xs, ys, LIN, LIN))).toEqual([1, 2]);
    expect(pointsInPolygon({ x: [0, 1], y: [0, 1] }, xs, ys, LIN, LIN).length).toBe(0);
  });

  it('la traza se simplifica sin perder la forma', () => {
    const pts = Array.from({ length: 100 }, (_, k) => ({ x: k * 0.5, y: 0 }));
    const s = simplifyPath(pts, 2);
    expect(s.length).toBe(25);
    expect(s[0]).toEqual({ x: 0, y: 0 });
  });
});

describe('selección → muestras → tramos', () => {
  const depth = Float64Array.from({ length: 20 }, (_, i) => 1000 + i * 0.5);

  it('tramo del visor → índices por bisección (bordes incluidos, al revés también)', () => {
    expect(intervalSamples(depth, 1001, 1002.5)).toEqual({ start: 2, end: 6 });
    expect(intervalSamples(depth, 1002.5, 1001)).toEqual({ start: 2, end: 6 });
    expect(intervalSamples(depth, 1001.1, 1001.4)).toEqual({ start: 3, end: 3 }); // entre muestras: ninguna
    expect(intervalSamples(depth, 900, 2000)).toEqual({ start: 0, end: 20 });
    const m = intervalMask(depth, 1001, 1002.5);
    expect(maskCount(m)).toBe(4);
    expect(Array.from(m.slice(0, 8))).toEqual([0, 0, 1, 1, 1, 1, 0, 0]);
  });

  it('muestras → tramos del visor: medio paso a cada lado y huecos de una muestra unidos', () => {
    const m = new Uint8Array(20);
    m[2] = m[3] = m[5] = 1; // hueco de una muestra (4): un solo tramo
    m[10] = 1;
    const runs = maskRuns(depth, m);
    expect(runs).toHaveLength(2);
    expect(runs[0]!.top).toBeCloseTo(1000.75, 12);
    expect(runs[0]!.base).toBeCloseTo(1002.75, 12);
    expect(runs[1]!.top).toBeCloseTo(1004.75, 12);
    expect(runs[1]!.base).toBeCloseTo(1005.25, 12);
  });

  it('nube ↔ muestras: puntos de la nube elegidos → máscara del pozo → puntos a resaltar', () => {
    const cloudIdx = Int32Array.from([1, 4, 7, 9, 12]);
    const mask = maskFromCloud(20, cloudIdx, [0, 3]);
    expect([...mask.keys()].filter((i) => mask[i])).toEqual([1, 9]);
    // Otro gráfico con otra nube ve las mismas muestras.
    const other = Int32Array.from([0, 1, 2, 9]);
    expect(Array.from(cloudMask(mask, other))).toEqual([0, 1, 0, 1]);
    expect(Array.from(unionMask(mask, maskFromCloud(20, cloudIdx, [1]))).reduce((a, b) => a + b, 0)).toBe(3);
  });

  it('clases del histograma → muestras: [borde, borde siguiente), la última cerrada, dentro del filtro', () => {
    const data = Float64Array.from([0, 1, 2, 3, 4, 5, NaN, 2.5]);
    const edges = [0, 2, 4, 5];
    expect(Array.from(binsMask(data, edges, [0]))).toEqual([1, 1, 0, 0, 0, 0, 0, 0]);
    expect(Array.from(binsMask(data, edges, [2]))).toEqual([0, 0, 0, 0, 1, 1, 0, 0]); // 5 entra (última clase)
    expect(Array.from(binsMask(data, edges, [1, 2], (i) => i !== 4))).toEqual([0, 0, 1, 1, 0, 1, 0, 1]);
    expect(toggleBin([0, 2], 1)).toEqual([0, 1, 2]);
    expect(toggleBin([0, 1, 2], 1)).toEqual([0, 2]);
  });
});

describe('una sola selección compartida', () => {
  const depth = Float64Array.from({ length: 10 }, (_, i) => 2000 + i);
  it('reemplaza la de otra fuente, vale solo para su pozo y se limpia', () => {
    const a = makeSelection('crossplot', depth, intervalMask(depth, 2001, 2003), { kind: 'shapes', x: 'r:NPHI', y: 'r:RHOB', shapes: [] })!;
    setPlotSelection(a);
    expect(selectionFor(depth)).toBe(a);
    expect(selectionFor(Float64Array.from(depth))).toBeNull(); // otro array = otro pozo u otra importación
    const b = makeSelection('viewer', depth, intervalMask(depth, 2005, 2006), { kind: 'interval', top: 2005, base: 2006 })!;
    setPlotSelection(b);
    expect(getPlotLink().selection).toBe(b);
    expect(b.count).toBe(2);
    expect(b.runs).toHaveLength(1);
    expect(selectionTitle(b, (d) => String(d))).toBe('Tramo 2005–2006 m');
    clearPlotSelection();
    expect(getPlotLink().selection).toBeNull();
  });
  it('sin muestras no hay selección', () => {
    expect(makeSelection('histogram', depth, new Uint8Array(10), { kind: 'bins', curve: 'r:GR', curveLabel: 'GR', edges: [0, 1], bins: [0] })).toBeNull();
  });
});

describe('excluir del ajuste los puntos seleccionados', () => {
  const spec: TrendSpec = { id: 't1', name: 'T', visible: true, series: { provider: 'crossplot', key: 'r:NPHI|r:RHOB|' }, model: 'linear', mode: 'fit', selection: { excluded: ['1000.5'] }, extend: true };
  const demo = syntheticWell();
  const W = demo.well.id;
  const p0 = addTrend(addWell(createProject('p'), demo.well, demo.zones), W, spec);
  it('suma las claves nuevas en una sola receta y no duplica', () => {
    const p1 = excludeTrendPoints(p0, W, 't1', ['1000.5', '1001', '1001.5']);
    expect(p1.wells[0]!.interpretation.trends[0]!.selection.excluded).toEqual(['1000.5', '1001', '1001.5']);
    expect(excludeTrendPoints(p1, W, 't1', ['1001'])).toBe(p1); // nada nuevo: mismo proyecto (sin entrada de deshacer)
    const p2 = includeAllTrendPoints(p1, W, 't1');
    expect(p2.wells[0]!.interpretation.trends[0]!.selection.excluded).toEqual([]);
    expect(includeAllTrendPoints(p2, W, 't1')).toBe(p2);
  });
});
