import { describe, expect, it } from 'vitest';
import { buildFeatureMatrix, featureValue, FEATURES, nphiIsPercent, resolveCurveAliases } from '../src/ml/features';

describe('Características de los modelos de facies', () => {
  it('log10 de la resistividad profunda: 1, 10, 100 ohm·m → 0, 1, 2', () => {
    const fm = buildFeatureMatrix({ RDEP: [1, 10, 100] }, ['LOG_RDEP']);
    expect(Array.from(fm.X)).toEqual([0, 1, 2]);
    expect(fm.n).toBe(3);
    expect(fm.d).toBe(1);
  });

  it('valores fuera de rango físico o no positivos → NaN (casos reales del TP y de FORCE)', () => {
    // TP: CAL = 1,098 in con trépano de 8,5 in; NPHI = 3,3 v/v; FORCE: PEF = 383, GR = 1077, RDEP ≤ 0.
    expect(featureValue(FEATURES.CALI, 1.098)).toBeNaN();
    expect(featureValue(FEATURES.CALI, 8.4)).toBe(8.4);
    expect(featureValue(FEATURES.NPHI, 3.3172)).toBeNaN();
    expect(featureValue(FEATURES.NPHI, 0.21)).toBe(0.21);
    expect(featureValue(FEATURES.PEF, 383)).toBeNaN();
    expect(featureValue(FEATURES.GR, 1077)).toBeNaN();
    expect(featureValue(FEATURES.LOG_RDEP, 0)).toBeNaN();
    expect(featureValue(FEATURES.LOG_RDEP, -0.01)).toBeNaN();
    expect(featureValue(FEATURES.RHOB, 0.72)).toBeNaN();
    expect(featureValue(FEATURES.DTC, NaN)).toBeNaN();
    expect(featureValue(FEATURES.GR, Infinity)).toBeNaN();
  });

  it('neutrón en % se detecta por el percentil 95 y se pasa a v/v; los picos espurios no engañan', () => {
    expect(nphiIsPercent([22, 25, 30, 18, 35])).toBe(true);
    expect(nphiIsPercent([0.22, 0.25, 0.3, 0.18, 0.35])).toBe(false);
    // 1 % de picos de 330 en un pozo en v/v: el percentil 95 sigue siendo ≈ 0,3.
    const withSpikes = Array.from({ length: 1000 }, (_, i) => (i % 100 === 0 ? 3.3 : 0.2 + (i % 17) * 0.01));
    expect(nphiIsPercent(withSpikes)).toBe(false);
    const pct = buildFeatureMatrix({ NPHI: [20, 30, 45] }, ['NPHI']);
    expect(pct.X[0]).toBeCloseTo(0.2, 6);
    expect(pct.X[2]).toBeCloseTo(0.45, 6);
    const forced = buildFeatureMatrix({ NPHI: [0.2, 0.3] }, ['NPHI'], { nphiUnit: 'percent' });
    expect(forced.X[0]).toBeCloseTo(0.002, 6);
    const frac = buildFeatureMatrix({ NPHI: [20, 30] }, ['NPHI'], { nphiUnit: 'fraction' });
    expect(Number.isNaN(frac.X[0])).toBe(true); // 20 v/v está fuera de rango
  });

  it('alias FORCE y TP resuelven a las mismas curvas del modelo', () => {
    const force = resolveCurveAliases({ GR: [1], RHOB: [2], NPHI: [3], PEF: [4], DTC: [5], RDEP: [6], CALI: [7] });
    const tp = resolveCurveAliases({ gr: [1], zden: [2], nphi: [3], pe: [4], dt: [5], at90: [6], cal: [7], at10: [99] });
    expect(Object.keys(force).sort()).toEqual(['CALI', 'DTC', 'GR', 'NPHI', 'PEF', 'RDEP', 'RHOB']);
    for (const k of Object.keys(force) as (keyof typeof force)[]) expect(Array.from(tp[k]!)).toEqual(Array.from(force[k]!));
    // AT10 no es RDEP: no se usa aunque exista.
    expect(Array.from(tp.RDEP!)).toEqual([6]);
  });

  it('curva ausente → columna NaN y se informa; longitudes distintas → error', () => {
    const fm = buildFeatureMatrix({ GR: [50, 60], RHOB: [2.3, 2.4] }, ['GR', 'RHOB', 'NPHI']);
    expect(fm.missingCurves).toEqual(['NPHI']);
    expect(Number.isNaN(fm.X[2])).toBe(true);
    expect(fm.X[0]).toBe(50);
    expect(fm.X[4]).toBeCloseTo(2.4, 6);
    expect(() => buildFeatureMatrix({ GR: [1, 2], RHOB: [1] }, ['GR', 'RHOB'])).toThrow();
    expect(buildFeatureMatrix({}, ['GR']).n).toBe(0);
  });
});
