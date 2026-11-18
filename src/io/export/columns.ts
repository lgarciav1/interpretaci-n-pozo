/** Armado de las columnas a exportar: curvas medidas del pozo + curvas calculadas del resultado del motor. */
import type { TableValue } from '../../core/module';
import type { Well } from '../../core/well';
import type { ExportColumn, ExportSummary, SummaryColumn } from './types';

/** Lo mínimo que se usa de `OutputRecord` (src/core/engine/engine.ts): así sirve el resultado del cliente o de un test. */
export interface ExportOutput {
  moduleId: string;
  port: string;
  kind: string;
  active: boolean;
  label: string;
  unit?: string;
  formula?: string;
  value: unknown;
}

export interface BuildColumnsOptions {
  /** Incluye también las alternativas (módulos que se calculan para comparar). Por defecto solo las activas. */
  includeAlternatives?: boolean;
  /** Nombre legible del módulo (para la descripción); por defecto, su id. */
  moduleName?: (moduleId: string) => string;
}

/**
 * Medidas primero (en el orden del pozo) y calculadas después (en el orden del motor). Una calculada alternativa
 * se llama `PUERTO_MODULO` para no pisar a la activa. Las calculadas de otro largo que la profundidad se omiten.
 * El `id` de cada columna es único (`m:<id>` / `c:<modulo>:<puerto>`).
 */
export function buildExportColumns(well: Well, outputs: readonly ExportOutput[] | null | undefined, options: BuildColumnsOptions = {}): ExportColumn[] {
  const out: ExportColumn[] = well.curves.map((c) => ({
    id: `m:${c.id}`,
    mnemonic: c.mnemonic || c.id,
    unit: c.unit,
    ...(c.origin.kind === 'prepared' ? { description: `Preparada${c.description ? ' · ' + c.description : ''}` } : c.description ? { description: c.description } : {}),
    data: c.data,
    origin: c.origin.kind === 'prepared' ? 'prepared' as const : 'measured' as const,
  }));
  const n = well.depth.values.length;
  const name = options.moduleName ?? ((id: string) => id);
  for (const o of outputs ?? []) {
    if (o.kind !== 'curve' || !(o.value instanceof Float64Array) || o.value.length !== n) continue;
    if (!o.active && !options.includeAlternatives) continue;
    out.push({
      id: `c:${o.moduleId}:${o.port}`,
      mnemonic: o.active ? o.port : `${o.port}_${o.moduleId}`,
      unit: o.unit ?? '',
      description: o.formula !== undefined ? `Fórmula: ${o.formula}` : `${o.label} · ${name(o.moduleId)}${o.active ? '' : ' (alternativa)'}`,
      data: o.value,
      origin: 'computed',
    });
  }
  return out;
}

/** Cuenta cuántas calculadas son alternativas (para el diálogo). */
export function countAlternatives(well: Well, outputs: readonly ExportOutput[] | null | undefined): number {
  const n = well.depth.values.length;
  return (outputs ?? []).filter((o) => o.kind === 'curve' && !o.active && o.value instanceof Float64Array && o.value.length === n).length;
}

/**
 * Tabla del sumario por zona publicada por el motor (módulo `zone-summary`, puerto `ZONE_SUMMARY`). `columns` son las
 * declaradas por el módulo (rótulos y unidades): el resultado no las trae. null si el motor todavía no la calculó.
 */
export function extractSummary(
  outputs: readonly ExportOutput[] | null | undefined,
  columns: readonly SummaryColumn[],
  ref: { moduleId: string; port: string } = { moduleId: 'zone-summary', port: 'ZONE_SUMMARY' },
): ExportSummary | null {
  const o = (outputs ?? []).find((x) => x.moduleId === ref.moduleId && x.port === ref.port && x.kind === 'table');
  const rows = (o?.value as TableValue | undefined)?.rows;
  if (!rows || rows.length === 0) return null;
  return { columns, rows };
}

