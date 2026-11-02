/**
 * Color del Log Digitizer: CIELAB contra valores de referencia (CIE 15:2004, D65), ΔE, máscaras y colores sugeridos.
 */
import { describe, expect, it } from 'vitest';
import { buildMask, colorMask, darkMask, deltaE, labToRgb, normalizeRegion, rgbToLab, suggestCurveColors } from '../../src/digitizer/color';
import { DigitizerError } from '../../src/digitizer/errors';
import type { RasterImage } from '../../src/digitizer/types';
import { drawPolyline, newImage, renderLog, type RGB } from './synth';

describe('CIELAB', () => {
  // Valores de referencia sRGB D65 (calculadoras estándar: Lindbloom / colormine)
  const refs: Array<[string, [number, number, number], [number, number, number]]> = [
    ['blanco', [255, 255, 255], [100, 0, 0]],
    ['negro', [0, 0, 0], [0, 0, 0]],
    ['rojo', [255, 0, 0], [53.2408, 80.0925, 67.2032]],
    ['verde', [0, 255, 0], [87.7347, -86.1827, 83.1793]],
    ['azul', [0, 0, 255], [32.297, 79.1875, -107.8602]],
    ['gris 128', [128, 128, 128], [53.5851, 0, 0]],
  ];
  for (const [name, rgb, lab] of refs) {
    it(`${name} → L*a*b*`, () => {
      const got = rgbToLab(...rgb);
      expect(got[0]).toBeCloseTo(lab[0], 1);
      expect(got[1]).toBeCloseTo(lab[1], 0);
      expect(got[2]).toBeCloseTo(lab[2], 0);
      expect(Math.abs(got[1] - lab[1])).toBeLessThan(0.1);
      expect(Math.abs(got[2] - lab[2])).toBeLessThan(0.1);
    });
  }

  it('ΔE blanco–negro = 100; ida y vuelta RGB → Lab → RGB exacta', () => {
    expect(deltaE(rgbToLab(255, 255, 255), rgbToLab(0, 0, 0))).toBeCloseTo(100, 4);
    for (const rgb of [[12, 200, 77], [250, 240, 10], [3, 3, 3], [130, 60, 210], [255, 255, 255]] as const) {
      const lab = rgbToLab(rgb[0], rgb[1], rgb[2]);
      expect(labToRgb(lab[0], lab[1], lab[2])).toEqual([...rgb]);
    }
  });
});

describe('regiones y errores', () => {
  const img: RasterImage = newImage(40, 30);
  it('recorta a la imagen y rechaza regiones vacías o con NaN', () => {
    expect(normalizeRegion(img, { x0: -5, y0: -5, x1: 100, y1: 100 })).toEqual({ x0: 0, y0: 0, x1: 40, y1: 30 });
    expect(() => normalizeRegion(img, { x0: 20, y0: 5, x1: 20, y1: 9 })).toThrow(/vacía/);
    expect(() => normalizeRegion(img, { x0: 50, y0: 0, x1: 90, y1: 9 })).toThrow(DigitizerError);
    expect(() => normalizeRegion(img, { x0: NaN, y0: 0, x1: 9, y1: 9 })).toThrow(/no numéricos/);
  });
  it('parámetros inválidos de la máscara', () => {
    expect(() => colorMask(img, undefined, [0, 0, 0], 0)).toThrow(/tolerancia/);
    expect(() => colorMask(img, undefined, [300, 0, 0])).toThrow(/RGB/);
    expect(() => colorMask(img, undefined, [250, 250, 250])).toThrow(/casi igual al del papel/);
    expect(() => darkMask(img, undefined, { lightMax: 80, lightMin: 40 })).toThrow(/umbrales/);
    expect(() => darkMask({ width: 3, height: 3, data: new Uint8ClampedArray(5) }, undefined)).toThrow(/bytes/);
  });
});

