/**
 * Lector .xlsx mínimo: descomprime el libro con `fflate` y lee workbook.xml, sharedStrings.xml y la hoja elegida.
 * Sin DOM ni DOMParser (corre en Node, navegador y worker). No evalúa fórmulas: usa el valor guardado por Excel.
 * Ver docs/decisiones/0002-lectura-de-datos.md.
 */
import { strFromU8, unzipSync } from 'fflate';
import { tableFromRows, type RawTable } from './table';

export interface XlsxOptions {
  /** Nombre o posición (desde 0) de la hoja. Por defecto, la primera que tenga datos. */
  sheet?: string | number;
  /** false: la tabla no es un perfil y puede no tener columna de profundidad (ver `TableContext.requireDepth`). */
  requireDepth?: boolean;
  preserveRawCells?: boolean;
}

interface SheetRef {
  name: string;
  path: string;
}

function decodeEntities(s: string): string {
  if (!s.includes('&') && !s.includes('_x')) return s;
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/_x([0-9a-fA-F]{4})_/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

function attr(tag: string, name: string): string | undefined {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(tag);
  return m ? decodeEntities(m[1]!) : undefined;
}

/** Texto de un fragmento <si> o <is>: concatena los <t> (sin los de fonética <rPh>). */
function textOf(fragment: string): string {
  const clean = fragment.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let out = '';
  const re = /<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean))) out += m[1] ?? '';
  return decodeEntities(out);
}

function readSharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  const out: string[] = [];
  const re = /<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1] === undefined ? '' : textOf(m[1]));
  return out;
}

/** "AB12" → { col: 27 (desde 0), row: 12 } */
function parseRef(ref: string): { col: number; row: number } | null {
  const m = /^([A-Za-z]+)(\d+)$/.exec(ref);
  if (!m) return null;
  let col = 0;
  for (const ch of m[1]!.toUpperCase()) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col: col - 1, row: Number(m[2]) };
}

function resolveTarget(target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = ('xl/' + target).split('/');
  const out: string[] = [];
  for (const p of parts) {
    if (p === '..') out.pop();
    else if (p !== '.' && p !== '') out.push(p);
  }
  return out.join('/');
}

function listSheets(files: Record<string, Uint8Array>): SheetRef[] {
  const wb = files['xl/workbook.xml'];
  if (!wb) throw new Error('El archivo no parece un libro de Excel (.xlsx): falta xl/workbook.xml.');
  const wbXml = strFromU8(wb);
  const relsRaw = files['xl/_rels/workbook.xml.rels'];
  const rels = new Map<string, string>();
  if (relsRaw) {
    const re = /<Relationship\b[^>]*>/g;
    let m: RegExpExecArray | null;
    const relsXml = strFromU8(relsRaw);
    while ((m = re.exec(relsXml))) {
      const id = attr(m[0], 'Id');
      const target = attr(m[0], 'Target');
      if (id && target) rels.set(id, resolveTarget(target));
    }
  }
  const sheets: SheetRef[] = [];
  const re = /<sheet\b[^>]*>/g;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(wbXml))) {
    k++;
    const name = attr(m[0], 'name') ?? `Hoja${k}`;
    const rid = attr(m[0], 'r:id');
    const path = (rid && rels.get(rid)) || `xl/worksheets/sheet${k}.xml`;
    sheets.push({ name, path });
  }
  if (sheets.length === 0) throw new Error('El libro de Excel no tiene hojas.');
  return sheets;
}

function unzipWorkbook(bytes: Uint8Array): Record<string, Uint8Array> {
  try {
    return unzipSync(bytes, {
      filter: (f) =>
        f.name === 'xl/workbook.xml' ||
        f.name === 'xl/_rels/workbook.xml.rels' ||
        f.name === 'xl/sharedStrings.xml' ||
        (f.name.startsWith('xl/worksheets/') && f.name.endsWith('.xml')),
    });
  } catch {
    throw new Error('No se pudo abrir el archivo como libro de Excel (.xlsx): está dañado o no es un .xlsx.');
  }
}

