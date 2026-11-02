/**
 * Integración con el pozo de la app y con los exportadores LAS/CSV: la curva digitalizada se remuestrea al índice del
 * pozo (sin extrapolar) o crea un pozo nuevo uniforme; y un LAS escrito desde la serie se relee con el lector real.
 */
import { describe, expect, it } from 'vitest';
import { readWellFile } from '../../src/io';
import { writeCsv } from '../../src/io/export/csv';
import { writeLas } from '../../src/io/export/las';
import { createWell, type Well } from '../../src/core/well';
import { DigitizerError } from '../../src/digitizer/errors';
import { addDigitizedCurveToWell, createWellFromDigitized, digitizedExportInput, DIGITIZER_SOURCE, uniqueCurveId } from '../../src/digitizer/integration';
import { buildSeries, resampleToUniform, uniformDepthGrid } from '../../src/digitizer/sampling';
import type { DigitizedSeries } from '../../src/digitizer/types';

const LIN = { kind: 'linear', min: 0, max: 150, reversed: false } as const;
const LOG = { kind: 'log', min: 0.2, max: 2000, reversed: false } as const;

/** Pozo de 500 muestras cada 0,1524 m desde 7700 m con una curva GR existente. */
function baseWell(): Well {
  const n = 500;
  const depth = Float64Array.from({ length: n }, (_, i) => 7700 + i * 0.1524);
  return createWell({
    id: 'w1',
    name: 'POZO-1',
    depth,
    curves: [{ id: 'GR', mnemonic: 'GR', role: 'GR', unit: 'gAPI', data: Float64Array.from({ length: n }, () => 60), origin: { kind: 'measured' } }],
  });
}

/** Serie digitalizada: GR = 50 + 10·(z − 7720) entre 7720 y 7740 m, cada 0,05 m. */
function digitizedGR(): DigitizedSeries {
  const d: number[] = [];
  const v: number[] = [];
  for (let z = 7720; z <= 7740 + 1e-9; z += 0.05) {
    d.push(z);
    v.push(50 + 0.5 * (z - 7720));
  }
  return buildSeries(d, v, null, LIN);
}

