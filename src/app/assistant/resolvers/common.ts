/**
 * Utilidades compartidas de los resolvers del Asistente v2 (0094): puro, sin React ni stores.
 */
import type { ClientResult } from '../../../core/engine/client';
import { activeOutput } from '../../../core/engine/engine';
import type { ReadonlyTableValue } from '../../../core/module';
import { convertArray, sameDimension } from '../../../core/units';
import type { Row } from '../../../modules/well-reading/model';
import { formatNumber } from '../../../ui/format';
import { FRACTION_LIKE_CURVES, levenshtein, normalizeQuestion } from '../intents';
import type {
  Action,
  Answer,
  AssistantContext,
  AssistantTable,
  ContextZone,
  CurveRole,
  Intent,
} from '../types';

export const SUMMARY_SRC = 'Sumario por zona · ZONE_SUMMARY';
export const SWEEP_SRC = 'Sensibilidad a los cutoffs · CUTOFF_SWEEP';
export const SURFACE_SRC = 'Superficie 2D de cutoffs · G09';
export const VOLUMETRICS_SRC = 'Volumen in situ · VOLUMETRICS';
export const READING_SRC = 'Lectura automática del pozo · WELL_READING';
export const GENERAL_SRC = 'Lectura automática del pozo · WELL_READING_GENERAL';
export const DIAGNOSTICS_SRC = 'Diagnósticos del motor · Avisos';
export const CROSS_CHECK_SRC = 'Coherencia cruzada entre herramientas · G08';
export const MDT_SRC = 'Presiones MDT · G05';
export const FLOW_SRC = 'Capacidad de flujo y Lorenz · FLOW_SUMMARY / SMLP';
export const CGR_SRC = 'GR espectral sin uranio · CGR_CALIBRATION';
export const MOVABLE_SRC = 'Hidrocarburo móvil y residual · MOVABLE_SUMMARY';
export const MICP_SRC = 'Análisis MICP · Curvas capilares';
export const PAY_LAYERS_SRC = 'Capas de pay y punzados · PAY_INTERVALS';
export const UNCERTAINTY_SRC = 'Incertidumbre volumétrica · UNCERTAINTY';
export const CORE_SRC = 'Calibración con corona · Plugs y ρmaa';
export const PROVENANCE_SRC = 'Trazabilidad de muestra · Origen';
export const FILTER_SRC = 'Selección booleana sobre curvas del pozo';
export const SNAPSHOT_SRC = 'Diferencias de interpretación · Snapshots';
export const PREP_SRC = 'Preparación de datos · Plan vigente';
export const GRAPH_SRC = 'Grafo del motor y sarta de perfilaje';

export const FRACTION_ROLES: ReadonlySet<string> = FRACTION_LIKE_CURVES;

export function clientResultOf(context: AssistantContext): ClientResult | null {
  if (context.clientResult) return context.clientResult;
  const res = context.result as Partial<ClientResult> | null;
  if (res && Array.isArray(res.nodes) && res.context && Array.isArray(res.outputs)) {
    return res as ClientResult;
  }
  return null;
}

export const commandAction = (id: string, label: string): Action => ({ kind: 'command', id, label });
export const panelAction = (panelId: string, label: string): Action => ({ kind: 'panel', panelId, label });
export const depthAction = (depth: number, label: string, span?: { top: number; base: number }): Action => ({
  kind: 'depth',
  depth,
  ...(span ? { top: span.top, base: span.base } : {}),
  label,
});

export const summaryAction = commandAction('step:summary', 'Abrir Sumario');
export const cutoffAction = commandAction('step:cutoffs', 'Revisar cutoffs');
export const warningAction = commandAction('dock:diagnostics', 'Abrir Avisos');
export const volumetricsAction = commandAction('step:volumetrics', 'Abrir Volumetría');

