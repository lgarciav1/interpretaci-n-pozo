import { describe, expect, it } from 'vitest';
import mdtCsv from '../fixtures/mdt_es.csv?raw';
import { buildPressureSet, parseTable, pointNumbersOf, suggestPressureMapping, type PressureField } from './pressuresTestApi';
import { makeXlsx } from './xlsxFixture';

const fields = (m: { name: string; field: PressureField }[]) => Object.fromEntries(m.map((x) => [x.name, x.field]));

describe('io/pressures: tabla de presiones en CSV (español, punto y coma, coma decimal)', () => {
  const table = parseTable(mdtCsv, 'mdt_es.csv', { requireDepth: false });

  it('reconoce cada columna por su nombre', () => {
    const m = suggestPressureMapping(table);
    expect(fields(m)).toEqual({
      Prueba: 'test',
      'Profundidad MD': 'depth',
      TVD: 'tvd',
      'Presión de formación': 'pressure',
      Movilidad: 'mobility',
      'Presión hidrostática antes': 'mudBefore',
      'Presión hidrostática después': 'mudAfter',
      Calidad: 'quality',
      Comentario: 'comment',
    });
    const byName = Object.fromEntries(m.map((x) => [x.name, x]));
    expect(byName['Presión de formación']!.unit).toBe('psi'); // psia → psi
    expect(byName['Movilidad']!.unit).toBe('mD/cP');
    expect(byName['Profundidad MD']!.unit).toBe('m');
  });

  it('arma el conjunto: ordenado por profundidad, sin la fila sin profundidad, ids de la columna de prueba', () => {
    const r = buildPressureSet(table, suggestPressureMapping(table), { id: 'mdt1', name: 'MDT corrida 1' });
    const s = r.set;
    expect(s.kind).toBe('pressure');
    expect(s.name).toBe('MDT corrida 1');
    expect(s.source).toBe('mdt_es.csv');
    expect(r.dropped).toBe(1);
    expect(r.warnings.some((w) => w.includes('1 fila no tiene profundidad'))).toBe(true);
    expect(r.warnings.some((w) => w.includes('1 punto no tiene presión'))).toBe(true);
    expect(s.pointIds).toEqual(['MDT-01', 'MDT-02', 'MDT-03', 'MDT-04', 'MDT-06']);
    expect([...s.depth]).toEqual([2490.5, 2500, 2510, 2525, 2540]);
    const p = pointNumbersOf(s, 'pressure');
    expect(p[0]).toBeCloseTo(3567.4, 9);
    expect(p[1]).toBeNaN(); // prueba seca sin presión: se conserva
    expect(pointNumbersOf(s, 'mobility')[0]).toBeCloseTo(85.5, 9);
    expect(pointNumbersOf(s, 'mudAfter')[2]).toBeCloseTo(4120.1, 9);
    expect(s.columns['quality']!.values).toEqual(['Buena', 'Seca', 'Buena', 'Sobrecargada', 'Good']);
    expect(s.columns['comment']!.values[1]).toBe('sin flujo');
  });

  it('falla en español si falta la presión o la profundidad', () => {
    const m = suggestPressureMapping(table).map((x) => (x.field === 'pressure' ? { ...x, field: 'ignore' as const } : x));
    expect(() => buildPressureSet(table, m, { id: 'x' })).toThrow(/presión de formación/);
    const m2 = suggestPressureMapping(table).map((x) => (x.field === 'depth' ? { ...x, field: 'ignore' as const } : x));
    expect(() => buildPressureSet(table, m2, { id: 'x' })).toThrow(/profundidad/);
  });
});

describe('io/pressures: Excel en inglés, pies y bar', () => {
  const bytes = makeXlsx([
    { name: 'Notas', rows: [['Archivo de prueba'], ['sin datos']] },
    {
      name: 'MDT',
      rows: [
        ['Test #', 'Depth', 'Formation Pressure', 'Mobility', 'Hydrostatic Before', 'Hydrostatic After', 'Test Type', 'Status'],
        ['', 'ft', 'bar', 'md/cp', 'bar', 'bar', '', ''],
        [1, 8200, 250, 35, 290, 290.2, 'Pretest', 'Valid'],
        [2, 8300, 253.1, 12, 293.5, 293.4, 'Pretest', 'Tight'],
        [3, 8250, 251.5, 0.4, 291.7, 291.7, 'Pretest', 'Supercharged'],
      ],
    },
  ]);
  const table = parseTable(bytes, 'mdt.xlsx', { requireDepth: false, sheet: 'MDT' });

  it('reconoce columnas en inglés y unidades de campo', () => {
    const m = suggestPressureMapping(table);
    expect(fields(m)).toEqual({
      'Test #': 'test',
      Depth: 'depth',
      'Formation Pressure': 'pressure',
      Mobility: 'mobility',
      'Hydrostatic Before': 'mudBefore',
      'Hydrostatic After': 'mudAfter',
      'Test Type': 'testType',
      Status: 'quality',
    });
    const byName = Object.fromEntries(m.map((x) => [x.name, x.unit]));
    expect(byName).toMatchObject({ Depth: 'ft', 'Formation Pressure': 'bar', Mobility: 'mD/cP' });
  });

  it('convierte a m y psi, ordena e identifica con el número de prueba', () => {
    const { set } = buildPressureSet(table, suggestPressureMapping(table), { id: 'x' });
    expect(set.pointIds).toEqual(['1', '3', '2']);
    expect(set.depth[0]).toBeCloseTo(8200 * 0.3048, 9);
    expect(pointNumbersOf(set, 'pressure')[0]).toBeCloseTo(250 * 14.503773773, 5);
    expect(set.columns['pressure']!).toMatchObject({ unit: 'psi' });
    expect(set.columns['testType']!.values).toEqual(['Pretest', 'Pretest', 'Pretest']);
  });
});

