import { describe, expect, it } from 'vitest';
import { blockSummary, decimateRows, decimateWithBounds, lowerBound, ROW_DATA, ROW_EMPTY, ROW_GAP, rowBounds, visibleRange } from '../../src/viewer/decimate';
import { AreaSink, fillBetween } from '../../src/viewer/fills';
import { layoutTracks, trackAt } from '../../src/viewer/layout';
import { formatReadout, nearestIndex, valueAt } from '../../src/viewer/readout';
import { dataRange, edgeValues, fractionArray, fractionToValue, valueToFraction, validScale, wrapFractionArray, type AxisScale } from '../../src/viewer/scale';
import { depthTicks, linearGrid, logGrid, niceStep } from '../../src/viewer/ticks';
import {
  baseOf,
  clampViewport,
  depthOf,
  ensureVisible,
  fitAll,
  MAX_PX_PER_SAMPLE,
  resizeViewport,
  scaleRatio,
  scrollBy,
  showRange,
  viewportLimits,
  yOf,
  zoomAt,
} from '../../src/viewer/viewport';

const depthRange = (n: number, top = 1000, step = 0.5) => Float64Array.from({ length: n }, (_, i) => top + i * step);

describe('viewport', () => {
  const depth = depthRange(2001, 1000, 0.5); // 1000–2000 m
  const lim = viewportLimits(depth, 500, 0.5);

  it('límites: ver todo = el pozo en el alto; acercar hasta 32 px por muestra', () => {
    expect(lim.min).toBe(1000);
    expect(lim.max).toBe(2000);
    expect(lim.minPxPerM).toBeCloseTo(0.5, 12);
    expect(lim.maxPxPerM).toBeCloseTo(MAX_PX_PER_SAMPLE / 0.5, 12);
    const all = fitAll(lim, 500);
    expect(all.top).toBe(1000);
    expect(baseOf(all)).toBeCloseTo(2000, 9);
  });

  it('profundidad ↔ píxel son inversas', () => {
    const vp = { top: 1234.5, pxPerM: 7.3, height: 500 };
    for (const d of [1234.5, 1300, 1290.123]) expect(depthOf(vp, yOf(vp, d))).toBeCloseTo(d, 9);
    expect(yOf(vp, 1234.5)).toBe(0);
  });

  it('zoom centrado en el puntero: la profundidad bajo el puntero no se mueve', () => {
    const vp = showRange(lim, 500, 1400, 1600);
    const y = 137;
    const before = depthOf(vp, y);
    const z = zoomAt(vp, 2, y, lim);
    expect(z.pxPerM).toBeCloseTo(vp.pxPerM * 2, 9);
    expect(depthOf(z, y)).toBeCloseTo(before, 9);
  });

  it('zoom acotado: no se aleja más que ver todo ni se acerca más que el máximo, y queda dentro del pozo', () => {
    const vp = fitAll(lim, 500);
    expect(zoomAt(vp, 0.1, 250, lim).pxPerM).toBeCloseTo(lim.minPxPerM, 12);
    const deep = zoomAt(vp, 1e6, 499, lim);
    expect(deep.pxPerM).toBeCloseTo(lim.maxPxPerM, 9);
    expect(baseOf(deep)).toBeLessThanOrEqual(2000 + 1e-9);
  });

  it('scroll acotado al tope y a la base', () => {
    const vp = showRange(lim, 500, 1000, 1100);
    expect(scrollBy(vp, -1e6, lim).top).toBe(1000);
    const down = scrollBy(vp, 1e9, lim);
    expect(baseOf(down)).toBeCloseTo(2000, 9);
    const mid = scrollBy(vp, 100, lim);
    expect(mid.top).toBeCloseTo(vp.top + 100 / vp.pxPerM, 9);
  });

  it('showRange centra el tramo; ensureVisible desplaza lo mínimo', () => {
    const vp = showRange(lim, 500, 1500, 1550);
    expect(vp.top).toBeCloseTo(1500, 9);
    expect(baseOf(vp)).toBeCloseTo(1550, 9);
    expect(ensureVisible(vp, 1520, lim)).toBe(vp);
    const moved = ensureVisible(vp, 1560, lim, 20);
    expect(yOf(moved, 1560)).toBeCloseTo(480, 6);
  });

  it('pozo más corto que la pantalla: se centra', () => {
    const shortLim = viewportLimits(depthRange(3, 100, 1), 500, 1);
    const vp = clampViewport({ top: 0, pxPerM: shortLim.minPxPerM, height: 500 }, shortLim);
    expect(vp.top).toBeCloseTo(100, 9);
  });

  it('al cambiar el alto conserva "ver todo" o el tope y el zoom', () => {
    const all = fitAll(lim, 500);
    const lim2 = viewportLimits(depth, 800, 0.5);
    expect(baseOf(resizeViewport(all, lim, lim2, 800))).toBeCloseTo(2000, 9);
    const z = showRange(lim, 500, 1500, 1550);
    const r = resizeViewport(z, lim, lim2, 800);
    expect(r.top).toBeCloseTo(z.top, 9);
    expect(r.pxPerM).toBeCloseTo(z.pxPerM, 9);
  });

  it('escala de impresión 1:N a 96 ppp', () => {
    // 1:1000 → 1 m = 1 mm = 96/25,4 px
    expect(scaleRatio(96 / 25.4)).toBeCloseTo(1000, 9);
    expect(scaleRatio((96 / 25.4) * 5)).toBeCloseTo(200, 9);
  });
});