export const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export const fmt = (v: unknown, unit = 'm', digits?: number): string =>
  finite(v)
    ? `${formatNumber(v, { digits: digits ?? (unit === 'm' ? 2 : 3) })}${unit ? ` ${unit}` : ''}`
    : 'sin dato';

export const fmtPlain = (v: unknown, digits = 2): string =>
  finite(v) ? formatNumber(v, { digits }) : '—';

export const fmtDepth = (d: number): string => `${formatNumber(d, { digits: 2, grouping: false })} m`;

export const textAnswer = (
  text: string,
  sources: readonly string[] = [],
  actions: readonly Action[] = [],
  extra: { table?: AssistantTable; intent?: Intent } = {},
): Answer => ({
  text,
  sources,
  actions,
  ...(extra.table ? { table: extra.table } : {}),
  ...(extra.intent ? { intent: extra.intent } : {}),
});

export function rowsOf(context: AssistantContext, port: string): readonly Row[] {
  const table = context.result?.outputs && activeOutput(context.result.outputs, port);
  return table?.kind === 'table' ? (table.value as ReadonlyTableValue).rows : [];
}

export function cellNum(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : NaN;
}

export function summaryRowOf(context: AssistantContext, zone?: ContextZone): Row | undefined {
  const table = rowsOf(context, 'ZONE_SUMMARY');
  if (!zone) {
    const total = table.at(-1);
    return total?.zone === 'Total' ? total : undefined;
  }
  return table.slice(0, -1).find((r) => r.zone === zone.name);
}

export type ZoneLookup =
  | { status: 'ok'; zone: ContextZone }
  | { status: 'missing' }
  | { status: 'ambiguous' };

export function resolveZone(context: AssistantContext, rawName: string): ZoneLookup {
  const target = normalizeQuestion(rawName);
  const exact = context.zones.filter((z) => normalizeQuestion(z.name) === target);
  if (exact.length === 1) return { status: 'ok', zone: exact[0]! };
  if (exact.length > 1) return { status: 'ambiguous' };
  if (target.length >= 4) {
    const fuzzy = context.zones.filter((z) => {
      const zn = normalizeQuestion(z.name);
      return zn.length >= 4 && levenshtein(target, zn, 1) <= 1;
    });
    if (fuzzy.length === 1) return { status: 'ok', zone: fuzzy[0]! };
    if (fuzzy.length > 1) return { status: 'ambiguous' };
  }
  return { status: 'missing' };
}

export function zoneErrorAnswer(status: 'missing' | 'ambiguous'): Answer {
  return textAnswer(
    status === 'ambiguous'
      ? 'Hay más de una zona con ese nombre. Revisá los nombres en el paso Zonas.'
      : 'No encontré esa zona en el pozo activo. Revisá los nombres en el paso Zonas.',
    [],
    [commandAction('step:zones', 'Abrir Zonas')],
  );
}

export interface ResolvedCurve {
  key: string;
  label: string;
  unit: string;
  data: Float64Array;
  outputKey?: string;
}

function normalizeCurveFraction(
  data: Float64Array,
  unit: string,
  roleOrPort: string,
  registry?: AssistantContext['registry'],
): { data: Float64Array; unit: string } {
  const upper = roleOrPort.toUpperCase();
  const isFracRole = FRACTION_ROLES.has(upper) || registry?.roles.get(upper)?.unit === 'v/v';
  if (isFracRole && unit !== 'v/v' && sameDimension(unit, 'v/v')) {
    return { data: convertArray(data, unit, 'v/v'), unit: 'v/v' };
  }
  return { data, unit };
}

