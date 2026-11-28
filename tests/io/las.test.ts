import { describe, expect, it } from 'vitest';
import lasFt from '../fixtures/ejemplo_ft.las?raw';
import lasM from '../fixtures/ejemplo_m.las?raw';
import lasWrap from '../fixtures/ejemplo_wrap.las?raw';
import { parseTable, readWellFile } from '../../src/io';

const FT = 0.3048;
const arr = (a: Float64Array): number[] => Array.from(a);

describe('LAS 2.0 con profundidad en pies', () => {
  const { well, zones, columns, warnings } = readWellFile(lasFt, 'ejemplo_ft.las');
  const c = (id: string) => well.curves.find((x) => x.id === id)!;

  it('profundidad convertida a metros, con la unidad original', () => {
    expect(well.depth.values).toHaveLength(7);
    expect(well.depth.values[0]).toBeCloseTo(1524.0, 9); // 5000 ft
    expect(well.depth.values[6]).toBeCloseTo(1524.9144, 9); // 5003 ft
    expect(well.depth.step!).toBeCloseTo(0.5 * FT, 9);
    expect(well.depth.sourceUnit).toBe('ft');
    expect(zones).toEqual([]);
  });

  it('NULL del encabezado pasa a NaN', () => {
    expect(arr(c('GR').data)).toEqual([45, 50, NaN, 60, 70, 80, 90]);
    expect(arr(c('RHOB').data)).toEqual([2.3, 2.35, 2.4, NaN, 2.5, 2.55, 2.6]);
    expect(arr(c('NPHI').data)).toEqual([0.2, 0.22, 0.25, 0.28, 0.3, NaN, 0.35]);
    expect(arr(c('ILD').data)).toEqual([10, 8, NaN, 5, 4, 3, 2]);
  });

  it('curvas: descripción, unidad y rol', () => {
    expect(well.curves.map((x) => x.id)).toEqual(['GR', 'RHOB', 'NPHI', 'ILD']);
    expect(c('GR')).toMatchObject({ description: '2  GAMMA RAY', unit: 'gAPI', role: 'GR' });
    expect(c('RHOB')).toMatchObject({ description: '3  BULK DENSITY', unit: 'g/cm3', role: 'RHOB' });
    expect(c('NPHI')).toMatchObject({ unit: 'v/v', role: 'NPHI' });
    expect(c('ILD')).toMatchObject({ unit: 'ohm.m', role: 'RT' });
    expect(columns.map((m) => m.kind)).toEqual(['depth', 'curve', 'curve', 'curve', 'curve']);
  });

  it('metadatos de ~W (y ~P) al header del pozo', () => {
    expect(well.name).toBe('POZO EJEMPLO-1');
    expect(well.id).toBe('pozo-ejemplo-1');
    expect(well.header['COMP']).toMatchObject({ value: 'PETROLERA DEL SUR', description: 'COMPANY' });
    expect(well.header['FLD']!.value).toBe('CAMPO NORTE');
    expect(well.header['UWI']!.value).toBe('05-123-45678');
    expect(well.header['DATE']!.value).toBe('2020-03-15 12:30:00');
    expect(well.header['STRT']).toMatchObject({ value: 5000, unit: 'ft' });
    expect(well.header['STEP']).toMatchObject({ value: 0.5, unit: 'ft' });
    expect(well.header['KB']).toMatchObject({ value: 45, unit: 'ft' });
    expect(well.header['NULL']).toBeUndefined();
    expect(warnings).toEqual([]);
  });

  it('parseTable conserva el texto de unidad original', () => {
    const t = parseTable(lasFt, 'ejemplo_ft.las');
    expect(t.format).toBe('las');
    expect(t.nullValue).toBe(-999.25);
    expect(t.columns.map((x) => x.unit)).toEqual(['FT', 'GAPI', 'G/CC', 'V/V', 'OHMM']);
    // número de línea de la primera muestra (la línea 41 del archivo)
    expect(lasFt.split('\n')[t.sourceRows[0]! - 1]).toContain('5000.0');
  });
});

