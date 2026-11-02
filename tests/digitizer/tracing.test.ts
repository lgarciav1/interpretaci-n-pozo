/**
 * Trazado de curvas sobre imágenes sintéticas con VERDAD CONOCIDA (generador en synth.ts).
 *
 * Tolerancias de la especificación en los casos limpios: error RMS del valor ≤ 1 % del rango de la escala (en escala log,
 * del rango en décadas) y error de profundidad ≤ 1 px de equivalente (desfase que mejor alinea la curva con la verdad).
 * En los casos difíciles se asevera con una cota explícita y el número medido queda anotado en el comentario de cada caso
 * (también en docs/decisiones/0062).
 */
import { describe, expect, it } from 'vitest';
import { valueAtX } from '../../src/digitizer/calibration';
import { buildMask } from '../../src/digitizer/color';
import { DigitizerError } from '../../src/digitizer/errors';
import { DEFAULT_TRACE_SETTINGS, resolveTraceSettings, traceCurve } from '../../src/digitizer/tracing';
import type { RasterImage, TraceMask } from '../../src/digitizer/types';
import { estimateLagRows, evaluate, frameOf, traceAndEvaluate } from './harness';
import { renderLog, type RGB, type SynthCurve, type SynthLogOptions } from './synth';

const GREEN: RGB = [30, 140, 60];
const BLACK: RGB = [20, 20, 20];
const RED: RGB = [200, 30, 30];
const scaleGR = { kind: 'linear' as const, min: 0, max: 150, reversed: false };
const gr = (d: number) => 75 + 40 * Math.sin(d / 6) + 20 * Math.sin(d / 1.7 + 1);
const base = { width: 720, height: 2400, left: 60, right: 660, topDepthM: 0, dzMPerPx: 0.05 };
/** Dentro de la pista (sin el borde oscuro de la pista, que el modo oscuro tomaría como trazo). */
const region = { x0: 66, y0: 0, x1: 655, y1: 2400 };
const curve = (over: Partial<SynthCurve> = {}): SynthCurve => ({ id: 'GR', rgb: GREEN, thickness: 3, scale: scaleGR, valueAt: gr, ...over });
const colorGreen = { mode: 'color', rgb: GREEN } as const;
const LONG = 60_000;

const render = (curves: SynthCurve[], over: Partial<SynthLogOptions> = {}) => renderLog({ ...base, curves, gridRows: 40, gridCols: 10, seed: 1, ...over });

describe('casos limpios: RMS del valor ≤ 1 % del rango y profundidad ≤ 1 px', () => {
  it('trazo verde de 3 px con grilla y borde (medido: RMS 0,10 %, 0,60 px)', () => {
    const log = render([curve()]);
    const e = traceAndEvaluate(log, 'GR', colorGreen, region);
    expect(e.coverage).toBeGreaterThanOrEqual(0.99);
    expect(e.rmsPct).toBeLessThanOrEqual(1);
    expect(Math.abs(estimateLagRows(log, 'GR', e.trace))).toBeLessThanOrEqual(1);
    expect(e.n).toBe(2400);
  });

  it('trazo negro (modo oscuro) con grilla y rótulos tipo texto dentro de la pista (medido: 0,10 %)', () => {
    const log = render([curve({ rgb: BLACK })], { textInside: 25, textOutside: 20 });
    const e = traceAndEvaluate(log, 'GR', { mode: 'dark' }, region);
    expect(e.coverage).toBeGreaterThanOrEqual(0.99);
    expect(e.rmsPct).toBeLessThanOrEqual(1);
    expect(Math.abs(estimateLagRows(log, 'GR', e.trace))).toBeLessThanOrEqual(1);
  });

  it('trazo de 1 px (medido: 0,02 %, 0,11 px)', () => {
    const e = traceAndEvaluate(render([curve({ thickness: 1 })]), 'GR', colorGreen, region);
    expect(e.coverage).toBeGreaterThanOrEqual(0.99);
    expect(e.rmsPct).toBeLessThanOrEqual(1);
  });

  it('resistividad en escala logarítmica 0,2–2000 ohm.m (4 décadas): error ≤ 1 % del rango en décadas', () => {
    const rt = curve({
      id: 'RT',
      rgb: RED,
      scale: { kind: 'log', min: 0.2, max: 2000, reversed: false },
      valueAt: (d) => 10 ** (1.3 + 1.1 * Math.sin(d / 5) + 0.4 * Math.sin(d / 1.3)),
    });
    const log = render([rt]);
    const e = traceAndEvaluate(log, 'RT', { mode: 'color', rgb: RED }, region);
    expect(e.coverage).toBeGreaterThanOrEqual(0.99);
    expect(e.rmsPct).toBeLessThanOrEqual(1);
  });

  it('escala invertida (DT 140→40 de izquierda a derecha)', () => {
    const dt = curve({ id: 'DT', scale: { kind: 'linear', min: 40, max: 140, reversed: true }, valueAt: (d) => 90 + 30 * Math.sin(d / 4) });
    const e = traceAndEvaluate(render([dt]), 'DT', colorGreen, region);
    expect(e.rmsPct).toBeLessThanOrEqual(1);
  });
});