export function resolveCurveSeries(context: AssistantContext, roleOrMnemonic: string): ResolvedCurve | null {
  const well = context.well;
  if (!well) return null;
  const n = well.depth.values.length;
  const rawKey = roleOrMnemonic.trim();
  const reg = context.registry;

  if (rawKey.startsWith('m:')) {
    const id = rawKey.slice(2);
    const c = well.curves.find((x) => x.id === id && x.data.length === n);
    if (!c) return null;
    const norm = normalizeCurveFraction(c.data, c.unit, c.role ?? c.mnemonic, reg);
    return { key: c.mnemonic, label: c.mnemonic, unit: norm.unit, data: norm.data };
  }
  const normalizedTarget = rawKey.startsWith('r:') ? rawKey.slice(2) : rawKey;
  const upper = normalizedTarget.toUpperCase();
  const outputs = context.clientResult?.outputs ?? context.result?.outputs ?? [];
  const src = context.result?.sources?.[upper];

  if (src?.kind === 'module') {
    const out =
      outputs.find((o) => o.kind === 'curve' && o.port === upper && o.moduleId === src.moduleId) ??
      outputs.find((o) => o.kind === 'curve' && o.port === upper && o.active);
    if (out && out.value instanceof Float64Array && out.value.length === n) {
      const norm = normalizeCurveFraction(out.value, out.unit ?? 'unitless', upper, reg);
      return { key: upper, label: upper, unit: norm.unit, data: norm.data, outputKey: out.key };
    }
  } else if (src?.kind === 'curve') {
    const c = well.curves.find((x) => x.id === src.curveId && x.data.length === n);
    if (c) {
      const norm = normalizeCurveFraction(c.data, c.unit, c.role ?? upper, reg);
      return { key: c.mnemonic, label: c.mnemonic, unit: norm.unit, data: norm.data };
    }
  }

  const active = outputs.find((o) => o.kind === 'curve' && o.active && o.port === upper);
  if (active && active.value instanceof Float64Array && active.value.length === n) {
    const norm = normalizeCurveFraction(active.value, active.unit ?? 'unitless', upper, reg);
    return { key: upper, label: upper, unit: norm.unit, data: norm.data, outputKey: active.key };
  }

  const byRole = well.curves.find((c) => c.role?.toUpperCase() === upper && c.data.length === n);
  if (byRole) {
    const norm = normalizeCurveFraction(byRole.data, byRole.unit, byRole.role ?? upper, reg);
    return { key: byRole.mnemonic, label: `${byRole.mnemonic} (${upper})`, unit: norm.unit, data: norm.data };
  }

  const foldTarget = normalizeQuestion(normalizedTarget);
  const byMnemonic = well.curves.find((c) => normalizeQuestion(c.mnemonic) === foldTarget && c.data.length === n);
  if (byMnemonic) {
    const norm = normalizeCurveFraction(byMnemonic.data, byMnemonic.unit, byMnemonic.role ?? byMnemonic.mnemonic, reg);
    return { key: byMnemonic.mnemonic, label: byMnemonic.mnemonic, unit: norm.unit, data: norm.data };
  }
  return null;
}

export function activeOutputKeyForPort(context: AssistantContext, port: CurveRole | string): string | null {
  const outputs = context.clientResult?.outputs ?? context.result?.outputs ?? [];
  const upper = port.toUpperCase();
  const active = outputs.find((o) => o.kind === 'curve' && o.port === upper && o.active);
  if (active) return active.key;
  const any = outputs.find((o) => o.kind === 'curve' && o.port === upper);
  return any?.key ?? null;
}

export function formatAnswerForCopy(answer: Pick<Answer, 'text' | 'sources' | 'table'>): string {
  const parts: string[] = [answer.text];
  if (answer.table && answer.table.rows.length > 0) {
    const headers = answer.table.columns.map((c) => c.label);
    const align = answer.table.columns.map((c) => (c.numeric ? '---:' : '---'));
    const body = answer.table.rows.map((r) => `| ${r.cells.map((c) => c.text).join(' | ')} |`);
    parts.push(['| ' + headers.join(' | ') + ' |', '| ' + align.join(' | ') + ' |', ...body].join('\n'));
  }
  if (answer.sources.length > 0) {
    parts.push(`Fuente: ${answer.sources.join(' · ')}`);
  }
  return parts.join('\n\n');
}
