/**
 * Tests del motor numérico de rayos gamma espectrales y CGR (`src/petro/spectralGr.ts`, decisión 0090).
 *
 * Verificación independiente:
 *  - Regresión sintética exacta (error < 1e-9) y con ruido determinístico contrastada contra solución cerrada
 *    de ecuaciones normales 3×3 (Cramer) y contra un sistema ortogonal por bloques resuelto a mano.
 *  - Datos reales del TP (`datos/pozo_tp_perfiles.csv`, 5810 muestras): valores de referencia y plausibilidad física.
 *  - Bordes: NaN/±Infinity, negativos, n < 30, colinealidad/mal condicionamiento, coeficientes ≤ 0, R² < 0,85,
 *    varianza nula, inmutabilidad de entradas, tramos [start, end) y máscara opcional.
 */
import { describe, expect, it } from 'vitest';
import tpCsv from '../datos/pozo_tp_perfiles.csv?raw';
import {
  MIN_FIT_R2,
  MIN_FIT_SAMPLES,
  STANDARD_SPECTRAL_COEFFS,
  cgrResidualInto,
  cgrThKInto,
  evaluateSpectralFit,
  fitSpectralGr,
  isValidSpectralSample,
  uraniumGrFractionInto,
  type SpectralCoeffs,
} from '../src/petro/spectralGr';

/** Resuelve XᵀX·β = Xᵀy de 3×3 por regla de Cramer (implementación independiente del solver QR). */
function solveNormalEq3(th: number[], k: number[], u: number[], gr: number[]): SpectralCoeffs {
  const cols = [th, k, u];
  const s: number[][] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const t = [0, 0, 0];
  for (let i = 0; i < gr.length; i++) {
    const x = [cols[0]![i]!, cols[1]![i]!, cols[2]![i]!];
    for (let r = 0; r < 3; r++) {
      t[r] = t[r]! + x[r]! * gr[i]!;
      for (let c = 0; c < 3; c++) s[r]![c] = s[r]![c]! + x[r]! * x[c]!;
    }
  }
  const det = (m: number[][]) =>
    m[0]![0]! * (m[1]![1]! * m[2]![2]! - m[1]![2]! * m[2]![1]!) -
    m[0]![1]! * (m[1]![0]! * m[2]![2]! - m[1]![2]! * m[2]![0]!) +
    m[0]![2]! * (m[1]![0]! * m[2]![1]! - m[1]![1]! * m[2]![0]!);
  const d = det(s);
  const replaceCol = (colIdx: number) => s.map((row, r) => row.map((v, c) => (c === colIdx ? t[r]! : v)));
  return {
    a: det(replaceCol(0)) / d,
    b: det(replaceCol(1)) / d,
    c: det(replaceCol(2)) / d,
  };
}

/** Genera muestras sintéticas bien condicionadas con variación determinística (sin aleatoriedad). */
function makeDesign(n: number) {
  const th = new Float64Array(n);
  const k = new Float64Array(n);
  const u = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    th[i] = 2 + ((i * 7) % 19) * 1.1;
    k[i] = 0.5 + ((i * 11) % 13) * 0.25;
    // Incluye valores levemente negativos de U para verificar que se admiten en el ajuste.
    u[i] = -0.3 + ((i * 5) % 17) * 0.45;
  }
  return { th, k, u };
}

function parseTpSpectral(raw: string) {
  const lines = raw.trim().split(/\r?\n/);
  const header = lines[0]!.split(',');
  const iGr = header.indexOf('GR');
  const iTh = header.indexOf('THOR');
  const iK = header.indexOf('POTA');
  const iU = header.indexOf('URAN');
  const n = lines.length - 1;
  const gr = new Float64Array(n);
  const th = new Float64Array(n);
  const k = new Float64Array(n);
  const u = new Float64Array(n);
  const num = (s: string | undefined) => (s === undefined || s === '' ? NaN : Number(s));
  for (let i = 0; i < n; i++) {
    const cols = lines[i + 1]!.split(',');
    gr[i] = num(cols[iGr]);
    th[i] = num(cols[iTh]);
    k[i] = num(cols[iK]);
    u[i] = num(cols[iU]);
  }
  return { n, gr, th, k, u };
}