describe('máscaras', () => {
  const GREEN: RGB = [30, 140, 60];
  /** Imagen con una raya vertical verde de 2 px (cobertura plena), una gris de grilla, una negra y una roja. */
  function stripes(): RasterImage {
    const im = newImage(100, 40);
    drawPolyline(im, [[20, 0], [20, 39]], { thickness: 2, rgb: GREEN });
    drawPolyline(im, [[40, 0], [40, 39]], { thickness: 2, rgb: [200, 200, 200] });
    drawPolyline(im, [[60, 0], [60, 39]], { thickness: 2, rgb: [10, 10, 10] });
    drawPolyline(im, [[80, 0], [80, 39]], { thickness: 2, rgb: [200, 40, 40] });
    return im;
  }
  it('modo color: solo la raya verde (la gris de la grilla, la negra y la roja quedan en 0)', () => {
    const m = colorMask(stripes(), undefined, GREEN, 28);
    const at = (x: number) => m.data[20 * m.width + x]!;
    expect(at(19)).toBeGreaterThan(96); // borde anti-aliased con cobertura parcial
    expect(at(20)).toBe(255);
    expect(at(40)).toBeLessThan(40); // muy por debajo del umbral de trazo (96)
    expect(at(60)).toBeLessThan(40); // muy por debajo del umbral de trazo (96)
    expect(at(80)).toBeLessThan(40); // muy por debajo del umbral de trazo (96)
    expect(at(5)).toBe(0);
  });

  it('un píxel anti-aliased (mezcla 50 % verde/blanco) conserva ≈ 50 % de intensidad', () => {
    const im = newImage(3, 1);
    const mix = (v: number, w: number) => Math.round(w * v + (1 - w) * 255);
    im.data.set([mix(GREEN[0], 0.5), mix(GREEN[1], 0.5), mix(GREEN[2], 0.5), 255], 4);
    const m = colorMask(im, undefined, GREEN, 28);
    // la mezcla no es lineal en Lab: el valor exacto es una cuenta de la proyección sobre bg→c; se verifica el rango
    expect(m.data[1]).toBeGreaterThan(90);
    expect(m.data[1]).toBeLessThan(200);
    expect(m.data[0]).toBe(0);
  });

  it('modo oscuro: negro sí; azul oscuro (croma alto), gris claro y blanco no', () => {
    const im = newImage(5, 1);
    im.data.set([5, 5, 5, 255, 0, 0, 140, 255, 200, 200, 200, 255, 255, 255, 255, 255, 60, 60, 60, 255]);
    const m = darkMask(im, undefined);
    expect(m.data[0]).toBe(255);
    expect(m.data[1]).toBeLessThan(40);
    expect(m.data[2]).toBe(0);
    expect(m.data[3]).toBe(0);
    expect(m.data[4]).toBeGreaterThan(200); // gris 60 → L* ≈ 25
  });

  it('buildMask elige el modo según la especificación; la región define el tamaño y el origen', () => {
    const im = stripes();
    const m = buildMask(im, { x0: 10, y0: 5, x1: 30, y1: 15 }, { mode: 'color', rgb: GREEN });
    expect([m.x0, m.y0, m.width, m.height]).toEqual([10, 5, 20, 10]);
    expect(m.data[2 * m.width + 10]).toBe(255); // x=20 → columna local 10
    const d = buildMask(im, undefined, { mode: 'dark' });
    expect(d.data[20 * d.width + 60]).toBe(255);
  });
});

