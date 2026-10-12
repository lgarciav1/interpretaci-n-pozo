import { describe, expect, it } from 'vitest';
import {
  apparentMatrixDensity,
  apparentMatrixDensityInto,
  applyCalibration,
  applyCalibrationInto,
  calibrationStats,
  cementationExponentFromRt,
  cementationExponentFromRtInto,
  fitCementationExponent,
  formationFactor,
  matchLogToPlugs,
  matrixDensityMatchingCore,
  summarizeByRanges,
  summarizeValues,
} from '../src/petro/coreCalibration';
import { densityPorosity } from '../src/petro/porosity';

// Valores esperados: ecuaciones de Bateman (1985) y Asquith y Krygowski (2004) donde se indica; el resto calculado con
// Python independiente (python3 -I, sin importar el repo) y/o a mano, rotulado como "verificado a mano, no de libro".

describe('petro/coreCalibration: emparejamiento plug–perfil', () => {
  // Perfil sintético: profundidad 100…110 cada 1 m, valor = 2·z (lineal, así la interpolación es exacta).
  const depth = Array.from({ length: 11 }, (_, i) => 100 + i);
  const value = depth.map((z) => 2 * z);

  it('interpolación lineal en el plug: z = 103,4 → 206,8 (verificado a mano)', () => {
    const out = matchLogToPlugs([103.4, 100, 110], depth, value);
    expect(out[0]).toBeCloseTo(206.8, 10);
    expect(out[1]).toBe(200);
    expect(out[2]).toBe(220);
  });

  it('plug fuera del perfil o profundidad no finita → NaN', () => {
    const out = matchLogToPlugs([99.9, 110.1, NaN], depth, value);
    expect(Number.isNaN(out[0]!)).toBe(true);
    expect(Number.isNaN(out[1]!)).toBe(true);
    expect(Number.isNaN(out[2]!)).toBe(true);
  });

  it('promedio en ventana ±1 m en z = 103,5 → media de las muestras en 103 y 104 = 207', () => {
    const out = matchLogToPlugs([103.5], depth, value, 1);
    expect(out[0]).toBeCloseTo(207, 10);
  });

  it('ventana ±2 m en z = 105: promedia 103…107 = 210 y suaviza un pico', () => {
    const spiky = value.slice();
    spiky[5] = 1000; // 105 m
    const out = matchLogToPlugs([105], depth, spiky, 2);
    // (206 + 208 + 1000 + 212 + 214) / 5 = 368
    expect(out[0]).toBeCloseTo(368, 10);
    expect(matchLogToPlugs([105], depth, spiky)[0]).toBe(1000);
  });

  it('ventana sin muestras (h menor que el paso) cae a la interpolación; muestras NaN no entran al promedio', () => {
    expect(matchLogToPlugs([103.5], depth, value, 0.1)[0]).toBeCloseTo(207, 10);
    const holes = value.slice();
    holes[4] = NaN; // 104 m
    // ventana [102,106]: 102,103,105,106 → (204+206+210+212)/4 = 208
    expect(matchLogToPlugs([104], depth, holes, 2)[0]).toBeCloseTo(208, 10);
    // sin ventana, z = 104 cae justo sobre la muestra NaN
    expect(Number.isNaN(matchLogToPlugs([104], depth, holes)[0]!)).toBe(true);
  });
});