describe('ticks y grillas', () => {
  it('paso 1-2-5 × 10ᵏ con al menos el mínimo de píxeles entre rótulos', () => {
    expect(niceStep(1, 56)).toBe(100);
    expect(niceStep(10, 56)).toBe(10);
    expect(niceStep(20, 56)).toBe(5);
    expect(niceStep(100, 56)).toBe(1);
    expect(niceStep(150, 56)).toBe(0.5);
    expect(niceStep(0.05, 56)).toBe(2000);
  });

  it('ticks de profundidad: múltiplos exactos, subdivisiones sin repetir las mayores, decimales según el paso', () => {
    const t = depthTicks(7906.21, 7969.91, 10);
    expect(t.step).toBe(10);
    expect(t.major).toEqual([7910, 7920, 7930, 7940, 7950, 7960]);
    expect(t.minorStep).toBe(2);
    expect(t.minor).toContain(7912);
    expect(t.minor).not.toContain(7920);
    expect(t.decimals).toBe(0);
    const fine = depthTicks(8000.03, 8001.2, 150);
    expect(fine.step).toBe(0.5);
    expect(fine.major).toEqual([8000.5, 8001]);
    expect(fine.decimals).toBe(1);
    // paso de 2 → 4 subdivisiones de 0,5
    expect(depthTicks(0, 10, 30).minorStep).toBe(0.5);
  });

  it('sin subdivisiones si quedan por debajo del mínimo pedido', () => {
    // paso 100 m a 0,7 px/m; subdivisiones de 20 m = 14 px < 20 px
    const t = depthTicks(7633, 8518, 0.7, 56, 20);
    expect(t.step).toBe(100);
    expect(t.minorStep).toBeNull();
    expect(t.minor).toEqual([]);
    expect(t.major.length).toBeGreaterThan(3);
  });

  it('grilla lineal de 10 divisiones con la mitad como mayor', () => {
    const g = linearGrid(10);
    expect(g).toHaveLength(9);
    expect(g.filter((l) => l.major).map((l) => l.f)).toEqual([0.5]);
  });

  it('grilla log 0,2–2000: décadas en 1, 10, 100, 1000 y líneas m·10ᵏ', () => {
    const g = logGrid(0.2, 2000);
    expect(g.filter((l) => l.major).map((l) => l.value)).toEqual([1, 10, 100, 1000]);
    const values = g.map((l) => l.value);
    expect(values).toContain(0.3);
    expect(values).toContain(900);
    expect(values).not.toContain(0.2);
    expect(values).not.toContain(2000);
    // 1 ohm·m está a log10(5)/4 del borde izquierdo
    expect(g.find((l) => l.value === 1)!.f).toBeCloseTo(Math.log10(5) / 4, 12);
    expect(logGrid(0, 10)).toEqual([]);
  });
});

