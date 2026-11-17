/**
 * Resumen en texto plano del pozo activo para pegar en un asistente externo (F25). Puro: parte del `ReportModel`
 * (que ya reúne zonas, métodos, parámetros efectivos, sumario y avisos) y no calcula petrofísica ni incluye
 * ecuaciones. El tope de tamaño se respeta recortando por prioridad (los avisos son lo más útil para un chat): primero
 * el detalle por zona de los parámetros, luego parámetros en versión breve, luego los de módulos auxiliares, recién
 * después avisos (información, advertencias y al final errores) y, en el extremo, líneas finales enteras. Nunca se
 * corta una línea a la mitad.
 */
import type { TableCell, TableColumn } from '../../core/module';
import { unitLabel } from '../../core/units';
import { PRODUCT_NAME } from '../../ui/brandSvg';
import type { ReportModel, ReportTable } from '../report/report';

/** Tope de caracteres del texto: entra con holgura en un mensaje de un chat. */
export const CHAT_CONTEXT_MAX_CHARS = 12000;
/** Largo máximo de un aviso individual (los más largos se acortan en un límite de palabra). */
const WARNING_MAX_CHARS = 260;

export interface ChatContextOptions {
  /** Tope de caracteres (por defecto `CHAT_CONTEXT_MAX_CHARS`). */
  maxChars?: number;
}
export interface ChatContextResult { text: string; truncated: boolean; length: number }

const num = (v: number) => (Number.isFinite(v) ? v.toLocaleString('es-AR', { maximumSignificantDigits: 5 }) : '—');
const zoneLabel = (name: string) => (/^zona\b/i.test(name) ? name : `Zona ${name}`);
/** Columnas del sumario que repiten lo ya dicho en la sección de zonas. */
const REDUNDANT_COLUMNS = new Set(['Tipo', 'Tope', 'Base']);
const KIND: Record<string, string> = { formation: 'formación', reservoir: 'reservorio', seal: 'sello', other: 'otra' };

function cellText(v: TableCell | undefined): string {
  if (v === undefined || v === null) return '—';
  if (typeof v === 'number') return num(v);
  return String(v);
}
/** Una fila de tabla como «Zona A: Espesor 12,3 m · φ 0,18»; omite las celdas sin dato. */
function rowLine(columns: readonly TableColumn[], row: Record<string, TableCell>, zoneNames: ReadonlySet<string>): string {
  const [first, ...rest] = columns;
  if (!first) return '';
  const parts: string[] = [];
  for (const c of rest) {
    if (REDUNDANT_COLUMNS.has(c.label)) continue;
    const text = cellText(row[c.key]);
    if (text === '—' || text === '') continue;
    const unit = c.unit && c.unit !== 'unitless' ? unitLabel(c.unit) : '';
    parts.push(`${c.label} ${text}${unit ? ` ${unit}` : ''}`);
  }
  const name = cellText(row[first.key]);
  return `- ${zoneNames.has(name) ? zoneLabel(name) : name}: ${parts.length ? parts.join(' · ') : 'sin datos'}`;
}
function tableLines(title: string, t: ReportTable | null, missing: string, zoneNames: ReadonlySet<string>): string[] {
  const out = [`## ${title}`];
  if (!t || t.rows.length === 0) out.push(missing);
  else out.push(...t.rows.map((r) => rowLine(t.columns, r, zoneNames)));
  return out;
}
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Avisos fijos del informe que no aportan por pozo: se resumen en una oración de la introducción. */
const GENERIC_WARNING_PREFIXES = [
  'Profundidad medida (MD), en metros.',
  'Los volúmenes son estimaciones in situ',
  'La interpretación depende de la calidad',
  'Los totales de volumen suman solo',
  'El sumario excluye las muestras',
];
export const isGenericWarning = (w: string): boolean => GENERIC_WARNING_PREFIXES.some((p) => w.startsWith(p));