describe('petro/coreCalibration: estadística de calibración φ perfil vs. corona', () => {
  const core = [0.1, 0.15, 0.2, 0.25];
  const log = [0.12, 0.14, 0.23, 0.26];

  it('sesgo, desvío, RMSE, MAE, r y r² (Python, verificado a mano, no de libro)', () => {
    const s = calibrationStats(core, log);
    expect(s.n).toBe(4);
    expect(s.bias).toBeCloseTo(0.0125, 12);
    expect(s.sdDiff).toBeCloseTo(0.01707825127659932, 12);
    expect(s.rmse).toBeCloseTo(0.01936491673103708, 12);
    expect(s.mae).toBeCloseTo(0.0175, 12);
    expect(s.r).toBeCloseTo(0.968141155667549, 12);
    expect(s.r2).toBeCloseTo(0.9372972972972974, 12);
  });

  it('rectas OLS y RMA de corona sobre perfil: OLS 0,91892·L + 0,0027027; RMA 0,94916·L − 0,0029671', () => {
    const s = calibrationStats(core, log);
    expect(s.ols!.slope).toBeCloseTo(0.9189189189189189, 12);
    expect(s.ols!.intercept).toBeCloseTo(0.002702702702702703, 12);
    expect(s.rma!.slope).toBeCloseTo(0.9491579957524989, 12);
    expect(s.rma!.intercept).toBeCloseTo(-0.002967124203593574, 12);
    // OLS atenúa la pendiente respecto de RMA (dilución de la regresión): |b_OLS| = |r|·|b_RMA|
    expect(s.ols!.slope / s.rma!.slope).toBeCloseTo(s.r, 12);
  });

  it('RMA es simétrica: la recta de perfil sobre corona es la inversa de la de corona sobre perfil; OLS no', () => {
    const a = calibrationStats(core, log);
    const b = calibrationStats(log, core); // ejes intercambiados
    expect(b.rma!.slope).toBeCloseTo(1 / a.rma!.slope, 12);
    expect(b.rma!.intercept).toBeCloseTo(-a.rma!.intercept / a.rma!.slope, 12);
    expect(b.ols!.slope).not.toBeCloseTo(1 / a.ols!.slope, 3);
  });

  it('perfil = corona: sesgo 0, r² = 1, pendiente 1 y ordenada 0 en ambas rectas', () => {
    const s = calibrationStats(core, core);
    expect(s.bias).toBe(0);
    expect(s.rmse).toBe(0);
    expect(s.r2).toBeCloseTo(1, 12);
    expect(s.ols!.slope).toBeCloseTo(1, 12);
    expect(s.rma!.slope).toBeCloseTo(1, 12);
    expect(s.rma!.intercept).toBeCloseTo(0, 12);
  });

  it('correlación negativa: la pendiente RMA toma el signo de la covarianza', () => {
    const s = calibrationStats([0.3, 0.2, 0.1], [0.1, 0.2, 0.3]);
    expect(s.rma!.slope).toBeCloseTo(-1, 12);
    expect(s.r).toBeCloseTo(-1, 12);
  });

  it('ignora los pares con NaN o Infinity', () => {
    const s = calibrationStats([...core, NaN, 0.3, 0.2], [...log, 0.2, NaN, Infinity]);
    expect(s.n).toBe(4);
    expect(s.bias).toBeCloseTo(0.0125, 12);
    expect(s.rma!.slope).toBeCloseTo(0.9491579957524989, 12);
  });

  it('casos degenerados: sin pares → NaN y rectas null; un solo par y perfil constante → sin ajuste', () => {
    const empty = calibrationStats([NaN], [NaN]);
    expect(empty.n).toBe(0);
    expect(Number.isNaN(empty.bias)).toBe(true);
    expect(empty.ols).toBeNull();
    const one = calibrationStats([0.2], [0.22]);
    expect(one.n).toBe(1);
    expect(one.bias).toBeCloseTo(0.02, 12);
    expect(one.rma).toBeNull();
    const flat = calibrationStats([0.1, 0.2, 0.3], [0.2, 0.2, 0.2]);
    expect(flat.ols).toBeNull();
    expect(flat.rma).toBeNull();
    expect(Number.isNaN(flat.r)).toBe(true);
  });

  it('desvío de las diferencias estable con sesgo grande frente a la dispersión (regresión de revisión)', () => {
    // d = 5 + {0, 1, 2, 3, 4}·1e-7 sobre corona ≈ 1000: desvío muestral exacto 1e-7·√2,5 = 1,5811e-7. La forma
    // Σd² − n·d̄² daba ~1,2e-7 (cancelación); la suma centrada lo reproduce.
    const core = [1000, 1000, 1000, 1000, 1000];
    const log = core.map((c, i) => c + 5 + i * 1e-7);
    expect(calibrationStats(core, log).sdDiff / (1e-7 * Math.sqrt(2.5))).toBeCloseTo(1, 4);
  });

  it('la recta RMA reduce el sesgo a ~0 en la media (pasa por el centro de masa)', () => {
    const s = calibrationStats(core, log);
    const meanLog = log.reduce((a, b) => a + b, 0) / 4;
    const meanCore = core.reduce((a, b) => a + b, 0) / 4;
    expect(applyCalibration(meanLog, s.rma!)).toBeCloseTo(meanCore, 12);
    expect(applyCalibration(meanLog, s.ols!)).toBeCloseTo(meanCore, 12);
  });
});