describe('casos difíciles (se documenta el error y la cobertura)', () => {
  it('curva punteada 18 px encendido / 10 apagado: se atraviesan los huecos (medido: cobertura 99,9 %, observada 83 %, RMS 0,18 %)', () => {
    const e = traceAndEvaluate(render([curve({ dash: [18, 10] })]), 'GR', colorGreen, region);
    expect(e.coverage).toBeGreaterThanOrEqual(0.98);
    expect(e.observedFraction).toBeLessThan(0.95); // hay puntos interpolados y se marcan
    expect(e.observedFraction).toBeGreaterThan(0.6);
    expect(e.rmsPct).toBeLessThanOrEqual(1);
    // los puntos interpolados tienen menos confianza que los observados
    const t = e.trace;
    let co = 0;
    let no = 0;
    let ci = 0;
    let ni = 0;
    for (let i = 0; i < t.x.length; i++) {
      if (Number.isNaN(t.x[i]!)) continue;
      if (t.observed[i]) {
        co += t.confidence[i]!;
        no++;
      } else {
        ci += t.confidence[i]!;
        ni++;
      }
    }
    expect(ni).toBeGreaterThan(100);
    expect(ci / ni).toBeLessThan(0.5 * (co / no));
  });

  it('ruido fuerte (desenfoque + gauss σ=25 + sal y pimienta 3 % + JPEG q=14 + 40 rótulos): negro y verde (medido: ≤ 0,14 %, cobertura 100 %)', { timeout: LONG }, () => {
    const hard: Partial<SynthLogOptions> = { blur: true, noiseSigma: 25, saltPepper: 0.03, jpegQ: 14, textInside: 40, textOutside: 20, seed: 2 };
    const a = traceAndEvaluate(render([curve()], hard), 'GR', colorGreen, region);
    expect(a.coverage).toBeGreaterThanOrEqual(0.97);
    expect(a.rmsPct).toBeLessThanOrEqual(1);
    const b = traceAndEvaluate(render([curve({ rgb: BLACK })], hard), 'GR', { mode: 'dark' }, region);
    expect(b.coverage).toBeGreaterThanOrEqual(0.97);
    expect(b.rmsPct).toBeLessThanOrEqual(1);
  });

  it('negra, punteada fina (2 px, 10/8) y con ruido fuerte (medido: cobertura 100 %, observada 77 %, RMS 0,20 %)', { timeout: LONG }, () => {
    const hard: Partial<SynthLogOptions> = { blur: true, noiseSigma: 25, saltPepper: 0.03, jpegQ: 14, textInside: 40, seed: 2 };
    const e = traceAndEvaluate(render([curve({ rgb: BLACK, dash: [10, 8], thickness: 2 })], hard), 'GR', { mode: 'dark' }, region);
    expect(e.coverage).toBeGreaterThanOrEqual(0.95);
    expect(e.rmsPct).toBeLessThanOrEqual(1.5);
  });

  it('cruce con otra curva de OTRO color dibujada encima: la tapada se recupera (medido: cobertura 100 %, observada 99,7 %, RMS 0,12 %)', () => {
    const rt = curve({ id: 'RT', rgb: RED, valueAt: (d) => 75 + 50 * Math.cos(d / 5) });
    const log = render([curve(), rt]);
    const a = traceAndEvaluate(log, 'GR', colorGreen, region);
    const b = traceAndEvaluate(log, 'RT', { mode: 'color', rgb: RED }, region);
    expect(a.coverage).toBeGreaterThanOrEqual(0.99);
    expect(a.rmsPct).toBeLessThanOrEqual(1);
    expect(b.rmsPct).toBeLessThanOrEqual(1);
  });

  it('dos curvas del MISMO color que se cruzan: el modo automático sigue UNA sola (no se mezcla ni inventa); el modo guiado elige la pedida', () => {
    const b = curve({ id: 'B', valueAt: (d) => 75 + 50 * Math.cos(d / 5) });
    const log = render([curve(), b]);
    const auto = traceAndEvaluate(log, 'GR', colorGreen, region);
    expect(auto.coverage).toBeGreaterThanOrEqual(0.99);
    // automático: coincide con B (medido 2,6 % RMS contra B; contra A es de otra curva)
    const t = auto.trace;
    const frame = frameOf(log, 'B');
    let ssB = 0;
    let n = 0;
    for (let i = 0; i < t.x.length; i++) {
      if (Number.isNaN(t.x[i]!)) continue;
      ssB += (valueAtX(frame, t.x[i]!) - log.trueValue('B', t.y0 + i)) ** 2;
      n++;
    }
    const rmsB = (100 * Math.sqrt(ssB / n)) / 150;
    expect(Math.min(auto.rmsPct, rmsB)).toBeLessThanOrEqual(3.5);
    // guiado sobre A: polilínea cada 25 filas con un error de ±5 px y corredor de 20 px
    const guide = { points: Array.from({ length: 97 }, (_, k) => k * 25).map((y, k) => ({ x: log.trueX('GR', Math.min(y, 2399)) + (k % 2 ? 5 : -5), y: Math.min(y, 2399) })), corridor: 20 };
    const guided = traceAndEvaluate(log, 'GR', colorGreen, region, { guide });
    expect(guided.coverage).toBeGreaterThanOrEqual(0.95);
    expect(guided.rmsPct).toBeLessThanOrEqual(1);
  });

  it('el prior elige entre dos curvas iguales que no se cruzan', () => {
    const lo = curve({ id: 'LO', valueAt: (d) => 40 + 15 * Math.sin(d / 5) });
    const hi = curve({ id: 'HI', valueAt: (d) => 110 + 15 * Math.sin(d / 7) });
    const log = render([lo, hi]);
    const xLo = log.trueX('LO', 0);
    const xHi = log.trueX('HI', 0);
    const a = traceAndEvaluate(log, 'LO', colorGreen, region, { prior: { x: xLo } });
    const b = traceAndEvaluate(log, 'HI', colorGreen, region, { prior: { x: xHi } });
    expect(a.rmsPct).toBeLessThanOrEqual(1);
    expect(b.rmsPct).toBeLessThanOrEqual(1);
  });

  it('hueco largo (100 filas sin trazo > 25): NO se inventan datos, quedan NaN (medido: 98 filas NaN)', () => {
    const log = render([curve({ gaps: [[800, 900]] })]);
    const e = traceAndEvaluate(log, 'GR', colorGreen, region);
    let nan = 0;
    let firstNan = -1;
    for (let i = 0; i < e.trace.x.length; i++) {
      if (Number.isNaN(e.trace.x[i]!)) {
        nan++;
        if (firstNan < 0) firstNan = i;
      }
    }
    expect(nan).toBeGreaterThanOrEqual(95);
    expect(nan).toBeLessThanOrEqual(105);
    expect(firstNan).toBeGreaterThanOrEqual(798);
    expect(firstNan).toBeLessThanOrEqual(805);
    expect(e.rmsPct).toBeLessThanOrEqual(1); // el resto es correcto
    // un hueco corto (20 filas ≤ 25) sí se atraviesa
    const short = traceAndEvaluate(render([curve({ gaps: [[800, 820]] })]), 'GR', colorGreen, region);
    expect(short.coverage).toBeGreaterThanOrEqual(0.995);
    expect(short.observedFraction).toBeLessThan(short.coverage);
  });

  it('cambios bruscos (escalones 30↔120 entre filas): se sigue la curva; el error se concentra en las 2 filas del barrido', () => {
    const step = curve({ valueAt: (d) => (Math.floor(d / 6) % 2 === 0 ? 30 : 120) });
    const log = render([step]);
    const e = traceAndEvaluate(log, 'GR', colorGreen, region);
    expect(e.coverage).toBeGreaterThanOrEqual(0.99);
    // fuera de las filas de transición (±3 filas de cada salto) el error es de píxeles
    const jumps: number[] = [];
    for (let y = 1; y < 2400; y++) if (Math.floor(log.depthAtRow(y) / 6) !== Math.floor(log.depthAtRow(y - 1) / 6)) jumps.push(y);
    expect(jumps.length).toBeGreaterThan(10);
    let worst = 0;
    for (let i = 0; i < e.trace.x.length; i++) {
      const y = e.trace.y0 + i;
      if (jumps.some((j) => Math.abs(y - j) <= 3)) continue;
      worst = Math.max(worst, Math.abs(e.trace.x[i]! - log.trueX('GR', y)));
    }
    expect(worst).toBeLessThanOrEqual(2);
  });

  it('un tramo horizontal ancho registra su ancho y baja la confianza', () => {
    const step = curve({ valueAt: (d) => (Math.floor(d / 6) % 2 === 0 ? 30 : 120) });
    const log = render([step]);
    const e = traceAndEvaluate(log, 'GR', colorGreen, region);
    const widths = Array.from(e.trace.width).filter((w) => w > 100);
    expect(widths.length).toBeGreaterThan(5);
    const i = Array.from(e.trace.width).findIndex((w) => w > 100);
    expect(e.trace.confidence[i]!).toBeLessThan(0.5);
  });
});

