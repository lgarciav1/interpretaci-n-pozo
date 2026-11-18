/**
 * Geometría y dibujo del gráfico x–y (src/plots/xy/axes.ts y draw.ts, docs/decisiones/0010 D6): mapeo dato ↔ px en
 * ejes lineales, logarítmicos e invertidos, ticks «lindos» y por décadas, rangos automáticos, búsqueda de puntos y
 * llamadas al canvas (con un contexto que registra, sin DOM). Todos los números se verifican con cuentas a mano.
 */
import { describe, expect, it } from 'vitest';
import {
  axisFraction,
  axisTicks,
  dataRectFromPx,
  formatTick,
  fractionValue,
  inDataRect,
  nearestPoint,
  niceRange,
  niceStep,
  plotRectFor,
  pointsInRect,
  validAxis,
  xyMapping,
  type XYAxis,
} from '../../src/plots/xy/axes';
import { axisTitle, drawDataLine, drawFrame, drawPoint, drawXYTrend } from '../../src/plots/xy/draw';
import { THEMES } from '../../src/ui/tokens';

const X: XYAxis = { kind: 'linear', min: 0, max: 0.4, label: 'Porosidad φ', unit: 'v/v' };
const Y: XYAxis = { kind: 'log', min: 0.01, max: 10000, label: 'Permeabilidad k', unit: 'mD' }; // 6 décadas
const RECT = { x: 50, y: 10, width: 400, height: 300 };

describe('axisFraction / fractionValue', () => {
  it('lineal: 0,1 en [0; 0,4] → 0,25; los extremos → 0 y 1; fuera de rango NO se acota', () => {
    expect(axisFraction(X, 0.1)).toBeCloseTo(0.25, 12);
    expect(axisFraction(X, 0)).toBe(0);
    expect(axisFraction(X, 0.4)).toBeCloseTo(1, 12);
    expect(axisFraction(X, 0.5)).toBeCloseTo(1.25, 12);
    expect(axisFraction(X, -0.1)).toBeCloseTo(-0.25, 12);
  });

  it('log: 1 mD en [0,01; 10 000] → (0 − (−2)) / 6 = 1/3; 100 → 4/6; las décadas son equidistantes', () => {
    expect(axisFraction(Y, 1)).toBeCloseTo(1 / 3, 12);
    expect(axisFraction(Y, 100)).toBeCloseTo(2 / 3, 12);
    expect(axisFraction(Y, 0.01)).toBeCloseTo(0, 12);
    expect(axisFraction(Y, 10000)).toBeCloseTo(1, 12);
    expect(axisFraction(Y, 10) - axisFraction(Y, 1)).toBeCloseTo(axisFraction(Y, 1000) - axisFraction(Y, 100), 12);
  });

  it('log con valores ≤ 0 o no finitos → NaN (no se pueden ubicar)', () => {
    for (const v of [0, -5, NaN, Infinity, -Infinity]) expect(axisFraction(Y, v), String(v)).toBeNaN();
    expect(axisFraction(X, NaN)).toBeNaN();
    expect(axisFraction(X, 0)).toBe(0); // en lineal el cero sí existe
    expect(axisFraction(X, -0.1)).toBeCloseTo(-0.25, 12);
  });

  it('invertido: el mayor queda en 0; la inversa lo respeta', () => {
    const rev: XYAxis = { ...X, reversed: true };
    expect(axisFraction(rev, 0.4)).toBeCloseTo(0, 12);
    expect(axisFraction(rev, 0.1)).toBeCloseTo(0.75, 12);
    expect(fractionValue(rev, 0.75)).toBeCloseTo(0.1, 12);
    const revLog: XYAxis = { ...Y, reversed: true };
    expect(axisFraction(revLog, 1)).toBeCloseTo(2 / 3, 12);
    expect(fractionValue(revLog, 2 / 3)).toBeCloseTo(1, 10);
  });

  it('ida y vuelta en cada tipo de eje', () => {
    for (const a of [X, Y, { ...X, reversed: true }, { ...Y, reversed: true }]) {
      for (const f of [0, 0.13, 0.5, 0.99, 1]) expect(axisFraction(a, fractionValue(a, f)), `${a.kind}${a.reversed ? ' inv' : ''} ${f}`).toBeCloseTo(f, 10);
    }
  });

  it('mapea y rotula rangos manuales con extremos finitos', () => {
    const wide = { ...X, min: -Number.MAX_VALUE, max: Number.MAX_VALUE };
    expect(axisFraction(wide, 0)).toBe(0.5);
    expect(fractionValue(wide, 0.5)).toBe(0);
    expect(axisTicks(wide, 400).map((tick) => tick.value)).toEqual([wide.min, wide.max]);
    expect(fractionValue({ ...X, min: -1e20, max: -1 }, 1)).toBe(-1);
    const tight = { ...X, min: 1e16, max: 1e16 + 2 };
    expect(axisTicks(tight, 400).map((tick) => tick.value)).toEqual([tight.min, tight.max]);
    const log = { ...Y, max: Number.MAX_VALUE };
    expect(fractionValue(log, 1)).toBe(log.max);
    expect(fractionValue(log, 1 - Number.EPSILON)).toBeLessThanOrEqual(log.max);
  });

  it('validAxis: max > min, finitos y, en log, min > 0', () => {
    expect(validAxis(X)).toBe(true);
    expect(validAxis(Y)).toBe(true);
    expect(validAxis({ ...X, max: 0 })).toBe(false);
    expect(validAxis({ ...X, min: NaN })).toBe(false);
    expect(validAxis({ ...Y, min: 0 })).toBe(false);
    expect(validAxis({ ...Y, min: -1 })).toBe(false);
    expect(validAxis({ ...X, min: -1 })).toBe(true);
  });
});

