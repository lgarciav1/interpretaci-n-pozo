/** Escritor CSV: coma como separador, punto decimal, encabezado `NOMBRE (unidad)`, NaN vacío o un valor. */
import { numText, prepareExport } from './prepare';
import type { ExportInput, ExportSummary } from './types';

const head = (name: string, unit: string) => (unit ? `${name} (${unit})` : name);

/** Celda de texto: entre comillas si trae coma, comillas o saltos de línea. */
export function csvCell(text: string): string {
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function writeCsv(input: ExportInput): string {
  const p = prepareExport(input, 'DEPTH');
  const rows: string[] = [[head('DEPTH', p.depthUnit), ...p.columns.map((c) => head(c.name, c.unit))].map(csvCell).join(',')];
  const nul = p.nullValue === null ? '' : numText(p.nullValue);
  for (let i = 0; i < p.depth.length; i++) {
    let row = numText(p.depth[i]!);
    for (const c of p.columns) {
      const v = c.values[i]!;
      row += ',' + (Number.isNaN(v) ? nul : numText(v));
    }
    rows.push(row);
  }
  return rows.join('\n') + '\n';
}

/** Sumario por zona en CSV (valores tal como los calcula el módulo; sin dato = vacío o el valor de nulos). */
export function writeSummaryCsv(summary: ExportSummary, nullValue: number | null = null): string {
  const nul = nullValue === null ? '' : numText(nullValue);
  const rows = [summary.columns.map((c) => csvCell(summaryHeader(c))).join(',')];
  for (const r of summary.rows) {
    rows.push(
      summary.columns
        .map((c) => {
          const v = r[c.key];
          if (typeof v === 'number') return Number.isFinite(v) ? numText(v) : nul;
          return v == null ? nul : csvCell(v);
        })
        .join(','),
    );
  }
  return rows.join('\n') + '\n';
}

/** Rótulo de columna con su unidad, salvo que el rótulo ya la traiga entre paréntesis. */
export function summaryHeader(c: { label: string; unit?: string }): string {
  const unit = c.unit && c.unit !== 'unitless' ? c.unit : '';
  return unit && !c.label.includes('(') ? `${c.label} (${unit})` : c.label;
}
