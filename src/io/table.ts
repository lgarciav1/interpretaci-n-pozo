/**
 * Tabla cruda: etapa intermedia entre el archivo y el `Well`.
 *
 * Cada lector (CSV, LAS, xlsx) produce una `RawTable`: columnas con nombre, unidad (texto tal como vino) y datos,
 * sin interpretar roles ni convertir unidades. La interfaz puede mostrarla en un asistente de columnas antes de
 * construir el pozo (`buildWell`, en build.ts).
 *
 * Este archivo también tiene lo que comparten CSV y xlsx: interpretación de celdas (decimal, nulos típicos) y
 * detección de la fila de encabezado y de la fila de unidades.
 */
import type { HeaderEntry } from '../core/well';
import { parseUnit } from '../core/units';

export type SourceFormat = 'csv' | 'las' | 'xlsx';

export interface RawColumn {
  /** Nombre tal como aparece en el archivo (sin la unidad entre paréntesis, si la traía). */
  name: string;
  /** Texto de unidad tal como vino ('' si no hay). */
  unit: string;
  description?: string;
  kind: 'numeric' | 'text';
  /** Datos de una columna numérica (NaN = sin dato); null si es de texto. */
  numbers: Float64Array | null;
  /** Datos de una columna de texto; null si es numérica. */
  text: string[] | null;
}

export interface RawTable {
  format: SourceFormat;
  sourceName: string;
  /** Metadatos del archivo (LAS: secciones ~W y ~P). */
  header: Record<string, HeaderEntry>;
  columns: RawColumn[];
  /** Índice de la columna de profundidad dentro de `columns`. */
  depthColumn: number;
  rowCount: number;
  /** Número de fila/línea (desde 1) de cada muestra en el archivo, para mensajes de error. */
  sourceRows: Int32Array;
  /** Valor nulo declarado por el archivo (LAS), si lo hay. */
  nullValue?: number;
  /** xlsx: hojas del libro y hoja usada. */
  sheets?: string[];
  sheet?: string;
  warnings: string[];
}

/** Valores numéricos que los archivos usan como "sin dato". */
export const NULL_NUMBERS: readonly number[] = [-999.25, -999, -9999, -99999];
const NULL_SET = new Set<number>(NULL_NUMBERS);
const NULL_TOKENS = new Set(['', 'NULL', 'NAN', 'NA', 'N/A', '#N/A', '#NULL!', '#VALUE!', '#DIV/0!', 'NONE', '-', '--', '.']);
const NUM_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** Nombres de columna que se reconocen como profundidad (ya normalizados: mayúsculas, sin espacios). */
const DEPTH_NAMES = new Set([
  'DEPTH', 'DEPT', 'MD', 'MDEPTH', 'PROF', 'PROFUNDIDAD', 'PROFUND', 'DEPTH_M', 'DEPTH_FT', 'DEPTH_MD', 'MD_M', 'MD_FT', 'PROF_M',
]);

export function isDepthName(name: string): boolean {
  return DEPTH_NAMES.has(name.trim().toUpperCase().replace(/[\s-]+/g, '_'));
}

/**
 * Interpreta una celda. Devuelve un número, NaN si es "sin dato" (vacía, NULL, NaN, -999.25...) o null si es
 * texto no numérico.
 */
export function parseCell(raw: string, decimalComma: boolean): number | null {
  const s = raw.trim();
  if (s === '') return NaN;
  if (NULL_TOKENS.has(s.toUpperCase())) return NaN;
  const t = decimalComma ? s.replace(',', '.') : s;
  if (!NUM_RE.test(t)) return null;
  const v = Number(t);
  return NULL_SET.has(v) ? NaN : v;
}

type CellClass = 'blank' | 'nul' | 'num' | 'text';

function classify(raw: string, decimalComma: boolean): CellClass {
  const s = raw.trim();
  if (s === '') return 'blank';
  if (NULL_TOKENS.has(s.toUpperCase())) return 'nul';
  return NUM_RE.test(decimalComma ? s.replace(',', '.') : s) ? 'num' : 'text';
}

function countClasses(cells: readonly string[], decimalComma: boolean): { num: number; text: number; nul: number } {
  let num = 0;
  let text = 0;
  let nul = 0;
  for (const c of cells) {
    const k = classify(c, decimalComma);
    if (k === 'num') num++;
    else if (k === 'text') text++;
    else if (k === 'nul') nul++;
  }
  return { num, text, nul };
}

function looksLikeUnitRow(cells: readonly string[], decimalComma: boolean): boolean {
  const k = countClasses(cells, decimalComma);
  if (k.num > 0 || k.text === 0) return false;
  let known = 0;
  for (const c of cells) {
    if (classify(c, decimalComma) === 'text' && parseUnit(c.trim()) !== null) known++;
  }
  return known * 2 >= k.text;
}

/** Detecta si el decimal es coma: solo posible si el separador de campos no es la coma. */
export function detectDecimal(rows: readonly string[][], fieldSeparatorIsComma: boolean): '.' | ',' {
  if (fieldSeparatorIsComma) return '.';
  let dot = 0;
  let comma = 0;
  const limit = Math.min(rows.length, 3000);
  for (let r = 0; r < limit; r++) {
    for (const c of rows[r]!) {
      const s = c.trim();
      if (/^[+-]?\d*\.\d+([eE][+-]?\d+)?$/.test(s)) dot++;
      else if (/^[+-]?\d*,\d+$/.test(s)) comma++;
    }
  }
  return comma > dot ? ',' : '.';
}

export interface TableContext {
  format: SourceFormat;
  sourceName: string;
  /** Si el separador de campos es la coma (el decimal entonces es punto). */
  fieldSeparatorIsComma?: boolean;
  decimal?: '.' | ',';
  sheets?: string[];
  sheet?: string;
}

