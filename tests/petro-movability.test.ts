import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RMF_OVER_RW,
  MHI_HIGH_MOBILITY,
  MHI_MOVABLE_SANDSTONE,
  SXO_BELOW_SW_TOL,
  archieSxo,
  emptyMovabilityCounts,
  evaluateMovabilitySample,
  hydrocarbonMovabilityIndex,
  movabilityInto,
  movableHydrocarbonFraction,
  movableOilSaturation,
  ratioMhi,
  ratioSxoRaw,
  residualHydrocarbonSaturation,
  rtRxoLineRxo,
  summarizeMovability,
  type MovabilityParams,
} from '../src/petro/movability';
import { archieSw } from '../src/petro/saturation';
import { arpsResistivityC } from '../src/petro/temperature';

function baseParams(overrides: Partial<MovabilityParams> = {}): MovabilityParams {
  return {
    method: 'ratio',
    rmfOverRw: DEFAULT_RMF_OVER_RW,
    rmf: 0.5,
    tRmf: 25,
    correctRmfTemp: true,
    a: 1,
    m: 2,
    n: 2,
    ...overrides,
  };
}

describe('petro/movability — constantes y casos de libro (Asquith & Krygowski, cap. 6)', () => {
  it('expone las constantes de referencia esperadas', () => {
    expect(DEFAULT_RMF_OVER_RW).toBe(10);
    expect(MHI_MOVABLE_SANDSTONE).toBe(0.7);
    expect(MHI_HIGH_MOBILITY).toBe(0.5);
    expect(SXO_BELOW_SW_TOL).toBe(1e-6);
  });

  it('arena clásica con hidrocarburo móvil: Rt=20, Rxo=40, Rw=0,05, Rmf=0,5, φ=0,25, a=1, m=2, n=2', () => {
    const rt = 20;
    const rxo = 40;
    const rw = 0.05;
    const rmf = 0.5;
    const phi = 0.25;
    const sw = archieSw(rt, phi, rw, 1, 2, 2);

    expect(sw).toBeCloseTo(0.2, 12);

    const expectedSxo = Math.sqrt(0.2); // 0.4472135954999579
    const expectedMos = expectedSxo - 0.2; // 0.2472135954999579
    const expectedShr = 1 - expectedSxo; // 0.5527864045000421
    const expectedMhi = 0.2 / expectedSxo; // 0.4472135954999579

    expect(ratioMhi(rxo, rt, rmf / rw, 2)).toBeCloseTo(expectedMhi, 6);
    expect(ratioSxoRaw(sw, rxo, rt, rmf / rw, 2)).toBeCloseTo(expectedSxo, 6);
    expect(archieSxo(rxo, phi, rmf, 1, 2, 2)).toBeCloseTo(expectedSxo, 6);
    expect(movableOilSaturation(sw, expectedSxo)).toBeCloseTo(expectedMos, 6);
    expect(residualHydrocarbonSaturation(expectedSxo)).toBeCloseTo(expectedShr, 6);
    expect(hydrocarbonMovabilityIndex(sw, expectedSxo)).toBeCloseTo(expectedMhi, 6);
    expect(movableHydrocarbonFraction(sw, expectedSxo)).toBeCloseTo(expectedMos / 0.8, 6);

    const resRatio = evaluateMovabilitySample(
      { sw, phi, rxo, rt },
      baseParams({ method: 'ratio', rmfOverRw: rmf / rw }),
    );
    expect(resRatio.sxo).toBeCloseTo(0.4472, 4);
    expect(resRatio.mos).toBeCloseTo(0.2472, 4);
    expect(resRatio.shr).toBeCloseTo(0.5528, 4);
    expect(resRatio.mhi).toBeCloseTo(0.4472, 4);
    expect(resRatio.mhi).toBeLessThan(MHI_MOVABLE_SANDSTONE);
    expect(resRatio.mhi).toBeLessThan(MHI_HIGH_MOBILITY);
    expect(resRatio.belowSw).toBe(false);
    expect(resRatio.clippedHigh).toBe(false);

    const resArchie = evaluateMovabilitySample(
      { sw, phi, rxo },
      baseParams({ method: 'archie', rmf, correctRmfTemp: false }),
    );
    expect(resArchie.sxo).toBeCloseTo(resRatio.sxo, 12);
    expect(resArchie.mos).toBeCloseTo(resRatio.mos, 12);
    expect(resArchie.shr).toBeCloseTo(resRatio.shr, 12);
    expect(resArchie.mhi).toBeCloseTo(resRatio.mhi, 12);
  });

  it('equivalencia algebraica exacta entre ratio y archie para cualquier (a, m, n)', () => {
    const cases = [
      { a: 1, m: 2, n: 2, rt: 25, rxo: 60, rw: 0.04, rmf: 0.4, phi: 0.22 },
      { a: 0.81, m: 2, n: 2, rt: 30, rxo: 50, rw: 0.05, rmf: 0.6, phi: 0.18 },
      { a: 0.62, m: 2.15, n: 2, rt: 18, rxo: 35, rw: 0.03, rmf: 0.45, phi: 0.24 },
      { a: 1, m: 1.8, n: 1.6, rt: 12, rxo: 28, rw: 0.06, rmf: 0.54, phi: 0.26 },
      { a: 0.9, m: 2.2, n: 2.5, rt: 50, rxo: 90, rw: 0.02, rmf: 0.35, phi: 0.2 },
    ];

    for (const c of cases) {
      const sw = archieSw(c.rt, c.phi, c.rw, c.a, c.m, c.n);
      expect(sw).toBeLessThan(1);

      const resRatio = evaluateMovabilitySample(
        { sw, phi: c.phi, rxo: c.rxo, rt: c.rt },
        baseParams({
          method: 'ratio',
          rmfOverRw: c.rmf / c.rw,
          a: c.a,
          m: c.m,
          n: c.n,
        }),
      );
      const resArchie = evaluateMovabilitySample(
        { sw, phi: c.phi, rxo: c.rxo, rt: c.rt },
        baseParams({
          method: 'archie',
          rmf: c.rmf,
          correctRmfTemp: false,
          a: c.a,
          m: c.m,
          n: c.n,
        }),
      );

      expect(resRatio.sxoRaw).toBeCloseTo(resArchie.sxoRaw, 12);
      expect(resRatio.sxo).toBeCloseTo(resArchie.sxo, 12);
      expect(resRatio.mos).toBeCloseTo(resArchie.mos, 12);
      expect(resRatio.shr).toBeCloseTo(resArchie.shr, 12);
      expect(resRatio.mhi).toBeCloseTo(resArchie.mhi, 12);
      expect(resRatio.belowSw).toBe(resArchie.belowSw);
      expect(resRatio.clippedHigh).toBe(resArchie.clippedHigh);
    }
  });

  it('arenisca de Asquith & Krygowski cap. 6: Sw=0,25, Rxo/Rt=2,5, Rmf/Rw=12,5, n=2', () => {
    const rt = 10;
    const rxo = 25; // Rxo / Rt = 2.5
    const rmfOverRw = 12.5;
    const sw = 0.25;

    const r = ratioMhi(rxo, rt, rmfOverRw, 2);
    expect(r).toBeCloseTo(Math.sqrt(0.2), 12); // 0.4472135955

    const res = evaluateMovabilitySample(
      { sw, phi: 0.2, rxo, rt },
      baseParams({ method: 'ratio', rmfOverRw, n: 2 }),
    );
    expect(res.mhi).toBeCloseTo(0.4472, 4);
    expect(res.sxo).toBeCloseTo(0.559, 4);
    expect(res.mos).toBeCloseTo(0.309, 4);
    expect(res.shr).toBeCloseTo(0.441, 4);
    expect(res.sxo).toBeCloseTo(0.25 / Math.sqrt(0.2), 12);
    expect(res.belowSw).toBe(false);
    expect(res.clippedHigh).toBe(false);

    // La recta de movilidad constante en el gráfico Rt–Rxo pasa exactamente por (Rt, Rxo)
    expect(rtRxoLineRxo(rt, rmfOverRw, res.mhi, 2)).toBeCloseTo(rxo, 12);
  });

  it('zona acuífera 100 % agua: Rxo/Rt = Rmf/Rw, Sw = 1', () => {
    const res = evaluateMovabilitySample(
      { sw: 1, phi: 0.25, rxo: 10, rt: 1 },
      baseParams({ method: 'ratio', rmfOverRw: 10 }),
    );
    expect(res.sxo).toBe(1);
    expect(res.mos).toBe(0);
    expect(res.shr).toBe(0);
    expect(res.mhi).toBe(1);
    expect(res.belowSw).toBe(false);
    expect(res.clippedHigh).toBe(false);
    expect(movableHydrocarbonFraction(1, res.sxo)).toBeNaN();
    expect(rtRxoLineRxo(1, 10, 1, 2)).toBe(10);
  });

  it('hidrocarburo residual/inmóvil: Sw=0,30, Rxo/Rt = Rmf/Rw', () => {
    const res = evaluateMovabilitySample(
      { sw: 0.3, phi: 0.22, rxo: 150, rt: 15 },
      baseParams({ method: 'ratio', rmfOverRw: 10 }),
    );
    expect(res.mhi).toBeCloseTo(1, 12);
    expect(res.sxo).toBeCloseTo(0.3, 12);
    expect(res.mos).toBeCloseTo(0, 12);
    expect(res.shr).toBeCloseTo(0.7, 12);
    expect(res.belowSw).toBe(false);
    expect(res.clippedHigh).toBe(false);
    expect(movableHydrocarbonFraction(0.3, res.sxo)).toBe(0);
  });
});

