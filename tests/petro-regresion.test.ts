import { describe, expect, it } from 'vitest';
import {
  TREND_MODEL_DOCS,
  evalTrend,
  fitTrend,
  formatTrendEquation,
  intersectTrends,
  invertTrend,
  trendSlopeAt,
  trendThroughPoints,
  type TrendCoefficients,
  type TrendModel,
} from '../src/petro/regression';

// Cuarteto de Anscombe (1973), The American Statistician 27(1):17-21, tabla 1.
const ANSCOMBE_X = [10, 8, 13, 9, 11, 14, 6, 4, 12, 7, 5];
const ANSCOMBE_Y1 = [8.04, 6.95, 7.58, 8.81, 8.33, 9.96, 7.24, 4.26, 10.84, 4.82, 5.68];
const ANSCOMBE_Y2 = [9.14, 8.14, 8.74, 8.77, 9.26, 8.1, 6.13, 3.1, 9.13, 7.26, 4.74];

describe('petro/regression: ajuste lineal contra bibliografía', () => {
  it('Anscombe I: y = 3,0001 + 0,5001·x, R² = 0,6665 (Anscombe 1973; reproducido con numpy.polyfit)', () => {
    const f = fitTrend(ANSCOMBE_X, ANSCOMBE_Y1, 'linear')!;
    expect(f.a).toBeCloseTo(3.0001, 4);
    expect(f.b).toBeCloseTo(0.5001, 4);
    expect(f.r2).toBeCloseTo(0.6665, 4);
    expect(f.n).toBe(11);
    expect(f.skipped).toBe(0);
    expect(f.xMin).toBe(4);
    expect(f.xMax).toBe(14);
  });

  it('Anscombe II: a = 3,0009, b = 0,5000, R² = 0,6662 (los cuatro cuartetos comparten la recta)', () => {
    const f = fitTrend(ANSCOMBE_X, ANSCOMBE_Y2, 'linear')!;
    expect(f.a).toBeCloseTo(3.0009, 4);
    expect(f.b).toBeCloseTo(0.5, 4);
    expect(f.r2).toBeCloseTo(0.6662, 4);
  });

  it('datos exactos y = 3 + 2x: coeficientes exactos, R² = 1, rmse = 0', () => {
    const x = [0, 1, 2, 3, 4, 5];
    const y = x.map((v) => 3 + 2 * v);
    const f = fitTrend(x, y, 'linear')!;
    expect(f.a).toBeCloseTo(3, 12);
    expect(f.b).toBeCloseTo(2, 12);
    expect(f.r2).toBeCloseTo(1, 12);
    expect(f.rmse).toBeLessThan(1e-12);
  });

  it('rmse en el espacio original: Anscombe I da √(SSE/n) = 1,1887 (SSE = 13,7627 con n = 11, ajuste lineal)', () => {
    const f = fitTrend(ANSCOMBE_X, ANSCOMBE_Y1, 'linear')!;
    // SSE = (1 − R²)·SST; SST de y1 = 41,2727 (10 · var muestral 4,1273) → SSE = 13,7627.
    expect(f.rmse * f.rmse * f.n).toBeCloseTo(13.7627, 3);
  });

  it('y constante: pendiente 0 y R² = 1 (ajuste exacto)', () => {
    const f = fitTrend([1, 2, 3, 4], [5, 5, 5, 5], 'linear')!;
    expect(f.b).toBe(0);
    expect(f.a).toBe(5);
    expect(f.r2).toBe(1);
  });
});

describe('petro/regression: precisión con profundidades grandes', () => {
  it('x en [7633, 8518] m, pendiente 0,0098 y offset −1000: coeficientes a 1e-9 relativo', () => {
    const n = 5810;
    const x = new Float64Array(n);
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      x[i] = 7633 + i * 0.1524;
      y[i] = -1000 + 0.0098 * x[i]!;
    }
    const f = fitTrend(x, y, 'linear')!;
    expect(Math.abs(f.b - 0.0098) / 0.0098).toBeLessThan(1e-9);
    expect(Math.abs(f.a + 1000) / 1000).toBeLessThan(1e-9);
    expect(f.r2).toBeCloseTo(1, 12);
  });

  it('gradiente de presión de agua en kPa/m con z ~ 8000 m: recupera 9,8 y el offset 101,325', () => {
    const z: number[] = [];
    const p: number[] = [];
    for (let i = 0; i < 40; i++) {
      z.push(7900 + i * 3.7);
      p.push(101.325 + 9.80665 * z[i]!);
    }
    const f = fitTrend(z, p, 'linear')!;
    expect(Math.abs(f.b - 9.80665) / 9.80665).toBeLessThan(1e-12);
    expect(Math.abs(f.a - 101.325) / 101.325).toBeLessThan(1e-8);
  });

  it('exponencial de compactación DT = 180·e^(−0,0004·z) con z en [7633, 8518]: recupera a y b', () => {
    const z: number[] = [];
    const dt: number[] = [];
    for (let i = 0; i < 200; i++) {
      z.push(7633 + i * 4.4);
      dt.push(180 * Math.exp(-0.0004 * z[i]!));
    }
    const f = fitTrend(z, dt, 'exp')!;
    expect(Math.abs(f.b + 0.0004) / 0.0004).toBeLessThan(1e-9);
    expect(Math.abs(f.a - 180) / 180).toBeLessThan(1e-7);
  });
});

