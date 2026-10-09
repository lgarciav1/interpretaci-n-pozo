/**
 * Lector LAS 2.0 (secciones ~V ~W ~C ~P ~O ~A). Pura: recibe texto, devuelve una RawTable.
 *
 * - El valor NULL del encabezado (~W) pasa a NaN.
 * - Se aceptan líneas en blanco y comentarios (#).
 * - WRAP=NO (una fila por línea) y WRAP=YES (muestra repartida en varias líneas) se leen igual: los datos se
 *   toman como una sucesión de valores y se cortan de a "cantidad de curvas".
 * - Los metadatos de ~W (y ~P, sin pisar a ~W) van al `header`. La unidad de profundidad se toma de la primera
 *   curva (o de STRT) y la conversión a metros la hace buildWell.
 */
import type { HeaderEntry } from '../core/well';
import { parseUnit } from '../core/units';
import { stripBom } from './csv';
import { isDepthName, type RawColumn, type RawTable } from './table';

interface LasLine {
  mnemonic: string;
  unit: string;
  data: string;
  description: string;
}

/** Separa "MNEM.UNIT   DATA : DESCRIPCIÓN". En ~C la descripción empieza en el primer ":"; en el resto, en el último. */
function parseLasLine(line: string, firstColon: boolean): LasLine | null {
  const dot = line.indexOf('.');
  if (dot < 0) return null;
  const mnemonic = line.slice(0, dot).trim();
  // Un ":" antes del punto solo es válido como sufijo numérico del mnemónico (GR:1); si no, es una línea de texto.
  if (mnemonic === '' || (mnemonic.includes(':') && !/^[^:]+:\d+$/.test(mnemonic))) return null;
  const rest = line.slice(dot + 1);
  const unit = /^[^\s:]*/.exec(rest)![0];
  const remainder = rest.slice(unit.length);
  const colon = firstColon ? remainder.indexOf(':') : remainder.lastIndexOf(':');
  if (colon < 0) return { mnemonic, unit, data: remainder.trim(), description: '' };
  return { mnemonic, unit, data: remainder.slice(0, colon).trim(), description: remainder.slice(colon + 1).trim() };
}

const NUMERIC_KEYS = new Set(['STRT', 'STOP', 'STEP', 'NULL']);

function headerEntry(l: LasLine): HeaderEntry {
  const unit = l.unit ? parseUnit(l.unit) : null;
  const asNumber = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(l.data) ? Number(l.data) : null;
  const useNumber = asNumber !== null && (unit !== null || NUMERIC_KEYS.has(l.mnemonic.toUpperCase()));
  return {
    value: useNumber ? asNumber! : l.data,
    ...(unit ? { unit } : {}),
    ...(l.description ? { description: l.description } : {}),
  };
}

export function looksLikeLas(text: string): boolean {
  return /^\s*~\s*V/im.test(text) && /^\s*~\s*A/im.test(text);
}