describe('petro/coreCalibration: corrección perfil → corona', () => {
  it('aplica la recta y recorta a [min, max]; NaN y Infinity se propagan como NaN', () => {
    const line = { slope: 0.9, intercept: 0.01 };
    expect(applyCalibration(0.2, line)).toBeCloseTo(0.19, 12);
    expect(applyCalibration(0.7, line, 0, 0.5)).toBe(0.5);
    expect(applyCalibration(-0.2, line, 0, 0.5)).toBe(0);
    expect(Number.isNaN(applyCalibration(NaN, line))).toBe(true);
    expect(Number.isNaN(applyCalibration(Infinity, line))).toBe(true);
  });

  it('Into escribe el tramo [start, end) y no toca el resto', () => {
    const out = new Float64Array(4).fill(-9);
    applyCalibrationInto([0.1, 0.2, NaN, 0.3], out, { slope: 2, intercept: 0 }, 0, 0.5, 1, 4);
    expect(out[0]).toBe(-9);
    expect(out[1]).toBeCloseTo(0.4, 12);
    expect(Number.isNaN(out[2]!)).toBe(true);
    expect(out[3]).toBe(0.5);
  });
});

describe('petro/coreCalibration: estadísticos de densidad de grano / ρmaa por zona', () => {
  const rhog = [2.6, 2.64, 2.65, 2.66, 2.7];

  it('media 2,65, mediana 2,65, desvío muestral 0,0360555, P10 2,616 y P90 2,684 (interpolación tipo 7, a mano)', () => {
    const s = summarizeValues(rhog);
    expect(s.n).toBe(5);
    expect(s.mean).toBeCloseTo(2.65, 12);
    expect(s.median).toBeCloseTo(2.65, 12);
    expect(s.sd).toBeCloseTo(0.036055512754639925, 12);
    expect(s.p10).toBeCloseTo(2.616, 12); // h = 0,4: 2,60 + 0,4·0,04
    expect(s.p90).toBeCloseTo(2.684, 12); // h = 3,6: 2,66 + 0,6·0,04
    expect(s.min).toBe(2.6);
    expect(s.max).toBe(2.7);
  });

  it('ignora NaN, respeta la máscara `include` y el tramo [start, end)', () => {
    const v = [NaN, 2.6, 2.7, Infinity, 2.8, 3.5];
    expect(summarizeValues(v).n).toBe(4);
    expect(summarizeValues(v, 0, 5).mean).toBeCloseTo(2.7, 12);
    expect(summarizeValues(v, 0, 6, (i) => i !== 5).max).toBe(2.8);
    expect(summarizeValues(v, 1, 3).median).toBeCloseTo(2.65, 12);
  });

  it('sin datos → n = 0 y todo NaN; un solo valor → sd NaN', () => {
    const e = summarizeValues([NaN, NaN]);
    expect(e.n).toBe(0);
    expect(Number.isNaN(e.mean)).toBe(true);
    const one = summarizeValues([2.65]);
    expect(one.median).toBe(2.65);
    expect(Number.isNaN(one.sd)).toBe(true);
  });

  it('summarizeByRanges: un resumen por zona, en el orden de los rangos', () => {
    const v = [2.6, 2.7, 2.65, 2.65, 3.0, 3.2];
    const z = summarizeByRanges(v, [
      { start: 0, end: 2 },
      { start: 2, end: 4 },
      { start: 4, end: 6 },
    ]);
    expect(z[0]!.mean).toBeCloseTo(2.65, 12);
    expect(z[1]!.mean).toBeCloseTo(2.65, 12);
    expect(z[2]!.mean).toBeCloseTo(3.1, 12);
    expect(z[2]!.p10).toBeCloseTo(3.02, 12);
  });
});