describe('petro/regression: modelos log, exp y power', () => {
  it('log: datos exactos y = 2 + 5·ln x recuperan a y b, R² = 1', () => {
    const x = [1, 2, 4, 8, 16];
    const y = x.map((v) => 2 + 5 * Math.log(v));
    const f = fitTrend(x, y, 'log')!;
    expect(f.a).toBeCloseTo(2, 12);
    expect(f.b).toBeCloseTo(5, 12);
    expect(f.r2).toBeCloseTo(1, 12);
  });

  it('log: caso pequeño x = [1,2,4,8], y = [3,5,7,14] → a = 2,000, b = 5,0494, R² = 0,8909 (numpy)', () => {
    const f = fitTrend([1, 2, 4, 8], [3, 5, 7, 14], 'log')!;
    expect(f.a).toBeCloseTo(2.0, 9);
    expect(f.b).toBeCloseTo(5.049432643, 8);
    expect(f.r2).toBeCloseTo(0.890909091, 8);
  });

  it('exp: datos exactos y = 152·e^(−0,00031·x) recuperan a y b', () => {
    const x = [0, 500, 1000, 2000, 3500, 5000];
    const y = x.map((v) => 152 * Math.exp(-0.00031 * v));
    const f = fitTrend(x, y, 'exp')!;
    expect(f.a).toBeCloseTo(152, 8);
    expect(f.b).toBeCloseTo(-0.00031, 12);
    expect(f.r2).toBeCloseTo(1, 12);
    expect(f.rmse).toBeLessThan(1e-8);
  });

  it('exp: caso a mano x = [1,2,3], y = [2,3,5] (igual que la tendencia exponencial de Excel)', () => {
    // Por simetría de x: b = (ln5 − ln2)/2 = 0,458145; ln a = mean(ln y) − 2b → a = 1,242893.
    // R² del espacio linealizado = (ln5 − ln2)² / (2·Svv) con Svv = Σ(ln y − media)² = 0,421644 → 0,995612.
    const f = fitTrend([1, 2, 3], [2, 3, 5], 'exp')!;
    expect(f.b).toBeCloseTo((Math.log(5) - Math.log(2)) / 2, 12);
    expect(f.a).toBeCloseTo(1.242893, 6);
    expect(f.r2).toBeCloseTo(0.995612, 6);
    // rmse en el espacio ORIGINAL de y (≠ rmse linealizado).
    expect(f.rmse).toBeCloseTo(0.0822308, 6);
  });

  it('power: datos exactos y = 7·x^(−0,6) recuperan a y b (p. ej. k–φ potencial)', () => {
    const x = [0.5, 1, 2, 5, 10, 40];
    const y = x.map((v) => 7 * Math.pow(v, -0.6));
    const f = fitTrend(x, y, 'power')!;
    expect(f.a).toBeCloseTo(7, 10);
    expect(f.b).toBeCloseTo(-0.6, 12);
    expect(f.r2).toBeCloseTo(1, 12);
  });

  it('power: caso x = [1,2,4,8], y = [3,5,7,14] → a = 2,9435, b = 0,71526, R² = 0,98209 (numpy sobre ln–ln)', () => {
    const f = fitTrend([1, 2, 4, 8], [3, 5, 7, 14], 'power')!;
    expect(f.a).toBeCloseTo(2.9434528, 6);
    expect(f.b).toBeCloseTo(0.7152604, 6);
    expect(f.r2).toBeCloseTo(0.9820922, 6);
  });
});

