/**
 * Ampliaciones de la base x–y de la fase 7a (docs/decisiones/0014): búsqueda por grilla para nubes grandes, extremo
 * visible de una línea guía, rótulos de potencias de 10, guías arrastrables (redondeo y paso del teclado), barras y
 * eje derecho en el dibujo.
 */
import { describe, expect, it } from 'vitest';
import { formatTick, plotRectFor, xyMapping, type XYAxis } from '../../src/plots/xy/axes';
import { drawBars, drawXYScene, visibleEnd } from '../../src/plots/xy/draw';
import { buildPointGrid, gridNearest } from '../../src/plots/xy/pick';
import { nudgeGuideValue, snapGuideValue } from '../../src/plots/xy/XYPlot';
import { THEMES } from '../../src/ui/tokens';

const X: XYAxis = { kind: 'linear', min: 0, max: 100, label: 'x' };
const Y: XYAxis = { kind: 'linear', min: 0, max: 100, label: 'y' };
const m = xyMapping(X, Y, { x: 0, y: 0, width: 100, height: 100 });

/** Contexto 2D que registra llamadas (sin DOM). */
function recorder() {
  const calls: string[] = [];
  const ctx = new Proxy(
    {},
    {
      get(_t, k: string) {
        if (k === 'measureText') return (s: string) => ({ width: s.length * 6 });
        if (k === 'createLinearGradient') return () => ({ addColorStop() {} });
        return (...a: unknown[]) => calls.push(`${k}(${a.map((v) => (typeof v === 'number' ? Math.round(v) : typeof v)).join(',')})`);
      },
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D;
  return { ctx, calls };
}

describe('grilla de búsqueda', () => {
  it('encuentra el más cercano igual que la búsqueda exhaustiva', () => {
    const n = 5000;
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 100;
    const xs = Float64Array.from({ length: n }, rnd);
    const ys = Float64Array.from({ length: n }, rnd);
    const g = buildPointGrid(xs, ys, m, 8);
    for (const [px, py] of [
      [10, 10],
      [50.5, 49.2],
      [99, 1],
    ] as const) {
      let best = -1;
      let bd = 6;
      for (let i = 0; i < n; i++) {
        const d = Math.hypot(m.x(xs[i]!) - px, m.y(ys[i]!) - py);
        if (d < bd || (d === bd && i > best)) {
          bd = d;
          best = i;
        }
      }
      const hit = gridNearest(g, px, py, 6);
      expect(hit?.i ?? -1).toBe(best);
    }
  });
  it('ignora los NaN y lo que está lejos', () => {
    const g = buildPointGrid([NaN, 50], [NaN, 50], m);
    expect(gridNearest(g, 50, 50, 4)?.i).toBe(1);
    expect(gridNearest(g, 10, 10, 4)).toBeNull();
  });
});

describe('extremo visible de una línea', () => {
  it('recorta al borde del área', () => {
    // De (−50, 50) a (150, 50) en datos: entra por x = 0, sale por x = 100 (y en px = 50).
    expect(visibleEnd(m, [-50, 150], [50, 50], 'start')).toEqual([0, 50]);
    expect(visibleEnd(m, [-50, 150], [50, 50], 'end')).toEqual([100, 50]);
    // Totalmente afuera.
    expect(visibleEnd(m, [200, 300], [50, 60], 'start')).toBeNull();
  });
});

describe('rótulos de ejes log', () => {
  it('potencias de 10 lejanas como 10ⁿ', () => {
    const L: XYAxis = { kind: 'log', min: 1e-8, max: 1e8, label: 'k' };
    expect(formatTick(1e-7, L)).toBe('10⁻⁷');
    expect(formatTick(1e7, L)).toBe('10⁷');
    expect(formatTick(0.01, L)).toBe('0,01');
    expect(formatTick(1000, L)).toBe('1.000');
  });
});

describe('guías arrastrables', () => {
  it('redondeo humano al soltar', () => {
    expect(snapGuideValue({ ...X, max: 0.4 }, 0.08137)).toBeCloseTo(0.081, 12); // paso 0,001
    expect(snapGuideValue({ kind: 'log', min: 0.1, max: 1000, label: 'R' }, 12.3456)).toBe(12.3);
  });
  it('teclado: 1 % del eje en la dirección en pantalla (también invertido)', () => {
    expect(nudgeGuideValue(X, 50, 1)).toBe(51);
    expect(nudgeGuideValue(X, 50, -10)).toBe(40);
    expect(nudgeGuideValue({ ...X, reversed: true }, 50, 1)).toBe(49);
    expect(nudgeGuideValue(X, 99.5, 10)).toBe(100); // acotado al eje
  });
});

describe('dibujo de barras y eje derecho', () => {
  it('una barra por clase con valor > 0 y el contorno escalonado', () => {
    const { ctx, calls } = recorder();
    drawBars(ctx, m, { id: 'b', edges: [0, 10, 20, 30], values: [5, 0, 10], color: '#336699' });
    expect(calls.filter((c) => c.startsWith('fillRect'))).toHaveLength(2);
    expect(calls.filter((c) => c.startsWith('lineTo')).length).toBeGreaterThan(5);
  });
  it('la escena con eje derecho y guía rotulada no falla y reserva margen', () => {
    const { ctx } = recorder();
    const r = plotRectFor(400, 300, false, 1, true);
    expect(r.x + r.width).toBeLessThan(400 - 40);
    expect(() =>
      drawXYScene(ctx, xyMapping(X, Y, r), X, Y, { bars: [{ id: 'b', edges: [0, 50, 100], values: [20, 40], color: '#336699' }], lines: [{ id: 'c', x: [50, 100], y: [30, 100], color: '#000000', y2: true, label: 'Acum.' }], guides: [{ axis: 'x', value: 40, color: '#ff0000', label: 'Cutoff global · 40', detail: 'Pasa 60 %' }], y2: { kind: 'linear', min: 0, max: 100, label: 'Acumulada', unit: '%' } }, THEMES.light),
    ).not.toThrow();
  });
});