describe('constantes y validación de muestra', () => {
  it('expone las constantes estándar y umbrales de la decisión 0090', () => {
    expect(STANDARD_SPECTRAL_COEFFS).toEqual({ a: 4, b: 16, c: 8 });
    expect(Object.isFrozen(STANDARD_SPECTRAL_COEFFS)).toBe(true);
    expect(MIN_FIT_SAMPLES).toBe(30);
    expect(MIN_FIT_R2).toBe(0.85);
  });

  it('valida finitud, no negatividad de GR/Th/K y admite U levemente negativo', () => {
    expect(isValidSpectralSample(50, 10, 1.5, 2)).toBe(true);
    expect(isValidSpectralSample(0, 0, 0, 0)).toBe(true);
    expect(isValidSpectralSample(40, 8, 1.2, -0.4)).toBe(true);

    expect(isValidSpectralSample(-0.1, 10, 1.5, 2)).toBe(false);
    expect(isValidSpectralSample(50, -0.1, 1.5, 2)).toBe(false);
    expect(isValidSpectralSample(50, 10, -0.1, 2)).toBe(false);

    for (const bad of [NaN, Infinity, -Infinity]) {
      expect(isValidSpectralSample(bad, 10, 1.5, 2)).toBe(false);
      expect(isValidSpectralSample(50, bad, 1.5, 2)).toBe(false);
      expect(isValidSpectralSample(50, 10, bad, 2)).toBe(false);
      expect(isValidSpectralSample(50, 10, 1.5, bad)).toBe(false);
    }
  });
});