describe('escalas horizontales', () => {
  const nphi: AxisScale = { kind: 'linear', min: -0.15, max: 0.45, reversed: true };
  const rt: AxisScale = { kind: 'log', min: 0.2, max: 2000, reversed: false };

  it('lineal invertida (NPHI): 0,45 a la izquierda, −0,15 a la derecha', () => {
    expect(valueToFraction(0.45, nphi)).toBeCloseTo(0, 12);
    expect(valueToFraction(-0.15, nphi)).toBeCloseTo(1, 12);
    expect(valueToFraction(0.15, nphi)).toBeCloseTo(0.5, 12);
    expect(edgeValues(nphi)).toEqual([0.45, -0.15]);
    expect(fractionToValue(valueToFraction(0.21, nphi), nphi)).toBeCloseTo(0.21, 12);
  });

  it('log por décadas: 2 ohm·m a un cuarto; ≤ 0 sin dato', () => {
    expect(valueToFraction(2, rt)).toBeCloseTo(0.25, 12);
    expect(valueToFraction(20, rt)).toBeCloseTo(0.5, 12);
    expect(valueToFraction(0, rt)).toBeNaN();
    expect(fractionToValue(0.75, rt)).toBeCloseTo(200, 9);
  });

  it('fractionArray: misma transformación, en caché por array y escala; NaN se conserva', () => {
    const data = Float64Array.from([0.2, 2, NaN, 2000, 20000]);
    const f = fractionArray(data, rt);
    expect([...f].map((v) => (Number.isNaN(v) ? 'NaN' : +v.toFixed(6)))).toEqual([0, 0.25, 'NaN', 1, 1.25]);
    expect(fractionArray(data, rt)).toBe(f);
    expect(fractionArray(data, { ...rt, max: 200 })).not.toBe(f);
  });

  it('curva de respaldo: solo donde se sale por la derecha (hasta un ancho de escala)', () => {
    const gr: AxisScale = { kind: 'linear', min: 0, max: 150, reversed: false };
    const w = wrapFractionArray(fractionArray(Float64Array.from([75, 180, 300, 450]), gr));
    expect(w[0]).toBeNaN();
    expect(w[1]).toBeCloseTo(0.2, 6);
    expect(w[2]).toBeCloseTo(1, 6);
    expect(w[3]).toBeNaN();
  });

  it('validScale y dataRange', () => {
    expect(validScale({ kind: 'log', min: 0, max: 10, reversed: false })).toBeNull();
    expect(validScale({ kind: 'linear', min: 1, max: 1, reversed: false })).toBeNull();
    expect(dataRange(Float64Array.from([NaN, 10, 20]))).toEqual({ min: 9.5, max: 20.5 });
    expect(dataRange(Float64Array.from([NaN]))).toBeNull();
  });
});