function shorten(s: string, max: number): string {
  const one = s.replace(/\s+/g, ' ').trim();
  if (one.length <= max) return one;
  const cut = one.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:.]+$/, '')}…`;
}
/** Quita el prefijo repetido «Advertencia · Módulo: Módulo: …» que dejan los módulos en sus mensajes. */
const dedupePrefix = (s: string) => s.replace(/^(.*? · )?(.{3,}?): \2: /, '$1$2: ');
/** Gravedad para ordenar y recortar: 0 error, 1 advertencia, 2 sin etiqueta (calidad, preparación), 3 información. */
const severity = (w: string) => (w.startsWith('Error') ? 0 : w.startsWith('Advertencia') ? 1 : w.startsWith('Información') ? 3 : 2);

/**
 * Agrupa avisos idénticos salvo la zona nombrada («en la zona A, …», «En la zona C …»): se reemplaza la mención de zona
 * por un marcador y los avisos con igual texto resultante se unen en uno solo «… — zonas A, C, E». Genérico: usa los
 * nombres de zona del modelo. Si no hay mención o el texto difiere (p. ej. otros números), el aviso queda individual.
 */
export function groupWarnings(warnings: readonly string[], zoneNames: readonly string[], maxChars = Infinity): string[] {
  const names = [...zoneNames].sort((a, b) => b.length - a.length).map(escapeRe);
  const mention = names.length ? new RegExp(`(?:[Ee]n )?la zona (${names.join('|')})(?=[\\s,.:;)]|$),?\\s*`) : null;
  const groups = new Map<string, { first: string; text: string; zones: string[] }>();
  const out: string[] = [];
  const order: (string | { key: string })[] = [];
  for (const raw of warnings) {
    const w = dedupePrefix(raw.replace(/\s+/g, ' ').trim());
    const m = mention?.exec(w);
    if (!m) { order.push(shorten(w, maxChars)); continue; }
    const key = w.replace(mention!, '§');
    const g = groups.get(key);
    if (g) { if (!g.zones.includes(m[1]!)) g.zones.push(m[1]!); continue; }
    groups.set(key, { first: w, text: key.replace('§', ''), zones: [m[1]!] });
    order.push({ key });
  }
  for (const o of order) {
    if (typeof o === 'string') { out.push(o); continue; }
    const g = groups.get(o.key)!;
    out.push(g.zones.length > 1 ? `${shorten(g.text, maxChars).replace(/[.\s]+$/, '')} — zonas ${g.zones.join(', ')}` : shorten(g.first, maxChars));
  }
  return [...new Set(out)];
}

/** Curvas medidas en una línea y módulos de cálculo uno por línea (una fuente es módulo si tiene parámetros en el modelo). */
function methodLines(model: ReportModel): string[] {
  if (model.methods.length === 0) return ['Sin métodos resueltos.'];
  const moduleNames = new Set(model.parameters.map((p) => p.module));
  const curves = model.methods.filter((m) => !moduleNames.has(m.source));
  const bySource = new Map<string, string[]>();
  for (const m of model.methods) if (moduleNames.has(m.source)) bySource.set(m.source, [...(bySource.get(m.source) ?? []), m.port]);
  return [
    ...(curves.length ? [`- Curvas medidas usadas (curva→puerto): ${curves.map((m) => `${m.source}→${m.port}`).join(', ')}`] : []),
    ...[...bySource].map(([source, ports]) => `- ${source} → ${ports.join(', ')}`),
  ];
}

type ParamMode = 'full' | 'global' | 'brief' | 'primary' | 'none';
/** Largo máximo de la línea de un método en los modos `brief` y `primary` (se corta entre parámetros). */
const BRIEF_LINE_CHARS = 150;
function parameterLines(model: ReportModel, mode: ParamMode): string[] {
  const out = ['## Parámetros efectivos'];
  if (mode === 'none') return [...out, 'Omitidos por tamaño.'];
  if (model.parameters.length === 0) return [...out, 'Sin parámetros disponibles (no hay resultados vigentes).'];
  const brief = mode === 'brief' || mode === 'primary';
  out.push(mode === 'full' ? 'Una línea por método; valor global y, entre paréntesis, las zonas que difieren.' : mode === 'global' ? 'Una línea por método; solo valores globales.' : 'Una línea por método; solo valores globales y solo los primeros parámetros.');
  const fed = new Set(model.methods.map((m) => m.source));
  for (const p of model.parameters) {
    if (p.rows.length === 0) continue;
    const primary = p.status.startsWith('Cadena principal') && fed.has(p.module);
    if (mode === 'primary' && !primary) continue;
    const items = p.rows.map((r) => {
      const diffs = mode === 'full' ? model.zones.flatMap((z, i) => (r.zones[i] !== undefined && r.zones[i] !== r.global ? [`zona ${z.name}: ${r.zones[i]}`] : [])) : [];
      return `${r.label} ${r.global}${diffs.length ? ` (${diffs.join('; ')})` : ''}`;
    });
    const status = p.status.endsWith('Calculado') && p.status.startsWith('Cadena principal') ? '' : ` [${p.status}]`;
    const head = `- ${p.module}${status}: `;
    if (!brief) { out.push(head + items.join(' · ')); continue; }
    const kept: string[] = [];
    let len = head.length;
    for (const it of items) {
      if (kept.length > 0 && len + it.length + 3 > BRIEF_LINE_CHARS) break;
      kept.push(it);
      len += it.length + 3;
    }
    out.push(head + kept.join(' · ') + (kept.length < items.length ? ` · … (+${items.length - kept.length})` : ''));
  }
  return out;
}

/** Arma el texto. Puro y determinista para un mismo modelo. */
export function chatContextText(model: ReportModel, opts: ChatContextOptions = {}): ChatContextResult {
  const max = opts.maxChars ?? CHAT_CONTEXT_MAX_CHARS;
  const hasResult = !!model.summary || model.parameters.length > 0;
  const zoneNames = new Set(model.zones.map((z) => z.name));
  const warnings = groupWarnings(model.warnings.filter((w) => !isGenericWarning(w)), model.zones.map((z) => z.name), WARNING_MAX_CHARS)
    .map((w, i) => ({ w, i }))
    .sort((a, b) => severity(a.w) - severity(b.w) || a.i - b.i)
    .map((x) => x.w);

  const head: string[] = [
    `Contexto de interpretación petrofísica exportado de ${PRODUCT_NAME} (${model.date}). Es un resumen en texto plano de un pozo ya interpretado: no incluye ecuaciones ni datos muestra por muestra. Notas generales: profundidades en metros de profundidad medida (MD); «—» significa sin dato (no es cero); los volúmenes son estimaciones in situ (no reservas) que dependen del área, el fluido, el factor de volumen y los cutoffs; los totales suman solo las zonas con dato; el sumario excluye las muestras fuera de las zonas definidas; y la interpretación depende de la calidad de los registros y de los modelos elegidos.`,
    '',
    '## Pozo',
    `- Nombre: ${model.wellName}`,
    `- Intervalo: ${num(model.top)}–${num(model.base)} m MD · ${model.samples.toLocaleString('es-AR')} muestras`,
    ...model.header.map((h) => `- ${h.label}: ${h.value}`),
    '',
    '## Zonas',
    ...(model.zones.length
      ? model.zones.map((z) => `- ${zoneLabel(z.name)}: ${num(z.top)}–${num(z.base)} m MD · espesor ${num(z.base - z.top)} m · ${KIND[z.kind] ?? z.kind}`)
      : ['Sin zonas definidas.']),
  ];
  if (!hasResult) head.push('', '## Estado', 'No hay resultados vigentes para este pozo: no hay sumario, volumen ni parámetros efectivos para informar.');
  const essentials: string[] = [
    ...head, '',
    '## Métodos elegidos', ...methodLines(model), '',
  ];
  const summary = tableLines('Sumario por zona', model.summary, 'Sin resultados disponibles.', zoneNames);
  const volumes = model.volumes && model.volumes.rows.length ? tableLines('Volumen in situ por zona', model.volumes, '', zoneNames) : [];

  const build = (mode: ParamMode, nWarn: number, cutLines = 0): { text: string; note: string } => {
    const lines = [...essentials, ...summary, ...(volumes.length ? ['', ...volumes] : []), ...(hasResult ? ['', ...parameterLines(model, mode)] : [])];
    const kept = warnings.slice(0, nWarn);
    if (kept.length) lines.push('', '## Avisos', ...kept.map((w) => `- ${w}`));
    const notes: string[] = [];
    if (mode === 'global') notes.push('el detalle de parámetros por zona');
    if (mode === 'brief') notes.push('el detalle de parámetros por zona y parte de los parámetros de cada método');
    if (mode === 'primary') notes.push('el detalle de parámetros por zona, parte de los parámetros y los de módulos auxiliares');
    if (mode === 'none') notes.push('los parámetros');
    if (nWarn < warnings.length) notes.push(`${warnings.length - nWarn} avisos (los menos graves)`);
    const body = cutLines > 0 ? lines.slice(0, lines.length - cutLines) : lines;
    if (cutLines > 0) notes.push(`${cutLines} líneas finales`);
    const note = notes.length ? `[Recortado: se omitieron ${notes.join(', ')} para que entre en un mensaje.]` : '';
    return { text: [...body, ...(note ? ['', note] : [])].join('\n'), note };
  };
  const fits = (r: { text: string }) => r.text.length <= max;

  // Los parámetros se reducen por etapas con todos los avisos; recién agotadas, se recortan avisos.
  const modes: ParamMode[] = hasResult ? ['full', 'global', 'brief', 'primary'] : ['none'];
  let result: { text: string; note: string } | null = null;
  for (const mode of modes) {
    const r = build(mode, warnings.length);
    if (fits(r)) { result = r; break; }
  }
  if (!result) {
    const mode = modes[modes.length - 1]!;
    if (fits(build(mode, 0))) {
      let lo = 0, hi = warnings.length;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (fits(build(mode, mid))) lo = mid; else hi = mid - 1;
      }
      result = build(mode, lo);
    } else {
      // Ni sin avisos entra: se omiten los parámetros y, si hace falta, líneas enteras del final.
      let cut = 0;
      while (cut < 10000 && !fits(build('none', 0, cut))) cut++;
      result = build('none', 0, cut);
    }
  }
  return { text: result.text, truncated: result.note !== '', length: result.text.length };
}