describe('petro/movability — recortes físicos, anomalías y temperatura Arps', () => {
  it('Sxo_raw > 1 recorta a 1, marca clippedHigh y conserva MOS = 1 − Sw, SHR = 0, MHI = Sw', () => {
    const sw = 0.6;
    const res = evaluateMovabilitySample(
      { sw, phi: 0.25, rxo: 40, rt: 20 },
      baseParams({ method: 'ratio', rmfOverRw: 10, n: 2 }),
    );
    expect(res.sxoRaw).toBeCloseTo(0.6 / Math.sqrt(0.2), 12);
    expect(res.sxoRaw).toBeGreaterThan(1);
    expect(res.clippedHigh).toBe(true);
    expect(res.belowSw).toBe(false);
    expect(res.sxo).toBe(1);
    expect(res.shr).toBe(0);
    expect(res.mos).toBeCloseTo(1 - sw, 12);
    expect(res.mhi).toBeCloseTo(sw, 12);
    expect(movableHydrocarbonFraction(sw, res.sxo)).toBeCloseTo(1, 12);
  });

  it('caso anómalo Sxo_raw < Sw (OBM o Rmf/Rw subestimado) recorta a Sw, marca belowSw e incrementa conteo', () => {
    const sw = 0.3;
    const rxo = 200;
    const rt = 10; // Rxo/Rt = 20 > Rmf/Rw = 10 => r = sqrt(2) > 1 => Sxo_raw < Sw
    const res = evaluateMovabilitySample(
      { sw, phi: 0.2, rxo, rt },
      baseParams({ method: 'ratio', rmfOverRw: 10, n: 2 }),
    );
    expect(res.sxoRaw).toBeCloseTo(0.3 / Math.SQRT2, 12);
    expect(res.belowSw).toBe(true);
    expect(res.clippedHigh).toBe(false);
    expect(res.sxo).toBeCloseTo(sw, 12);
    expect(res.mos).toBe(0);
    expect(res.shr).toBeCloseTo(1 - sw, 12);
    expect(res.mos + res.shr).toBeCloseTo(1 - sw, 12);
    expect(res.mhi).toBeCloseTo(1, 12);

    // Contabilización en movabilityInto
    const out = {
      sxo: new Float64Array(2),
      mos: new Float64Array(2),
      shr: new Float64Array(2),
      mhi: new Float64Array(2),
    };
    const counts = movabilityInto(
      {
        sw: new Float64Array([0.3, 0.2]),
        phi: new Float64Array([0.2, 0.25]),
        rxo: new Float64Array([200, 40]),
        rt: new Float64Array([10, 20]),
      },
      out,
      baseParams({ method: 'ratio', rmfOverRw: 10 }),
    );
    expect(counts.total).toBe(2);
    expect(counts.resolved).toBe(2);
    expect(counts.belowSw).toBe(1);
    expect(counts.clippedHigh).toBe(0);
    expect(counts.missingRxo).toBe(0);
    expect(counts.missingInputs).toBe(0);
  });

  it('respeta la tolerancia SXO_BELOW_SW_TOL para no disparar falsos positivos por ruido numérico', () => {
    const sw = 0.5;
    // Elegimos Rxo/Rt ligeramente mayor a Rmf/Rw para que sxoRaw quede dentro de SXO_BELOW_SW_TOL
    const targetRaw = sw - SXO_BELOW_SW_TOL * 0.25;
    const r = sw / targetRaw;
    const rxo = 10 * 10 * r * r; // rt = 10, rmfOverRw = 10
    const res = evaluateMovabilitySample(
      { sw, phi: 0.2, rxo, rt: 10 },
      baseParams({ method: 'ratio', rmfOverRw: 10, n: 2 }),
    );
    expect(res.belowSw).toBe(false);
    expect(res.sxo).toBe(sw);
    expect(res.mos).toBe(0);
  });

  it('modo archie con corrección de Rmf por temperatura (Arps) vs sin corrección y sin curva TEMP', () => {
    const rxo = 20;
    const phi = 0.22;
    const sw = 0.15;
    const rmf = 0.8;
    const tRmf = 20;
    const temp = 80;

    const rmfAtT = arpsResistivityC(rmf, tRmf, temp);
    expect(rmfAtT).toBeLessThan(rmf); // a mayor temperatura, menor resistividad del filtrado

    const withTemp = evaluateMovabilitySample(
      { sw, phi, rxo, temp },
      baseParams({ method: 'archie', rmf, tRmf, correctRmfTemp: true, a: 1, m: 2, n: 2 }),
    );
    const expectedSxoAtT = archieSxo(rxo, phi, rmfAtT, 1, 2, 2);
    expect(withTemp.sxo).toBeCloseTo(expectedSxoAtT, 12);
    expect(withTemp.mos).toBeCloseTo(expectedSxoAtT - sw, 12);

    // Con correctRmfTemp = false, ignora temp y usa rmf directo
    const noCorrection = evaluateMovabilitySample(
      { sw, phi, rxo, temp },
      baseParams({ method: 'archie', rmf, tRmf, correctRmfTemp: false, a: 1, m: 2, n: 2 }),
    );
    const expectedSxoDirect = archieSxo(rxo, phi, rmf, 1, 2, 2);
    expect(noCorrection.sxo).toBeCloseTo(expectedSxoDirect, 12);
    expect(withTemp.sxo).toBeLessThan(noCorrection.sxo);

    // Sin curva TEMP (temp === undefined), correctRmfTemp = true usa rmf directo
    const withoutTempCurve = evaluateMovabilitySample(
      { sw, phi, rxo },
      baseParams({ method: 'archie', rmf, tRmf, correctRmfTemp: true, a: 1, m: 2, n: 2 }),
    );
    expect(withoutTempCurve.sxo).toBeCloseTo(expectedSxoDirect, 12);

    // Con temp = NaN o fuera del dominio de Arps (<= -21.5389 °C) y correctRmfTemp = true => todo NaN
    const nanTemp = evaluateMovabilitySample(
      { sw, phi, rxo, temp: NaN },
      baseParams({ method: 'archie', rmf, tRmf, correctRmfTemp: true }),
    );
    expect(nanTemp.sxo).toBeNaN();
    expect(nanTemp.sxoRaw).toBeNaN();
    expect(nanTemp.mos).toBeNaN();
    expect(nanTemp.shr).toBeNaN();
    expect(nanTemp.mhi).toBeNaN();

    const invalidTemp = evaluateMovabilitySample(
      { sw, phi, rxo, temp: -30 },
      baseParams({ method: 'archie', rmf, tRmf, correctRmfTemp: true }),
    );
    expect(invalidTemp.sxo).toBeNaN();
  });

  it('modo archie sin Sw finito resuelve Sxo y SHR y deja MOS y MHI en NaN', () => {
    const res = evaluateMovabilitySample(
      { sw: NaN, phi: 0.25, rxo: 40 },
      baseParams({ method: 'archie', rmf: 0.5, correctRmfTemp: false }),
    );
    const expectedSxo = Math.sqrt(0.2);
    expect(res.sxo).toBeCloseTo(expectedSxo, 12);
    expect(res.shr).toBeCloseTo(1 - expectedSxo, 12);
    expect(res.mos).toBeNaN();
    expect(res.mhi).toBeNaN();
    expect(res.belowSw).toBe(false);
    expect(res.clippedHigh).toBe(false);

    // En archie sin Sw, Sxo_raw > 1 también recorta a 1 y marca clippedHigh
    const high = evaluateMovabilitySample(
      { sw: NaN, phi: 0.1, rxo: 10 },
      baseParams({ method: 'archie', rmf: 0.5, correctRmfTemp: false }),
    );
    expect(high.sxo).toBe(1);
    expect(high.shr).toBe(0);
    expect(high.mos).toBeNaN();
    expect(high.mhi).toBeNaN();
    expect(high.clippedHigh).toBe(true);
  });
});