describe('modos y opciones', () => {
  it('guiado: solo se trazan las filas que abarca la guía, y se ignora el trazo fuera del corredor', () => {
    const log = render([curve()]);
    const guide = { points: [{ x: log.trueX('GR', 500), y: 500 }, ...Array.from({ length: 20 }, (_, k) => ({ x: log.trueX('GR', 520 + k * 25), y: 520 + k * 25 }))], corridor: 15 };
    const mask = buildMask(log.image as RasterImage, region, colorGreen);
    const t = traceCurve(mask, { guide });
    expect(t.y0).toBe(500);
    expect(t.x.length).toBe(Math.floor(guide.points[guide.points.length - 1]!.y) - 500 + 1);
    const e = evaluate(log, 'GR', t);
    expect(e.rmsPct).toBeLessThanOrEqual(1);
    // guía que se aparta de la curva (> corredor): sin trazo → NaN con advertencia, no una curva inventada
    const far = { points: [{ x: 70, y: 100 }, { x: 70, y: 300 }], corridor: 5 };
    const t2 = traceCurve(buildMask(log.image as RasterImage, region, colorGreen), { guide: far });
    const covered = Array.from(t2.x).filter((v) => !Number.isNaN(v)).length;
    expect(covered).toBeLessThan(t2.x.length * 0.5);
    expect(t2.warnings.length).toBeGreaterThan(0);
  });

  it('es determinista y devuelve arrays alineados', () => {
    const log = render([curve()]);
    const mask = buildMask(log.image as RasterImage, region, colorGreen);
    const a = traceCurve(mask);
    const b = traceCurve(mask);
    expect(Array.from(a.x)).toEqual(Array.from(b.x));
    expect(a.x.length).toBe(a.width.length);
    expect(a.x.length).toBe(a.confidence.length);
    expect(a.x.length).toBe(a.observed.length);
    for (const c of a.confidence) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });

  it('progreso creciente hasta 1 y cancelación con AbortSignal', () => {
    const mask = buildMask(render([curve()]).image as RasterImage, region, colorGreen);
    const seen: number[] = [];
    traceCurve(mask, { onProgress: (f) => seen.push(f) });
    expect(seen[seen.length - 1]).toBe(1);
    for (let i = 1; i < seen.length; i++) expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!);
    const ctl = new AbortController();
    ctl.abort();
    let err: unknown;
    try {
      traceCurve(mask, { signal: ctl.signal });
    } catch (e) {
      err = e;
    }
    expect((err as Error).name).toBe('AbortError');
  });

  it('los ajustes por defecto están documentados y los inválidos se rechazan', () => {
    expect(resolveTraceSettings(undefined)).toEqual(DEFAULT_TRACE_SETTINGS);
    expect(DEFAULT_TRACE_SETTINGS).toMatchObject({ threshold: 96, maxGapRows: 25, sigma: 2, freeSlope: 6, maxJump: 40, coverageReward: 4, restartCost: 24, wideRun: 30 });
    expect(() => resolveTraceSettings({ sigma: 0 })).toThrow(/sigma/);
    expect(() => resolveTraceSettings({ threshold: 300 })).toThrow(/umbral/);
    expect(() => resolveTraceSettings({ maxGapRows: -1 })).toThrow(/hueco máximo/);
    expect(() => resolveTraceSettings({ maxCandidates: 0 })).toThrow(/candidatos/);
    expect(() => resolveTraceSettings({ bridge: 1.5 })).toThrow(DigitizerError);
  });
});

