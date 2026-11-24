/**
 * Curvas MICP del TP en el panel «Tipos de roca» (docs/decisiones de MICP del TP): carga con una receta (sin
 * duplicar, un Ctrl+Z), curvas medidas en vez del ejemplo de libro y tabla R35 medido contra Winland.
 * Valores de referencia: tests/petro-micp.test.ts (numpy).
 */
import { describe, expect, it } from 'vitest';
import { emptyHistory, recordChange, undo } from '../src/core/state/history';
import { addWell, createProject, getWellEntry } from '../src/core/state/project';
import { createWell } from '../src/core/well';
import { capillaryCurves, examplePcCurves, labThroatGroups, labThroatSeries, measuredR35Rows, pcInUnit, TP_LAB_DIAMETER_PC_UM_KGCM2 } from '../src/modules/rock-typing/model';
import { addTpMicp, hasTpMicp, isTpMicpSet, TP_MICP_SAMPLES_COUNT, tpMicpSet } from '../src/modules/rock-typing/tp';
import { parseMicpCsv } from '../src/modules/rock-typing/micpCsv';
import { PORT_CLASSES, washburnRadius } from '../src/petro/rockTyping';

const W = 'w';
const project = () => addWell(createProject(), createWell({ id: W, name: 'Pozo TP', depth: Float64Array.from({ length: 10 }, (_, i) => 7800 + i), curves: [], pointSets: [] }), []);

describe('cargar las curvas MICP del TP', () => {
  it('una receta agrega el conjunto; repetirla no lo duplica; Ctrl+Z vuelve al pozo sin curvas', () => {
    const p0 = project();
    expect(hasTpMicp(p0, W)).toBe(false);
    const p1 = addTpMicp(p0, W, tpMicpSet('micp-1'));
    expect(getWellEntry(p1, W).well.pointSets.filter(isTpMicpSet)).toHaveLength(1);
    expect(addTpMicp(p1, W, tpMicpSet('micp-2'))).toBe(p1);
    const back = undo(recordChange(emptyHistory(), p0, 'Cargar curvas MICP del TP', 0), p1)!;
    expect(hasTpMicp(back.project, W)).toBe(false);
  });

  it('con el conjunto del TP las curvas son medidas (8, no el ejemplo de libro)', () => {
    const { curves, book } = capillaryCurves([tpMicpSet('m')]);
    expect(book).toBe(false);
    expect(curves).toHaveLength(TP_MICP_SAMPLES_COUNT);
    expect(TP_MICP_SAMPLES_COUNT).toBe(8);
    expect(curves.every((c) => c.source === 'measured')).toBe(true);
  });
});

describe('R35 medido contra Winland por muestra', () => {
  const rows = measuredR35Rows(capillaryCurves([tpMicpSet('m')]).curves);
  const by = Object.fromEntries(rows.map((r) => [r.label, r]));

  it('una fila por curva medida, con k (mD) y φ (v/v) de la muestra; las de libro no entran', () => {
    expect(rows.map((r) => r.label).sort()).toEqual(['1-2', '1-2L', '1-32', '1-33', '1-33CK', '2-15', '2-17', '2-6L']);
    expect(by['1-32']).toMatchObject({ k: 92.4 });
    expect(by['1-32']!.phi).toBeCloseTo(0.232053, 6);
    expect(measuredR35Rows(examplePcCurves())).toEqual([]);
  });

  it('R35 medido (numpy) y diferencia: 1-32 con Winland +35 %, el resto dentro del 10 %', () => {
    expect(by['1-32']!.measured).toBeCloseTo(3.7917, 3);
    expect(by['1-32']!.winland).toBeCloseTo(5.1044, 3);
    expect(by['1-32']!.diffPct).toBeCloseTo(100 * (5.1044 / 3.7917 - 1), 1);
    expect(by['2-6L']!.measured).toBeCloseTo(0.8248, 3);
    for (const r of rows) if (r.label !== '1-32') expect(Math.abs(r.diffPct)).toBeLessThan(10);
  });

  it('clases de garganta: medida y estimada; 1-32 es macro con las dos, 2-6L meso', () => {
    const name = (i: number) => PORT_CLASSES[i]!.id;
    expect(name(by['1-32']!.classMeasured)).toBe('macro');
    expect(name(by['1-32']!.classWinland)).toBe('macro');
    expect(name(by['2-6L']!.classMeasured)).toBe('meso');
    for (const r of rows) expect(r.classMeasured).toBeGreaterThanOrEqual(0);
  });
});

describe('unidad de presión del gráfico Pc–Sw', () => {
  it('kg/cm² = psi / 14,2233; psi sin cambios', () => {
    const pc = Float64Array.of(14.22334330746688, 142.2334330746688);
    expect([...pcInUnit(pc, 'kgcm2')].map((v) => +v.toFixed(9))).toEqual([1, 10]);
    expect([...pcInUnit(pc, 'psi')]).toEqual([...pc]);
  });
});