describe('agregar la curva al índice de un pozo existente', () => {
  it('remuestrea al índice del pozo, deja NaN fuera del tramo digitalizado y no extrapola', () => {
    const well = baseWell();
    const before = well.curves.length;
    const { well: w2, curve, coverage, topM, baseM } = addDigitizedCurveToWell(well, digitizedGR(), { id: 'GR', mnemonic: 'GR_DIG', unit: 'gAPI', role: 'GR' });
    // inmutabilidad: el pozo original no cambia
    expect(well.curves.length).toBe(before);
    expect(w2.curves.length).toBe(before + 1);
    expect(w2.depth).toBe(well.depth);
    // id único (GR ya existía)
    expect(curve.id).toBe('GR_2');
    expect(curve.origin).toEqual({ kind: 'measured', source: DIGITIZER_SOURCE });
    expect(curve.unit).toBe('gAPI');
    expect(curve.data.length).toBe(well.depth.values.length);
    expect(curve.data).toBeInstanceOf(Float64Array);
    // fuera de [7720, 7740] → NaN; dentro, la recta 50 + 0,5(z−7720)
    let inside = 0;
    for (let i = 0; i < curve.data.length; i++) {
      const z = well.depth.values[i]!;
      if (z < 7720 - 1e-9 || z > 7740 + 1e-9) expect(curve.data[i]).toBeNaN();
      else {
        inside++;
        expect(curve.data[i]).toBeCloseTo(50 + 0.5 * (z - 7720), 9);
      }
    }
    expect(inside).toBeGreaterThan(120);
    expect(coverage).toBeCloseTo(inside / 500, 12);
    expect(topM).toBeGreaterThanOrEqual(7720);
    expect(baseM).toBeLessThanOrEqual(7740);
  });

  it('huecos de la serie mayores que maxGapM quedan NaN en el pozo', () => {
    const s = buildSeries([7720, 7721, 7730, 7731], [10, 20, 30, 40], null, LIN);
    const { curve } = addDigitizedCurveToWell(baseWell(), s, { id: 'X', mnemonic: 'X', unit: 'gAPI' }, { maxGapM: 2 });
    const well = baseWell();
    const iHole = well.depth.values.findIndex((z) => z > 7725);
    expect(curve.data[iHole]).toBeNaN();
    const iIn = well.depth.values.findIndex((z) => z > 7720.5);
    expect(curve.data[iIn]).not.toBeNaN();
  });

  it('sin superposición con el pozo: error claro; metadatos inválidos: error', () => {
    const s = buildSeries([100, 101], [1, 2], null, LIN);
    let err: unknown;
    try {
      addDigitizedCurveToWell(baseWell(), s, { id: 'X', mnemonic: 'X', unit: 'gAPI' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(DigitizerError);
    expect((err as DigitizerError).code).toBe('no-overlap');
    expect((err as Error).message).toMatch(/no se superpone/);
    expect(() => addDigitizedCurveToWell(baseWell(), digitizedGR(), { id: ' ', mnemonic: 'X', unit: 'gAPI' })).toThrow(/nombre/);
    expect(() => addDigitizedCurveToWell(baseWell(), digitizedGR(), { id: 'X', mnemonic: 'X', unit: '' })).toThrow(/unidad/);
  });

  it('ids únicos', () => {
    expect(uniqueCurveId(['A', 'A_2'], 'A')).toBe('A_3');
    expect(uniqueCurveId([], 'A')).toBe('A');
  });
});

describe('pozo nuevo con índice uniforme', () => {
  it('crea un pozo con paso en pies (0,5 ft = 0,1524 m), una curva lineal y una log, y los tramos propios de cada una', () => {
    const gr = digitizedGR();
    const rtD: number[] = [];
    const rtV: number[] = [];
    for (let z = 7725; z <= 7745 + 1e-9; z += 0.05) {
      rtD.push(z);
      rtV.push(10 ** (0 + 0.1 * (z - 7725))); // 1 → 100 ohm.m en 20 m
    }
    const rt = buildSeries(rtD, rtV, null, LOG);
    const w = createWellFromDigitized({
      id: 'dig', name: 'Digitalizado', step: 0.5, unit: 'ft',
      curves: [
        { series: gr, meta: { id: 'GR', mnemonic: 'GR', unit: 'gAPI', role: 'GR' } },
        { series: rt, meta: { id: 'RT', mnemonic: 'AT90', unit: 'ohm.m', role: 'RT' } },
      ],
    });
    expect(w.depth.step).toBeCloseTo(0.1524, 6);
    expect(w.depth.sourceUnit).toBe('ft');
    expect(w.header['SRC']!.value).toBe(DIGITIZER_SOURCE);
    expect(w.curves.map((c) => c.id)).toEqual(['GR', 'RT']);
    for (const c of w.curves) expect(c.origin).toEqual({ kind: 'measured', source: DIGITIZER_SOURCE });
    // el índice abarca la unión [7720, 7745]; GR es NaN después de 7740 y RT antes de 7725
    const d = w.depth.values;
    expect(d[0]!).toBeGreaterThanOrEqual(7720);
    expect(d[d.length - 1]!).toBeLessThanOrEqual(7745);
    const iAfter = d.findIndex((z) => z > 7742);
    expect(w.curves[0]!.data[iAfter]).toBeNaN();
    expect(w.curves[1]!.data[iAfter]).not.toBeNaN();
    const iBefore = d.findIndex((z) => z > 7722);
    expect(w.curves[1]!.data[iBefore]).toBeNaN();
    // RT en log: a 7735 m → 10^(1,0) = 10 ohm.m (interpolación geométrica entre nodos)
    const i35 = d.findIndex((z) => z > 7735);
    const expected = 10 ** (0.1 * (d[i35]! - 7725));
    expect(w.curves[1]!.data[i35]).toBeCloseTo(expected, 6);
  });

  it('sin curvas o sin puntos: error', () => {
    expect(() => createWellFromDigitized({ id: 'a', name: 'a', step: 1, curves: [] })).toThrow(/al menos una curva/);
    const empty = buildSeries([], [], null, LIN);
    expect(() => createWellFromDigitized({ id: 'a', name: 'a', step: 1, curves: [{ series: empty, meta: { id: 'A', mnemonic: 'A', unit: 'gAPI' } }] })).toThrow(/no tienen puntos/);
    expect(() => createWellFromDigitized({ id: 'a', name: 'a', step: 1000, curves: [{ series: digitizedGR(), meta: { id: 'A', mnemonic: 'A', unit: 'gAPI' } }] })).toThrow(/más corto que el paso/);
  });
});

describe('exportación: serie digitalizada → LAS / CSV → relectura con el lector de la app', () => {
  const series = digitizedGR();
  const grid = uniformDepthGrid({ step: 0.1524, topM: 7719, baseM: 7745 });
  const values = resampleToUniform(series, { step: 0.1524, topM: 7719, baseM: 7745, align: true }).values;
  const input = digitizedExportInput({
    wellName: 'DIGITALIZADO',
    depthM: grid,
    columns: [{ meta: { id: 'GR', mnemonic: 'GR', unit: 'gAPI', description: 'Rayos gamma digitalizados' }, values }],
  });

  it('LAS en metros: se relee con parseLas/buildWell con los mismos valores, NaN preservados y rol GR', () => {
    const las = writeLas(input);
    const { well } = readWellFile(las, 'digitalizado.las');
    expect(well.depth.values.length).toBe(grid.length);
    for (let i = 0; i < grid.length; i += 7) expect(well.depth.values[i]).toBeCloseTo(grid[i]!, 9);
    const c = well.curves.find((k) => k.mnemonic === 'GR')!;
    expect(c).toBeDefined();
    expect(c.role).toBe('GR');
    let nan = 0;
    for (let i = 0; i < values.length; i++) {
      if (Number.isNaN(values[i]!)) {
        nan++;
        expect(Number.isNaN(c.data[i]!)).toBe(true);
      } else expect(c.data[i]).toBeCloseTo(values[i]!, 9);
    }
    expect(nan).toBeGreaterThan(5); // los extremos del tramo pedido quedan sin dato
    expect(nan).toBeLessThan(values.length / 2);
  });

  it('LAS en pies: la profundidad vuelve a metros', () => {
    const las = writeLas({ ...input, depthUnit: 'ft' });
    expect(las).toMatch(/STRT\.ft/);
    const { well } = readWellFile(las, 'digitalizado_ft.las');
    for (let i = 0; i < grid.length; i += 11) expect(well.depth.values[i]).toBeCloseTo(grid[i]!, 5);
  });

  it('CSV: se relee y conserva los valores', () => {
    const csv = writeCsv(input);
    const { well } = readWellFile(csv, 'digitalizado.csv');
    const c = well.curves.find((k) => k.mnemonic === 'GR')!;
    for (let i = 0; i < values.length; i += 5) {
      if (Number.isNaN(values[i]!)) expect(Number.isNaN(c.data[i]!)).toBe(true);
      else expect(c.data[i]).toBeCloseTo(values[i]!, 9);
    }
  });

  it('largos distintos: error', () => {
    expect(() => digitizedExportInput({ wellName: 'x', depthM: grid, columns: [{ meta: { id: 'GR', mnemonic: 'GR', unit: 'gAPI' }, values: new Float64Array(3) }] })).toThrow(/muestras/);
  });
});