describe('xyMapping: dato → px', () => {
  const m = xyMapping(X, Y, RECT);

  it('x lineal: 0,1 → 50 + 0,25·400 = 150; y log (crece hacia arriba): 1 mD → 10 + (1 − 1/3)·300 = 210', () => {
    expect(m.x(0.1)).toBeCloseTo(150, 9);
    expect(m.y(1)).toBeCloseTo(210, 9);
    expect(m.x(0)).toBe(50);
    expect(m.x(0.4)).toBeCloseTo(450, 9);
    expect(m.y(10000)).toBeCloseTo(10, 9); // el máximo, arriba
    expect(m.y(0.01)).toBeCloseTo(310, 9); // el mínimo, abajo
  });

  it('log en ambos ejes: dos décadas en x = 1/3 del ancho', () => {
    const mm = xyMapping({ kind: 'log', min: 1, max: 1000, label: 'x' }, { kind: 'log', min: 1, max: 1000, label: 'y' }, RECT);
    expect(mm.x(100)).toBeCloseTo(50 + (2 / 3) * 400, 9);
    expect(mm.y(10)).toBeCloseTo(10 + (1 - 1 / 3) * 300, 9);
  });

  it('puntos fuera de rango: salen del área (sin acotar) para que el dibujo los recorte', () => {
    expect(m.x(0.5)).toBeCloseTo(550, 9);
    expect(m.x(-0.1)).toBeCloseTo(-50, 9);
    expect(m.y(1e6)).toBeLessThan(RECT.y);
    expect(m.y(1e-6)).toBeGreaterThan(RECT.y + RECT.height);
  });

  it('valores ≤ 0 en el eje log → NaN (no se dibujan)', () => {
    expect(m.y(0)).toBeNaN();
    expect(m.y(-3)).toBeNaN();
    expect(m.y(NaN)).toBeNaN();
    expect(m.x(NaN)).toBeNaN();
  });

  it('inversa: px → dato', () => {
    expect(m.xInv(150)).toBeCloseTo(0.1, 12);
    expect(m.yInv(210)).toBeCloseTo(1, 9);
    for (const v of [0.02, 0.17, 0.4]) expect(m.xInv(m.x(v))).toBeCloseTo(v, 12);
    for (const v of [0.05, 1, 37, 8000]) expect(m.yInv(m.y(v))).toBeCloseTo(v, 9);
  });

  it('ejes invertidos: y no se invierte dos veces', () => {
    const mm = xyMapping({ ...X, reversed: true }, { ...Y, reversed: true }, RECT);
    expect(mm.x(0.4)).toBeCloseTo(50, 9);
    expect(mm.x(0.1)).toBeCloseTo(50 + 0.75 * 400, 9);
    expect(mm.y(10000)).toBeCloseTo(310, 9);
    expect(mm.xInv(mm.x(0.13))).toBeCloseTo(0.13, 12);
    expect(mm.yInv(mm.y(7))).toBeCloseTo(7, 9);
  });
});