describe('petro/regression: dominio, nulos y opciones', () => {
  it('log y power descartan x ≤ 0; exp y power descartan y ≤ 0 (cuentan en `skipped`)', () => {
    const x = [-1, 0, 1, 2, 4];
    const y = [5, 5, 3, 5, 7];
    const fl = fitTrend(x, y, 'log')!;
    expect(fl.skipped).toBe(2);
    expect(fl.n).toBe(3);
    expect(fl.xMin).toBe(1);
    const fe = fitTrend([1, 2, 3, 4, 5], [2, 0, -1, 4, 8], 'exp')!;
    expect(fe.skipped).toBe(2);
    expect(fe.n).toBe(3);
    const fp = fitTrend([1, 2, 0, 4, 5], [2, -3, 5, 4, 8], 'power')!;
    expect(fp.skipped).toBe(2);
    expect(fp.n).toBe(3);
  });

  it('NaN e Infinity se descartan en todos los modelos', () => {
    const x = [1, 2, NaN, 4, 5, 6];
    const y = [2, 4, 6, Infinity, 10, 12];
    const f = fitTrend(x, y, 'linear')!;
    expect(f.n).toBe(4);
    expect(f.skipped).toBe(2);
    expect(f.b).toBeCloseTo(2, 12);
    expect(f.a).toBeCloseTo(0, 12);
  });

  it('menos de 2 puntos válidos → null; x constante → null', () => {
    expect(fitTrend([1], [1], 'linear')).toBeNull();
    expect(fitTrend([], [], 'linear')).toBeNull();
    expect(fitTrend([1, NaN], [1, 2], 'linear')).toBeNull();
    expect(fitTrend([3, 3, 3], [1, 2, 3], 'linear')).toBeNull();
    expect(fitTrend([2, 2, 2], [1, 2, 3], 'exp')).toBeNull();
    expect(fitTrend([-1, -2, 0], [1, 2, 3], 'log')).toBeNull();
    // x distinto pero y ≤ 0 deja un solo punto en power
    expect(fitTrend([1, 2], [1, -1], 'power')).toBeNull();
  });

  it('start/end limita el tramo; indices tiene prioridad; exclude saca outliers', () => {
    const x = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const y = x.map((v) => 1 + 2 * v);
    y[5] = 1000; // outlier
    const full = fitTrend(x, y, 'linear')!;
    expect(full.b).not.toBeCloseTo(2, 1);
    const sinOutlier = fitTrend(x, y, 'linear', { exclude: (i) => i === 5 })!;
    expect(sinOutlier.b).toBeCloseTo(2, 12);
    expect(sinOutlier.a).toBeCloseTo(1, 12);
    expect(sinOutlier.n).toBe(9);
    expect(sinOutlier.skipped).toBe(0);
    const tramo = fitTrend(x, y, 'linear', { start: 0, end: 5 })!;
    expect(tramo.n).toBe(5);
    expect(tramo.b).toBeCloseTo(2, 12);
    const idx = fitTrend(x, y, 'linear', { indices: [9, 1, 3, 7, 99, -1], start: 100 })!;
    expect(idx.n).toBe(4);
    expect(idx.b).toBeCloseTo(2, 12);
    expect(idx.xMin).toBe(1);
    expect(idx.xMax).toBe(9);
  });

  it('rendimiento: 50 000 muestras, 30 ajustes de cada modelo sin asignar arrays del tamaño del pozo', () => {
    const n = 50000;
    const x = new Float64Array(n);
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      x[i] = 7633 + i * 0.0177;
      y[i] = 50 + 100 * Math.exp(-0.0003 * (x[i]! - 7633)) + Math.sin(i) * 0.1;
    }
    const t0 = performance.now();
    for (let k = 0; k < 30; k++) {
      for (const m of ['linear', 'log', 'exp', 'power'] as TrendModel[]) fitTrend(x, y, m);
    }
    expect(performance.now() - t0).toBeLessThan(3000);
  });
});

