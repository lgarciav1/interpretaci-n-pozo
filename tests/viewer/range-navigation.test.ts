import { describe, expect, it } from 'vitest';
import { adjacentDepthRange, centeredDepthRange, validateDepthRange } from '../../src/viewer/rangeNavigation';
import { baseOf, showRange, viewportLimits } from '../../src/viewer/viewport';

const bounds = { min: 1000, max: 2000 };
describe('selección explícita de profundidad', () => {
  it('acepta coma, punto y profundidades sin redondear al paso de muestreo', () => {
    expect(validateDepthRange('1234,56789', '1284.56789', bounds, 2)).toEqual({ range: { top: 1234.56789, base: 1284.56789 } });
  });
  it.each([['', '1500'], ['NaN', '1500'], ['1200', 'Infinity'], ['1e999', '1500'], ['1200x', '1500']])('rechaza entrada inválida %s / %s', (top, base) => {
    expect(validateDepthRange(top, base, bounds, 2).error).toBeTruthy();
  });
  it.each([['1500', '1500'], ['1600', '1500'], ['999', '1500'], ['1500', '2001'], ['1500', '1501']])('no recorta silenciosamente un tramo inválido %s / %s', (top, base) => {
    expect(validateDepthRange(top, base, bounds, 2).range).toBeUndefined();
  });
  it('permite profundidades negativas y el límite exacto de detalle', () => {
    expect(validateDepthRange('-25,5', '-23,5', { min: -30, max: 10 }, 2).range).toEqual({ top: -25.5, base: -23.5 });
  });
});

describe('ventanas de detalle y contexto', () => {
  it('centra 50 m dentro de la ventana actual', () => {
    expect(centeredDepthRange({ top: 1200, base: 1400 }, 50, bounds)).toEqual({ top: 1275, base: 1325 });
  });
  it('junto al tope o base desplaza el tramo completo sin perder longitud', () => {
    expect(centeredDepthRange({ top: 1000, base: 1010 }, 100, bounds)).toEqual({ top: 1000, base: 1100 });
    expect(centeredDepthRange({ top: 1990, base: 2000 }, 100, bounds)).toEqual({ top: 1900, base: 2000 });
  });
  it('un pozo corto entra completo en un preset mayor', () => {
    expect(centeredDepthRange({ top: 10, base: 20 }, 100, { min: 0, max: 30 })).toEqual({ top: 0, base: 30 });
  });
  it('anterior y siguiente dejan 10 % compartido y son inversos lejos de los extremos', () => {
    const r = { top: 1300, base: 1400 };
    const next = adjacentDepthRange(r, 1, bounds);
    expect(next).toEqual({ top: 1390, base: 1490 });
    expect(adjacentDepthRange(next, -1, bounds)).toEqual(r);
  });
  it('recorrer repetidamente nunca supera los límites ni cambia el ancho', () => {
    let r = { top: 1300, base: 1350 };
    for (let i = 0; i < 30; i++) r = adjacentDepthRange(r, 1, bounds);
    expect(r).toEqual({ top: 1950, base: 2000 });
    for (let i = 0; i < 30; i++) r = adjacentDepthRange(r, -1, bounds);
    expect(r).toEqual({ top: 1000, base: 1050 });
  });
  it('usa el mismo viewport existente: todas las pistas comparten el tramo pedido', () => {
    const depth = Float64Array.from({ length: 2001 }, (_, i) => 1000 + i / 2);
    const limits = viewportLimits(depth, 475, 0.5);
    const selection = validateDepthRange('1234,25', '1284,25', limits, 475 / limits.maxPxPerM);
    expect(selection.error).toBeUndefined();
    const vp = showRange(limits, 475, selection.range!.top, selection.range!.base);
    expect(vp.top).toBeCloseTo(1234.25, 10);
    expect(baseOf(vp)).toBeCloseTo(1284.25, 10);
    expect(depth[0]).toBe(1000);
    expect(depth[2000]).toBe(2000);
  });
});