describe('reducción M4 por fila de píxel', () => {
  it('primera, mínima, máxima, última y media por fila', () => {
    const depth = depthRange(8, 0, 0.25); // 4 muestras por metro
    const v = Float64Array.from([1, 5, 2, 3, 10, 0, 4, 4]);
    const b = decimateRows(depth, v, 0, 8, 0, 1, 2); // 1 px por metro → 2 filas
    expect(b.state[0]).toBe(ROW_DATA);
    expect([b.first[0], b.min[0], b.max[0], b.last[0], b.mean[0]]).toEqual([1, 1, 5, 3, 2.75]);
    expect([b.first[1], b.min[1], b.max[1], b.last[1], b.mean[1]]).toEqual([10, 0, 10, 4, 4.5]);
  });

  it('no pierde un pico aislado aunque haya cientos de muestras por fila', () => {
    const n = 50000;
    const depth = depthRange(n, 1000, 0.1524);
    const v = new Float64Array(n).fill(1);
    v[31337] = 110;
    const rows = 400;
    const top = depth[0]!;
    const px = rows / (depth[n - 1]! - top + 1e-9);
    const b = decimateRows(depth, v, 0, n, top, px, rows);
    let max = -Infinity;
    for (let r = 0; r < rows; r++) if (b.state[r] === ROW_DATA) max = Math.max(max, b.max[r]!);
    expect(max).toBe(110);
  });

  it('huecos: una fila solo con NaN corta (GAP); una fila con algún dato no; sin muestras = vacía', () => {
    const depth = Float64Array.from([0, 0.5, 1, 1.5, 2, 2.5, 4.2]);
    const v = Float64Array.from([1, NaN, NaN, NaN, 2, 3, 5]);
    const b = decimateRows(depth, v, 0, depth.length, 0, 1, 5);
    expect(b.state[0]).toBe(ROW_DATA); // 1 y NaN
    expect(b.mean[0]).toBe(1);
    expect(b.state[1]).toBe(ROW_GAP); // solo NaN
    expect(b.state[2]).toBe(ROW_DATA);
    expect(b.state[3]).toBe(ROW_EMPTY); // ninguna muestra cae en [3, 4)
    expect(b.state[4]).toBe(ROW_DATA);
  });

  it('con resumen por bloques da exactamente lo mismo que muestra por muestra (con huecos NaN)', () => {
    const n = 20000;
    const depth = depthRange(n, 0, 0.1524);
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const v = Float32Array.from({ length: n }, (_, i) => (i > 5000 && i < 5400 ? NaN : rnd() < 0.02 ? NaN : rnd() * 100));
    for (const rows of [37, 123, 600]) {
      const top = 50;
      const px = rows / (depth[n - 1]! - top);
      const bounds = rowBounds(depth, 0, n, top, px, rows);
      const a = decimateWithBounds(v, bounds, rows);
      const b = decimateWithBounds(v, bounds, rows, undefined, blockSummary(v));
      for (let r = 0; r < rows; r++) {
        expect(b.state[r]).toBe(a.state[r]);
        if (a.state[r] !== ROW_DATA) continue;
        expect([b.first[r], b.min[r], b.max[r], b.last[r]]).toEqual([a.first[r], a.min[r], a.max[r], a.last[r]]);
        expect(b.mean[r]).toBeCloseTo(a.mean[r]!, 3);
      }
    }
    expect(blockSummary(v)).toBe(blockSummary(v)); // en caché
  });

  it('reusa los buffers y limpia las filas en cada llamada', () => {
    const depth = depthRange(10, 0, 1);
    const a = decimateRows(depth, new Float64Array(10).fill(1), 0, 10, 0, 1, 10);
    const b = decimateRows(depth, new Float64Array(10).fill(NaN), 0, 10, 0, 1, 10, a);
    expect(b).toBe(a);
    expect([...b.state.subarray(0, 10)].every((s) => s === ROW_GAP)).toBe(true);
  });

  it('tramo visible por búsqueda binaria, con una muestra de margen', () => {
    const depth = depthRange(100, 0, 1);
    expect(lowerBound(depth, 10.5)).toBe(11);
    expect(visibleRange(depth, 10.5, 20.5)).toEqual([10, 22]);
    expect(visibleRange(depth, -50, 1000)).toEqual([0, 100]);
  });
});