describe('petro/regression: evalTrend, invertTrend, trendSlopeAt', () => {
  const cases: TrendCoefficients[] = [
    { model: 'linear', a: 14.7, b: 0.433 },
    { model: 'log', a: -4.5, b: 12.3 },
    { model: 'exp', a: 152, b: -0.00031 },
    { model: 'power', a: 7, b: -0.6 },
  ];

  it('valores a mano', () => {
    expect(evalTrend({ model: 'linear', a: 14.7, b: 0.433 }, 8000)).toBeCloseTo(3478.7, 9);
    expect(evalTrend({ model: 'log', a: 1, b: 2 }, Math.E)).toBeCloseTo(3, 12);
    expect(evalTrend({ model: 'exp', a: 2, b: 0.5 }, 2)).toBeCloseTo(2 * Math.E, 12);
    expect(evalTrend({ model: 'power', a: 3, b: 2 }, 4)).toBe(48);
  });

  it('NaN fuera de dominio (x ≤ 0 en log y power) y con NaN de entrada', () => {
    expect(evalTrend(cases[1]!, 0)).toBeNaN();
    expect(evalTrend(cases[1]!, -3)).toBeNaN();
    expect(evalTrend(cases[3]!, 0)).toBeNaN();
    expect(evalTrend(cases[0]!, NaN)).toBeNaN();
    expect(trendSlopeAt(cases[1]!, 0)).toBeNaN();
    expect(trendSlopeAt(cases[3]!, -1)).toBeNaN();
  });

  it('invertTrend es la inversa de evalTrend', () => {
    for (const c of cases) {
      for (const x of [0.7, 3, 120, 4500]) {
        const y = evalTrend(c, x);
        expect(invertTrend(c, y) / x).toBeCloseTo(1, 9);
      }
    }
  });

  it('invertTrend: NaN cuando no existe (b = 0, y/a ≤ 0)', () => {
    expect(invertTrend({ model: 'linear', a: 1, b: 0 }, 3)).toBeNaN();
    expect(invertTrend({ model: 'exp', a: 2, b: 0.5 }, -1)).toBeNaN();
    expect(invertTrend({ model: 'power', a: 2, b: 0.5 }, 0)).toBeNaN();
    expect(invertTrend({ model: 'exp', a: 2, b: 0.5 }, NaN)).toBeNaN();
  });

  it('trendSlopeAt coincide con la derivada numérica (diferencias centrales)', () => {
    for (const c of cases) {
      for (const x of [2, 50, 3000]) {
        const h = x * 1e-6;
        const num = (evalTrend(c, x + h) - evalTrend(c, x - h)) / (2 * h);
        expect(trendSlopeAt(c, x) / num).toBeCloseTo(1, 6);
      }
    }
  });

  it('formas cerradas: lineal b; log b/x; exp a·b·e^(bx); power a·b·x^(b−1)', () => {
    expect(trendSlopeAt({ model: 'linear', a: 5, b: 0.35 }, 1234)).toBe(0.35);
    expect(trendSlopeAt({ model: 'log', a: 0, b: 6 }, 3)).toBe(2);
    expect(trendSlopeAt({ model: 'exp', a: 2, b: 0.5 }, 0)).toBe(1);
    expect(trendSlopeAt({ model: 'power', a: 3, b: 2 }, 5)).toBe(30);
  });
});

describe('petro/regression: trendThroughPoints', () => {
  const p1 = { x: 2, y: 3 };
  const p2 = { x: 9, y: 11 };

  it('la curva pasa exactamente por los dos puntos en los cuatro modelos', () => {
    for (const m of ['linear', 'log', 'exp', 'power'] as TrendModel[]) {
      const c = trendThroughPoints(m, p1, p2)!;
      expect(c.model).toBe(m);
      expect(evalTrend(c, p1.x)).toBeCloseTo(p1.y, 10);
      expect(evalTrend(c, p2.x)).toBeCloseTo(p2.y, 10);
    }
  });

  it('lineal: (2,3) y (9,11) → b = 8/7, a = 3 − 16/7 (a mano)', () => {
    const c = trendThroughPoints('linear', p1, p2)!;
    expect(c.b).toBeCloseTo(8 / 7, 12);
    expect(c.a).toBeCloseTo(3 - 16 / 7, 12);
  });

  it('potencial con puntos de una potencia exacta recupera a y b', () => {
    const c = trendThroughPoints('power', { x: 1, y: 7 }, { x: 4, y: 7 * 8 })!;
    expect(c.b).toBeCloseTo(1.5, 12);
    expect(c.a).toBeCloseTo(7, 12);
  });

  it('con profundidades de ~8000 m en lineal conserva precisión', () => {
    const c = trendThroughPoints('linear', { x: 7633, y: 74.8 + 0.0098 * 7633 }, { x: 8518, y: 74.8 + 0.0098 * 8518 })!;
    expect(Math.abs(c.b - 0.0098) / 0.0098).toBeLessThan(1e-9);
  });

  it('null: x iguales, fuera de dominio o no finitos', () => {
    expect(trendThroughPoints('linear', { x: 1, y: 1 }, { x: 1, y: 2 })).toBeNull();
    expect(trendThroughPoints('log', { x: 0, y: 1 }, { x: 2, y: 2 })).toBeNull();
    expect(trendThroughPoints('log', { x: -1, y: 1 }, { x: 2, y: 2 })).toBeNull();
    expect(trendThroughPoints('exp', { x: 1, y: 0 }, { x: 2, y: 2 })).toBeNull();
    expect(trendThroughPoints('power', { x: 1, y: 1 }, { x: 2, y: -2 })).toBeNull();
    expect(trendThroughPoints('linear', { x: NaN, y: 1 }, { x: 2, y: 2 })).toBeNull();
  });
});