describe('niceStep y formatTick', () => {
  it('paso 1-2-5 × 10ᵏ ≥ el pedido', () => {
    expect(niceStep(0.056)).toBe(0.1);
    expect(niceStep(1.1)).toBe(2);
    expect(niceStep(2)).toBe(2);
    expect(niceStep(2.0000001)).toBe(5);
    expect(niceStep(7)).toBe(10);
    expect(niceStep(0.0031)).toBe(0.005);
    expect(niceStep(430)).toBe(500);
    expect(niceStep(0)).toBe(1);
    expect(niceStep(-3)).toBe(1);
    expect(niceStep(NaN)).toBe(1);
  });

  it('rótulos en español: coma decimal, miles con punto, signo menos tipográfico', () => {
    expect(formatTick(0.1, X, 0.1)).toBe('0,1');
    expect(formatTick(0, X, 0.1)).toBe('0,0');
    expect(formatTick(-0.2, X, 0.1)).toBe('−0,2');
    expect(formatTick(0.01, Y)).toBe('0,01');
    expect(formatTick(1, Y)).toBe('1');
    expect(formatTick(100, Y)).toBe('100');
    expect(formatTick(10000, Y)).toBe('10.000');
  });
});

describe('axisTicks', () => {
  it('lineal [0; 0,4] en 400 px: mayores cada 0,1 con rótulo; menores cada 0,02 sin rótulo; sin repetir los mayores', () => {
    const t = axisTicks(X, 400);
    const major = t.filter((k) => k.major);
    expect(major.map((k) => k.value)).toEqual([0, 0.1, 0.2, 0.3, 0.4]);
    expect(major.map((k) => k.label)).toEqual(['0,0', '0,1', '0,2', '0,3', '0,4']);
    major.forEach((k, i) => expect(k.f).toBeCloseTo(i / 4, 12));
    const minor = t.filter((k) => !k.major);
    expect(minor).toHaveLength(16);
    expect(minor.every((k) => k.label === null)).toBe(true);
    expect(minor.map((k) => k.value).slice(0, 4)).toEqual([0.02, 0.04, 0.06, 0.08]);
    expect(t.map((k) => k.f)).toEqual([...t.map((k) => k.f)].sort((a, b) => a - b));
  });

  it('lineal: más corto el eje, paso más grande (no se pisan los rótulos)', () => {
    const t = axisTicks(X, 120, 56);
    const major = t.filter((k) => k.major).map((k) => k.value);
    expect(major).toEqual([0, 0.2, 0.4]);
  });

  it('log [0,01; 10 000] en 300 px (50 px por década): una marca mayor por década, rótulo cada 2 décadas, menores 2…9', () => {
    const t = axisTicks(Y, 300);
    const major = t.filter((k) => k.major);
    expect(major.map((k) => k.value)).toEqual([0.01, 0.1, 1, 10, 100, 1000, 10000]);
    expect(major.map((k) => k.f.toFixed(6))).toEqual(['0.000000', '0.166667', '0.333333', '0.500000', '0.666667', '0.833333', '1.000000']);
    // Rótulo cada ceil(56/50) = 2 décadas: 10⁻², 10⁰, 10², 10⁴.
    expect(major.map((k) => k.label)).toEqual(['0,01', null, '1', null, '100', null, '10.000']);
    const minor = t.filter((k) => !k.major);
    expect(minor).toHaveLength(48); // 8 por década × 6 décadas
    // Dentro de una década, las menores están en escala log: 2·10ᵏ queda en log10(2) = 0,30103 de la década.
    const two = minor.find((k) => k.value === 2)!;
    expect(two.f).toBeCloseTo((2 + Math.log10(2)) / 6, 10);
  });

  it('log con pocas décadas y mucho lugar: también rotula 2 y 5', () => {
    const t = axisTicks({ kind: 'log', min: 1, max: 100, label: 'x' }, 600);
    const labelled = t.filter((k) => k.label).map((k) => k.value);
    expect(labelled).toEqual([1, 2, 5, 10, 20, 50, 100]);
  });

  it('log de muchas décadas: se omiten los menores demasiado juntos (< 18 px por década)', () => {
    const t = axisTicks({ kind: 'log', min: 1e-6, max: 1e6, label: 'x' }, 200);
    expect(t.every((k) => k.major)).toBe(true);
    expect(t.length).toBe(13);
  });

  it('ejes inválidos o sin largo → sin marcas', () => {
    expect(axisTicks({ ...Y, min: 0 }, 300)).toEqual([]);
    expect(axisTicks({ ...X, max: 0 }, 300)).toEqual([]);
    expect(axisTicks(X, 0)).toEqual([]);
  });

  it('en eje invertido la fracción ya viene invertida', () => {
    const t = axisTicks({ ...X, reversed: true }, 400).filter((k) => k.major);
    expect(t.find((k) => k.value === 0.4)!.f).toBe(0);
    expect(t.find((k) => k.value === 0)!.f).toBe(1);
  });
});