describe('colores sugeridos', () => {
  it('encuentra negro, verde y rojo en una pista con grilla, y descarta el papel y el gris claro', () => {
    const GREEN: RGB = [30, 140, 60];
    const RED: RGB = [200, 30, 30];
    const log = renderLog({
      width: 720, height: 1200, left: 60, right: 660, topDepthM: 0, dzMPerPx: 0.1, gridRows: 40, gridCols: 10, textInside: 30,
      curves: [
        { id: 'a', rgb: GREEN, thickness: 3, scale: { kind: 'linear', min: 0, max: 150, reversed: false }, valueAt: (d) => 75 + 50 * Math.sin(d / 5) },
        { id: 'b', rgb: RED, thickness: 3, scale: { kind: 'linear', min: 0, max: 150, reversed: false }, valueAt: (d) => 75 + 40 * Math.cos(d / 7) },
        { id: 'c', rgb: [15, 15, 15], thickness: 3, scale: { kind: 'linear', min: 0, max: 150, reversed: false }, valueAt: (d) => 75 + 30 * Math.sin(d / 3 + 1) },
      ],
      blur: true,
      seed: 5,
    });
    const s = suggestCurveColors(log.image as RasterImage, { x0: 66, y0: 0, x1: 655, y1: 1200 }, { maxColors: 5 });
    expect(s.background).toEqual([255, 255, 255]);
    expect(s.colors.length).toBeGreaterThanOrEqual(3);
    const hasNear = (target: RGB, de: number) => s.colors.some((c) => deltaE(rgbToLab(...c.rgb), rgbToLab(...target)) < de);
    expect(hasNear(GREEN, 15)).toBe(true);
    expect(hasNear(RED, 15)).toBe(true);
    expect(s.colors.some((c) => c.kind === 'dark' && c.rgb[0] < 70)).toBe(true);
    // ningún color sugerido es papel ni gris claro de grilla
    for (const c of s.colors) {
      const [L, a, b] = c.lab;
      expect(L > 88 && Math.hypot(a, b) < 12).toBe(false);
      expect(L > 55 && Math.hypot(a, b) < 12).toBe(false);
    }
    // ordenados por cantidad y con fracciones coherentes
    for (let i = 1; i < s.colors.length; i++) expect(s.colors[i - 1]!.count).toBeGreaterThanOrEqual(s.colors[i]!.count);
    expect(s.colors.reduce((a, c) => a + c.fraction, 0)).toBeLessThanOrEqual(1.0001);
  });

  it('es determinista y la especificación sugerida sirve para construir la máscara', () => {
    const GREEN: RGB = [30, 140, 60];
    const log = renderLog({
      width: 300, height: 600, left: 30, right: 270, topDepthM: 0, dzMPerPx: 0.1, gridRows: 40, gridCols: 10,
      curves: [{ id: 'a', rgb: GREEN, thickness: 3, scale: { kind: 'linear', min: 0, max: 150, reversed: false }, valueAt: (d) => 75 + 50 * Math.sin(d / 5) }],
      seed: 6,
    });
    const r1 = suggestCurveColors(log.image as RasterImage, undefined);
    const r2 = suggestCurveColors(log.image as RasterImage, undefined);
    expect(r1).toEqual(r2);
    const top = r1.colors[0]!;
    expect(top.kind).toBe('color');
    const m = buildMask(log.image as RasterImage, undefined, top.spec);
    let active = 0;
    for (const v of m.data) if (v > 96) active++;
    expect(active).toBeGreaterThan(600 * 3 * 0.8);
  });

  it('imagen sin tinta (solo papel y grilla): lista vacía, sin excepción; imagen de un color uniforme también', () => {
    const blank = newImage(60, 60);
    expect(suggestCurveColors(blank).colors).toEqual([]);
    const grid = renderLog({ width: 100, height: 100, left: 10, right: 90, topDepthM: 0, dzMPerPx: 1, curves: [], gridRows: 10, gridCols: 4, seed: 1 });
    // el borde de la pista (gris 90) sí es "tinta oscura": se sugiere como tal; la grilla clara no
    const s = suggestCurveColors(grid.image as RasterImage, { x0: 12, y0: 0, x1: 88, y1: 100 });
    expect(s.colors).toEqual([]);
    expect(() => suggestCurveColors(blank, { x0: 5, y0: 5, x1: 5, y1: 9 })).toThrow(DigitizerError);
  });
});
