/**
 * Geometría del dibujo de tendencias, independiente de los ejes (docs/decisiones/0008, D5): muestreo adaptativo
 * en píxeles, extensión punteada, recorte al rango visible, manijas, cortes fuera de dominio y orientación.
 */
import { describe, expect, it } from 'vitest';
import { distanceToPolylines, projectPoint, sampleTrendPath, trendGeometry, type TrendMapping } from '../../src/plots/trend/draw';
import { valueToFraction } from '../../src/viewer/scale';

/** Visor: profundidad 1000–1100 m en 0–500 px (vertical); valor en una pista de 200 px desde x = 100. */
const yOf = (d: number) => (d - 1000) * 5;
const viewerLinear: TrendMapping = { x: yOf, y: (v) => 100 + valueToFraction(v, { kind: 'linear', min: 0, max: 100, reversed: false }) * 200, transpose: true };
const viewerLog: TrendMapping = { x: yOf, y: (v) => 100 + valueToFraction(v, { kind: 'log', min: 0.2, max: 2000, reversed: false }) * 200, transpose: true };

const maxChordError = (line: number[]) => {
  // Distancia máxima de los puntos intermedios a la recta entre extremos.
  const [ax, ay] = [line[0]!, line[1]!];
  const [bx, by] = [line[line.length - 2]!, line[line.length - 1]!];
  let worst = 0;
  for (let k = 2; k + 3 < line.length; k += 2) {
    const d = Math.abs((by - ay) * (line[k]! - ax) - (bx - ax) * (line[k + 1]! - ay)) / Math.hypot(bx - ax, by - ay);
    worst = Math.max(worst, d);
  }
  return worst;
};

describe('muestreo adaptativo', () => {
  it('una recta en ejes lineales son dos puntos (en el visor, transpuesta: x de pantalla = valor)', () => {
    const lines = sampleTrendPath({ model: 'linear', a: -950, b: 1 }, 1010, 1090, viewerLinear);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual([100 + 60 * 2, 50, 100 + 140 * 2, 450]);
  });

  it('una recta lineal en una pista logarítmica NO es recta: muchos puntos, cada uno sobre la curva', () => {
    const c = { model: 'linear' as const, a: -1000 + 1, b: 1 }; // 1 → 101 ohm·m entre 1000 y 1100 m
    const [line] = sampleTrendPath(c, 1000, 1100, viewerLog, 0.35);
    expect(line!.length / 2).toBeGreaterThan(8);
    expect(maxChordError(line!)).toBeGreaterThan(20); // se curva decenas de px
    // Cada punto está sobre la curva verdadera; los segmentos no se apartan más que la tolerancia.
    for (let k = 0; k < line!.length; k += 2) {
      const d = 1000 + line![k + 1]! / 5;
      expect(line![k]).toBeCloseTo(viewerLog.y(c.a + c.b * d), 6);
    }
    for (let k = 0; k + 3 < line!.length; k += 2) {
      // El punto verdadero a mitad de cada segmento (en profundidad) queda a < 0,5 px del segmento dibujado.
      const dm = 1000 + (line![k + 1]! + line![k + 3]!) / 10;
      const p: [number, number] = [viewerLog.y(c.a + c.b * dm), yOf(dm)];
      expect(distanceToPolylines([line!.slice(k, k + 4)], p[0], p[1])).toBeLessThan(0.5);
    }
  });

  it('exponencial de compactación en ejes lineales también se curva', () => {
    const [line] = sampleTrendPath({ model: 'exp', a: 160 * Math.exp(1.2e-2 * 1000), b: -1.2e-2 }, 1000, 1100, viewerLinear);
    expect(line!.length / 2).toBeGreaterThan(4);
  });

  it('fuera de dominio corta el trazo (valores ≤ 0 en una pista log)', () => {
    const lines = sampleTrendPath({ model: 'linear', a: -1050, b: 1 }, 1000, 1100, viewerLog);
    expect(lines).toHaveLength(1);
    const first = lines[0]!;
    expect(1000 + first[1]! / 5).toBeGreaterThan(1050); // empieza donde el valor se vuelve positivo
    expect(1000 + first[1]! / 5).toBeLessThan(1050.5);
  });

  it('sin la transposición (crossplot): x horizontal, y vertical', () => {
    const m: TrendMapping = { x: (v) => v * 10, y: (v) => 500 - v * 10, transpose: false };
    expect(projectPoint(m, 3, 4)).toEqual([30, 460]);
    expect(sampleTrendPath({ model: 'linear', a: 0, b: 1 }, 0, 10, m)).toEqual([[0, 500, 100, 400]]);
  });
});

describe('geometría de una tendencia', () => {
  const c = { model: 'linear' as const, a: -950, b: 1 };
  it('tramo sólido, extensión punteada hasta el borde visible y manijas', () => {
    const g = trendGeometry({ coeffs: c, span: [1020, 1060], visible: [1000, 1100], extend: true, mapping: viewerLinear, handles: [{ x: 1020, y: 70 }, { x: 1060, y: 110 }] });
    expect(g.solid).toEqual([[100 + 70 * 2, 100, 100 + 110 * 2, 300]]);
    expect(g.dashed).toHaveLength(2);
    expect(g.dashed[0]![1]).toBeCloseTo(0, 9);
    expect(g.dashed[1]!.at(-1)).toBeCloseTo(500, 9);
    expect(g.handles).toEqual([
      [240, 100],
      [320, 300],
    ]);
    expect(g.anchor).toEqual([240, 100]);
    const noExt = trendGeometry({ coeffs: c, span: [1020, 1060], visible: [1000, 1100], extend: false, mapping: viewerLinear, handles: [] });
    expect(noExt.dashed).toEqual([]);
  });

  it('recorta al rango visible (zoom dentro del tramo) y no dibuja si el tramo no se ve', () => {
    const g = trendGeometry({ coeffs: c, span: [1000, 1100], visible: [1040, 1050], extend: true, mapping: viewerLinear, handles: [] });
    expect(g.solid[0]![1]).toBeCloseTo(200, 9);
    expect(g.solid[0]!.at(-1)).toBeCloseTo(250, 9);
    expect(g.dashed).toEqual([]);
    const off = trendGeometry({ coeffs: c, span: [1000, 1010], visible: [1050, 1060], extend: false, mapping: viewerLinear, handles: [] });
    expect(off.solid).toEqual([]);
    expect(off.anchor).toBeNull();
  });

  it('distancia a la línea (para el hit)', () => {
    const g = trendGeometry({ coeffs: c, span: [1020, 1060], visible: [1000, 1100], extend: false, mapping: viewerLinear, handles: [] });
    expect(distanceToPolylines(g.solid, 280, 200)).toBeCloseTo(0, 9);
    expect(distanceToPolylines(g.solid, 290, 200)).toBeGreaterThan(4);
  });
});