describe('vista del laboratorio de la distribución de gargantas (caché de los gráficos del Excel)', () => {
  const curves = capillaryCurves([tpMicpSet('m')]).curves;
  const lab = (name: string) => labThroatSeries(curves.find((c) => c.label === name)!, TP_LAB_DIAMETER_PC_UM_KGCM2);
  const s132 = lab('1-32');

  it('diámetro del laboratorio = 15,507 / Pc (kg/cm²): 0,0436 → 355,74 µm y 3,889 → 3,99 µm; acumulada = Sw en %', () => {
    expect(s132.diameter.length).toBe(37);
    expect(s132.diameter[0]).toBeCloseTo(355.74, 1);
    expect(s132.diameter[16]).toBeCloseTo(3.99, 2);
    expect(s132.cumulative[0]).toBe(100);
    expect(s132.cumulative[36]).toBeCloseTo(1.78, 9);
    for (let i = 1; i < s132.diameter.length; i++) expect(s132.diameter[i]!).toBeLessThan(s132.diameter[i - 1]!);
  });

  it('incremental = promedio centrado de las caídas de Sw (valores del laboratorio, ±0,01 %)', () => {
    const want: Record<string, [number, number[]]> = {
      '1-2': [15, [10.0, 21.35, 15.38, 7.05, 4.32, 2.98, 2.82]],
      '1-32': [12, [3.96, 25.0, 25.94, 7.69]],
      '2-6L': [17, [10.46, 21.47, 14.49]],
    };
    for (const [name, [from, k]] of Object.entries(want)) {
      const s = lab(name);
      k.forEach((v, j) => expect(s.incremental[from + j]!).toBeCloseTo(v, 2));
    }
    // suma = la caída total (cada caída se reparte entre dos escalones)
    expect(s132.incremental.reduce((a, b) => a + b, 0)).toBeCloseTo(100 - 1.78, 9);
    expect(s132.incremental[0]).toBe(0);
  });

  it('picos de las incrementales en el diámetro del laboratorio', () => {
    const peak: Record<string, number> = { '1-2': 3.99, '1-2L': 3.99, '1-32': 7.35, '1-33CK': 5.41, '1-33': 8.81, '2-15': 5.41, '2-17': 3.99, '2-6L': 2.21 };
    for (const c of curves) {
      const s = lab(c.label);
      const k = s.incremental.indexOf(Math.max(...s.incremental));
      expect(s.diameter[k]!).toBeCloseTo(peak[c.label]!, 2);
    }
  });

  it('sin constante del laboratorio: diámetro = 2 × radio de Washburn de la app', () => {
    const c = curves.find((x) => x.label === '1-32')!;
    expect(labThroatSeries(c).diameter[0]).toBeCloseTo(2 * washburnRadius(c.pc[0]!), 9);
  });

  it('curvas del TP: un gráfico por reservorio (prefijo 1- y 2-) con la constante del laboratorio; otro conjunto: un único grupo con Washburn', () => {
    const g = labThroatGroups(curves, true);
    expect(g.map((x) => x.title)).toEqual(['Reservorio 1', 'Reservorio 2']);
    expect(g[0]!.series.map((x) => x.label)).toEqual(['1-2', '1-2L', '1-32', '1-33', '1-33CK']);
    expect(g[1]!.series.map((x) => x.label)).toEqual(['2-6L', '2-15', '2-17']);
    expect(g[0]!.series[2]!.diameter[0]).toBeCloseTo(355.74, 1);
    const one = labThroatGroups(curves, false);
    expect(one).toHaveLength(1);
    expect(one[0]!.series).toHaveLength(8);
    expect(one[0]!.series.find((x) => x.label === '1-32')!.diameter[0]).toBeCloseTo(2 * washburnRadius(curves.find((x) => x.label === '1-32')!.pc[0]!), 9);
    expect(labThroatGroups([], false)).toEqual([]);
    expect(labThroatGroups(examplePcCurves(), false)[0]!.series).toHaveLength(5);
  });
});

describe('importador genérico CSV/TSV de MICP (parseMicpCsv)', () => {
  it('lee CSV con Pc en kg/cm², SHg en %, coma decimal y punto y coma; convierte a psi y Sw en v/v', () => {
    const csv = [
      'muestra;pc (kg/cm2);shg%;k_md;phi%;depth',
      'M1;1,0;0;45,2;20,5;2100,5',
      'M1;10,0;50;45,2;20,5;2100,5',
      'M1;100,0;92;45,2;20,5;2100,5',
      'M2;2,0;0;5,0;14,0;2110,0',
      'M2;20,0;40;5,0;14,0;2110,0',
    ].join('\n');
    const res = parseMicpCsv(csv, 'ensayo.csv', 'micp-csv-1');
    expect(res.sampleCount).toBe(2);
    expect(res.rowCount).toBe(5);
    expect(res.pressureUnit).toBe('kg/cm²');
    const { curves, book } = capillaryCurves([res.set]);
    expect(book).toBe(false);
    expect(curves).toHaveLength(2);
    expect(curves[0]!.label).toBe('M1');
    expect(curves[0]!.pc[0]).toBeCloseTo(14.22334, 4);
    expect(curves[0]!.sw[1]).toBeCloseTo(0.5, 9);
    expect(curves[0]!.sw[2]).toBeCloseTo(0.08, 9);
    expect(curves[0]!.k).toBeCloseTo(45.2, 6);
    expect(curves[0]!.phi).toBeCloseTo(0.205, 6);
  });

  it('acepta CSV mínimo con solo pc (psi) y sw (v/v) sin columna de muestra', () => {
    const csv = 'pc,sw\n10,1\n50,0.65\n200,0.2\n';
    const res = parseMicpCsv(csv, 'plug_A.csv', 'micp-csv-2');
    expect(res.sampleCount).toBe(1);
    expect(res.pressureUnit).toBe('psi');
    const { curves } = capillaryCurves([res.set]);
    expect(curves[0]!.label).toBe('plug_A');
    expect(curves[0]!.sw[1]).toBeCloseTo(0.65, 9);
  });

  it('rechaza archivos sin columna de presión o de saturación', () => {
    expect(() => parseMicpCsv('a,b\n1,2\n3,4', 'mal.csv', 'x')).toThrow(/presión capilar/i);
    expect(() => parseMicpCsv('pc,otro\n10,2\n20,4', 'mal.csv', 'x')).toThrow(/saturación/i);
  });
});