describe('petro/coreCalibration: densidad de matriz aparente', () => {
  it('φ = 0,20, ρb = 2,32, ρf = 1 → ρmaa = 2,65 (arenisca limpia, Bateman 1985 / Asquith y Krygowski 2004, cap. 4)', () => {
    expect(apparentMatrixDensity(2.32, 0.2, 1)).toBeCloseTo(2.65, 12);
  });

  it('es la inversa de la porosidad densidad: φD con ρma = ρmaa devuelve la φ dada (caliza 2,71, φ 0,15)', () => {
    const rhoB = 2.71 * (1 - 0.15) + 1 * 0.15; // 2,4535
    expect(apparentMatrixDensity(rhoB, 0.15, 1)).toBeCloseTo(2.71, 12);
    expect(densityPorosity(rhoB, apparentMatrixDensity(rhoB, 0.15, 1), 1)).toBeCloseTo(0.15, 12);
  });

  it('φ = 0,30, ρb = 2,15, ρf = 1 → 2,642857 (a mano: 1,85/0,70); φ = 0 → ρmaa = ρb', () => {
    expect(apparentMatrixDensity(2.15, 0.3, 1)).toBeCloseTo(1.85 / 0.7, 12);
    expect(apparentMatrixDensity(2.4, 0, 1)).toBe(2.4);
  });

  it('guardas: φ ≥ 1, φ < 0 o entradas no finitas → NaN', () => {
    expect(Number.isNaN(apparentMatrixDensity(2.3, 1, 1))).toBe(true);
    expect(Number.isNaN(apparentMatrixDensity(2.3, 1.2, 1))).toBe(true);
    expect(Number.isNaN(apparentMatrixDensity(2.3, -0.05, 1))).toBe(true);
    expect(Number.isNaN(apparentMatrixDensity(NaN, 0.2, 1))).toBe(true);
    expect(Number.isNaN(apparentMatrixDensity(2.3, NaN, 1))).toBe(true);
    expect(Number.isNaN(apparentMatrixDensity(2.3, 0.2, Infinity))).toBe(true);
  });

  it('Into: escribe el tramo y propaga NaN por muestra', () => {
    const out = new Float64Array(3).fill(-1);
    apparentMatrixDensityInto([2.32, NaN, 2.15], [0.2, 0.2, 0.3], out, 1);
    expect(out[0]).toBeCloseTo(2.65, 12);
    expect(Number.isNaN(out[1]!)).toBe(true);
    expect(out[2]).toBeCloseTo(1.85 / 0.7, 12);
    const out2 = new Float64Array(2).fill(-1);
    apparentMatrixDensityInto([2.32, 2.15], [0.2, 0.3], out2, 1, 1, 2);
    expect(out2[0]).toBe(-1);
    expect(out2[1]).toBeCloseTo(1.85 / 0.7, 12);
  });
});