describe('niceRange', () => {
  it('lineal: margen del 5 % y extremos múltiplos de un paso 1-2-5', () => {
    // a mano: lo = 0,05; hi = 0,3; span 0,25; pad 0,0125; paso = niceStep(0,275 / 5 = 0,055) = 0,1 → [0; 0,4]
    expect(niceRange([[0.05, 0.1, 0.3]], 'linear')).toEqual({ min: 0, max: 0.4 });
  });

  it('lineal con `zero`: incluye el cero', () => {
    expect(niceRange([[0.2, 0.3]], 'linear', { zero: true })!.min).toBe(0);
  });

  it('log: extremos en décadas enteras y solo valores > 0', () => {
    expect(niceRange([[0.02, 5, 3000]], 'log')).toEqual({ min: 0.01, max: 10000 });
    expect(niceRange([[0, -4, 0.5, 20]], 'log')).toEqual({ min: 0.1, max: 100 });
  });

  it('log de un solo valor o de una década exacta: al menos una década de ancho', () => {
    expect(niceRange([[5]], 'log')).toEqual({ min: 1, max: 10 });
    expect(niceRange([[10]], 'log')).toEqual({ min: 10, max: 100 });
  });

  it('une varias series y ignora NaN; sin valores válidos → null', () => {
    expect(niceRange([[0.05, NaN], [0.3]], 'linear')).toEqual({ min: 0, max: 0.4 });
    expect(niceRange([[NaN], []], 'linear')).toBeNull();
    expect(niceRange([[-1, 0]], 'log')).toBeNull();
  });

  it('valor único en lineal: rango no degenerado', () => {
    const r = niceRange([[0.2]], 'linear')!;
    expect(r.max).toBeGreaterThan(r.min);
    expect(r.min).toBeLessThanOrEqual(0.2);
    expect(r.max).toBeGreaterThanOrEqual(0.2);
  });
});

describe('plotRectFor', () => {
  it('márgenes para rótulos y títulos', () => {
    expect(plotRectFor(600, 400)).toEqual({ x: 56, y: 10, width: 530, height: 350 });
    expect(plotRectFor(600, 400, true)).toEqual({ x: 34, y: 6, width: 558, height: 370 });
  });
  it('nunca menos de 10 px', () => {
    const r = plotRectFor(20, 20);
    expect(r.width).toBe(10);
    expect(r.height).toBe(10);
  });
});