describe('regresión OLS sin intercepto (datos sintéticos)', () => {
  it('recupera coeficientes exactos GR = 3·Th + 12·K + 6·U con error < 1e-9, R² = 1 y RMSE ≈ 0', () => {
    const n = 60;
    const { th, k, u } = makeDesign(n);
    const gr = new Float64Array(n);
    for (let i = 0; i < n; i++) gr[i] = 3 * th[i]! + 12 * k[i]! + 6 * u[i]!;

    const fit = fitSpectralGr(gr, th, k, u);
    expect(fit.status).toBe('ok');
    expect(fit.n).toBe(n);
    expect(Math.abs(fit.a - 3)).toBeLessThan(1e-9);
    expect(Math.abs(fit.b - 12)).toBeLessThan(1e-9);
    expect(Math.abs(fit.c - 6)).toBeLessThan(1e-9);
    expect(fit.r2).toBeCloseTo(1, 12);
    expect(fit.rmse).toBeLessThan(1e-12);
  });

  it('coincide con la solución cerrada por bloques ortogonales calculada a mano', () => {
    // 3 bloques ortogonales de 10 muestras: XᵀX = diag(10·100, 10·4, 10·9) = diag(1000, 40, 90).
    // Bloque Th: Th=10, GR alterna 35 y 45 (media 40) -> a = 4000/1000 = 4, residuo ±5 (SSE_1 = 250).
    // Bloque K:  K=2,   GR alterna 28 y 36 (media 32) -> b = 640/40  = 16, residuo ±4 (SSE_2 = 160).
    // Bloque U:  U=3,   GR alterna 21 y 27 (media 24) -> c = 720/90  = 8, residuo ±3 (SSE_3 = 90).
    // SSE = 500, n = 30 -> RMSE = sqrt(500/30). Media GR = (40+32+24)/3 = 32.
    // SST = 5·(3²+13²) + 5·(4²+4²) + 5·(11²+5²) = 890 + 160 + 730 = 1780 -> R² = 1 - 500/1780 = 1280/1780.
    // Notar R² ≈ 0.7191 < 0.85 -> status 'low-r2'.
    const n = 30;
    const th = new Float64Array(n);
    const k = new Float64Array(n);
    const u = new Float64Array(n);
    const gr = new Float64Array(n);
    for (let i = 0; i < 10; i++) {
      th[i] = 10;
      gr[i] = i % 2 === 0 ? 35 : 45;
    }
    for (let i = 10; i < 20; i++) {
      k[i] = 2;
      gr[i] = i % 2 === 0 ? 28 : 36;
    }
    for (let i = 20; i < 30; i++) {
      u[i] = 3;
      gr[i] = i % 2 === 0 ? 21 : 27;
    }

    const fit = fitSpectralGr(gr, th, k, u);
    expect(fit.n).toBe(30);
    expect(fit.a).toBeCloseTo(4, 12);
    expect(fit.b).toBeCloseTo(16, 12);
    expect(fit.c).toBeCloseTo(8, 12);
    expect(fit.rmse).toBeCloseTo(Math.sqrt(500 / 30), 12);
    expect(fit.r2).toBeCloseTo(1 - 500 / 1780, 12);
    expect(fit.status).toBe('low-r2');
  });

  it('con ruido determinístico conocido coincide con ecuaciones normales 3×3 resueltas independientemente', () => {
    const n = 90;
    const { th, k, u } = makeDesign(n);
    const gr = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const noise = Math.sin(i * 1.7) * 2.5 + Math.cos(i * 0.9) * 1.2;
      gr[i] = 3.5 * th[i]! + 14.2 * k[i]! + 7.1 * u[i]! + noise;
    }

    const ref = solveNormalEq3(Array.from(th), Array.from(k), Array.from(u), Array.from(gr));
    let mean = 0;
    for (let i = 0; i < n; i++) mean += gr[i]!;
    mean /= n;
    let sse = 0;
    let sst = 0;
    for (let i = 0; i < n; i++) {
      const r = gr[i]! - (ref.a * th[i]! + ref.b * k[i]! + ref.c * u[i]!);
      sse += r * r;
      sst += (gr[i]! - mean) ** 2;
    }
    const refR2 = 1 - sse / sst;
    const refRmse = Math.sqrt(sse / n);

    const fit = fitSpectralGr(gr, th, k, u);
    expect(fit.status).toBe('ok');
    expect(fit.n).toBe(n);
    expect(Math.abs(fit.a - ref.a)).toBeLessThan(1e-10);
    expect(Math.abs(fit.b - ref.b)).toBeLessThan(1e-10);
    expect(Math.abs(fit.c - ref.c)).toBeLessThan(1e-10);
    expect(Math.abs(fit.r2 - refR2)).toBeLessThan(1e-12);
    expect(Math.abs(fit.rmse - refRmse)).toBeLessThan(1e-12);

    const evalStats = evaluateSpectralFit(gr, th, k, u, { a: fit.a, b: fit.b, c: fit.c });
    expect(evalStats.n).toBe(fit.n);
    expect(evalStats.r2).toBeCloseTo(fit.r2, 12);
    expect(evalStats.rmse).toBeCloseTo(fit.rmse, 12);
  });

  it('mantiene precisión con escalas de columnas muy dispares (escalado QR)', () => {
    const n = 50;
    const base = makeDesign(n);
    const th = base.th.map((v) => v * 1e6);
    const k = base.k.map((v) => v * 1e-4);
    const u = base.u;
    const gr = new Float64Array(n);
    for (let i = 0; i < n; i++) gr[i] = 2e-6 * th[i]! + 5e4 * k[i]! + 7 * u[i]!;

    const fit = fitSpectralGr(gr, th, k, u);
    expect(fit.status).toBe('ok');
    expect(Math.abs(fit.a - 2e-6) / 2e-6).toBeLessThan(1e-9);
    expect(Math.abs(fit.b - 5e4) / 5e4).toBeLessThan(1e-9);
    expect(Math.abs(fit.c - 7) / 7).toBeLessThan(1e-9);
  });
});