describe('petro/movability — conservación volumétrica sobre grilla variada', () => {
  it('mantiene SW + MOS + SHR === 1 y MOS + SHR === 1 − SW en ratio y archie', () => {
    const swGrid = [0, 0.05, 0.2, 0.45, 0.75, 1];
    const rxoGrid = [2, 10, 40, 200];
    const rtGrid = [1, 10, 50];
    const phiGrid = [0.08, 0.2, 0.35];
    const nGrid = [1.5, 2, 2.5];

    for (const sw of swGrid) {
      for (const rxo of rxoGrid) {
        for (const rt of rtGrid) {
          for (const n of nGrid) {
            const r = evaluateMovabilitySample(
              { sw, phi: 0.2, rxo, rt },
              baseParams({ method: 'ratio', rmfOverRw: 10, n }),
            );
            expect(r.sxo).toBeGreaterThanOrEqual(sw - 1e-12);
            expect(r.sxo).toBeLessThanOrEqual(1);
            expect(sw + r.mos + r.shr).toBeCloseTo(1, 12);
            expect(r.mos + r.shr).toBeCloseTo(1 - sw, 12);
          }
        }
        for (const phi of phiGrid) {
          for (const n of nGrid) {
            const a = evaluateMovabilitySample(
              { sw, phi, rxo },
              baseParams({ method: 'archie', rmf: 0.5, correctRmfTemp: false, n }),
            );
            expect(a.sxo).toBeGreaterThanOrEqual(sw - 1e-12);
            expect(a.sxo).toBeLessThanOrEqual(1);
            expect(sw + a.mos + a.shr).toBeCloseTo(1, 12);
            expect(a.mos + a.shr).toBeCloseTo(1 - sw, 12);
          }
        }
      }
    }
  });
});

