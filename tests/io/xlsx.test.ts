import { strToU8, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import csvText from '../../datos/pozo_tp_perfiles.csv?raw';
import { listXlsxSheets, parseTable, readWellFile } from '../../src/io';

type Cell = string | number | null;

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function colRef(c: number): string {
  let s = '';
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Arma un .xlsx mínimo. Los textos van a sharedStrings; los números como <v> con el texto original. */
function makeXlsx(sheets: { name: string; rows: Cell[][] }[]): Uint8Array {
  const shared: string[] = [];
  const sharedIdx = new Map<string, number>();
  const sst = (s: string): number => {
    let i = sharedIdx.get(s);
    if (i === undefined) {
      i = shared.length;
      shared.push(s);
      sharedIdx.set(s, i);
    }
    return i;
  };
  const sheetXml = sheets.map(({ rows }) => {
    const body = rows
      .map((row, r) => {
        const cells = row
          .map((v, c) => {
            if (v === null) return '';
            const ref = `${colRef(c)}${r + 1}`;
            return typeof v === 'number'
              ? `<c r="${ref}"><v>${v}</v></c>`
              : `<c r="${ref}" t="s"><v>${sst(v)}</v></c>`;
          })
          .join('');
        return `<row r="${r + 1}">${cells}</row>`;
      })
      .join('');
    return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
  });
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
        .map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join('')}</sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
        .map((_, i) => `<Relationship Id="rId${i + 1}" Type="worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
        .join('')}</Relationships>`,
    ),
    'xl/sharedStrings.xml': strToU8(
      `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">${shared
        .map((s) => `<si><t>${esc(s)}</t></si>`)
        .join('')}</sst>`,
    ),
  };
  sheetXml.forEach((x, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(x)));
  return zipSync(files);
}

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
