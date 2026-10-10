/**
 * Escritor xlsx mínimo sobre `fflate` (zip) con cadenas en línea: sin dependencias nuevas. Hojas: Curvas (primera,
 * así `parseXlsx` la toma por defecto), Zonas, Sumario (si hay) y Encabezado.
 */
import { strToU8, zipSync } from 'fflate';
import { prepareExport, unitText } from './prepare';
import { summaryHeader } from './csv';
import type { ExportInput, PreparedExport } from './types';

type Cell = string | number | null;

const esc = (s: string) =>
  // eslint-disable-next-line no-control-regex
  s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function colRef(c: number): string {
  let s = '';
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** `boldRows`: filas (desde 0) con el estilo de encabezado. */
function sheetXml(rows: readonly (readonly Cell[])[], widths: readonly number[], boldRows = 1): string {
  const body: string[] = [];
  for (let r = 0; r < rows.length; r++) {
    const cells: string[] = [];
    const row = rows[r]!;
    for (let c = 0; c < row.length; c++) {
      const v = row[c];
      if (v === null || v === undefined) continue;
      const ref = `${colRef(c)}${r + 1}`;
      const s = r < boldRows ? ' s="1"' : '';
      if (typeof v === 'number') {
        if (Number.isFinite(v)) cells.push(`<c r="${ref}"${s}><v>${v}</v></c>`);
      } else {
        cells.push(`<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`);
      }
    }
    body.push(`<row r="${r + 1}">${cells.join('')}</row>`);
  }
  const cols = widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
  const pane = boldRows > 0 ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : '';
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${pane}<cols>${cols}</cols><sheetData>${body.join('')}</sheetData></worksheet>`
  );
}

const STYLES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>';

function curvesRows(p: PreparedExport): Cell[][] {
  const head = (name: string, unit: string) => (unit ? `${name} (${unit})` : name);
  const rows: Cell[][] = [[head('DEPTH', p.depthUnit), ...p.columns.map((c) => head(c.name, c.unit))]];
  const nul = p.nullValue;
  for (let i = 0; i < p.depth.length; i++) {
    const row: Cell[] = [p.depth[i]!];
    for (const c of p.columns) {
      const v = c.values[i]!;
      row.push(Number.isNaN(v) ? nul : v);
    }
    rows.push(row);
  }
  return rows;
}

export function writeXlsx(input: ExportInput): Uint8Array {
  const p = prepareExport(input, 'DEPTH');
  const sheets: { name: string; xml: string }[] = [];
  const curves = curvesRows(p);
  sheets.push({ name: 'Curvas', xml: sheetXml(curves, [12, ...p.columns.map(() => 12)]) });

  if (p.zones.length > 0) {
    const rows: Cell[][] = [['Zona', 'Tipo', `Tope (${p.depthUnit})`, `Base (${p.depthUnit})`], ...p.zones.map((z): Cell[] => [z.name, z.kind ?? null, z.top, z.base])];
    sheets.push({ name: 'Zonas', xml: sheetXml(rows, [18, 14, 14, 14]) });
  }
  if (p.summary) {
    const s = p.summary;
    const rows: Cell[][] = [s.columns.map((c) => summaryHeader(c))];
    for (const r of s.rows) rows.push(s.columns.map((c) => (r[c.key] ?? null)));
    sheets.push({ name: 'Sumario', xml: sheetXml(rows, s.columns.map((c) => (c.kind === 'text' ? 18 : 16))) });
  }

  const info: Cell[][] = [['Campo', 'Valor', 'Unidad', 'Descripción']];
  info.push(['Pozo', p.wellName, null, null]);
  for (const [k, e] of Object.entries(p.header)) info.push([k, typeof e.value === 'number' ? e.value : String(e.value), e.unit ? unitText(e.unit) : null, e.description ?? null]);
  info.push(['Profundidad', p.depthUnit, null, 'Unidad de la primera columna de la hoja Curvas']);
  info.push(['Tope', p.top, p.depthUnit, null], ['Base', p.base, p.depthUnit, null]);
  info.push(['Paso', p.step, p.depthUnit, p.step === null ? 'Muestreo irregular' : null]);
  info.push(['Muestras', p.depth.length, null, null]);
  info.push(['Valor para sin dato', p.nullValue, null, p.nullValue === null ? 'Celda vacía' : null]);
  info.push(['Generado', p.generatedAt.toISOString(), null, null], [], ['Columna', 'Origen', 'Unidad', 'Descripción']);
  for (const c of p.columns) info.push([c.name, c.origin === 'computed' ? 'calculada' : 'medida', c.unit || null, c.description || null]);
  sheets.push({ name: 'Encabezado', xml: sheetXml(info, [24, 28, 12, 50]) });

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
        '</Types>',
    ),
    '_rels/.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    ),
    'xl/workbook.xml': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
        sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
        '</sheets></workbook>',
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
        `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    ),
    'xl/styles.xml': strToU8(STYLES),
  };
  sheets.forEach((s, i) => (files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(s.xml)));
  return zipSync(files, { level: 6 });
}
