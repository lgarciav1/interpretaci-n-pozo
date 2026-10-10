/**
 * Lectura de datos de pozo (fase 2). API pública de src/io.
 *
 * Dos etapas, para que la interfaz pueda mostrar un asistente de columnas entre ellas:
 *   parseTable(archivo, nombre)            → RawTable (columnas con nombre, unidad y datos)
 *   buildWell(tabla, mapeo, opciones)      → { well, zones, columns, warnings }
 * `readWellFile` hace las dos con el mapeo sugerido. Todo es puro: corre en Node, navegador y worker.
 */
import { looksLikeLas, parseLas } from './las';
import { parseCsv, type CsvOptions } from './csv';
import { parseXlsx, type XlsxOptions } from './xlsx';
import { buildWell, type BuildOptions, type BuildResult } from './build';
import type { RawTable, SourceFormat } from './table';

export type { RawColumn, RawTable, SourceFormat } from './table';
export { NULL_NUMBERS } from './table';
export { buildWell, suggestMapping } from './build';
export type { BuildOptions, BuildResult, ColumnKind, ColumnMapping } from './build';
export { normalizeMnemonic, resolveUnit, suggestRole } from './mnemonics';
export type { Confidence, RoleSuggestion } from './mnemonics';
export { listXlsxSheets, parseXlsx } from './xlsx';
export { parseLas } from './las';
export { parseCsv } from './csv';
export {
  buildPressureSet,
  MOBILITY_UNIT,
  normalizeColumnName,
  PRESSURE_COLUMNS,
  PRESSURE_FIELD_DIMENSION,
  PRESSURE_FIELD_LABEL,
  PRESSURE_SET_KIND,
  PRESSURE_UNIT,
  suggestPressureMapping,
} from './pressures';
export type { BuildPressureOptions, BuildPressureResult, PressureColumnMapping, PressureField } from './pressures';
export { buildCoreSet, CORE_COLUMNS, CORE_FIELD_DIMENSION, CORE_FIELD_LABEL, CORE_SET_KIND, CORE_UNITS, coreFieldUnit, suggestCoreMapping } from './core';
export type { BuildCoreOptions, BuildCoreResult, CoreColumnMapping, CoreField } from './core';
export { getCurveQc, PAD_ROLES, PHYSICAL_RANGES, QC_DEFAULTS, QC_FLAGS, runQc, unreliableMask } from './qc';
export type {
  BoreholeInterval,
  BoreholeIssue,
  BoreholeQc,
  ConstantRun,
  CurveQc,
  CurveStats,
  PhysicalRange,
  QcOptions,
  QcReason,
  QcReasonCode,
  QcReport,
  QcSeverity,
  QcStatus,
} from './qc';

/** Contenido de un archivo: bytes (lo que entrega `File.arrayBuffer()`) o texto ya decodificado. */
export type FileInput = string | Uint8Array | ArrayBuffer;

/** `requireDepth: false` para tablas que no son perfiles (presiones, plugs): ver `TableContext.requireDepth`. */
export interface ParseOptions extends CsvOptions, XlsxOptions {
  /** Fuerza el formato (por defecto se detecta por contenido y extensión). */
  format?: SourceFormat;
}

export type ReadOptions = ParseOptions & BuildOptions;

function toBytes(input: Exclude<FileInput, string>): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

/** Decodifica texto: UTF-8 y, si hay bytes inválidos, Windows-1252 (archivos viejos con tildes). */
function decodeText(input: FileInput): string {
  if (typeof input === 'string') return input;
  const bytes = toBytes(input);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

/** Detecta el formato por firma (zip = xlsx), contenido (~V ... ~A = LAS) y, por último, extensión. */
export function detectFormat(input: FileInput, fileName: string): SourceFormat {
  if (typeof input !== 'string') {
    const b = toBytes(input);
    if (b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04) return 'xlsx';
  }
  const ext = (/\.([^.\\/]+)$/.exec(fileName)?.[1] ?? '').toLowerCase();
  if (ext === 'xlsx' || ext === 'xlsm') return 'xlsx';
  if (ext === 'las') return 'las';
  if (ext === 'csv' || ext === 'tsv') return 'csv';
  const head = typeof input === 'string' ? input.slice(0, 20000) : decodeText(toBytes(input).subarray(0, 20000));
  return looksLikeLas(head) ? 'las' : 'csv';
}

/** Etapa 1: lee el archivo a una tabla cruda. Lanza un Error en español si no se puede interpretar. */
export function parseTable(input: FileInput, fileName: string, options: ParseOptions = {}): RawTable {
  const format = options.format ?? detectFormat(input, fileName);
  if (typeof input !== 'string' && toBytes(input).length === 0) throw new Error('El archivo está vacío.');
  if (format === 'xlsx') {
    if (typeof input === 'string') throw new Error('Un archivo .xlsx debe entregarse como bytes, no como texto.');
    return parseXlsx(toBytes(input), fileName, options);
  }
  const text = decodeText(input);
  if (format === 'las') return parseLas(text, fileName);
  // Un .las sin extensión reconocible o un .txt con LAS adentro ya se detectaron arriba; el resto es CSV.
  return parseCsv(text, fileName, options);
}

/** Lee un archivo completo con el mapeo de columnas sugerido. */
export function readWellFile(input: FileInput, fileName: string, options: ReadOptions = {}): BuildResult {
  const table = parseTable(input, fileName, options);
  return buildWell(table, undefined, options);
}
export * from './export';
