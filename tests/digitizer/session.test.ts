/**
 * Sesión serializable (JSON puro) y reglas de pureza del motor.
 */
import { describe, expect, it } from 'vitest';
import { DigitizerError } from '../../src/digitizer/errors';
import {
  createSession,
  deserializeTrace,
  fingerprintImage,
  isJsonPure,
  parseSession,
  serializeSession,
  serializeTrace,
  sessionMatchesImage,
  validateSession,
} from '../../src/digitizer/session';
import type { DigitizerSession, RasterImage, TracedCurve } from '../../src/digitizer/types';
import { newImage } from './synth';

function sampleSession(): DigitizerSession {
  const s = createSession('Registro ajeno', 'escaneo.png', newImage(40, 30) as RasterImage);
  s.geometry = [
    { kind: 'rotate', angleRad: 0.0123, expand: false },
    { kind: 'perspective', quad: [{ x: 1, y: 2 }, { x: 30, y: 2 }, { x: 31, y: 80 }, { x: 0, y: 81 }], outWidth: 300, outHeight: 800 },
  ];
  s.depth = { unit: 'ft', method: 'piecewise', ties: [{ y: 10, depth: 7600 }, { y: 700, depth: 7700.5 }] };
  s.curves = [
    {
      id: 'GR', mnemonic: 'GR', unit: 'gAPI', role: 'GR', description: 'Rayos gamma',
      frame: { leftPx: 20, rightPx: 280, scale: { kind: 'linear', min: 0, max: 150, reversed: false } },
      color: { mode: 'color', rgb: [30, 140, 60], tolerance: 30, background: [250, 245, 230] },
      region: { x0: 22, y0: 0, x1: 278, y1: 800 }, mode: 'guided',
      guide: { points: [{ x: 100, y: 0 }, { x: 120, y: 400 }], corridor: 15 },
      prior: { x: 100, sigma: 20 }, settings: { threshold: 80, maxGapRows: 30, despeckle: false },
    },
    {
      id: 'RT', mnemonic: 'AT90', unit: 'ohm.m',
      frame: { leftPx: 300, rightPx: 560, scale: { kind: 'log', min: 0.2, max: 2000, reversed: false } },
      color: { mode: 'dark' }, region: { x0: 302, y0: 0, x1: 558, y1: 800 }, mode: 'auto',
    },
  ];
  const t: TracedCurve = {
    y0: 5,
    x: Float64Array.from([10.5, NaN, 12.25]),
    width: Float64Array.from([3, NaN, 4]),
    confidence: Float64Array.from([0.9, 0, 0.8]),
    observed: Uint8Array.from([1, 0, 1]),
    warnings: ['no se guarda'],
  };
  s.traces = { GR: serializeTrace(t) };
  return s;
}

describe('sesión serializable', () => {
  it('es JSON puro y la ida y vuelta por texto la reproduce exactamente', () => {
    const s = sampleSession();
    expect(isJsonPure(s)).toBe(true);
    const text = serializeSession(s);
    expect(typeof text).toBe('string');
    const back = parseSession(text);
    expect(back).toEqual(s);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });

  it('el trazo guardado convierte NaN ↔ null y recupera los arrays tipados', () => {
    const s = sampleSession();
    expect(s.traces['GR']!.x).toEqual([10.5, null, 12.25]);
    expect(isJsonPure(s.traces['GR'])).toBe(true);
    const t = deserializeTrace(JSON.parse(JSON.stringify(s.traces['GR'])));
    expect(t.x).toBeInstanceOf(Float64Array);
    expect(t.observed).toBeInstanceOf(Uint8Array);
    expect(Array.from(t.x).map((v) => (Number.isNaN(v) ? 'nan' : v))).toEqual([10.5, 'nan', 12.25]);
    expect(Number.isNaN(t.width[1]!)).toBe(true);
    expect(() => deserializeTrace({ y0: 0, x: [1], width: [], confidence: [], observed: [] })).toThrow(/largos distintos/);
  });

  it('isJsonPure rechaza arrays tipados, funciones, NaN, undefined, clases', () => {
    expect(isJsonPure({ a: new Float64Array(2) })).toBe(false);
    expect(isJsonPure({ a: () => 1 })).toBe(false);
    expect(isJsonPure({ a: NaN })).toBe(false);
    expect(isJsonPure({ a: undefined })).toBe(false);
    expect(isJsonPure({ a: new Date() })).toBe(false);
    expect(isJsonPure({ a: [1, 'x', null, true, { b: 2 }] })).toBe(true);
  });

  it('huella de imagen: estable, y cambia si cambia un píxel muestreado; sessionMatchesImage', () => {
    const img = newImage(40, 30) as RasterImage;
    expect(fingerprintImage(img)).toBe(fingerprintImage(newImage(40, 30) as RasterImage));
    const s = createSession('s', 'a.png', img);
    expect(sessionMatchesImage(s, img)).toBe(true);
    const other = newImage(40, 30) as RasterImage;
    other.data[0] = 7;
    expect(sessionMatchesImage(s, other)).toBe(false);
    expect(sessionMatchesImage(s, newImage(41, 30) as RasterImage)).toBe(false);
  });
});