/** Nombres de las hojas del libro (para que la interfaz deje elegir). */
export function listXlsxSheets(bytes: Uint8Array): string[] {
  return listSheets(unzipWorkbook(bytes)).map((s) => s.name);
}

/** Lee las celdas de una hoja como texto, con su número de fila. */
function readSheetRows(xml: string, shared: string[]): { rows: string[][]; rowNumbers: number[] } {
  const rows: string[][] = [];
  const rowNumbers: number[] = [];
  const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
  let rm: RegExpExecArray | null;
  let autoRow = 0;
  while ((rm = rowRe.exec(xml))) {
    autoRow++;
    const rowNum = Number(attr(rm[1]!, 'r') ?? autoRow);
    autoRow = rowNum;
    const body = rm[2];
    if (!body) continue;
    const cells: string[] = [];
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cm: RegExpExecArray | null;
    let autoCol = -1;
    while ((cm = cellRe.exec(body))) {
      const ref = attr(cm[1]!, 'r');
      const pos = ref ? parseRef(ref) : null;
      const col = pos ? pos.col : autoCol + 1;
      autoCol = col;
      const inner = cm[2];
      if (inner === undefined) continue;
      const t = attr(cm[1]!, 't') ?? 'n';
      let value = '';
      if (t === 'inlineStr') {
        const is = /<is\b[^>]*>([\s\S]*?)<\/is>/.exec(inner);
        value = is ? textOf(is[1]!) : '';
      } else {
        const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner);
        if (v) {
          const raw = v[1]!;
          if (t === 's') value = shared[Number(raw)] ?? '';
          else if (t === 'str') value = decodeEntities(raw);
          else if (t === 'b') value = raw === '1' ? 'TRUE' : 'FALSE';
          else if (t === 'e') value = ''; // #N/A, #DIV/0!... → sin dato
          else value = raw.trim();
        }
      }
      while (cells.length < col) cells.push('');
      cells[col] = value;
    }
    rows.push(cells);
    rowNumbers.push(rowNum);
  }
  return { rows, rowNumbers };
}

/** Lee un libro .xlsx a una RawTable. */
export function parseXlsx(bytes: Uint8Array, sourceName: string, options: XlsxOptions = {}): RawTable {
  if (bytes.length === 0) throw new Error('El archivo está vacío.');
  const files = unzipWorkbook(bytes);
  const sheets = listSheets(files);
  const sheetNames = sheets.map((s) => s.name);
  const sharedRaw = files['xl/sharedStrings.xml'];
  const shared = readSharedStrings(sharedRaw ? strFromU8(sharedRaw) : undefined);

  const tryParse = (s: SheetRef): RawTable => {
    const data = files[s.path];
    if (!data) throw new Error(`La hoja '${s.name}' no se encontró dentro del archivo (${s.path}).`);
    const { rows, rowNumbers } = readSheetRows(strFromU8(data), shared);
    return tableFromRows(rows, rowNumbers, { format: 'xlsx', sourceName, sheets: sheetNames, sheet: s.name, ...(options.preserveRawCells ? { preserveRawCells: true } : {}), ...(options.requireDepth === false ? { requireDepth: false } : {}) });
  };

  const wanted = options.sheet;
  if (wanted !== undefined) {
    const s = typeof wanted === 'number' ? sheets[wanted] : sheets.find((x) => x.name === wanted);
    if (!s) throw new Error(`No existe la hoja '${wanted}'. Hojas del libro: ${sheetNames.join(', ')}.`);
    return tryParse(s);
  }
  // Por defecto: la primera hoja que se pueda leer como tabla de perfiles.
  let firstError: Error | null = null;
  for (const s of sheets) {
    try {
      return tryParse(s);
    } catch (e) {
      firstError ??= e instanceof Error ? e : new Error(String(e));
    }
  }
  throw new Error(
    `Ninguna hoja del libro tiene una tabla de perfiles utilizable (${sheetNames.join(', ')}). ` +
      `Primera hoja: ${firstError?.message ?? 'sin datos'}`,
  );
}
