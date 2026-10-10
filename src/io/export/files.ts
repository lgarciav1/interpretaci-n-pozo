/** Arma el archivo a descargar: un formato, con el sumario incluido (hoja de Excel, o CSV aparte dentro de un zip). */
import { strToU8, zipSync } from 'fflate';
import { writeSummaryCsv, writeCsv } from './csv';
import { writeLas } from './las';
import { writeXlsx } from './xlsx';
import type { ExportInput } from './types';

export type ExportFormat = 'las' | 'csv' | 'xlsx';

export interface ExportFile {
  /** Nombre con extensión. */
  name: string;
  mime: string;
  bytes: Uint8Array;
}

export const FORMAT_LABEL: Record<ExportFormat, string> = { las: 'LAS 2.0', csv: 'CSV', xlsx: 'Excel (.xlsx)' };

/** Nombre de archivo seguro (sin separadores de ruta ni caracteres reservados). */
export function safeFileName(text: string, fallback = 'pozo'): string {
  const s = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[^\w.\-]+/g, '_')
    .replace(/^[_.]+|[_]+$/g, '');
  return s === '' ? fallback : s;
}

/**
 * `input.summary` presente = incluir el sumario. En LAS y CSV el sumario es un CSV aparte y los dos archivos van
 * en un .zip (el navegador pide permiso para varias descargas seguidas); en Excel es la hoja «Sumario».
 */
export function buildExportFile(format: ExportFormat, baseName: string, input: ExportInput): ExportFile {
  const base = safeFileName(baseName);
  if (format === 'xlsx') {
    return { name: `${base}.xlsx`, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes: writeXlsx(input) };
  }
  const main = format === 'las' ? writeLas(input) : writeCsv(input);
  const mainName = `${base}.${format}`;
  const mainMime = format === 'las' ? 'text/plain' : 'text/csv';
  if (!input.summary) return { name: mainName, mime: `${mainMime};charset=utf-8`, bytes: strToU8(main) };
  const summary = writeSummaryCsv(input.summary, input.nullValue ?? null);
  return {
    name: `${base}.zip`,
    mime: 'application/zip',
    bytes: zipSync({ [mainName]: strToU8(main), [`${base}_sumario.csv`]: strToU8('﻿' + summary) }),
  };
}