describe('petro/coreCalibration: ρma que reproduce la φ de corona (solución cerrada)', () => {
  it('datos exactos de una misma matriz 2,65 → recupera 2,65 con sesgo y RMSE nulos', () => {
    const phiCore = [0.05, 0.12, 0.2, 0.28, 0.33];
    const rhoB = phiCore.map((p) => 2.65 * (1 - p) + 1 * p);
    const fit = matrixDensityMatchingCore(rhoB, phiCore, 1)!;
    expect(fit.rhoMa).toBeCloseTo(2.65, 12);
    expect(fit.n).toBe(5);
    expect(fit.rmse).toBeLessThan(1e-12);
    expect(fit.clamped).toBe(false);
  });

  it('dos plugs (ρb 2,32 / φc 0,20 y ρb 2,00 / φc 0,39): ρma = 1 + 2,7424/1,666 = 2,6460984 (a mano)', () => {
    const fit = matrixDensityMatchingCore([2.32, 2.0], [0.2, 0.39], 1)!;
    expect(fit.rhoMa).toBeCloseTo(2.6460984393757503, 10);
    expect(fit.bias).toBeCloseTo(0.000303383897316184, 10);
    expect(fit.rmse).toBeCloseTo(0.0022203577034767496, 10);
  });

  it('con un plug equivale a ρmaa con la φ de corona', () => {
    const fit = matrixDensityMatchingCore([2.32], [0.2], 1)!;
    expect(fit.rhoMa).toBeCloseTo(apparentMatrixDensity(2.32, 0.2, 1), 12);
  });

  it('es mínimo de S(ρma) = Σ(φD − φc)²: perturbarla en ±0,01 sube el error', () => {
    const rhoB = [2.32, 2.0, 2.45, 2.2];
    const phiC = [0.2, 0.39, 0.13, 0.27];
    const best = matrixDensityMatchingCore(rhoB, phiC, 1)!.rhoMa;
    const sse = (rhoMa: number) =>
      rhoB.reduce((s, rb, i) => s + ((rhoMa - rb) / (rhoMa - 1) - phiC[i]!) ** 2, 0);
    expect(sse(best)).toBeLessThan(sse(best + 0.01));
    expect(sse(best)).toBeLessThan(sse(best - 0.01));
  });

  it('bounds recorta la solución y la marca; descarta pares inválidos; null si no queda ninguno', () => {
    const fit = matrixDensityMatchingCore([2.32, 2.0], [0.2, 0.39], 1, [2.5, 2.6])!;
    expect(fit.rhoMa).toBe(2.6);
    expect(fit.clamped).toBe(true);
    const mixed = matrixDensityMatchingCore([2.32, NaN, 0.9, 2.3], [0.2, 0.2, 0.2, 1.1], 1)!;
    expect(mixed.n).toBe(1); // NaN, ρb < ρf y φ ≥ 1 se descartan
    expect(matrixDensityMatchingCore([NaN], [0.2], 1)).toBeNull();
    expect(matrixDensityMatchingCore([2.3], [0.2], NaN)).toBeNull();
    expect(matrixDensityMatchingCore([2.3], [0.2], 0)).toBeNull();
  });
});