describe('rellenos entre curvas', () => {
  it('cuadrilátero a un lado; el área coincide con el trapecio', () => {
    const a = new AreaSink();
    const b = new AreaSink();
    fillBetween(2, [0, 10], [1, 3], [5, 5], a, b);
    expect(a.area).toBeCloseTo(((4 + 2) / 2) * 10, 9);
    expect(b.area).toBe(0);
  });

  it('cruce: dos triángulos con el punto de cruce interpolado', () => {
    const a = new AreaSink();
    const b = new AreaSink();
    fillBetween(2, [0, 1], [0, 2], [2, 0], a, b);
    expect(a.area).toBeCloseTo(0.5, 12);
    expect(b.area).toBeCloseTo(0.5, 12);
    expect(a.polygons + b.polygons).toBe(2);
  });

  it('NaN corta el relleno; valores fuera de escala se acotan al borde', () => {
    const a = new AreaSink();
    fillBetween(4, [0, 1, 2, 3], [0, NaN, 0, 0], [1, 1, 1, 1], a, null);
    expect(a.area).toBeCloseTo(1, 12); // solo el tramo 2→3
    const c = new AreaSink();
    fillBetween(2, [0, 1], [-100, -100], [10, 10], c, null, 0, 10);
    expect(c.area).toBeCloseTo(10, 12);
  });

  it('relleno hacia un borde (valor fijo)', () => {
    const s = new AreaSink();
    fillBetween(3, [0, 1, 2], [4, 6, 4], 0, null, s);
    expect(s.area).toBeCloseTo(10, 12);
  });
});

describe('lectura en el cursor', () => {
  const depth = depthRange(5, 100, 0.5); // 100, 100.5 … 102

  it('muestra más cercana; fuera del pozo = -1', () => {
    expect(nearestIndex(depth, 100.2)).toBe(0);
    expect(nearestIndex(depth, 100.3)).toBe(1);
    expect(nearestIndex(depth, 102.2)).toBe(4);
    expect(nearestIndex(depth, 99.6)).toBe(-1);
    expect(nearestIndex(depth, 102.4)).toBe(-1);
    expect(nearestIndex(depth, NaN)).toBe(-1);
  });

  it('NaN = sin dato; formato con 4 cifras significativas y coma decimal; banderas sí/no', () => {
    const data = Float64Array.from([84.2345, NaN, 2.4531, 0.21553, 1]);
    expect(formatReadout(valueAt(data, 0))).toBe('84,23');
    expect(formatReadout(valueAt(data, 1))).toBe('—');
    expect(formatReadout(valueAt(data, -1))).toBe('—');
    expect(formatReadout(valueAt(data, 2))).toBe('2,453');
    expect(formatReadout(valueAt(data, 3))).toBe('0,2155');
    expect(formatReadout(1, 'band')).toBe('sí');
    expect(formatReadout(0, 'band')).toBe('no');
  });
});

describe('anchos de pista', () => {
  it('fijos primero; el resto proporcional; bordes en px enteros y contiguos', () => {
    const { boxes, total } = layoutTracks([{ width: 1 }, { fixed: 76 }, { width: 1 }, { width: 2 }], 1076);
    expect(boxes[1]!.width).toBe(76);
    expect(boxes[0]!.width).toBe(250);
    expect(boxes[3]!.width).toBe(500);
    expect(total).toBe(1076);
    for (let i = 1; i < boxes.length; i++) expect(boxes[i]!.x).toBe(boxes[i - 1]!.x + boxes[i - 1]!.width);
    expect(trackAt(boxes, 260)).toBe(1);
    expect(trackAt(boxes, 2000)).toBe(-1);
  });

  it('sin lugar: cada pista flexible conserva el mínimo y el total excede (desplazamiento horizontal)', () => {
    const { boxes, total } = layoutTracks([{ width: 1 }, { fixed: 76 }, { width: 3 }], 200, 104);
    expect(boxes[0]!.width).toBe(104);
    expect(boxes[2]!.width).toBe(104);
    expect(total).toBe(284);
  });

  it('una pista angosta sube al mínimo y el resto se reparte entre las demás', () => {
    const { boxes } = layoutTracks([{ width: 0.1 }, { width: 1 }, { width: 1 }], 600, 100);
    expect(boxes[0]!.width).toBe(100);
    expect(boxes[1]!.width).toBe(250);
    expect(boxes[2]!.width).toBe(250);
  });
});