describe('petro/regression: intersectTrends', () => {
  // Contacto agua–petróleo a 8000 ft (Dake 1978, cap. 2): ambos fluidos tienen la misma presión en el contacto.
  const water: TrendCoefficients = { model: 'linear', a: 14.7, b: 0.433 }; // psi, z en ft
  const pContacto = 14.7 + 0.433 * 8000; // 3478,7 psi
  const oil: TrendCoefficients = { model: 'linear', a: pContacto - 0.35 * 8000, b: 0.35 };

  it('rectas de agua (0,433 psi/ft) y petróleo (0,35 psi/ft): corte en 8000 ft', () => {
    expect(intersectTrends(water, oil)!).toBeCloseTo(8000, 8);
    expect(intersectTrends(oil, water)!).toBeCloseTo(8000, 8);
    expect(intersectTrends(water, oil, [7000, 9000])!).toBeCloseTo(8000, 8);
  });

  it('corte fuera de xRange → null; rectas paralelas o idénticas → null', () => {
    expect(intersectTrends(water, oil, [0, 7000])).toBeNull();
    expect(intersectTrends(water, { model: 'linear', a: 20, b: 0.433 })).toBeNull();
    expect(intersectTrends(water, water)).toBeNull();
  });

  it('mismo modelo no lineal: formas cerradas (log, exp, power)', () => {
    // log: 1 + 2 ln x = 3 + 1 ln x → ln x = 2 → x = e²
    expect(intersectTrends({ model: 'log', a: 1, b: 2 }, { model: 'log', a: 3, b: 1 })!).toBeCloseTo(Math.E ** 2, 10);
    // exp: 2e^(0,5x) = 8e^(0,1x) → e^(0,4x) = 4 → x = ln4/0,4
    expect(intersectTrends({ model: 'exp', a: 2, b: 0.5 }, { model: 'exp', a: 8, b: 0.1 })!).toBeCloseTo(Math.log(4) / 0.4, 10);
    // power: 2x^3 = 18x → x² = 9 → x = 3
    expect(intersectTrends({ model: 'power', a: 2, b: 3 }, { model: 'power', a: 18, b: 1 })!).toBeCloseTo(3, 10);
    // exp con signos de `a` opuestos: nunca se cortan
    expect(intersectTrends({ model: 'exp', a: 2, b: 0.5 }, { model: 'exp', a: -8, b: 0.1 })).toBeNull();
  });

  it('modelos distintos: búsqueda en xRange (e^x = x + 3 → x = 1,505241495793)', () => {
    const e: TrendCoefficients = { model: 'exp', a: 1, b: 1 };
    const l: TrendCoefficients = { model: 'linear', a: 3, b: 1 };
    expect(intersectTrends(e, l, [0, 3])!).toBeCloseTo(1.505241495793, 10);
    expect(intersectTrends(l, e, [3, 0])!).toBeCloseTo(1.505241495793, 10);
  });

  it('modelos distintos: sin xRange → null; dos cortes → null (ambiguo); uno solo al acotar el rango', () => {
    const e: TrendCoefficients = { model: 'exp', a: 1, b: 1 };
    const l3: TrendCoefficients = { model: 'linear', a: 0, b: 3 };
    expect(intersectTrends(e, l3)).toBeNull();
    // e^x = 3x tiene raíces 0,619061 y 1,512135
    expect(intersectTrends(e, l3, [0, 2])).toBeNull();
    expect(intersectTrends(e, l3, [1, 2])!).toBeCloseTo(1.5121345516578, 10);
    expect(intersectTrends(e, l3, [0, 1])!).toBeCloseTo(0.6190612867359, 10);
    // sin cortes: e^x > 2x siempre
    expect(intersectTrends(e, { model: 'linear', a: 0, b: 2 }, [-5, 5])).toBeNull();
  });

  it('modelos distintos con dominio parcial (log en x ≤ 0 es NaN): ignora el tramo no definido', () => {
    // 1 + 2 ln x = 0,5·x tiene dos raíces (≈0,2 y ≈12); en [1, 20] solo la mayor.
    const lg: TrendCoefficients = { model: 'log', a: 1, b: 2 };
    const l: TrendCoefficients = { model: 'linear', a: 0, b: 0.5 };
    const x = intersectTrends(lg, l, [1, 20])!;
    expect(1 + 2 * Math.log(x)).toBeCloseTo(0.5 * x, 10);
    expect(x).toBeGreaterThan(10);
    expect(intersectTrends(lg, l, [-5, 20])).toBeNull(); // incluye ambas raíces
  });

  it('contacto con rectas obtenidas de ajustes de puntos MDT (kPa, z en m)', () => {
    const z1 = [2000, 2010, 2020, 2030];
    const zc = 2040; // contacto verdadero
    const pc = 20000; // kPa
    const gw = 1.03 * 9.80665; // agua salada
    const go = 0.78 * 9.80665; // petróleo
    const pw = z1.map((z) => pc + gw * (z - zc));
    const po = z1.map((z) => pc + go * (z - zc));
    const fw = fitTrend(z1, pw, 'linear')!;
    const fo = fitTrend(z1, po, 'linear')!;
    expect(intersectTrends(fw, fo)!).toBeCloseTo(zc, 6);
  });
});

