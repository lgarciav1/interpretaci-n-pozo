import { describe, expect, it } from 'vitest';
import csvText from '../../datos/pozo_tp_perfiles.csv?raw';
import { listXlsxSheets, parseTable, readWellFile } from '../../src/io';
import { makeXlsx, type Cell } from './xlsxFixture';

/** Filas del CSV del TP: cada celda numérica va como número (con su texto original), las vacías se omiten. */
function csvRows(): Cell[][] {
  const lines = csvText.trim().split('\n');
  return lines.map((line, r) =>
    line.split(',').map((c): Cell => (c === '' ? null : r === 0 || Number.isNaN(Number(c)) ? c : (c as unknown as number))),
  );
}

describe('xlsx', () => {
  const rows = csvRows();
  const bytes = makeXlsx([{ name: 'Portada', rows: [['Pozo del TP']] }, { name: 'Datos', rows }]);

  it('da exactamente los mismos números que el CSV', () => {
    const fromCsv = readWellFile(csvText, 'pozo_tp_perfiles.csv');
    const fromXlsx = readWellFile(bytes, 'pozo_tp_perfiles.xlsx');
    expect(Array.from(fromXlsx.well.depth.values)).toEqual(Array.from(fromCsv.well.depth.values));
    expect(fromXlsx.well.curves.map((c) => c.id)).toEqual(fromCsv.well.curves.map((c) => c.id));
    for (const c of fromCsv.well.curves) {
      const x = fromXlsx.well.curves.find((k) => k.id === c.id)!;
      expect(Array.from(x.data), c.id).toEqual(Array.from(c.data));
      expect(x.role).toBe(c.role);
      expect(x.unit).toBe(c.unit);
    }
    expect(fromXlsx.zones).toEqual(fromCsv.zones);
    expect(fromXlsx.well.depth.values).toHaveLength(5810);
  });

  it('por defecto salta las hojas sin datos; la hoja se puede elegir por nombre o posición', () => {
    expect(listXlsxSheets(bytes)).toEqual(['Portada', 'Datos']);
    expect(parseTable(bytes, 'a.xlsx').sheet).toBe('Datos');
    expect(parseTable(bytes, 'a.xlsx', { sheet: 'Datos' }).rowCount).toBe(5810);
    expect(parseTable(bytes, 'a.xlsx', { sheet: 1 }).rowCount).toBe(5810);
    expect(() => parseTable(bytes, 'a.xlsx', { sheet: 'Nada' })).toThrow(/No existe la hoja 'Nada'.*Portada, Datos/);
  });

  it('detecta filas de título previas, fila de unidades y número de fila de origen', () => {
    const b = makeXlsx([
      {
        name: 'Hoja1',
        rows: [
          ['Registro de ejemplo'],
          [],
          ['DEPTH', 'GR', 'RHOB & co'],
          ['ft', 'gAPI', 'g/cc'],
          [100, 50, 2.3],
          [100.5, null, 2.4],
        ],
      },
    ]);
    const t = parseTable(b, 'b.xlsx');
    expect(t.columns.map((c) => [c.name, c.unit])).toEqual([['DEPTH', 'ft'], ['GR', 'gAPI'], ['RHOB & co', 'g/cc']]);
    expect(t.sourceRows[0]).toBe(5);
    const { well } = readWellFile(b, 'b.xlsx');
    expect(well.depth.sourceUnit).toBe('ft');
    expect(well.depth.values[1]).toBeCloseTo(100.5 * 0.3048, 9);
    expect(Array.from(well.curves[0]!.data)).toEqual([50, NaN]);
  });

  it('errores en español', () => {
    expect(() => readWellFile(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]), 'x.xlsx')).toThrow(/no es un \.xlsx|dañado/);
    expect(() => readWellFile(makeXlsx([{ name: 'Vacía', rows: [] }]), 'x.xlsx')).toThrow(/Ninguna hoja/);
    const noDepth = makeXlsx([{ name: 'S', rows: [['FORMACION', 'GR'], ['Arenisca', 10], ['Lutita', 20]] }]);
    expect(() => readWellFile(noDepth, 'x.xlsx')).toThrow(/profundidad/);
    const bad = makeXlsx([{ name: 'S', rows: [['DEPTH', 'GR'], [1, 10], [3, 20], [2, 30]] }]);
    expect(() => readWellFile(bad, 'x.xlsx')).toThrow(/no creciente en la fila 4/);
  });
});