describe('petro/coreCalibration: exponente de cementación', () => {
  it('Archie con valores de Humble (a = 0,62, m = 2,15; Asquith y Krygowski 2004, cap. 5): F(φ = 0,2) = 19,7323', () => {
    expect(0.62 / Math.pow(0.2, 2.15)).toBeCloseTo(19.73227679096956, 10);
  });

  it('datos exactos de Humble: a libre recupera a = 0,62 y m = 2,15 con r² = 1; a fijo 0,62 recupera m = 2,15', () => {
    const phi = [0.08, 0.12, 0.18, 0.22, 0.3];
    const F = phi.map((p) => 0.62 / Math.pow(p, 2.15));
    const r = fitCementationExponent(phi, F, 0.62);
    expect(r.n).toBe(5);
    expect(r.freeA!.m).toBeCloseTo(2.15, 10);
    expect(r.freeA!.a).toBeCloseTo(0.62, 10);
    expect(r.freeA!.r2).toBeCloseTo(1, 12);
    expect(r.fixedA!.m).toBeCloseTo(2.15, 10);
    expect(r.fixedA!.rmseLog10F).toBeLessThan(1e-10);
  });

  it('a = 1 fijo con F = 1/φ^2: m = 2 exacto', () => {
    const phi = [0.1, 0.2, 0.3];
    const r = fitCementationExponent(phi, phi.map((p) => 1 / (p * p)));
    expect(r.fixedA!.m).toBeCloseTo(2, 12);
    expect(r.fixedA!.a).toBe(1);
  });

  it('datos con ruido φ = [0,1; 0,2; 0,3], F = [110; 25; 10]: a=1 → m = 2,009913; libre → m = 2,177796, a = 0,735981 (Python)', () => {
    const r = fitCementationExponent([0.1, 0.2, 0.3], [110, 25, 10]);
    expect(r.fixedA!.m).toBeCloseTo(2.0099134222811887, 10);
    expect(r.fixedA!.r2).toBeCloseTo(0.9934202898323593, 10);
    expect(r.fixedA!.rmseLog10F).toBeCloseTo(0.03480394578526947, 10);
    expect(r.freeA!.m).toBeCloseTo(2.1777959762384316, 10);
    expect(r.freeA!.a).toBeCloseTo(0.7359807846351021, 10);
    expect(r.freeA!.r2).toBeCloseTo(0.9997819529962743, 10);
  });

  it('ignora pares inválidos (φ fuera de (0,1), F ≤ 0, NaN); con 2 plugs no ajusta a libre', () => {
    const r = fitCementationExponent([0.1, 0.2, 1, 0, NaN, 0.3], [100, 25, 5, 5, 5, -1]);
    expect(r.n).toBe(2);
    expect(r.freeA).toBeNull();
    expect(r.fixedA!.m).toBeCloseTo(2, 12);
    expect(fitCementationExponent([], [])).toEqual({ n: 0, fixedA: null, freeA: null });
    expect(fitCementationExponent([0.2, 0.2, 0.2], [20, 25, 30]).freeA).toBeNull(); // ln φ constante
  });

  it('formationFactor = Ro/Rw; entradas no positivas → NaN', () => {
    expect(formationFactor(1.25, 0.05)).toBeCloseTo(25, 12);
    expect(Number.isNaN(formationFactor(0, 0.05))).toBe(true);
    expect(Number.isNaN(formationFactor(1, -1))).toBe(true);
  });

  it('m por plug en zona acuífera: φ = 0,2, Rw = 0,05, Rt = 1,25 (F = 25) → m = 2 (a = 1)', () => {
    expect(cementationExponentFromRt(0.2, 1.25, 0.05)).toBeCloseTo(2, 12);
  });

  it('con a = 1 y Rt = 1,0: m = ln(0,05)/ln(0,2) = 1,861353 (a mano); con a = 0,62 y F de Humble recupera 2,15', () => {
    expect(cementationExponentFromRt(0.2, 1.0, 0.05)).toBeCloseTo(1.8613531161467862, 10);
    const rw = 0.05;
    const rt = (0.62 / Math.pow(0.2, 2.15)) * rw; // Ro = F·Rw
    expect(cementationExponentFromRt(0.2, rt, rw, 0.62)).toBeCloseTo(2.15, 10);
  });

  it('guardas: φ ∉ (0,1), Rt/Rw/a no positivos o no finitos → NaN; Into escribe el tramo', () => {
    expect(Number.isNaN(cementationExponentFromRt(1, 1, 0.05))).toBe(true);
    expect(Number.isNaN(cementationExponentFromRt(0, 1, 0.05))).toBe(true);
    expect(Number.isNaN(cementationExponentFromRt(0.2, -1, 0.05))).toBe(true);
    expect(Number.isNaN(cementationExponentFromRt(0.2, 1, 0))).toBe(true);
    expect(Number.isNaN(cementationExponentFromRt(0.2, 1, 0.05, 0))).toBe(true);
    expect(Number.isNaN(cementationExponentFromRt(NaN, 1, 0.05))).toBe(true);
    const out = new Float64Array(3).fill(-1);
    cementationExponentFromRtInto([0.2, 0.2, 0.2], [1.25, NaN, 1.25], out, 0.05, 1, 0, 3);
    expect(out[0]).toBeCloseTo(2, 12);
    expect(Number.isNaN(out[1]!)).toBe(true);
    expect(out[2]).toBeCloseTo(2, 12);
  });
});