describe('búsqueda de puntos', () => {
  it('nearestPoint: el más cercano dentro de maxDist; NaN ignorados; −1 si no hay', () => {
    const xs = [10, 50, NaN, 100];
    const ys = [10, 50, 50, 100];
    expect(nearestPoint(xs, ys, 52, 49, 10)).toBe(1);
    expect(nearestPoint(xs, ys, 52, 49, 1)).toBe(-1);
    expect(nearestPoint(xs, ys, 400, 400, 20)).toBe(-1);
    expect(nearestPoint([], [], 0, 0, 10)).toBe(-1);
  });

  it('dataRectFromPx: ordenado y válido con ejes log e invertidos', () => {
    const m = xyMapping(X, Y, RECT);
    // (150, 210) → (0,1; 1 mD) y (250, 110) → (0,2; 100 mD); las esquinas pueden venir en cualquier orden.
    const r = dataRectFromPx(m, 250, 210, 150, 110);
    expect(r.xMin).toBeCloseTo(0.1, 12);
    expect(r.xMax).toBeCloseTo(0.2, 12);
    expect(r.yMin).toBeCloseTo(1, 9);
    expect(r.yMax).toBeCloseTo(100, 9);
    const rev = dataRectFromPx(xyMapping({ ...X, reversed: true }, Y, RECT), 150, 210, 250, 110);
    expect(rev.xMin).toBeLessThan(rev.xMax);
    expect(rev.xMin).toBeCloseTo(0.2, 12);
    expect(rev.xMax).toBeCloseTo(0.3, 12);
  });

  it('pointsInRect / inDataRect: bordes inclusivos y NaN fuera', () => {
    const r = { xMin: 0.1, xMax: 0.2, yMin: 1, yMax: 100 };
    expect(inDataRect(r, 0.1, 1)).toBe(true);
    expect(inDataRect(r, 0.2, 100)).toBe(true);
    expect(inDataRect(r, 0.21, 10)).toBe(false);
    expect(inDataRect(r, NaN, 10)).toBe(false);
    expect(pointsInRect(r, [0.05, 0.1, 0.15, 0.2, 0.3, NaN], [10, 1, 50, 100, 10, 10])).toEqual([1, 2, 3]);
  });
});

// ── dibujo con un contexto que registra las llamadas ───────────────────────────────────────────────────────────

