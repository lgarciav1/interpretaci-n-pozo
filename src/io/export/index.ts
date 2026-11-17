/**
 * Exportación de datos del pozo (fase 6c-1): LAS 2.0, CSV y Excel, más el sumario por zona.
 * Escritores puros; la descarga vive en `src/app/export/`. Ver docs/decisiones/0011-exportacion-de-datos.md.
 */
export { writeLas } from './las';
export { buildExportFile, FORMAT_LABEL, safeFileName } from './files';
export type { ExportFile, ExportFormat } from './files';
export { summaryHeader, writeCsv, writeSummaryCsv } from './csv';
export { writeWorkbook, writeXlsx } from './xlsx';
export type { XlsxCell, XlsxSheet } from './xlsx';
export { buildExportColumns, countAlternatives, extractSummary } from './columns';
export type { BuildColumnsOptions, ExportOutput } from './columns';
export { LAS_NULL, prepareExport, sanitizeMnemonic, uniqueNames } from './prepare';
export type { DepthUnit, ExportColumn, ExportInput, ExportSummary, ExportZone, PreparedExport, SummaryColumn } from './types';