describe('LAS 2.0 con profundidad en metros', () => {
  const { well } = readWellFile(lasM, 'ejemplo_m.las');
  it('lee metros, tabuladores, NULL -9999 y mnemónico con sufijo :1', () => {
    expect(arr(well.depth.values)).toEqual([1000, 1000.5, 1001]);
    expect(well.depth.sourceUnit).toBe('m');
    expect(well.name).toBe('Pozo Metros-2');
    expect(well.curves.map((x) => x.id)).toEqual(['GR:1', 'DT']);
    expect(arr(well.curves[0]!.data)).toEqual([30, NaN, 45.5]);
    expect(arr(well.curves[1]!.data)).toEqual([100, 95.5, NaN]);
    expect(well.curves[0]).toMatchObject({ role: 'GR', unit: 'gAPI' });
    expect(well.curves[1]).toMatchObject({ role: 'DT', unit: 'us/ft' });
  });
});

describe('LAS 2.0 con WRAP=YES', () => {
  it('une las líneas de cada muestra', () => {
    const { well } = readWellFile(lasWrap, 'wrap.las');
    expect(arr(well.depth.values)).toEqual([100, 100.5]);
    expect(arr(well.curves[0]!.data)).toEqual([1, 4]);
    expect(arr(well.curves[1]!.data)).toEqual([2, NaN]);
    expect(arr(well.curves[2]!.data)).toEqual([3, 6]);
  });

  it('muestra incompleta: error claro', () => {
    expect(() => readWellFile(lasWrap.replace('4.0 -999.25 6.0', '4.0 -999.25'), 'wrap.las')).toThrow(/WRAP=YES.*incompleta/);
  });
});

describe('LAS: errores en español', () => {
  it('archivo vacío', () => {
    expect(() => readWellFile('', 'x.las')).toThrow('vacío');
  });

  it('sin sección de curvas (sin profundidad)', () => {
    expect(() => readWellFile('~V\nVERS. 2.0 :\n~W\nNULL. -999.25 :\n~A\n1 2 3\n', 'x.las')).toThrow(/falta la sección ~C.*profundidad/);
  });

  it('sin sección de datos', () => {
    expect(() => readWellFile('~V\nVERS. 2.0 :\n~C\nDEPT.M :\nGR.GAPI :\n', 'x.las')).toThrow(/~A/);
  });

  it('profundidad no creciente: indica la línea', () => {
    const bad = lasM.replace('1000.5\t-9999', '999.5\t-9999');
    expect(() => readWellFile(bad, 'x.las')).toThrow(/no creciente en la fila 16/);
  });

  it('fila con cantidad de valores distinta', () => {
    expect(() => readWellFile(lasM.replace('1000.5\t-9999\t95.5', '1000.5\t-9999'), 'x.las')).toThrow(/línea 16.*3 valores.*2/);
  });

  it('LAS 3.0 no se admite', () => {
    expect(() => readWellFile(lasM.replace('VERS. 2.0', 'VERS. 3.0'), 'x.las')).toThrow(/solo se admite LAS 2.0/);
  });
});

describe('LAS: coma decimal y unidades entre corchetes', () => {
  it('lee comas decimales en ~P y ~A sin confundirlas con separadores de columna', () => {
    const commaLas = `~V
VERS. 2.0 :
WRAP. NO :
~W
STRT.[M] 1000.0 :
NULL. -999.25 :
~C
DEPT.[M] :
RHOB.[K/M3] :
DT.[US/M] :
~P
BHT.DEGC 35,5000 :
MDEN. 2710,1000 :
~A
1000,0   2550,0   200,0
1000,5   2600,5   190,5
`;
    const r = readWellFile(commaLas, 'coma.las');
    expect(r.well.header['BHT']?.value).toBeCloseTo(35.5, 6);
    expect(r.well.header['MDEN']?.value).toBe('2710,1000');
    expect([...r.well.depth.values]).toEqual([1000, 1000.5]);
    expect(r.well.curves.find((c) => c.id === 'RHOB')?.unit).toBe('kg/m3');
    expect(r.well.curves.find((c) => c.id === 'DT')?.unit).toBe('us/m');
  });

  it('mantiene soporte de archivos LAS delimitados por comas en ~A', () => {
    const csvDelimitedLas = `~V
VERS. 2.0 :
WRAP. NO :
~W
NULL. -999.25 :
~C
DEPT.M :
GR.GAPI :
~A
1000.0, 45.5
1000.5, 50.0
`;
    const r = readWellFile(csvDelimitedLas, 'delim.las');
    expect([...r.well.depth.values]).toEqual([1000, 1000.5]);
    expect([...r.well.curves.find((c) => c.id === 'GR')!.data]).toEqual([45.5, 50]);
  });
});