describe('validación al abrir una sesión', () => {
  const clone = (): Record<string, unknown> => JSON.parse(serializeSession(sampleSession())) as Record<string, unknown>;
  const msg = (raw: unknown): string => {
    try {
      validateSession(raw);
    } catch (e) {
      expect(e).toBeInstanceOf(DigitizerError);
      expect((e as DigitizerError).code).toBe('invalid-session');
      return (e as Error).message;
    }
    return '';
  };

  it('acepta la sesión buena y rechaza texto que no es JSON o no es una sesión', () => {
    expect(msg(clone())).toBe('');
    expect(() => parseSession('{no es json')).toThrow(/JSON válido/);
    expect(msg(null)).toMatch(/no es un objeto/);
    expect(msg([])).toMatch(/no es un objeto/);
    expect(msg({ ...clone(), version: 2 })).toMatch(/versión 2/);
  });

  it('detecta cada tipo de dato corrupto con un mensaje en español', () => {
    const edit = (f: (s: Record<string, any>) => void) => {
      const s = clone() as Record<string, any>;
      f(s);
      return msg(s);
    };
    expect(edit((s) => delete s['name'])).toMatch(/falta el nombre/);
    expect(edit((s) => (s['image'] = { name: 'x' }))).toMatch(/datos de la imagen/);
    expect(edit((s) => (s['geometry'] = [{ kind: 'warp' }]))).toMatch(/tipo desconocido/);
    expect(edit((s) => (s['geometry'][0].angleRad = 'x'))).toMatch(/ángulo numérico/);
    expect(edit((s) => (s['geometry'][1].quad = []))).toMatch(/4 esquinas/);
    expect(edit((s) => (s['depth'].ties = [{ y: 0, depth: 1 }]))).toMatch(/al menos 2 amarres/);
    expect(edit((s) => (s['depth'].ties = [{ y: 0, depth: 10 }, { y: 5, depth: 3 }]))).toMatch(/crecer hacia abajo/);
    expect(edit((s) => (s['curves'][1].id = 'GR'))).toMatch(/dos curvas con el id/);
    expect(edit((s) => (s['curves'][0].frame.rightPx = 5))).toMatch(/a la derecha/);
    expect(edit((s) => (s['curves'][1].frame.scale.min = 0))).toMatch(/positivos/);
    expect(edit((s) => (s['curves'][0].color = { mode: 'neon' }))).toMatch(/modo de color/);
    expect(edit((s) => (s['curves'][0].color = { mode: 'color', rgb: [1, 2] }))).toMatch(/3 valores/);
    expect(edit((s) => (s['curves'][0].region = { x0: 1 }))).toMatch(/región/);
    expect(edit((s) => (s['curves'][0].mode = 'magico'))).toMatch(/modo 'magico'/);
    expect(edit((s) => delete s['curves'][0].guide)).toMatch(/necesita una guía/);
    expect(edit((s) => (s['traces'] = { ZZZ: {} }))).toMatch(/no existe/);
    expect(edit((s) => (s['traces']['GR'].confidence = [1]))).toMatch(/largos distintos/);
    expect(edit((s) => delete s['traces'])).toMatch(/trazos guardados/);
  });
});

describe('pureza del motor (corre en un Web Worker)', () => {
  const sources = import.meta.glob('../../src/digitizer/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('hay archivos del motor', () => {
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(11);
  });

  it('no importa React, zustand ni la interfaz; de viewer solo la escala; sin DOM ni canvas', () => {
    for (const [file, raw] of Object.entries(sources)) {
      const src = strip(raw);
      expect(src, file).not.toMatch(/from ['"](react|react-dom|zustand)(\/[^'"]*)?['"]/);
      expect(src, file).not.toMatch(/from ['"][./]*(app|ui|plots|modules)\//);
      for (const m of src.matchAll(/from ['"]((?:\.\.\/)+viewer\/[^'"]*)['"]/g)) expect(m[1], file).toMatch(/\/viewer\/scale$/);
      expect(src, file).not.toMatch(/\b(document|window|HTMLCanvasElement|OffscreenCanvas|CanvasRenderingContext2D|createElement|getContext|localStorage)\b/);
      expect(src, file).not.toMatch(/\bnew ImageData\b/);
    }
  });
});