type Call = { name: string; args: unknown[] };
function recorder() {
  const calls: Call[] = [];
  const ctx = new Proxy({} as Record<string | symbol, unknown>, {
    get(target, prop) {
      if (prop in target) return target[prop];
      if (prop === 'measureText') return (t: string) => ({ width: t.length * 6 });
      return (...args: unknown[]) => {
        calls.push({ name: String(prop), args });
      };
    },
    set(target, prop, v) {
      target[prop] = v;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { ctx, calls, of: (name: string) => calls.filter((c) => c.name === name) };
}

describe('draw: marco, puntos y líneas', () => {
  const m = xyMapping(X, Y, RECT);

  it('axisTitle agrega la unidad entre paréntesis', () => {
    expect(axisTitle(X)).toBe('Porosidad φ (v/v)');
    expect(axisTitle({ kind: 'linear', min: 0, max: 1, label: 'Índice' })).toBe('Índice');
  });

  it('drawFrame: grilla en la posición exacta de cada marca, rótulos de décadas y títulos de los dos ejes', () => {
    const r = recorder();
    drawFrame(r.ctx, m, X, Y, THEMES.light);
    const moves = r.of('moveTo').map((c) => c.args as [number, number]);
    // x = 0,1 → 150 → línea vertical en 150,5 de y = 10 a 310; 1 mD → 210 → línea horizontal en y = 210,5.
    expect(moves).toContainEqual([150.5, 10]);
    expect(moves).toContainEqual([50, 210.5]);
    const texts = r.of('fillText').map((c) => c.args[0]);
    // El eje y mide 300 px (50 px por década) y pide ≥ 34 px entre rótulos: se rotula cada década.
    for (const t of ['0,1', '0,3', '0,01', '1', '10', '100', '1.000', '10.000', 'Porosidad φ (v/v)', 'Permeabilidad k (mD)']) expect(texts, t).toContain(t);
  });

  it('drawFrame compacto: sin títulos de ejes', () => {
    const r = recorder();
    drawFrame(r.ctx, m, X, Y, THEMES.light, true);
    const texts = r.of('fillText').map((c) => c.args[0]);
    expect(texts).not.toContain('Porosidad φ (v/v)');
  });

  it('drawPoint: lleno = círculo con relleno y borde; vacío = igual con otro estilo; tachado = además una × (4 trazos)', () => {
    for (const [variant, moves] of [['filled', 0], ['hollow', 0], ['crossed', 2]] as const) {
      const r = recorder();
      drawPoint(r.ctx, 100, 120, 4, '#a21caf', variant, '#ffffff');
      expect(r.of('arc'), variant).toHaveLength(1);
      expect(r.of('arc')[0]!.args.slice(0, 3)).toEqual([100, 120, 4]);
      expect(r.of('fill'), variant).toHaveLength(1);
      expect(r.of('moveTo'), variant).toHaveLength(moves);
      expect(r.of('lineTo'), variant).toHaveLength(moves);
      expect(r.of('stroke'), variant).toHaveLength(variant === 'crossed' ? 2 : 1);
    }
    const filled = recorder();
    drawPoint(filled.ctx, 0, 0, 3, '#a21caf', 'filled', '#ffffff');
    expect((filled.ctx as unknown as Record<string, unknown>)['fillStyle']).toBe('#a21caf');
    const crossed = recorder();
    drawPoint(crossed.ctx, 10, 10, 4, '#a21caf', 'crossed', '#ffffff');
    // La × tiene lado 0,55·r = 2,2 px a cada lado del centro.
    expect(crossed.of('moveTo').map((c) => c.args)).toEqual([[7.8, 7.8], [12.2, 7.8]]);
  });

  it('drawDataLine: corta la línea en los valores que no se pueden ubicar (NaN y ≤ 0 en el eje log)', () => {
    const r = recorder();
    drawDataLine(r.ctx, m, [0.1, 0.2, 0.3, 0.4], [1, 0, 10, 100], '#000');
    // (0,1; 1) pluma levantada; (0,2; 0) no se ubica → se corta; (0,3; 10) vuelve con moveTo; (0,4; 100) lineTo.
    const mv = r.of('moveTo').map((c) => c.args as [number, number]);
    expect(mv).toHaveLength(2);
    expect(mv[0]![0]).toBeCloseTo(150, 9);
    expect(mv[0]![1]).toBeCloseTo(210, 9);
    expect(mv[1]![0]).toBeCloseTo(350, 9);
    expect(mv[1]![1]).toBeCloseTo(160, 9);
    const ln = r.of('lineTo').map((c) => c.args as [number, number]);
    expect(ln).toHaveLength(1);
    expect(ln[0]![0]).toBeCloseTo(450, 9);
    expect(ln[0]![1]).toBeCloseTo(110, 9);
    expect(r.of('stroke')).toHaveLength(1);
  });

  it('drawDataLine: con guiones y ancho', () => {
    const r = recorder();
    drawDataLine(r.ctx, m, [0.1, 0.2], [1, 10], '#000', 2, [4, 3]);
    expect(r.of('setLineDash')[0]!.args[0]).toEqual([4, 3]);
    expect((r.ctx as unknown as Record<string, unknown>)['lineWidth']).toBe(2);
  });

  it('drawXYTrend: recorta al área de dibujo y traza; sin etiqueta no devuelve caja', () => {
    const r = recorder();
    const box = drawXYTrend(r.ctx, m, X, { model: 'exp', a: 0.02007, b: 50.22 }, [0.06, 0.21], { color: '#1d4ed8', extend: false }, THEMES.light);
    expect(box).toBeNull();
    expect(r.of('rect')[0]!.args).toEqual([50, 10, 400, 300]);
    expect(r.of('clip')).toHaveLength(1);
    expect(r.of('stroke').length).toBeGreaterThan(0);
  });

  it('drawXYTrend con etiqueta: devuelve la caja, dentro del área', () => {
    const r = recorder();
    const box = drawXYTrend(r.ctx, m, X, { model: 'exp', a: 0.02007, b: 50.22 }, [0.06, 0.21], { color: '#1d4ed8', extend: true, label: ['k = 0,02·e^(50,2·φ)', 'R² = 0,97'] }, THEMES.light);
    expect(box).not.toBeNull();
    expect(box!.w).toBeGreaterThan(0);
    expect(box!.x).toBeGreaterThanOrEqual(RECT.x - 5);
    expect(box!.x + box!.w).toBeLessThanOrEqual(RECT.x + RECT.width + 5);
    expect(r.of('fillText').map((c) => c.args[0])).toContain('R² = 0,97');
  });
});
