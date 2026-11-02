/**
 * Calibración del Log Digitizer: valores calculados a mano (cada caso indica la cuenta).
 */
import { describe, expect, it } from 'vitest';
import {
  assertValueFrame,
  axisFromEdgeValues,
  buildDepthCalibration,
  checkDepthSpec,
  checkValueFrame,
  depthAtRow,
  depthsOfRows,
  rowAtDepth,
  valueAtX,
  xAtValue,
} from '../../src/digitizer/calibration';
import { DigitizerError } from '../../src/digitizer/errors';
import type { DepthCalibrationSpec, ValueFrame } from '../../src/digitizer/types';

describe('calibración de profundidad', () => {
  it('dos amarres en pies: 5000 ft en y=0 y 5100 ft en y=1000 → 0,1 ft/px = 0,03048 m/px', () => {
    // a mano: 5050 ft en y=500 → 5050 × 0,3048 = 1539,24 m
    const cal = buildDepthCalibration({ unit: 'ft', method: 'linear', ties: [{ y: 0, depth: 5000 }, { y: 1000, depth: 5100 }] });
    expect(cal.slopeMPerPx).toBeCloseTo(0.03048, 12);
    expect(depthAtRow(cal, 500)).toBeCloseTo(1539.24, 9);
    expect(depthAtRow(cal, 0)).toBeCloseTo(1524, 9);
    expect(cal.rmsResidualPx).toBeCloseTo(0, 9);
    // prolonga fuera de los amarres
    expect(depthAtRow(cal, 2000)).toBeCloseTo(5200 * 0.3048, 9);
  });

  it('por tramos pasa exactamente por los amarres y usa la pendiente de cada tramo', () => {
    const spec: DepthCalibrationSpec = {
      unit: 'm',
      method: 'piecewise',
      // tramo 1: 0,1 m/px; tramo 2: 0,2 m/px
      ties: [{ y: 0, depth: 100 }, { y: 100, depth: 110 }, { y: 200, depth: 130 }],
    };
    const cal = buildDepthCalibration(spec);
    expect(depthAtRow(cal, 50)).toBeCloseTo(105, 12);
    expect(depthAtRow(cal, 150)).toBeCloseTo(120, 12);
    expect(depthAtRow(cal, 100)).toBeCloseTo(110, 12);
    // prolongación con la pendiente del tramo extremo: y=300 → 130 + 100×0,2 = 150; y=-50 → 100 − 5 = 95
    expect(depthAtRow(cal, 300)).toBeCloseTo(150, 12);
    expect(depthAtRow(cal, -50)).toBeCloseTo(95, 12);
    expect(rowAtDepth(cal, 120)).toBeCloseTo(150, 12);
    expect(rowAtDepth(cal, 95)).toBeCloseTo(-50, 12);
    // el ajuste lineal global se reporta igual: hay residuo porque las pendientes difieren
    expect(cal.rmsResidualPx).toBeGreaterThan(1);
  });

  it('lineal con 3 amarres con error de pick: pendiente, ordenada y residuo RMS calculados a mano', () => {
    // y = [0,100,200], z = [0,10,20,2]: media y=100, media z=10,0667; Sxy=2020; Sxx=20000 → b=0,101; a=-0,03333
    // residuos: +0,03333, -0,06667, +0,03333 → rms = sqrt(0,0022222) = 0,047140 m → 0,46669 px
    const cal = buildDepthCalibration({ unit: 'm', method: 'linear', ties: [{ y: 0, depth: 0 }, { y: 100, depth: 10 }, { y: 200, depth: 20.2 }] });
    expect(cal.slopeMPerPx).toBeCloseTo(0.101, 12);
    expect(cal.interceptM).toBeCloseTo(-0.1 / 3, 12);
    expect(cal.rmsResidualM).toBeCloseTo(0.04714045, 7);
    expect(cal.rmsResidualPx).toBeCloseTo(0.04714045 / 0.101, 6); // = 0,46674
    expect(cal.maxResidualPx).toBeCloseTo(0.0666667 / 0.101, 5);
    expect(cal.warnings).toEqual([]);
  });

  it('avisa de un escaneo estirado (residuo > 2 px) y de amarres muy juntos', () => {
    const stretched = buildDepthCalibration({
      unit: 'm',
      method: 'piecewise',
      ties: [{ y: 0, depth: 0 }, { y: 500, depth: 40 }, { y: 1000, depth: 100 }],
    });
    expect(stretched.warnings.some((w) => /estirado/.test(w))).toBe(true);
    const close = buildDepthCalibration({ unit: 'm', method: 'linear', ties: [{ y: 0, depth: 0 }, { y: 20, depth: 2 }] });
    expect(close.warnings.some((w) => /poco precisa/.test(w))).toBe(true);
  });

  it('ida y vuelta fila → profundidad → fila (lineal y por tramos, también en pies)', () => {
    for (const method of ['linear', 'piecewise'] as const) {
      const cal = buildDepthCalibration({ unit: 'ft', method, ties: [{ y: 30, depth: 7600 }, { y: 4000, depth: 7900 }, { y: 9000, depth: 8100 }] });
      for (const y of [-10, 30, 123.4, 4000, 6500.25, 9100]) expect(rowAtDepth(cal, depthAtRow(cal, y))).toBeCloseTo(y, 8);
    }
    const cal = buildDepthCalibration({ unit: 'm', method: 'linear', ties: [{ y: 0, depth: 10 }, { y: 100, depth: 20 }] });
    expect(Array.from(depthsOfRows(cal, 10, 3))).toEqual([11, 11.1, 11.2].map((v) => expect.closeTo(v, 12)));
  });

  it('ordena los amarres por fila', () => {
    const cal = buildDepthCalibration({ unit: 'm', method: 'piecewise', ties: [{ y: 200, depth: 30 }, { y: 0, depth: 10 }, { y: 100, depth: 20 }] });
    expect(cal.ties.map((t) => t.y)).toEqual([0, 100, 200]);
  });

  it('errores explícitos en español', () => {
    const msg = (spec: DepthCalibrationSpec) => {
      try {
        buildDepthCalibration(spec);
      } catch (e) {
        expect(e).toBeInstanceOf(DigitizerError);
        expect((e as DigitizerError).code).toBe('invalid-calibration');
        return (e as Error).message;
      }
      return null;
    };
    expect(msg({ unit: 'm', method: 'linear', ties: [{ y: 0, depth: 10 }] })).toMatch(/al menos 2 amarres/);
    expect(msg({ unit: 'm', method: 'linear', ties: [] })).toMatch(/al menos 2 amarres/);
    expect(msg({ unit: 'm', method: 'linear', ties: [{ y: 5, depth: 10 }, { y: 5, depth: 20 }] })).toMatch(/misma fila/);
    expect(msg({ unit: 'm', method: 'linear', ties: [{ y: 0, depth: 20 }, { y: 100, depth: 10 }] })).toMatch(/debe crecer hacia abajo/);
    expect(msg({ unit: 'm', method: 'linear', ties: [{ y: 0, depth: 10 }, { y: 100, depth: 10 }] })).toMatch(/debe crecer hacia abajo/);
    expect(msg({ unit: 'm', method: 'piecewise', ties: [{ y: 0, depth: 10 }, { y: 50, depth: 30 }, { y: 100, depth: 20 }] })).toMatch(/debe crecer hacia abajo/);
    expect(msg({ unit: 'm', method: 'linear', ties: [{ y: 0, depth: NaN }, { y: 100, depth: 20 }] })).toMatch(/no numérico/);
    expect(msg({ unit: 'yd' as 'm', method: 'linear', ties: [{ y: 0, depth: 1 }, { y: 100, depth: 2 }] })).toMatch(/unidad de profundidad/);
    expect(checkDepthSpec({ unit: 'm', method: 'linear', ties: [{ y: 0, depth: 1 }, { y: 10, depth: 2 }] })).toEqual([]);
  });

  it('NaN e infinitos en las consultas devuelven NaN, sin lanzar', () => {
    const cal = buildDepthCalibration({ unit: 'm', method: 'piecewise', ties: [{ y: 0, depth: 1 }, { y: 100, depth: 2 }] });
    expect(depthAtRow(cal, NaN)).toBeNaN();
    expect(rowAtDepth(cal, Infinity)).toBeNaN();
  });
});