describe('casos de error y bordes (sin excepciones no controladas)', () => {
  const blank = (w: number, h: number): TraceMask => ({ x0: 0, y0: 0, width: w, height: h, data: new Uint8Array(w * h) });

  it('máscara sin trazo: todo NaN con advertencia', () => {
    const t = traceCurve(blank(50, 100));
    expect(t.x.length).toBe(100);
    expect(Array.from(t.x).every(Number.isNaN)).toBe(true);
    expect(Array.from(t.confidence).every((c) => c === 0)).toBe(true);
    expect(t.warnings[0]).toMatch(/No se encontró trazo/);
  });

  it('imagen real sin trazo del color pedido: máscara vacía, sin excepción', () => {
    const log = render([]);
    const t = traceCurve(buildMask(log.image as RasterImage, region, colorGreen));
    expect(Array.from(t.x).every(Number.isNaN)).toBe(true);
  });

  it('máscara estructuralmente inválida (cero píxeles, tamaño inconsistente, NaN): DigitizerError en español', () => {
    expect(() => traceCurve({ x0: 0, y0: 0, width: 0, height: 5, data: new Uint8Array(0) })).toThrow(/máscara está vacía/);
    expect(() => traceCurve({ x0: 0, y0: 0, width: 4, height: 5, data: new Uint8Array(7) })).toThrow(/trae 7 valores/);
    expect(() => traceCurve({ x0: NaN, y0: 0, width: 1, height: 1, data: new Uint8Array(1) })).toThrow(/origen/);
    expect(() => traceCurve(blank(5, 5), { guide: { points: [{ x: 1, y: 1 }] } })).toThrow(/al menos 2 puntos/);
    expect(() => traceCurve(blank(5, 5), { guide: { points: [{ x: 1, y: 1 }, { x: 2, y: 2 }], corridor: 0 } })).toThrow(/corredor/);
  });

  it('una sola fila y una sola columna', () => {
    const one = blank(30, 1);
    one.data[12] = 255;
    one.data[13] = 255;
    const t = traceCurve(one);
    expect(t.x.length).toBe(1);
    // una fila sola es un tramo más corto que lo que justifica una curva (< 6 filas): se descarta, no se inventa
    expect(Number.isNaN(t.x[0]!)).toBe(true);
    const col = blank(1, 40);
    col.data.fill(255);
    const t2 = traceCurve(col);
    expect(Array.from(t2.x).every((v) => v === 0)).toBe(true);
  });

  it('una guía fuera de la región: cero filas, con advertencia', () => {
    const t = traceCurve(blank(20, 20), { guide: { points: [{ x: 3, y: 100 }, { x: 4, y: 200 }] } });
    expect(t.x.length).toBe(0);
    expect(t.warnings[0]).toMatch(/guía no cae/);
  });

  it('máscara con valores no finitos en la guía (NaN) se ignoran', () => {
    const m = blank(20, 20);
    m.data.fill(255);
    const t = traceCurve(m, { guide: { points: [{ x: NaN, y: 3 }, { x: 4, y: 2 }, { x: 5, y: 19 }], corridor: 4 } });
    expect(t.x.length).toBeGreaterThan(0);
  });
});