describe('petro/regression: formatTrendEquation', () => {
  it('lineal: "y = 0,433·x + 14,7"', () => {
    expect(formatTrendEquation({ model: 'linear', a: 14.7, b: 0.433 })).toBe('y = 0,433·x + 14,7');
  });

  it('lineal con offset negativo y pendiente negativa usa el menos tipográfico', () => {
    expect(formatTrendEquation({ model: 'linear', a: -4.567, b: -0.4331 })).toBe('y = −0,433·x − 4,57');
  });

  it('exponencial: "y = 152·e^(−0,00031·x)"', () => {
    expect(formatTrendEquation({ model: 'exp', a: 152.04, b: -0.00031 })).toBe('y = 152·e^(−0,00031·x)');
  });

  it('potencial y logarítmica', () => {
    expect(formatTrendEquation({ model: 'power', a: 7.0123, b: -0.6 })).toBe('y = 7,01·x^(−0,6)');
    expect(formatTrendEquation({ model: 'power', a: 3, b: 1.5 })).toBe('y = 3·x^1,5');
    expect(formatTrendEquation({ model: 'log', a: -4.5, b: 12.34 })).toBe('y = 12,3·ln(x) − 4,5');
  });

  it('nombres de variables y cifras significativas a elección', () => {
    expect(formatTrendEquation({ model: 'linear', a: 14.7, b: 0.43353 }, { x: 'z', y: 'P', digits: 4 })).toBe('P = 0,4335·z + 14,7');
  });

  it('offset grande conserva la parte entera; coeficientes muy chicos van en notación científica', () => {
    expect(formatTrendEquation({ model: 'linear', a: -3287.4, b: 0.0098 })).toBe('y = 0,0098·x − 3287');
    expect(formatTrendEquation({ model: 'exp', a: 5, b: -3.1e-5 })).toBe('y = 5·e^(−3,1·10⁻⁵·x)');
  });

  it('pendiente nula y offset nulo', () => {
    expect(formatTrendEquation({ model: 'linear', a: 5, b: 0 })).toBe('y = 5');
    expect(formatTrendEquation({ model: 'linear', a: 0, b: 2 })).toBe('y = 2·x');
  });
});

describe('petro/regression: documentación de modelos', () => {
  it('etiquetas en español y LaTeX para el módulo Ecuaciones', () => {
    expect(TREND_MODEL_DOCS.linear.label).toBe('Lineal');
    expect(TREND_MODEL_DOCS.log.label).toBe('Logarítmica');
    expect(TREND_MODEL_DOCS.exp.label).toBe('Exponencial');
    expect(TREND_MODEL_DOCS.power.label).toBe('Potencial');
    for (const m of Object.values(TREND_MODEL_DOCS)) expect(m.latex.length).toBeGreaterThan(5);
  });
});