export function parseLas(text: string, sourceName: string): RawTable {
  const clean = stripBom(text);
  if (clean.trim() === '') throw new Error('El archivo está vacío.');
  const lines = clean.split(/\r\n|\n|\r/);

  const warnings: string[] = [];
  const header: Record<string, HeaderEntry> = {};
  const params: Record<string, HeaderEntry> = {};
  const curveDefs: LasLine[] = [];
  const version: Record<string, string> = {};
  let nullValue = -999.25;
  let strtUnit = '';
  let section = '';
  let dataStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    if (line.startsWith('~')) {
      section = (line[1] ?? '').toUpperCase();
      if (section === 'A') {
        dataStart = i + 1;
        break;
      }
      continue;
    }
    const first = section === 'C';
    if (section === 'V') {
      const l = parseLasLine(line, false);
      if (l) version[l.mnemonic.toUpperCase()] = l.data;
    } else if (section === 'W') {
      const l = parseLasLine(line, false);
      if (!l) continue;
      const key = l.mnemonic.toUpperCase();
      if (key === 'NULL') {
        const v = Number(l.data);
        if (Number.isFinite(v)) nullValue = v;
        else warnings.push(`El valor NULL del encabezado ('${l.data}') no es un número; se usa ${nullValue}.`);
        continue;
      }
      if (key === 'STRT') strtUnit = l.unit;
      header[key] = headerEntry(l);
    } else if (section === 'C') {
      const l = parseLasLine(line, first);
      if (l) curveDefs.push(l);
    } else if (section === 'P') {
      const l = parseLasLine(line, false);
      if (l) params[l.mnemonic.toUpperCase()] = headerEntry(l);
    }
  }

  const vers = (version['VERS'] ?? '').trim();
  if (/^3/.test(vers)) {
    throw new Error(`El archivo es LAS ${vers}: solo se admite LAS 2.0 (y 1.2).`);
  }
  if (dataStart < 0) {
    throw new Error('El archivo LAS no tiene sección de datos (~A).');
  }
  if (curveDefs.length === 0) {
    throw new Error('El archivo LAS no define curvas (falta la sección ~C): no se encontró la profundidad.');
  }
  for (const [k, v] of Object.entries(params)) if (!(k in header)) header[k] = v;

  const wrap = (version['WRAP'] ?? 'NO').trim().toUpperCase().startsWith('Y');
  const nCurves = curveDefs.length;

  // Valores en una sola lista; en WRAP=NO además se controla el ancho de cada línea.
  const values: number[] = [];
  const rowStartLine: number[] = [];
  let badTokens = 0;
  let pending = 0; // WRAP=YES: valores acumulados de la muestra en curso
  for (let i = dataStart; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === '' || line.startsWith('#')) continue;
    if (line.startsWith('~')) break; // otra sección tras los datos
    const tokens = line.split(/[\s,]+/).filter((t) => t !== '');
    if (!wrap && tokens.length !== nCurves) {
      throw new Error(
        `Fila de datos en la línea ${i + 1}: se esperaban ${nCurves} valores (uno por curva de ~C) y hay ${tokens.length}.`,
      );
    }
    if (wrap && pending === 0) rowStartLine.push(i + 1);
    if (!wrap) rowStartLine.push(i + 1);
    for (const t of tokens) {
      let v = Number(t);
      if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(t)) {
        v = NaN;
        badTokens++;
      } else if (v === nullValue) v = NaN;
      values.push(v);
    }
    if (wrap) {
      pending += tokens.length;
      if (pending > nCurves) {
        throw new Error(`Con WRAP=YES, la muestra que empieza en la línea ${rowStartLine[rowStartLine.length - 1]} tiene más de ${nCurves} valores.`);
      }
      if (pending === nCurves) pending = 0;
    }
  }
  if (wrap && pending !== 0) {
    throw new Error(`Con WRAP=YES, la última muestra está incompleta (${pending} de ${nCurves} valores).`);
  }
  if (badTokens > 0) warnings.push(`${badTokens} valores de la sección ~A no son numéricos; se toman como sin dato.`);

  const n = values.length / nCurves;
  if (n === 0) throw new Error('La sección ~A no tiene filas de datos.');

  const columns: RawColumn[] = curveDefs.map((def, c) => {
    const numbers = new Float64Array(n);
    for (let i = 0; i < n; i++) numbers[i] = values[i * nCurves + c]!;
    return {
      name: def.mnemonic,
      unit: def.unit,
      ...(def.description ? { description: def.description } : {}),
      kind: 'numeric',
      numbers,
      text: null,
    };
  });

  // La profundidad es la primera curva; si no trae unidad, la de STRT.
  const depthCol = columns[0]!;
  if (depthCol.unit === '' && strtUnit !== '') depthCol.unit = strtUnit;
  if (!isDepthName(depthCol.name)) {
    warnings.push(`La primera curva ('${depthCol.name}') no se llama como una profundidad (DEPT, DEPTH, MD...): se usa como tal.`);
  }

  const sourceRows = new Int32Array(n);
  for (let i = 0; i < n; i++) sourceRows[i] = rowStartLine[i] ?? 0;

  return {
    format: 'las',
    sourceName,
    header,
    columns,
    depthColumn: 0,
    rowCount: n,
    sourceRows,
    nullValue,
    warnings,
  };
}
