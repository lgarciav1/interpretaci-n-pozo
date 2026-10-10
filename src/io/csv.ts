/**
 * Lector CSV: separador coma, punto y coma o tabulación (autodetectado); decimal punto o coma; comillas.
 * Pura: recibe texto, devuelve una RawTable. La primera columna es la profundidad (o la que se llame como tal).
 */
import { tableFromRows, type RawTable } from './table';

export interface CsvOptions {
  /** Fuerza el separador de campos (por defecto se detecta). */
  delimiter?: ',' | ';' | '\t';
  /** Fuerza el decimal (por defecto se detecta). */
  decimal?: '.' | ',';
  /** false: la tabla no es un perfil y puede no tener columna de profundidad (ver `TableContext.requireDepth`). */
  requireDepth?: boolean;
}

// Orden de preferencia ante empate: con decimal coma, la coma aparece tan seguido como el separador real.
const CANDIDATES = [';', '\t', ','] as const;

/** Quita el BOM inicial. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Detecta el separador mirando las primeras líneas: el que aparece una cantidad constante y alta de veces. */
export function detectDelimiter(text: string): ',' | ';' | '\t' {
  const lines = text
    .split(/\r\n|\n|\r/, 40)
    .filter((l) => l.trim() !== '' && !l.startsWith('#'))
    .slice(0, 20);
  let best: (typeof CANDIDATES)[number] = ',';
  let bestScore = 0;
  for (const d of CANDIDATES) {
    const counts = lines.map((l) => countOutsideQuotes(l, d));
    const nonZero = counts.filter((c) => c > 0);
    if (nonZero.length === 0) continue;
    // Cuántas líneas comparten la cantidad más repetida de separadores: premia la regularidad.
    const freq = new Map<number, number>();
    for (const c of nonZero) freq.set(c, (freq.get(c) ?? 0) + 1);
    let modeFreq = 0;
    for (const f of freq.values()) modeFreq = Math.max(modeFreq, f);
    const score = modeFreq;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return best;
}

function countOutsideQuotes(line: string, d: string): number {
  let inQ = false;
  let n = 0;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') inQ = !inQ;
    else if (ch === d && !inQ) n++;
  }
  return n;
}

/** Divide el texto en filas de celdas. Devuelve también el número de línea (desde 1) donde empieza cada fila. */
export function splitCsv(text: string, delimiter: string): { rows: string[][]; lineNumbers: number[] } {
  const rows: string[][] = [];
  const lineNumbers: number[] = [];
  if (!text.includes('"')) {
    // Camino rápido: sin comillas.
    const lines = text.split(/\r\n|\n|\r/);
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i]!;
      if (l === '') continue;
      rows.push(l.split(delimiter));
      lineNumbers.push(i + 1);
    }
    return { rows, lineNumbers };
  }
  let row: string[] = [];
  let cell = '';
  let inQ = false;
  let line = 1;
  let rowLine = 1;
  const pushRow = (): void => {
    row.push(cell);
    cell = '';
    if (!(row.length === 1 && row[0] === '')) {
      rows.push(row);
      lineNumbers.push(rowLine);
    }
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQ = false;
      } else {
        if (ch === '\n') line++;
        cell += ch;
      }
    } else if (ch === '"') {
      inQ = true;
    } else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      pushRow();
      line++;
      rowLine = line;
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length > 0) pushRow();
  return { rows, lineNumbers };
}

/** Lee un CSV de pozo a una RawTable. Lanza un Error en español si el archivo no tiene datos utilizables. */
export function parseCsv(text: string, sourceName: string, options: CsvOptions = {}): RawTable {
  const clean = stripBom(text);
  if (clean.trim() === '') throw new Error('El archivo está vacío.');
  const delimiter = options.delimiter ?? detectDelimiter(clean);
  const { rows, lineNumbers } = splitCsv(clean, delimiter);
  return tableFromRows(rows, lineNumbers, {
    format: 'csv',
    sourceName,
    fieldSeparatorIsComma: delimiter === ',',
    ...(options.decimal ? { decimal: options.decimal } : {}),
    ...(options.requireDepth === false ? { requireDepth: false } : {}),
  });
}
