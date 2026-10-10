/** Arma un .xlsx mínimo para los tests (lo usan xlsx.test.ts y pressures.test.ts). */
import { strToU8, zipSync } from 'fflate';

export type Cell = string | number | null;
const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function colRef(c: number): string {
  let s = '';
  for (let n = c + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Arma un .xlsx mínimo. Los textos van a sharedStrings; los números como <v> con el texto original. */
export function makeXlsx(sheets: { name: string; rows: Cell[][] }[]): Uint8Array {
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