/**
 * Arma una RawTable a partir de una grilla de celdas (CSV o una hoja de Excel).
 * `rowNumbers[i]` es el número de fila/línea de origen de `rows[i]` (desde 1).
 */
export function tableFromRows(allRows: string[][], allRowNumbers: number[], ctx: TableContext): RawTable {
  const warnings: string[] = [];
  // Descartar filas vacías y comentarios (#...), conservando la numeración original.
  const rows: string[][] = [];
  const rowNumbers: number[] = [];
  for (let i = 0; i < allRows.length; i++) {
    const r = allRows[i]!;
    const first = (r[0] ?? '').trim();
    if (first.startsWith('#') && ctx.format === 'csv') continue;
    if (r.every((c) => c.trim() === '')) continue;
    rows.push(r);
    rowNumbers.push(allRowNumbers[i]!);
  }
  if (rows.length === 0) throw new Error('El archivo está vacío o no tiene celdas con contenido.');

  const decimal = ctx.decimal ?? detectDecimal(rows, ctx.fieldSeparatorIsComma ?? false);
  const comma = decimal === ',';

  // Fila de encabezado: texto, seguida (con fila de unidades opcional) por una fila mayormente numérica.
  let headerAt = -1;
  let unitAt = -1;
  let dataAt = -1;
  const scan = Math.min(rows.length - 1, 60);
  for (let r = 0; r < scan && headerAt < 0; r++) {
    const k = countClasses(rows[r]!, comma);
    if (k.text < 1 || k.text <= k.num) continue;
    let next = r + 1;
    let unit = -1;
    if (next < rows.length && looksLikeUnitRow(rows[next]!, comma)) {
      unit = next;
      next++;
    }
    if (next >= rows.length) continue;
    const d = countClasses(rows[next]!, comma);
    if (d.num >= 1 && d.num * 2 >= d.num + d.text + d.nul) {
      headerAt = r;
      unitAt = unit;
      dataAt = next;
    }
  }
  if (headerAt < 0) {
    throw new Error(
      'No se encontró una fila de encabezado seguida de filas de datos numéricos. ' +
        'La primera fila debería tener los nombres de las curvas (la primera columna, la profundidad).',
    );
  }

  const headerRow = rows[headerAt]!;
  const dataRows = rows.slice(dataAt);
  const width = headerRow.length;
  const unitRow = unitAt >= 0 ? rows[unitAt]! : null;

  const names: string[] = [];
  const units: string[] = [];
  for (let c = 0; c < width; c++) {
    let name = (headerRow[c] ?? '').trim();
    let unit = unitRow ? (unitRow[c] ?? '').trim() : '';
    // "GR (gAPI)" o "GR [gAPI]": la unidad viene en el nombre.
    const m = /^(.*?)\s*[([]([^)\]]*)[)\]]\s*$/.exec(name);
    if (m && m[1]) {
      name = m[1].trim();
      if (!unit) unit = m[2]!.trim();
    }
    if (name === '') name = `COLUMNA_${c + 1}`;
    names.push(name);
    units.push(unit);
  }

  let wide = 0;
  for (const r of dataRows) if (r.length > width && r.slice(width).some((x) => x.trim() !== '')) wide++;
  if (wide > 0) warnings.push(`${wide} filas tienen más celdas que el encabezado; se ignoran las sobrantes.`);

  const n = dataRows.length;
  const columns: RawColumn[] = [];
  for (let c = 0; c < width; c++) {
    const numbers = new Float64Array(n);
    let nNum = 0;
    let nText = 0;
    for (let i = 0; i < n; i++) {
      const raw = dataRows[i]![c] ?? '';
      const v = parseCell(raw, comma);
      if (v === null) {
        numbers[i] = NaN;
        nText++;
      } else {
        numbers[i] = v;
        if (!Number.isNaN(v)) nNum++;
      }
    }
    if (nText > 0 && nText >= nNum) {
      const text = new Array<string>(n);
      for (let i = 0; i < n; i++) text[i] = (dataRows[i]![c] ?? '').trim();
      columns.push({ name: names[c]!, unit: units[c]!, kind: 'text', numbers: null, text });
    } else {
      if (nText > 0) {
        warnings.push(`La columna '${names[c]}' tiene ${nText} celdas no numéricas; se toman como sin dato.`);
      }
      columns.push({ name: names[c]!, unit: units[c]!, kind: 'numeric', numbers, text: null });
    }
  }

  let depthColumn = columns.findIndex((col) => isDepthName(col.name));
  if (depthColumn < 0) {
    depthColumn = 0;
    if (columns[0]!.kind === 'numeric') {
      warnings.push(
        `Ninguna columna se llama como una profundidad (DEPTH, DEPT, MD...): se usa la primera ('${columns[0]!.name}').`,
      );
    }
  }
  if (columns[depthColumn]!.kind !== 'numeric') {
    throw new Error(
      `No se encontró una columna de profundidad numérica: la columna '${columns[depthColumn]!.name}' tiene texto. ` +
        'La primera columna del archivo debe ser la profundidad.',
    );
  }

  const sourceRows = new Int32Array(n);
  for (let i = 0; i < n; i++) sourceRows[i] = rowNumbers[dataAt + i]!;

  return {
    format: ctx.format,
    sourceName: ctx.sourceName,
    header: {},
    columns,
    depthColumn,
    rowCount: n,
    sourceRows,
    ...(ctx.sheets ? { sheets: ctx.sheets } : {}),
    ...(ctx.sheet !== undefined ? { sheet: ctx.sheet } : {}),
    warnings,
  };
}
