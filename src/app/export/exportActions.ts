import { effectiveWell } from '../preparation/data';
import { entryContext } from '../preparation/data';
/**
 * Exportar datos del pozo: arma las columnas y el sumario desde el proyecto y el último resultado del motor, escribe el
 * archivo (src/io/export, puro) y lo descarga con el mismo patrón que `saveProject`. Sin React.
 *
 * Cada tipo de exportación es una entrada de `EXPORT_KINDS` con su propia función de armado: `data` (este archivo) y
 * `figure` (`figureActions.ts`, fase 6c-2). El diálogo elige el tipo.
 */
import { contextMatchesWell, sameContext, type EngineContext } from '../../core/engine/context';
import type { ClientResult } from '../../core/engine/client';
import type { Well, Zone } from '../../core/well';
import {
  buildExportColumns,
  buildExportFile,
  countAlternatives,
  extractSummary,
  type DepthUnit,
  type ExportColumn,
  type ExportFile,
  type ExportFormat,
  type ExportSummary,
  type SummaryColumn,
} from '../../io/export';
import { registry } from '../../modules';
import { selectDataCurves } from '../../core/preparation/projection';
import type { PreparedPayload } from '../../core/preparation/plan';
import { toast } from '../../ui';
import { selectActiveEntry, useProject } from '../store/project';
import { useResults } from '../store/results';

export const EXPORT_KINDS = [
  { id: 'data', label: 'Datos del pozo' },
  { id: 'figure', label: 'Figuras' },
  { id: 'report', label: 'Informe' },
] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number]['id'];

/** Columnas del sumario por zona declaradas por el módulo `zone-summary`. */
function summaryColumns(): readonly SummaryColumn[] {
  const spec = Object.values(registry.get('zone-summary')?.outputs ?? {}).find((o) => o.kind === 'table');
  return spec && spec.kind === 'table' ? spec.columns : [];
}

export interface ExportSources {
  columns: ExportColumn[];
  alternatives: number;
  summary: ExportSummary | null;
}
const qualityColumns = new WeakMap<PreparedPayload, Float64Array>();

/** Lo que se puede exportar del pozo activo con el resultado vigente (el resultado de otro pozo no se usa). */
export function exportSources(well: Well, result: ClientResult | null, includeAlternatives: boolean, context?:EngineContext): ExportSources {
  if (context && !sameContext(result?.context, context)) result = null;
  well = effectiveWell(well, result);
  const outputs = result && contextMatchesWell(result.context,{id:well.id,depth:well.depth.values,curves:well.curves}) && (!context || sameContext(result.context,context)) ? result.outputs : null;
  const moduleName = (id: string) => registry.get(id)?.name ?? id;
  const eligible = result?.preparation ? new Set(selectDataCurves(well.curves, result.preparation.plan, registry.tools).eligible.map(c => c.id)) : null;
  const exportWell = eligible ? { ...well, curves: well.curves.filter(c => c.origin.kind !== 'prepared' || eligible.has(c.id)) } : well;
  const columns = buildExportColumns(exportWell, outputs, { includeAlternatives, moduleName });
  if (outputs && result?.preparation) for (const p of result.preparation.artifacts) {
    if (!eligible?.has(p.id)) continue;
    let data = qualityColumns.get(p);
    if (!data) { data = Float64Array.from(p.quality); qualityColumns.set(p, data); }
    const a = result.preparation.plan.artifacts.find(a => a.id === p.id)!;
    columns.push({ id: `q:${p.id}`, mnemonic: `${a.mnemonic}_QC`, unit: 'unitless', data, origin: 'prepared', description: 'Calidad de preparación: 0=conservada; 1=faltante original; 2=excluida; 3=faltante original y excluida' });
  }
  return {
    columns,
    alternatives: countAlternatives(well, outputs),
    summary: extractSummary(outputs, summaryColumns()),
  };
}

export interface DataExportRequest {
  format: ExportFormat;
  /** Ids de `ExportSources.columns`. */
  selection: readonly string[];
  zoneId: string | null;
  depthUnit: DepthUnit;
  nullValue: number | null;
  includeAlternatives: boolean;
  includeSummary: boolean;
}

/** Archivo de la exportación pedida (sin descargarlo: lo usan el diálogo y los tests). */
export function buildDataExport(well: Well, zones: readonly Zone[], result: ClientResult | null, req: DataExportRequest, context?:EngineContext): { file: ExportFile; samples: number } {
  const src = exportSources(well, result, req.includeAlternatives,context);
  if(req.selection.some(id=>!src.columns.some(c=>c.id===id)))throw new Error('Las curvas seleccionadas ya no están disponibles para este contexto. Esperá al cálculo actual y revisá la selección.');
  const zone = req.zoneId ? zones.find((z) => z.id === req.zoneId) : undefined;
  if (req.zoneId && !zone) throw new Error('La zona elegida ya no existe.');
  const file = buildExportFile(req.format, zone ? `${well.name}_${zone.name}` : well.name, {
    wellName: well.name,
    header: well.header,
    depth: well.depth.values,
    columns: src.columns,
    zones: zones.map((z) => ({ name: z.name, top: z.top, base: z.base, kind: z.kind })),
    ...(req.includeSummary && src.summary ? { summary: src.summary } : {}),
    selection: req.selection,
    ...(zone ? { range: { top: zone.top, base: zone.base } } : {}),
    depthUnit: req.depthUnit,
    nullValue: req.nullValue,
  });
  const samples = zone ? well.depth.values.filter((d) => d >= zone.top && d <= zone.base).length : well.depth.values.length;
  return { file, samples };
}

export function downloadFile(file: ExportFile): void {
  const url = URL.createObjectURL(new Blob([file.bytes as BlobPart], { type: file.mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportData(req: DataExportRequest): boolean {
  const entry = selectActiveEntry(useProject.getState());
  if (!entry) return false;
  try {
    const { file, samples } = buildDataExport(entry.well, entry.interpretation.zones, useResults.getState().result, req,entryContext(entry));
    downloadFile(file);
    toast({ title: 'Datos exportados', description: `${file.name} · ${samples.toLocaleString('es-AR')} muestras · ${(file.bytes.length / 1024).toLocaleString('es-AR', { maximumFractionDigits: 0 })} kB`, tone: 'ok' });
    return true;
  } catch (err) {
    toast({ title: 'No se pudo exportar', description: err instanceof Error ? err.message : String(err), tone: 'error' });
    return false;
  }
}