describe('io/pressures: casos borde', () => {
  it('sin nombres reconocibles: profundidad = primera numérica, presión por unidad, ids P01…', () => {
    const t = parseTable('A,B (psi),C\n1000,1450,x\n1010,1465,y\n', 'raro.csv', { requireDepth: false });
    const m = suggestPressureMapping(t);
    expect(m.map((x) => x.field)).toEqual(['depth', 'pressure', 'ignore']);
    expect(m[0]!.confidence).toBe('low');
    const { set } = buildPressureSet(t, m, { id: 'r' });
    expect(set.pointIds).toEqual(['P01', 'P02']);
    expect(set.name).toBe('raro');
  });

  it('ids repetidos: se numeran', () => {
    const t = parseTable('Prueba,MD,Presion\nA,1000,1450\nA,1010,1465\n', 'rep.csv', { requireDepth: false });
    const r = buildPressureSet(t, suggestPressureMapping(t), { id: 'r' });
    expect(r.set.pointIds).toEqual(['A', 'A (2)']);
    expect(r.warnings.some((w) => w.includes('repite'))).toBe(true);
  });

  it('una columna de texto como primera no rompe la lectura (requireDepth: false)', () => {
    const t = parseTable('Prueba,Prof. MD,Pres. formación\nMDT-1,1000,1450\nMDT-2,1010,1465\n', 'x.csv', { requireDepth: false });
    expect(t.depthColumn).toBe(-1); // «Prof. MD» no es un nombre de profundidad del lector de perfiles
    const m = suggestPressureMapping(t);
    expect(m.map((x) => x.field)).toEqual(['test', 'depth', 'pressure']);
  });
});

describe('io/pressures: LAS 2.0 (sale gratis del lector de perfiles)', () => {
  const las = [
    '~V',
    'VERS. 2.0 : version',
    'WRAP. NO : una linea por muestra',
    '~W',
    'STRT.FT 8200 : tope',
    'STOP.FT 8300 : base',
    'STEP.FT 0 : irregular',
    'NULL. -999.25 : nulo',
    'WELL. Pozo X : nombre',
    '~C',
    'DEPT.FT : Profundidad',
    'PFORM.PSIA : Presion de formacion',
    'MOB.MD/CP : Movilidad',
    'HYDB.PSI : Hidrostatica antes',
    '~A',
    '8200  3600.5  35   4400',
    '8250  3622.1  -999.25  4425',
    '8300  3644.0  12   4450',
  ].join('\n');

  it('reconoce profundidad en pies, presión absoluta, movilidad y lodo', () => {
    const t = parseTable(las, 'mdt.las', { requireDepth: false });
    const m = suggestPressureMapping(t);
    expect(m.map((x) => x.field)).toEqual(['depth', 'pressure', 'mobility', 'mudBefore']);
    expect(m.map((x) => x.unit)).toEqual(['ft', 'psi', 'mD/cP', 'psi']);
    const { set } = buildPressureSet(t, m, { id: 'l' });
    expect(set.depth[2]).toBeCloseTo(8300 * 0.3048, 9);
    expect(pointNumbersOf(set, 'mobility')[1]).toBeNaN();
    expect(set.pointIds).toEqual(['P01', 'P02', 'P03']);
  });
});

describe('io/pressures: unidad pegada al nombre y token de unidad que no es nombre', () => {
  const byNameOf = (csv: string) => Object.fromEntries(suggestPressureMapping(parseTable(csv, 'p.csv', { requireDepth: false })).map((m) => [m.name, m]));

  it('«Presion bar» → unidad bar (no psi por defecto) y conversión a psi', () => {
    const csv = 'MD,Presion bar\n2500,250\n2501,251\n';
    expect(byNameOf(csv)['Presion bar']).toMatchObject({ field: 'pressure', unit: 'bar' });
    const t = parseTable(csv, 'p.csv', { requireDepth: false });
    expect(pointNumbersOf(buildPressureSet(t, suggestPressureMapping(t), { id: 'x' }).set, 'pressure')[0]).toBeCloseTo(3625.94, 1);
  });

  it('«Movilidad mD/cP»: unidad mD/cP pegada al nombre', () => {
    expect(byNameOf('MD,Movilidad mD/cP\n2500,85\n')['Movilidad mD/cP']).toMatchObject({ field: 'mobility', unit: 'mD/cP' });
  });

  it('«Prueba MD»: el MD es la unidad, la columna es el id de la prueba (no profundidad)', () => {
    expect(byNameOf('Prueba MD,Presion psi\nT1,3500\n')['Prueba MD']).toMatchObject({ field: 'test' });
  });
});