describe('datos reales del TP (pozo_tp_perfiles.csv)', () => {
  const tp = parseTpSpectral(tpCsv);

  it('ajusta las 5810 muestras del TP con coeficientes positivos y métricas fijadas', () => {
    expect(tp.n).toBe(5810);

    const fit = fitSpectralGr(tp.gr, tp.th, tp.k, tp.u);
    expect(fit.status).toBe('ok');
    expect(fit.n).toBe(5810);

    // Valores de referencia verificados independientemente contra ecuaciones normales 3×3.
    expect(fit.a).toBeCloseTo(3.1387395676, 6);
    expect(fit.b).toBeCloseTo(19.0672241015, 6);
    expect(fit.c).toBeCloseTo(0.0117316576, 6);
    expect(fit.r2).toBeCloseTo(0.9991408715, 6);
    expect(fit.rmse).toBeCloseTo(0.5599015499, 6);

    // Plausibilidad física.
    expect(fit.a).toBeGreaterThan(0);
    expect(fit.b).toBeGreaterThan(0);
    expect(fit.c).toBeGreaterThan(0);
    expect(fit.r2).toBeGreaterThanOrEqual(MIN_FIT_R2);
    expect(fit.rmse).toBeGreaterThan(0);

    // Consistencia con evaluateSpectralFit en todo el pozo y en un tramo (zona).
    const fullEval = evaluateSpectralFit(tp.gr, tp.th, tp.k, tp.u, fit);
    expect(fullEval.n).toBe(5810);
    expect(fullEval.r2).toBeCloseTo(fit.r2, 12);
    expect(fullEval.rmse).toBeCloseTo(fit.rmse, 12);

    const sliceEval = evaluateSpectralFit(tp.gr, tp.th, tp.k, tp.u, fit, { start: 0, end: 1000 });
    expect(sliceEval.n).toBe(1000);
    expect(sliceEval.r2).toBeGreaterThan(0.99);
    expect(sliceEval.rmse).toBeLessThan(1);
  });

  it('calcula CGR (Th+K y residual) y U_GR_FRAC finitos y en rango físico sobre el TP', () => {
    const fit = fitSpectralGr(tp.gr, tp.th, tp.k, tp.u);
    const cgrThK = new Float64Array(tp.n);
    const cgrRes = new Float64Array(tp.n);
    const uFrac = new Float64Array(tp.n);

    cgrThKInto(tp.th, tp.k, cgrThK, fit);
    cgrResidualInto(tp.gr, tp.u, cgrRes, fit.c);
    uraniumGrFractionInto(tp.th, tp.k, tp.u, uFrac, fit);

    for (let i = 0; i < tp.n; i++) {
      expect(Number.isFinite(cgrThK[i]!)).toBe(true);
      expect(cgrThK[i]!).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(cgrRes[i]!)).toBe(true);
      expect(cgrRes[i]!).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(uFrac[i]!)).toBe(true);
      expect(uFrac[i]!).toBeGreaterThanOrEqual(0);
      expect(uFrac[i]!).toBeLessThanOrEqual(1);
    }
  });
});