describe('escala de valor', () => {
  const lin: ValueFrame = { leftPx: 100, rightPx: 700, scale: { kind: 'linear', min: 0, max: 150, reversed: false } };

  it('lineal normal: x=400 es el punto medio → 75; bordes → 0 y 150', () => {
    expect(valueAtX(lin, 400)).toBeCloseTo(75, 12);
    expect(valueAtX(lin, 100)).toBeCloseTo(0, 12);
    expect(valueAtX(lin, 700)).toBeCloseTo(150, 12);
    expect(valueAtX(lin, 800)).toBeCloseTo(175, 12); // extrapola
    expect(xAtValue(lin, 75)).toBeCloseTo(400, 12);
  });

  it('invertida (DT 140 → 40 de izquierda a derecha): borde izquierdo = 140', () => {
    const f: ValueFrame = { leftPx: 0, rightPx: 600, scale: axisFromEdgeValues(140, 40, 'linear') };
    expect(f.scale.reversed).toBe(true);
    expect(valueAtX(f, 0)).toBeCloseTo(140, 12);
    expect(valueAtX(f, 600)).toBeCloseTo(40, 12);
    expect(valueAtX(f, 300)).toBeCloseTo(90, 12);
  });

  it('logarítmica 0,2–2000 ohm.m: décadas equiespaciadas; el centro es la media geométrica sqrt(0,2·2000) = 20', () => {
    const f: ValueFrame = { leftPx: 50, rightPx: 650, scale: axisFromEdgeValues(0.2, 2000, 'log') };
    expect(valueAtX(f, 350)).toBeCloseTo(20, 9);
    // 4 décadas en 600 px → 150 px por década
    expect(valueAtX(f, 50 + 150)).toBeCloseTo(2, 9);
    expect(xAtValue(f, 200)).toBeCloseTo(50 + 450, 9);
    expect(xAtValue(f, 0)).toBeNaN();
    expect(xAtValue(f, -5)).toBeNaN();
  });

  it('errores: borde derecho a la izquierda, log con mínimo ≤ 0, escala degenerada', () => {
    expect(checkValueFrame({ ...lin, rightPx: 100 })[0]).toMatch(/debe estar a la derecha/);
    expect(checkValueFrame({ ...lin, rightPx: 50 })[0]).toMatch(/debe estar a la derecha/);
    expect(checkValueFrame({ ...lin, leftPx: NaN })[0]).toMatch(/deben ser números/);
    expect(checkValueFrame({ ...lin, scale: { kind: 'log', min: 0, max: 100, reversed: false } })[0]).toMatch(/logarítmica necesita valores positivos/);
    expect(checkValueFrame({ ...lin, scale: { kind: 'log', min: -1, max: 100, reversed: false } })[0]).toMatch(/positivos/);
    expect(checkValueFrame({ ...lin, scale: { kind: 'linear', min: 5, max: 5, reversed: false } })[0]).toMatch(/inválida/);
    expect(() => assertValueFrame({ ...lin, rightPx: 100 })).toThrow(DigitizerError);
    expect(() => axisFromEdgeValues(0, 100, 'log')).toThrow(/positivos/);
    expect(() => axisFromEdgeValues(5, 5, 'linear')).toThrow(/no pueden ser iguales/);
    expect(() => axisFromEdgeValues(NaN, 5, 'linear')).toThrow(/números/);
    expect(valueAtX(lin, NaN)).toBeNaN();
    expect(xAtValue(lin, NaN)).toBeNaN();
  });
});