describe('petro/movability — bordes, funciones escalares, movabilityInto y summarizeMovability', () => {
  it('guardas estrictas contra NaN, ±Infinity, 0 y negativos en todas las funciones escalares', () => {
    const badPos = [NaN, Infinity, -Infinity, 0, -1, -0.001];
    for (const bad of badPos) {
      expect(ratioMhi(bad, 10, 10, 2)).toBeNaN();
      expect(ratioMhi(40, bad, 10, 2)).toBeNaN();
      expect(ratioMhi(40, 10, bad, 2)).toBeNaN();
      expect(ratioMhi(40, 10, 10, bad)).toBeNaN();

      expect(archieSxo(bad, 0.2, 0.5, 1, 2, 2)).toBeNaN();
      expect(archieSxo(40, bad, 0.5, 1, 2, 2)).toBeNaN();
      expect(archieSxo(40, 0.2, bad, 1, 2, 2)).toBeNaN();
      expect(archieSxo(40, 0.2, 0.5, bad, 2, 2)).toBeNaN();
      expect(archieSxo(40, 0.2, 0.5, 1, bad, 2)).toBeNaN();
      expect(archieSxo(40, 0.2, 0.5, 1, 2, bad)).toBeNaN();

      expect(rtRxoLineRxo(bad, 10, 1, 2)).toBeNaN();
      expect(rtRxoLineRxo(10, bad, 1, 2)).toBeNaN();
      expect(rtRxoLineRxo(10, 10, bad, 2)).toBeNaN();
      expect(rtRxoLineRxo(10, 10, 1, bad)).toBeNaN();
    }

    for (const nonFinite of [NaN, Infinity, -Infinity]) {
      expect(ratioSxoRaw(nonFinite, 40, 20, 10, 2)).toBeNaN();
      expect(movableOilSaturation(nonFinite, 0.5)).toBeNaN();
      expect(movableOilSaturation(0.2, nonFinite)).toBeNaN();
      expect(residualHydrocarbonSaturation(nonFinite)).toBeNaN();
      expect(hydrocarbonMovabilityIndex(nonFinite, 0.5)).toBeNaN();
      expect(hydrocarbonMovabilityIndex(0.2, nonFinite)).toBeNaN();
      expect(movableHydrocarbonFraction(nonFinite, 0.5)).toBeNaN();
      expect(movableHydrocarbonFraction(0.2, nonFinite)).toBeNaN();
    }

    // Sw = 0 y Sxo = 0
    expect(ratioSxoRaw(0, 40, 20, 10, 2)).toBe(0);
    expect(ratioSxoRaw(-0.1, 40, 20, 10, 2)).toBe(0);
    expect(hydrocarbonMovabilityIndex(0, 0)).toBeNaN();
    expect(hydrocarbonMovabilityIndex(0.2, -0.5)).toBeNaN();
    expect(hydrocarbonMovabilityIndex(0, 0.5)).toBe(0);
    expect(movableOilSaturation(0.6, 0.4)).toBe(0);
    expect(movableHydrocarbonFraction(1, 1)).toBeNaN();
    expect(movableHydrocarbonFraction(1.2, 1)).toBeNaN();
    expect(movableHydrocarbonFraction(0, 0.5)).toBe(0.5);

    // Desborde de ratioSxoRaw a Infinity (con r subnormal positivo finito) recortado luego a 1
    const huge = ratioSxoRaw(1, 1e-160, 1e150, 10, 1);
    expect(huge).toBe(Infinity);
    const clippedInf = evaluateMovabilitySample(
      { sw: 0.25, phi: 0.2, rxo: 1e-160, rt: 1e150 },
      baseParams({ method: 'ratio', rmfOverRw: 10, n: 1 }),
    );
    expect(clippedInf.sxoRaw).toBe(Infinity);
    expect(clippedInf.sxo).toBe(1);
    expect(clippedInf.mos).toBeCloseTo(0.75, 12);
    expect(clippedInf.shr).toBe(0);
    expect(clippedInf.clippedHigh).toBe(true);

    // Sw = 0 en ratio da sxo = 0, mos = 0, shr = 1, mhi = NaN
    const swZero = evaluateMovabilitySample(
      { sw: 0, phi: 0.2, rxo: 40, rt: 20 },
      baseParams({ method: 'ratio', rmfOverRw: 10 }),
    );
    expect(swZero.sxo).toBe(0);
    expect(swZero.mos).toBe(0);
    expect(swZero.shr).toBe(1);
    expect(swZero.mhi).toBeNaN();

    // n != 2 en rtRxoLineRxo y ratioMhi
    expect(ratioMhi(80, 10, 10, 3)).toBeCloseTo(Math.cbrt(0.8), 12);
    expect(rtRxoLineRxo(10, 10, 0.5, 3)).toBeCloseTo(12.5, 12);
  });

  it('movabilityInto respeta subtramos [start, end), tramos vacíos, conteos e inmutabilidad', () => {
    const sw = new Float64Array([0.2, 0.6, 0.3, 0.25, NaN, 0.2]);
    const phi = new Float64Array([0.25, 0.25, 0.25, 0.25, 0.25, 0.25]);
    const rxo = new Float64Array([40, 40, 200, NaN, 40, 40]);
    const rt = new Float64Array([20, 20, 10, 20, 20, 20]);
    const swCopy = sw.slice();
    const phiCopy = phi.slice();
    const rxoCopy = rxo.slice();
    const rtCopy = rt.slice();

    const out = {
      sxo: new Float64Array(6).fill(-99),
      mos: new Float64Array(6).fill(-99),
      shr: new Float64Array(6).fill(-99),
      mhi: new Float64Array(6).fill(-99),
    };

    // Procesa [1, 5):
    // i=1: sxoRaw > 1 (clippedHigh)
    // i=2: sxoRaw < sw (belowSw)
    // i=3: rxo = NaN (missingRxo)
    // i=4: sw = NaN con rxo válida (missingInputs)
    const counts = movabilityInto(
      { sw, phi, rxo, rt },
      out,
      baseParams({ method: 'ratio', rmfOverRw: 10 }),
      1,
      5,
    );

    expect(counts).toEqual({
      total: 4,
      resolved: 2,
      belowSw: 1,
      clippedHigh: 1,
      missingRxo: 1,
      missingInputs: 1,
    });
    // Fuera del subtramo [1, 5) no modifica las salidas
    expect(out.sxo[0]).toBe(-99);
    expect(out.sxo[5]).toBe(-99);
    expect(out.sxo[1]).toBe(1);
    expect(out.sxo[2]).toBeCloseTo(0.3, 12);
    expect(out.sxo[3]).toBeNaN();
    expect(out.sxo[4]).toBeNaN();

    // No muta ningún array de entrada
    expect(Array.from(sw)).toEqual(Array.from(swCopy));
    expect(Array.from(phi)).toEqual(Array.from(phiCopy));
    expect(Array.from(rxo)).toEqual(Array.from(rxoCopy));
    expect(Array.from(rt)).toEqual(Array.from(rtCopy));

    // Tramo vacío (start >= end)
    expect(movabilityInto({ sw, phi, rxo, rt }, out, baseParams(), 4, 4)).toEqual(
      emptyMovabilityCounts(),
    );
    expect(movabilityInto({ sw, phi, rxo, rt }, out, baseParams(), 5, 2)).toEqual(
      emptyMovabilityCounts(),
    );
  });

  it('summarizeMovability pondera por volumen poral (h·φ) y verifica identidad de fracción móvil', () => {
    // 4 muestras:
    // 0: válida, h=1, phi=0.2 => w=0.2, sw=0.2, sxo=0.5, mos=0.3, shr=0.5, mhi=0.4 (< 0.7 móvil)
    // 1: válida, h=2, phi=0.3 => w=0.6, sw=0.4, sxo=0.5, mos=0.1, shr=0.5, mhi=0.8 (>= 0.7 no móvil)
    // 2: rxo válida pero sxo=NaN (no resuelta)
    // 3: rxo=NaN, sxo=NaN (sin dato)
    const rxo = [40, 60, 50, NaN];
    const sw = [0.2, 0.4, 0.3, 0.2];
    const sxo = [0.5, 0.5, NaN, NaN];
    const mos = [0.3, 0.1, NaN, NaN];
    const shr = [0.5, 0.5, NaN, NaN];
    const mhi = [0.4, 0.8, NaN, NaN];
    const phi = [0.2, 0.3, 0.25, 0.2];
    const thickness = [1, 2, 1, 1];

    const s = summarizeMovability({ rxo, sw, sxo, mos, shr, mhi, phi, thickness });

    const w0 = 0.2;
    const w1 = 0.6;
    const wSum = w0 + w1; // 0.8
    const expectedSw = (w0 * 0.2 + w1 * 0.4) / wSum; // 0.35
    const expectedSxo = (w0 * 0.5 + w1 * 0.5) / wSum; // 0.50
    const expectedMos = (w0 * 0.3 + w1 * 0.1) / wSum; // 0.15
    const expectedShr = (w0 * 0.5 + w1 * 0.5) / wSum; // 0.50
    const expectedMhi = (w0 * 0.4 + w1 * 0.8) / wSum; // 0.70
    const expectedFrac = (w0 * 0.3 + w1 * 0.1) / (w0 * 0.8 + w1 * 0.6); // 0.12 / 0.52

    expect(s.totalSamples).toBe(4);
    expect(s.rxoSamples).toBe(3);
    expect(s.resolvedSamples).toBe(2);
    expect(s.resolvedPct).toBeCloseTo(50, 12);
    expect(s.swMean).toBeCloseTo(expectedSw, 12);
    expect(s.sxoMean).toBeCloseTo(expectedSxo, 12);
    expect(s.mosMean).toBeCloseTo(expectedMos, 12);
    expect(s.shrMean).toBeCloseTo(expectedShr, 12);
    expect(s.mhiMean).toBeCloseTo(expectedMhi, 12);
    expect(s.movableHcFraction).toBeCloseTo(expectedFrac, 12);
    expect(s.movableHcFraction).toBeCloseTo(s.mosMean / (1 - s.swMean), 12);
    expect(s.swMean + s.mosMean + s.shrMean).toBeCloseTo(1, 12);
    expect(s.movableSamplesPct).toBeCloseTo(50, 12);
  });

  it('summarizeMovability hace respaldo a pesos por espesor h si falta phi o no hay volumen poral positivo', () => {
    const base = {
      rxo: [40, 60],
      sw: [0.2, 0.4],
      sxo: [0.6, 0.5],
      mos: [0.4, 0.1],
      shr: [0.4, 0.5],
      mhi: [1 / 3, 0.8],
      thickness: [1, 3],
    };

    // Sin curva phi
    const noPhi = summarizeMovability(base);
    expect(noPhi.swMean).toBeCloseTo((1 * 0.2 + 3 * 0.4) / 4, 12);
    expect(noPhi.sxoMean).toBeCloseTo((1 * 0.6 + 3 * 0.5) / 4, 12);
    expect(noPhi.mosMean).toBeCloseTo((1 * 0.4 + 3 * 0.1) / 4, 12);
    expect(noPhi.shrMean).toBeCloseTo((1 * 0.4 + 3 * 0.5) / 4, 12);
    expect(noPhi.mhiMean).toBeCloseTo((1 * (1 / 3) + 3 * 0.8) / 4, 12);

    // Con phi degenerada (0 y NaN) => mismo respaldo por espesor
    const zeroPhi = summarizeMovability({ ...base, phi: [0, NaN] });
    expect(zeroPhi.swMean).toBeCloseTo(noPhi.swMean, 12);
    expect(zeroPhi.mosMean).toBeCloseTo(noPhi.mosMean, 12);

    // Sin phi ni thickness => h = 1 uniforme
    const uniform = summarizeMovability({
      rxo: base.rxo,
      sw: base.sw,
      sxo: base.sxo,
      mos: base.mos,
      shr: base.shr,
      mhi: base.mhi,
    });
    expect(uniform.swMean).toBeCloseTo(0.3, 12);
    expect(uniform.sxoMean).toBeCloseTo(0.55, 12);
  });

  it('summarizeMovability maneja tramos vacíos, thickness <= 0, NaN/±Infinity, mhi NaN y zona 100 % agua', () => {
    const empty = summarizeMovability(
      { rxo: [40], sw: [0.2], sxo: [0.5], mos: [0.3], shr: [0.5], mhi: [0.4] },
      1,
      1,
    );
    expect(empty.totalSamples).toBe(0);
    expect(empty.rxoSamples).toBe(0);
    expect(empty.resolvedSamples).toBe(0);
    expect(empty.resolvedPct).toBeNaN();
    expect(empty.swMean).toBeNaN();
    expect(empty.sxoMean).toBeNaN();
    expect(empty.mosMean).toBeNaN();
    expect(empty.shrMean).toBeNaN();
    expect(empty.mhiMean).toBeNaN();
    expect(empty.movableHcFraction).toBeNaN();
    expect(empty.movableSamplesPct).toBeNaN();

    // thickness <= 0 y ±Infinity quedan descartados de los promedios sin corromperlos
    const badH = summarizeMovability({
      rxo: [40, 40, 40, 40],
      sw: [0.2, 0.5, 0.5, 0.5],
      sxo: [0.6, 0.8, 0.8, 0.8],
      mos: [0.4, 0.3, 0.3, 0.3],
      shr: [0.4, 0.2, 0.2, 0.2],
      mhi: [1 / 3, 0.625, 0.625, 0.625],
      thickness: [2, 0, -1, Infinity],
    });
    expect(badH.swMean).toBeCloseTo(0.2, 12);
    expect(badH.sxoMean).toBeCloseTo(0.6, 12);

    // Zona 100 % agua => movableHcFraction = NaN
    const water = summarizeMovability({
      rxo: [10, 10],
      sw: [1, 1],
      sxo: [1, 1],
      mos: [0, 0],
      shr: [0, 0],
      mhi: [1, 1],
      phi: [0.2, 0.2],
    });
    expect(water.swMean).toBe(1);
    expect(water.movableHcFraction).toBeNaN();
    expect(water.movableSamplesPct).toBe(0);

    // MHI NaN en una muestra (Sw = 0, Sxo = 0) no envenena mhiMean
    const withNanMhi = summarizeMovability({
      rxo: [40, 40],
      sw: [0, 0.2],
      sxo: [0, 0.5],
      mos: [0, 0.3],
      shr: [1, 0.5],
      mhi: [NaN, 0.4],
      phi: [0.2, 0.2],
    });
    expect(withNanMhi.mhiMean).toBeCloseTo(0.4, 12);
    expect(withNanMhi.movableSamplesPct).toBeCloseTo(50, 12);
  });
});