describe('bordes, guardas de dominio e inmutabilidad', () => {
  it('devuelve insufficient con coeficientes NaN si hay menos de 30 muestras válidas', () => {
    const { th, k, u } = makeDesign(40);
    const gr = new Float64Array(40);
    for (let i = 0; i < 40; i++) gr[i] = 4 * th[i]! + 16 * k[i]! + 8 * u[i]!;
    // Invalida 11 muestras -> quedan 29 (< 30).
    for (let i = 0; i < 4; i++) gr[i] = NaN;
    for (let i = 4; i < 7; i++) th[i] = -1;
    for (let i = 7; i < 9; i++) k[i] = Infinity;
    u[9] = -Infinity;
    gr[10] = -0.01;

    const fit = fitSpectralGr(gr, th, k, u);
    expect(fit.status).toBe('insufficient');
    expect(fit.n).toBe(29);
    expect(fit.a).toBeNaN();
    expect(fit.b).toBeNaN();
    expect(fit.c).toBeNaN();
    expect(fit.r2).toBeNaN();
    expect(fit.rmse).toBeNaN();
  });

  it('acepta exactamente 30 muestras válidas', () => {
    const { th, k, u } = makeDesign(30);
    const gr = new Float64Array(30);
    for (let i = 0; i < 30; i++) gr[i] = 4 * th[i]! + 16 * k[i]! + 8 * u[i]!;
    const fit = fitSpectralGr(gr, th, k, u);
    expect(fit.status).toBe('ok');
    expect(fit.n).toBe(30);
    expect(fit.a).toBeCloseTo(4, 9);
    expect(fit.b).toBeCloseTo(16, 9);
    expect(fit.c).toBeCloseTo(8, 9);
  });

  it('devuelve singular cuando las columnas son colineales (Th = 2·K exacto) o una columna es nula', () => {
    const n = 50;
    const { k, u } = makeDesign(n);
    const th = k.map((v) => 2 * v);
    const gr = new Float64Array(n);
    for (let i = 0; i < n; i++) gr[i] = 4 * th[i]! + 16 * k[i]! + 8 * u[i]!;

    const collinear = fitSpectralGr(gr, th, k, u);
    expect(collinear.status).toBe('singular');
    expect(collinear.n).toBe(n);
    expect(collinear.a).toBeNaN();
    expect(collinear.b).toBeNaN();
    expect(collinear.c).toBeNaN();
    expect(collinear.r2).toBeNaN();
    expect(collinear.rmse).toBeNaN();

    // Columna U toda ceros -> también no identificable.
    const { th: th2, k: k2 } = makeDesign(n);
    const zeroU = new Float64Array(n);
    const gr2 = new Float64Array(n);
    for (let i = 0; i < n; i++) gr2[i] = 4 * th2[i]! + 16 * k2[i]!;
    const zeroCol = fitSpectralGr(gr2, th2, k2, zeroU);
    expect(zeroCol.status).toBe('singular');
    expect(zeroCol.a).toBeNaN();
  });

  it('devuelve non-positive cuando algún coeficiente ajustado es ≤ 0', () => {
    const n = 50;
    const { th, k, u } = makeDesign(n);
    // Caso c < 0.
    const grNeg = new Float64Array(n);
    for (let i = 0; i < n; i++) grNeg[i] = 4 * th[i]! + 16 * k[i]! - 2 * u[i]!;
    const fitNeg = fitSpectralGr(grNeg, th, k, u);
    expect(fitNeg.status).toBe('non-positive');
    expect(fitNeg.a).toBeCloseTo(4, 9);
    expect(fitNeg.b).toBeCloseTo(16, 9);
    expect(fitNeg.c).toBeCloseTo(-2, 9);

    // Caso c = 0 (borde exacto ≤ 0).
    const grZero = new Float64Array(n);
    for (let i = 0; i < n; i++) grZero[i] = 4 * th[i]! + 16 * k[i]!;
    const fitZero = fitSpectralGr(grZero, th, k, u);
    expect(fitZero.status).toBe('non-positive');
    expect(Math.abs(fitZero.c)).toBeLessThan(1e-12);
  });

  it('evaluateSpectralFit devuelve r2 NaN si n < 2 o GR tiene varianza cero (incluso 0.1 constante)', () => {
    const coeffs = STANDARD_SPECTRAL_COEFFS;
    expect(evaluateSpectralFit([], [], [], [], coeffs)).toEqual({ n: 0, r2: NaN, rmse: NaN });

    const one = evaluateSpectralFit([50], [5], [1], [2], coeffs);
    expect(one.n).toBe(1);
    expect(one.r2).toBeNaN();
    expect(one.rmse).toBeCloseTo(Math.abs(50 - (4 * 5 + 16 * 1 + 8 * 2)), 12);

    // 30 muestras con GR constante = 0.1 (prueba también ausencia de varianza espuria IEEE-754).
    const grConst = new Float64Array(30).fill(0.1);
    const { th, k, u } = makeDesign(30);
    const zeroVar = evaluateSpectralFit(grConst, th, k, u, coeffs);
    expect(zeroVar.n).toBe(30);
    expect(zeroVar.r2).toBeNaN();
    expect(Number.isFinite(zeroVar.rmse)).toBe(true);
  });

  it('respeta start/end y mask en fitSpectralGr y evaluateSpectralFit', () => {
    const n = 80;
    const { th, k, u } = makeDesign(n);
    const gr = new Float64Array(n);
    for (let i = 0; i < 40; i++) gr[i] = 2 * th[i]! + 10 * k[i]! + 4 * u[i]!;
    for (let i = 40; i < 80; i++) gr[i] = 5 * th[i]! + 20 * k[i]! + 9 * u[i]!;

    const fitFirst = fitSpectralGr(gr, th, k, u, { start: 0, end: 40 });
    expect(fitFirst.status).toBe('ok');
    expect(fitFirst.n).toBe(40);
    expect(fitFirst.a).toBeCloseTo(2, 9);
    expect(fitFirst.b).toBeCloseTo(10, 9);
    expect(fitFirst.c).toBeCloseTo(4, 9);

    const fitSecond = fitSpectralGr(gr, th, k, u, { start: 40, end: 80 });
    expect(fitSecond.status).toBe('ok');
    expect(fitSecond.a).toBeCloseTo(5, 9);
    expect(fitSecond.b).toBeCloseTo(20, 9);
    expect(fitSecond.c).toBeCloseTo(9, 9);

    // Máscara selecciona solo la segunda mitad (solo mask[i] === 1 cuenta).
    const mask = new Float64Array(n);
    for (let i = 40; i < 80; i++) mask[i] = 1;
    mask[0] = 2;
    mask[1] = NaN;
    const fitMasked = fitSpectralGr(gr, th, k, u, { mask });
    expect(fitMasked.n).toBe(40);
    expect(fitMasked.a).toBeCloseTo(5, 9);
    expect(fitMasked.b).toBeCloseTo(20, 9);
    expect(fitMasked.c).toBeCloseTo(9, 9);

    const evalMasked = evaluateSpectralFit(gr, th, k, u, { a: 5, b: 20, c: 9 }, { mask });
    expect(evalMasked.n).toBe(40);
    expect(evalMasked.r2).toBeCloseTo(1, 12);
    expect(evalMasked.rmse).toBeLessThan(1e-12);
  });

  it('no muta ninguna curva de entrada ni la máscara', () => {
    const n = 45;
    const { th, k, u } = makeDesign(n);
    const gr = new Float64Array(n);
    const mask = new Float64Array(n).fill(1);
    for (let i = 0; i < n; i++) gr[i] = 4 * th[i]! + 16 * k[i]! + 8 * u[i]!;
    gr[3] = NaN;
    th[5] = -2;
    u[7] = Infinity;

    const snapGr = Float64Array.from(gr);
    const snapTh = Float64Array.from(th);
    const snapK = Float64Array.from(k);
    const snapU = Float64Array.from(u);
    const snapMask = Float64Array.from(mask);

    const fit = fitSpectralGr(gr, th, k, u, { mask });
    evaluateSpectralFit(gr, th, k, u, fit, { mask });
    const out = new Float64Array(n);
    cgrThKInto(th, k, out, fit);
    cgrResidualInto(gr, u, out, fit.c);
    uraniumGrFractionInto(th, k, u, out, fit);

    expect(Array.from(gr)).toEqual(Array.from(snapGr));
    expect(Array.from(th)).toEqual(Array.from(snapTh));
    expect(Array.from(k)).toEqual(Array.from(snapK));
    expect(Array.from(u)).toEqual(Array.from(snapU));
    expect(Array.from(mask)).toEqual(Array.from(snapMask));
  });
});

