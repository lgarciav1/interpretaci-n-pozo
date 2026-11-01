import { effectiveWell } from '../preparation/data';
import { contextMatchesWell, engineDecisionKey, sameContext, wellInputKey } from '../../core/engine/context';
import { planPreparation } from '../../core/preparation/plan';
import { toEngineWell } from '../../core/engine/engine';
import { stageQualityCounts, alignmentQualityCounts, normalizationQualityCounts } from '../../core/preparation/quality';
import { NORMALIZATION_METHOD_LABEL, normalizationAnchorsList } from '../../core/preparation/normalization';
import type { ClientResult } from '../../core/engine/client';
import type { Interpretation } from '../../core/interpretation';
import type { TableCell, TableColumn, TableValue } from '../../core/module';
import { resolveModuleParams, type ParamSpec, type ParamValue } from '../../core/params';
import type { Registry } from '../../core/registry';
import { unitLabel } from '../../core/units';
import type { Well } from '../../core/well';
import { registry } from '../../modules';
import { runQc } from '../../io/qc';
import type { AcquisitionMetadata } from '../../core/inputs/acquisition';
import { buildPreparationReport, preparationReportHtml, type PreparationReport } from './preparationReport';

export interface ReportOptions {
  title: string; author: string;
  includeParameters: boolean; includeSummary: boolean; includeVolumes: boolean; includeWarnings: boolean;
  includePreparation?: boolean;
  profile: 'none' | 'well' | 'zones'; trackIds: readonly string[] | null; xyIds: readonly string[];
}
export const defaultReportOptions = (): ReportOptions => ({ title: '', author: '', includeParameters: true, includeSummary: true, includeVolumes: true, includeWarnings: true, includePreparation: true, profile: 'well', trackIds: null, xyIds: [] });
export interface ReportTable { title: string; columns: readonly TableColumn[]; rows: Record<string, TableCell>[] }
export interface ReportModel {
  wellName: string; date: string; samples: number; top: number; base: number;
  header: { label: string; value: string }[];
  zones: { id: string; name: string; top: number; base: number; kind: string }[];
  methods: { port: string; source: string }[];
  parameters: { module: string; status: string; rows: { label: string; global: string; zones: string[] }[] }[];
  summary: ReportTable | null; volumes: ReportTable | null; warnings: string[];
  preparation?: PreparationReport;
}
export interface ReportFigure { title: string; dataUrl: string; caption: string }
const number = (v: number) => Number.isFinite(v) ? v.toLocaleString('es-AR', { maximumSignificantDigits: 6 }) : '—';
function paramText(spec: ParamSpec, value: ParamValue): string {
  if (spec.type === 'enum') return spec.options.find((o) => o.value === value)?.label ?? String(value);
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  const unit = spec.type === 'number' && spec.unit && spec.unit !== 'unitless' ? unitLabel(spec.unit) : '';
  return `${typeof value === 'number' ? number(value) : value}${unit ? ` ${unit}` : ''}`;
}
/** Copia los textos y tablas de una corrida; no calcula petrofísica ni conserva arrays del motor. */
export function buildReportModel(well: Well, interpretation: Interpretation, result: ClientResult | null, date = new Date(), catalog: Registry = registry, acquisition?: AcquisitionMetadata): ReportModel {
  const originals = well;
  if (result?.preparation) {
    try { if (!sameContext(result.context, planPreparation(toEngineWell(well), interpretation, result.context.inputRevisionId, catalog, result.preparation.plan.bindings).context)) result = null; }
    catch { result = null; }
  } else if (interpretation.preparation?.nodes.length) result = null;
  well = effectiveWell(well, result);
  if(result && (!contextMatchesWell(result.context,{id:well.id,depth:well.depth.values,curves:well.curves}) || result.context.engineKey !== wellInputKey({id:well.id,depth:well.depth.values,curves:well.curves}) + '|' + engineDecisionKey(interpretation)))result=null;
  const current = result?.wellId === well.id ? result : null;
  const zones = interpretation.zones.map(({ id, name, top, base, kind }) => ({ id, name, top, base, kind }));
  const table = (port: string): ReportTable | null => {
    const out = current?.outputs.find((o) => o.port === port && o.kind === 'table' && o.active);
    if (!out) return null;
    const spec = Object.values(catalog.get(out.moduleId)?.outputs ?? {}).find((s) => s.kind === 'table' && s.port === port);
    if (!spec || spec.kind !== 'table') return null;
    return { title: spec.label, columns: spec.columns.map((c) => ({ ...c })), rows: (out.value as TableValue).rows.map((r) => ({ ...r })) };
  };
  const warnings = current?.diagnostics.map((d) => `${d.level === 'error' ? 'Error' : d.level === 'warning' ? 'Advertencia' : 'Información'}${d.moduleId ? ` · ${catalog.get(d.moduleId)?.name ?? d.moduleId}` : ''}: ${d.message}`) ?? ['No hay resultados vigentes para este pozo.'];
  const qc = runQc(originals, { roles: catalog.roles });
  for (const p of current?.preparation?.artifacts ?? []) {
    const a = current!.preparation!.plan.artifacts.find(a => a.id === p.id)!;
    if (a.mgt) { warnings.push(`Corrección ambiental MGT: ${JSON.stringify(a.correctionLedger)}. ${p.quality.reduce((n,q) => n + (q === 64 ? 1 : 0),0)} muestras corregidas; ${p.quality.reduce((n,q) => n + (q === 128 ? 1 : 0),0)} fuera de dominio o sin caliper. No certifica resultados del TP ni equivalencia con otra herramienta.`); continue; }
    const counts = stageQualityCounts(p.quality);
    if (a.normalization && p.normalization) {
      const n = a.normalization.config, s = p.normalization, unit = unitLabel(a.unit);
      const pairs = normalizationAnchorsList(n, s).map((x) => `P${number(x.percentile)} de origen ${number(x.source)} → ${number(x.reference)} ${unit}`).join('; ');
      warnings.push(`Normalización ${NORMALIZATION_METHOD_LABEL[n.method]} · ${a.mnemonic}: ${pairs}; intervalo de referencia ${number(n.top)}–${number(n.base)} m MD con ${s.samples} muestras de origen (finitas, sin excluidas ni estimadas); ganancia ${number(s.gain)}. Se aplica a toda la curva después de las demás etapas; ${normalizationQualityCounts(p.quality).normalized} muestras normalizadas (bit 256)${s.outOfDomain ? `; ${s.outOfDomain} quedan fuera del dominio físico del rol y se conservan marcadas (bit 128)` : ''}. Los valores de referencia los ingresó el usuario; no es una normalización entre pozos.`);
    }
    if (a.shift) {
      const shifted = alignmentQualityCounts(p.data, p.quality);
      warnings.push(`Alineación manual constante · ${a.mnemonic}: ${a.shift.offsetM > 0 ? '+' : ''}${number(a.shift.offsetM)} m; referencia MD ${a.shift.referenceId}, datum declarado ${a.shift.datum}; hueco máximo ${number(a.shift.maxGapM)} m. ${shifted.finite} salidas finitas, ${shifted.unsupported} sin soporte, ${shifted.missing} faltantes trasladados; ${shifted.estimatedSupport} salidas con soporte estimado. Remuestreo lineal sin extrapolación, después de las etapas previas. Bits 32=alineada, 128=sin soporte; los demás flags proceden del soporte de origen. Antes de alinear: ${p.sourceCounts!.interpolated} muestras interpoladas y ${p.sourceCounts!.filtered} filtradas. No mueve otras curvas ni laboratorio, no convierte datum/MD/TVD y no valida la correlación geológica. Los originales se conservan.`);
      if (a.ranges.length) warnings.push(`Antes de alinear · exclusiones en MD de origen: ${a.ranges.map(r => `${number(r.top)}–${number(r.base)} m`).join(', ')}.`);
      if (a.gapFill) warnings.push(`Antes de alinear · interpolación lineal: tramo ${number(a.gapFill.top)}–${number(a.gapFill.base)} m MD de origen; máximo entre anclajes ${number(a.gapFill.maxGapM)} m.`);
      if (a.filter) warnings.push(`Antes de alinear · mediana física: tramo ${number(a.filter.top)}–${number(a.filter.base)} m MD de origen; radio ${number(a.filter.radiusM)} m; separación máxima ${number(a.filter.maxStepM)} m.`);
      continue;
    }
    if (a.gapFill) warnings.push(`Interpolación lineal en MD · ${a.mnemonic}: ${counts.interpolated} muestras estimadas; tramo ${number(a.gapFill.top)}–${number(a.gapFill.base)} m; distancia máxima entre anclajes ${number(a.gapFill.maxGapM)} m. Calidad 9 = faltante original + interpolada. No extrapola, no cruza fronteras de zona ni rellena exclusiones; los valores estimados no son mediciones.`);
    if (a.filter) warnings.push(`Mediana móvil en valores lineales · ${a.mnemonic}: ${counts.filtered} muestras filtradas; radio ${number(a.filter.radiusM)} m MD; tramo ${number(a.filter.top)}–${number(a.filter.base)} m; separación máxima ${number(a.filter.maxStepM)} m. Se aplica después de la interpolación si existe; ${counts.estimatedInfluence} centros medidos reciben influencia de estimaciones. Conserva bordes sin soporte completo, faltantes y exclusiones; no cruza zonas. QC 16=filtrada, 24=filtrada con contribuyentes interpolados, 25=faltante original interpolado y filtrado.`);
    const exclusions = a.ranges.length ? `Intervalos MD con extremos incluidos: ${a.ranges.map(r => `${number(r.top)}–${number(r.base)} m`).join(', ')}.` : 'Sin exclusiones por intervalo.';
    warnings.push(`Preparación · ${a.mnemonic}: ${counts.newlyExcluded} mediciones excluidas; ${counts.originallyMissing} faltantes originales. ${exclusions} Los originales se conservan; el control de calidad describe las mediciones originales.`);
  }
  warnings.push(`Control de calidad de registros: ${qc.status === 'ok' ? 'sin alertas relevantes' : qc.status === 'bad' ? 'datos con problemas importantes' : 'hay advertencias'}.`);
  for (const curve of qc.curves) for (const reason of curve.reasons) warnings.push(`Calidad · ${curve.mnemonic}: ${reason.message}`);
  if (!qc.borehole) warnings.push('Sin caliper asignado: no se puede evaluar el estado del pozo ni los posibles errores de contacto de las herramientas de patín.');
  else if (qc.borehole.washoutSamples || qc.borehole.invalidCaliperSamples) warnings.push(`Estado del pozo: ${number(qc.borehole.washoutThicknessM)} m con derrumbe y ${number(qc.borehole.invalidCaliperThicknessM)} m con caliper inválido. Revisar las curvas de patín: ${qc.borehole.affectedCurveIds.join(', ') || 'sin curvas asignadas'}.`);
  const parameters: ReportModel['parameters'] = [];
  for (const node of current?.nodes ?? []) {
    const mod = catalog.get(node.moduleId);
    if (!mod) continue;
    const resolved = resolveModuleParams(mod.id, mod.params, interpretation.params, zones.map((z) => z.id));
    warnings.push(...resolved.problems);
    const status = { ok: 'Calculado', error: 'Error de cálculo', 'missing-input': 'Faltan datos de entrada', cycle: 'Dependencias circulares', blocked: 'Bloqueado por una dependencia' }[node.status];
    parameters.push({ module: mod.name, status: `${node.reason === 'compare' ? 'Comparación' : node.reason === 'dependency' ? 'Dependencia' : 'Cadena principal'} · ${status}`, rows: Object.entries(mod.params).map(([key, spec]) => ({ label: spec.label, global: paramText(spec, resolved.global[key]!), zones: zones.map((z) => paramText(spec, resolved.byZone.get(z.id)![key]!)) })) });
  }
  if (current?.nodes.some((n) => n.reason === 'compare')) warnings.push('Los métodos de comparación no alimentan el sumario ni el volumen; esos resultados usan las fuentes de la cadena principal.');
  warnings.push('Profundidad medida (MD), en metros. Los valores faltantes se indican con —; no representan cero.', 'Los volúmenes son estimaciones in situ, no reservas recuperables. Dependen del área, del fluido, del factor de volumen y de los cutoffs adoptados.', 'La interpretación depende de la calidad de los registros y de los modelos elegidos. Revisar los intervalos sin datos y la calibración con información independiente.');
  warnings.push('Los totales de volumen suman solo las zonas con volumen disponible. Un total finito no implica que todas las zonas tengan datos; revisar cada fila.', 'El sumario excluye las muestras fuera de las zonas definidas; informa los espesores sin datos de clasificación y sin Sw para pay.');
  const consumed = new Set((current?.nodes ?? []).filter((n) => n.status === 'ok' && n.reason !== 'compare').flatMap((n) => Object.values(catalog.get(n.moduleId)?.inputs ?? {}).map((input) => input.kind === 'curve' ? input.role : input.port)));
  const methods = Object.entries(current?.sources ?? {}).filter(([port, s]) => s.kind === 'curve' ? consumed.has(port) : current?.outputs.some((o) => o.moduleId === s.moduleId && o.port === port && o.active && (o.kind === 'curve' || port === 'ZONE_SUMMARY' || port === 'VOLUMETRICS'))).map(([port, s]) => ({ port, source: s.kind === 'module' ? catalog.get(s.moduleId)?.name ?? s.moduleId : well.curves.find((c) => c.id === s.curveId)?.mnemonic ?? s.curveId }));
  return { wellName: well.name, date: date.toLocaleString('es-AR'), samples: well.depth.values.length, top: well.depth.values[0] ?? NaN, base: well.depth.values[well.depth.values.length - 1] ?? NaN,
    header: Object.entries(well.header).map(([label, h]) => ({ label, value: `${h.value}${h.unit ? ` ${unitLabel(h.unit)}` : ''}` })), zones,
    methods, parameters, summary: table('ZONE_SUMMARY'), volumes: table('VOLUMETRICS'), warnings: [...new Set(warnings)],
    preparation: buildPreparationReport(originals, interpretation, current?.context.inputRevisionId ?? null, catalog, acquisition, current?.preparation ?? null) };
}
export const escapeReportText = (s: unknown): string => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const e = escapeReportText;
const cell = (v: TableCell | undefined) => e(typeof v === 'number' ? number(v) : v ?? '—');
function dataTable(t: ReportTable | null, title: string): string {
  if (!t || t.rows.length === 0) return `<section><h2>${e(title)}</h2><p>Sin resultados disponibles en esta corrida.</p></section>`;
  const groups: TableColumn[][] = [];
  for (let i = 1; i < t.columns.length; i += 6) groups.push([t.columns[0]!, ...t.columns.slice(i, i + 6)]);
  if (t.columns.length === 1) groups.push([t.columns[0]!]);
  return `<section><h2>${e(t.title)}</h2>${groups.map((columns, i) => `<div class="table-wrap">${groups.length > 1 ? `<p class="meta">Parte ${i + 1} de ${groups.length}</p>` : ''}<table><thead><tr>${columns.map((c) => `<th>${e(c.label)}${c.unit ? `<small>${e(unitLabel(c.unit))}</small>` : ''}</th>`).join('')}</tr></thead><tbody>${t.rows.map((r) => `<tr>${columns.map((c) => `<td>${cell(r[c.key])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`).join('')}</section>`;
}
/** HTML autónomo: todo dato se escapa y las figuras admiten solo imágenes locales incrustadas. */
export function reportHtml(model: ReportModel, figures: readonly ReportFigure[] = [], options: ReportOptions = defaultReportOptions()): string {
  const title = options.title.trim() || `Informe de interpretación · ${model.wellName}`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(title)}</title><style>
  *{box-sizing:border-box}body{margin:0;background:#eceff3;color:#162235;font:14px Arial,sans-serif;line-height:1.5}.toolbar{position:sticky;top:0;background:#162235;color:white;padding:12px 24px;display:flex;gap:16px;align-items:center;z-index:1}.toolbar button{padding:9px 18px;border:0;border-radius:6px;background:white;color:#162235;cursor:pointer}main{max-width:1100px;margin:24px auto;padding:40px;background:white}h1{font-size:28px;line-height:1.2;margin:0 0 12px}h2{font-size:19px;margin:30px 0 12px;border-bottom:2px solid #dce3eb;padding-bottom:8px}h3{margin:18px 0 8px;font-size:15px}p{margin:8px 0}small{display:block;color:#59667a;font-size:10px}table{border-collapse:collapse;width:100%;font-size:11px;margin:12px 0}th,td{border-bottom:1px solid #dce3eb;padding:7px 6px;text-align:right;vertical-align:top}th{background:#eef2f7;color:#243b58}th:first-child,td:first-child{text-align:left}thead{display:table-header-group}tr{break-inside:avoid}.meta{color:#59667a}.figure{break-before:page;page-break-before:always}.figure img{display:block;max-width:100%;max-height:235mm;margin:auto}figcaption{font-size:12px;color:#59667a;margin-top:10px}.table-wrap{overflow:auto}footer{border-top:1px solid #dce3eb;margin-top:28px;padding-top:12px;font-size:11px;color:#59667a}@page{size:A4 landscape;margin:14mm}@media print{body{background:white;font-size:11px}.toolbar{display:none}main{margin:0;padding:0;max-width:none}h2,h3{break-after:avoid}.table-wrap{overflow:visible}.figure img{max-height:145mm}footer{font-size:9px}}
  </style></head><body><div class="toolbar"><button type="button" onclick="window.print()">Imprimir / Guardar como PDF</button><span>Elegí «Guardar como PDF» en el destino de impresión. A4 horizontal recomendado.</span></div><main><header><h1>${e(title)}</h1><p class="meta">${e(model.wellName)} · ${e(model.date)}${options.author.trim() ? ` · ${e(options.author.trim())}` : ''}</p><p>${number(model.samples)} muestras · ${number(model.top)}–${number(model.base)} m MD</p></header>
  <section><h2>Encabezado del pozo</h2>${model.header.length ? `<table><tbody>${model.header.map((h) => `<tr><th>${e(h.label)}</th><td>${e(h.value)}</td></tr>`).join('')}</tbody></table>` : '<p>Sin metadatos de encabezado.</p>'}</section>
  <section><h2>Zonas interpretadas</h2>${model.zones.length ? `<table><thead><tr><th>Zona</th><th>Tope (m MD)</th><th>Base (m MD)</th><th>Tipo</th></tr></thead><tbody>${model.zones.map((z) => `<tr><td>${e(z.name)}</td><td>${number(z.top)}</td><td>${number(z.base)}</td><td>${e(({ formation: 'Formación', reservoir: 'Reservorio', seal: 'Sello', other: 'Otra' } as Record<string, string>)[z.kind] ?? z.kind)}</td></tr>`).join('')}</tbody></table>` : '<p>No se definieron zonas.</p>'}</section>
  ${options.includeParameters ? `<section><h2>Métodos y parámetros efectivos</h2><p>Fuentes que alimentan la cadena de cálculo:</p><table><thead><tr><th>Puerto</th><th>Fuente elegida</th></tr></thead><tbody>${model.methods.map((m) => `<tr><td>${e(m.port)}</td><td>${e(m.source)}</td></tr>`).join('')}</tbody></table><p>Las columnas de zona incluyen el valor global heredado cuando no existe una modificación local.</p>${model.parameters.map((p) => `<h3>${e(p.module)}</h3><p class="meta">${e(p.status)}</p>${p.rows.length ? `<table><thead><tr><th>Parámetro</th><th>Global</th>${model.zones.map((z) => `<th>${e(z.name)}</th>`).join('')}</tr></thead><tbody>${p.rows.map((r) => `<tr><td>${e(r.label)}</td><td>${e(r.global)}</td>${r.zones.map((v) => `<td>${e(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '<p>Sin parámetros configurables.</p>'}`).join('')}</section>` : ''}
  ${options.includeSummary ? dataTable(model.summary, 'Sumario por zona') : ''}${options.includeVolumes ? dataTable(model.volumes, 'Volumen in situ por zona') : ''}
  ${options.includePreparation !== false && model.preparation ? preparationReportHtml(model.preparation, e) : ''}
  ${options.includeWarnings ? `<section><h2>Advertencias y limitaciones</h2><ul>${model.warnings.map((w) => `<li>${e(w)}</li>`).join('')}</ul></section>` : ''}
  ${figures.map((f) => { if (!/^data:image\/(?:png|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(f.dataUrl)) throw new Error('La figura del informe debe ser una imagen incrustada.'); return `<section class="figure"><h2>${e(f.title)}</h2><figure><img src="${f.dataUrl}" alt="${e(f.title)}"><figcaption>${e(f.caption)}</figcaption></figure></section>`; }).join('')}<footer>Interpretación de registros de pozo · FIUBA · Copia del estado al generar el informe. No se recalcula al abrirlo.</footer></main></body></html>`;
}