describe('curvas derivadas: cgrThKInto, cgrResidualInto y uraniumGrFractionInto', () => {
  const coeffs: SpectralCoeffs = { a: 4, b: 16, c: 8 };

  it('cgrThKInto recorta Th/K negativos a 0, propaga NaN/±Infinity y respeta [start, end)', () => {
    const th = Float64Array.of(10, -5, 0, NaN, Infinity, 3);
    const k = Float64Array.of(2, 1.5, -1, 2, 1, -Infinity);
    const out = new Float64Array(6).fill(-999);

    cgrThKInto(th, k, out, coeffs, 1, 5);
    expect(out[0]).toBe(-999);
    expect(out[1]).toBeCloseTo(0 + 16 * 1.5, 12);
    expect(out[2]).toBe(0);
    expect(out[3]).toBeNaN();
    expect(out[4]).toBeNaN();
    expect(out[5]).toBe(-999);

    cgrThKInto(th, k, out, coeffs);
    expect(out[0]).toBeCloseTo(4 * 10 + 16 * 2, 12);
    expect(out[5]).toBeNaN();
  });

  it('cgrResidualInto calcula max(0, GR − c·U), propaga no finitos y respeta [start, end)', () => {
    const gr = Float64Array.of(100, 10, 50, NaN, Infinity, 40);
    const u = Float64Array.of(5, 5, -1, 2, 1, -Infinity);
    const out = new Float64Array(6).fill(-999);

    cgrResidualInto(gr, u, out, 8, 1, 5);
    expect(out[0]).toBe(-999);
    expect(out[1]).toBe(0); // max(0, 10 - 40)
    expect(out[2]).toBeCloseTo(58, 12); // 50 - 8*(-1)
    expect(out[3]).toBeNaN();
    expect(out[4]).toBeNaN();
    expect(out[5]).toBe(-999);

    cgrResidualInto(gr, u, out, 8);
    expect(out[0]).toBeCloseTo(60, 12);
    expect(out[5]).toBeNaN();
  });

  it('uraniumGrFractionInto recorta Th,K,U a ≥ 0, acota a [0, 1], da NaN si den ≤ 0 o no finito y respeta [start, end)', () => {
    // 0: 24 / (40 + 32 + 24) = 0.25
    // 1: U negativo -> 0 / (40 + 16) = 0
    // 2: Th=K=0, U>0 -> 1
    // 3: Th=K=U=0 -> den=0 -> NaN
    // 4: todos negativos -> recortados a 0 -> den=0 -> NaN
    // 5: NaN en entrada -> NaN
    // 6: Infinity en entrada -> NaN
    const th = Float64Array.of(10, 10, 0, 0, -2, NaN, 5);
    const k = Float64Array.of(2, 1, 0, 0, -1, 1, Infinity);
    const u = Float64Array.of(3, -1, 4, 0, -3, 2, 1);
    const out = new Float64Array(7).fill(-999);

    uraniumGrFractionInto(th, k, u, out, coeffs, 1, 6);
    expect(out[0]).toBe(-999);
    expect(out[1]).toBe(0);
    expect(out[2]).toBe(1);
    expect(out[3]).toBeNaN();
    expect(out[4]).toBeNaN();
    expect(out[5]).toBeNaN();
    expect(out[6]).toBe(-999);

    uraniumGrFractionInto(th, k, u, out, coeffs);
    expect(out[0]).toBeCloseTo(0.25, 12);
    expect(out[6]).toBeNaN();
  });

  it('rechaza coeficientes negativos devolviendo NaN en cgrThKInto, cgrResidualInto y uraniumGrFractionInto', () => {
    const out = new Float64Array(2).fill(123);
    cgrThKInto([10, 5], [2, 1], out, { a: -4, b: 16, c: 8 });
    expect(Array.from(out).every(Number.isNaN)).toBe(true);

    out.fill(123);
    cgrResidualInto([50, 80], [10, 2], out, -8);
    expect(Array.from(out).every(Number.isNaN)).toBe(true);

    out.fill(123);
    uraniumGrFractionInto([10, 1], [2, 1], [1, 10], out, { a: 4, b: 16, c: -8 });
    expect(Array.from(out).every(Number.isNaN)).toBe(true);

    out.fill(123);
    uraniumGrFractionInto([1, 2], [1, 2], [10, 5], out, { a: -4, b: -16, c: 8 });
    expect(Array.from(out).every(Number.isNaN)).toBe(true);
  });
});
