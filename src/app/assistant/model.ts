import { activeOutput, type EngineRunResult } from '../../core/engine/engine';
import type { ReadonlyTableValue } from '../../core/module';
import type { Zone as WellZone } from '../../core/well';
import { fold, searchCommands, type Command } from '../../ui/commands';
import { formatNumber } from '../../ui/format';
import { filterEntries, type EquationEntry } from '../ecuaciones/model';
import { cardsFrom, generalFrom, type Row } from '../../modules/well-reading/model';
import { interpretQuestion, normalizeQuestion, type CurveRole, type Intent, type Metric } from './intents';

type Action =
  | { kind: 'command'; id: string; label: string }
  | { kind: 'curve'; role: CurveRole; zoneId: string; label: string }
  | { kind: 'equation'; id: string; label: string };

export interface Answer {
  text: string;
  sources: readonly string[];
  actions: readonly Action[];
}

export interface AssistantContext {
  zones: readonly Pick<WellZone, 'id' | 'name' | 'top' | 'base'>[];
  result: Pick<EngineRunResult, 'outputs' | 'diagnostics' | 'sources'> | null;
  equations: readonly EquationEntry[];
  commands: readonly NavigationCommand[];
  nextStep?: { id: string; title: string };
}

type NavigationCommand = Pick<Command, 'id' | 'title' | 'group' | 'keywords' | 'run'>;

const SUMMARY = 'Sumario por zona · ZONE_SUMMARY';
const SWEEP = 'Sensibilidad a los cutoffs · CUTOFF_SWEEP';
const READING = 'Lectura automática del pozo · WELL_READING';
const GENERAL = 'Lectura automática del pozo · WELL_READING_GENERAL';
const DIAGNOSTICS = 'Diagnósticos del motor · Avisos';
const METRIC: Record<Metric, readonly [label: string, unit: 'm' | 'v/v']> = {
  gross: ['Espesor bruto', 'm'], netSand: ['Arena neta', 'm'], netRes: ['Reservorio neto', 'm'],
  netPay: ['Pay neto', 'm'], ntgPay: ['N/G de pay', 'v/v'], phiPay: ['φ media del pay', 'v/v'],
  swPay: ['Sw media del pay', 'v/v'], vshPay: ['Vsh media del pay', 'v/v'],
};

const textAnswer = (text: string, sources: readonly string[] = [], actions: readonly Action[] = []): Answer => ({ text, sources, actions });
const command = (id: string, label: string): Action => ({ kind: 'command', id, label });
const summaryAction = command('step:summary', 'Abrir Sumario');
const cutoffAction = command('step:cutoffs', 'Revisar cutoffs');
const warningAction = command('dock:diagnostics', 'Abrir Avisos');

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const number = (v: unknown, unit = 'm') => finite(v) ? `${formatNumber(v, { digits: unit === 'm' ? 2 : 3 })} ${unit}` : 'sin dato';

function rows(context: AssistantContext, port: string): readonly Row[] {
  const table = context.result?.outputs && activeOutput(context.result.outputs, port);
  return table?.kind === 'table' ? (table.value as ReadonlyTableValue).rows : [];
}

type Zone = AssistantContext['zones'][number];

function summaryRow(context: AssistantContext, zone?: Zone): Row | undefined {
  const table = rows(context, 'ZONE_SUMMARY');
  if (!zone) {
    const total = table.at(-1);
    return total?.zone === 'Total' ? total : undefined;
  }
  return table.slice(0, -1).find(r => r.zone === zone.name);
}

function summaryAnswer(context: AssistantContext, metric: Metric, zone?: Zone): Answer {
  const row = summaryRow(context, zone);
  const subject = zone ? `Zona ${zone.name}` : context.zones.length ? 'Total de las zonas' : 'Pozo completo';
  const [label, unit] = METRIC[metric];
  return textAnswer(`${subject}. ${label}: ${number(row?.[metric], unit)}.`, [SUMMARY], [summaryAction]);
}

function payAnswer(context: AssistantContext, zone: Zone): Answer {
  const row = summaryRow(context, zone);
  if (!row) return textAnswer(`El sumario todavía no informa pay para la zona ${zone.name}.`, [SUMMARY], [summaryAction]);
  return textAnswer(
    `Zona ${zone.name}. De ${number(row.gross)} de espesor bruto, el sumario clasifica ${number(row.netRes)} como reservorio neto y ${number(row.netPay)} como pay. ` +
    `Reservorio sin dato para clasificar pay: ${number(row.noDataPay)}. Revisá qué filtros están activos y el barrido de cada cutoff.`,
    [SUMMARY], [summaryAction, cutoffAction],
  );
}

function cutoffAnswer(context: AssistantContext, intent: Extract<Intent, { kind: 'cutoff' }>, zone?: Zone): Answer {
  if (!(intent.threshold >= 0 && intent.threshold <= 1)) return textAnswer('Indicá un umbral entre 0 y 1 v/v, o entre 0 % y 100 %.', [], [cutoffAction]);
  const series = rows(context, 'CUTOFF_SWEEP').filter(r => r.variable === intent.variable && r.zoneId === (zone?.id ?? ''));
  const current = series.find(r => r.current === 1);
  const zonedTotal = !zone && context.zones.length > 0;
  const candidates = series.filter(r => finite(r.threshold) && !(zonedTotal && r.current === 1));
  const nearest = candidates.reduce<Row | undefined>((best, row) =>
    !best || Math.abs(Number(row.threshold) - intent.threshold) < Math.abs(Number(best.threshold) - intent.threshold) ? row : best, undefined);
  if (!finite(current?.netPay) || !finite(nearest?.netPay)) {
    return textAnswer('El barrido no informa neto pay para ese filtro y ámbito. Indicá una zona si el pozo tiene zonas.', [SWEEP], [cutoffAction]);
  }
  const variable = { phi: 'φ', sw: 'Sw', vsh: 'Vsh' }[intent.variable];
  const subject = zone ? `Zona ${zone.name}` : zonedTotal ? 'Total de las zonas' : 'Pozo completo';
  const baseline = zonedTotal ? 'Con los cutoffs vigentes en cada zona' : `Con el cutoff vigente de ${variable} en ${number(current.threshold, 'v/v')}`;
  const scope = zonedTotal ? ' aplicado a todas las zonas' : '';
  return textAnswer(
    `${subject}. ${baseline}, el barrido da ${number(current.netPay)} de pay neto. ` +
    `En el punto evaluado más próximo para ${variable}, ${number(nearest.threshold, 'v/v')}${scope}, da ${number(nearest.netPay)}. Los demás cortes se mantienen fijos.`,
    [SWEEP], [cutoffAction],
  );
}

function readingAnswer(context: AssistantContext, intent: Extract<Intent, { kind: 'reading' }>, zone?: Zone): Answer {
  const readingAction = command('step:summary', 'Revisar el paso Sumario');
  if (!zone && !intent.phase) {
    const line = generalFrom(rows(context, 'WELL_READING_GENERAL')).find(item => item.kind === 'summary');
    if (line) return textAnswer(line.text, [GENERAL], [readingAction]);
  }
  const card = cardsFrom(rows(context, 'WELL_READING')).find(c => (!zone || c.zoneId === zone.id) && (!intent.phase || c.kind === intent.phase));
  if (!card) return textAnswer('La lectura automática no informa tramos para esa consulta.', [READING], [readingAction]);
  return textAnswer(
    `Primer tramo de la lectura automática${card.zone ? ` en ${card.zone}` : ''}, de ${number(card.top)} a ${number(card.base)} MD. ` +
    `Fluido probable: ${card.fluidLabel.toLowerCase()}, confianza ${card.confidenceLabel.toLowerCase()}. ${card.text} ${card.evidence.join(' · ')}`.trim(),
    [READING], [readingAction],
  );
}

function methodAnswer(context: AssistantContext, query: string): Answer {
  const parts = (name: string) => fold(name).split(/[^\p{L}\p{N}]+/u);
  const matches = filterEntries(context.equations, query);
  const exact = context.equations.filter(e => fold(e.name) === query || e.id === query);
  const byName = matches.filter(e => query.split(' ').every(word => parts(e.name).includes(word)));
  const entries = exact.length ? exact : byName.length ? byName : matches;
  const actions = entries.slice(0, 4).map((entry): Action => ({ kind: 'equation', id: entry.id, label: entry.name }));
  if (entries.length !== 1) return textAnswer(
    entries.length ? 'Encontré varios métodos. Elegí una ficha de Ecuaciones.' : 'No encontré ese método. Probá con su nombre en Ecuaciones.',
    ['Ecuaciones'], actions.length ? actions : [command('help:equations', 'Abrir Ecuaciones')],
  );
  return textAnswer(entries[0]!.docs.summary, [`Ecuaciones · ${entries[0]!.name}`], actions);
}

function warningsAnswer(context: AssistantContext, zone?: Zone): Answer {
  const warnings = (context.result?.diagnostics ?? []).filter(d => d.level !== 'info' && (!zone || d.zoneId === zone.id));
  return textAnswer(
    warnings.slice(0, 3).map(d => d.message).join('\n') || 'El motor no informa avisos para este ámbito.',
    [DIAGNOSTICS], [warningAction],
  );
}

const NAVIGATION_GROUPS = new Set(['Flujo', 'Paneles', 'Ayuda']);
export function suggestCommands(question: string, commands: readonly NavigationCommand[]): Action[] {
  const query = normalizeQuestion(question).replace(/\b(?:el|la|los|de|al|que|quiero|abrir|mostrame|ir|por|favor)\b/g, ' ').trim();
  if (!query) return [];
  const allowed = commands.filter(c => c.id !== 'dock:assistant' &&
    (c.id.startsWith('step:') || c.id.startsWith('dock:') || c.id.startsWith('zone:') && c.id !== 'zone:mark' || c.id === 'help:equations') &&
    (NAVIGATION_GROUPS.has(c.group) || c.group === 'Zonas'));
  return searchCommands(allowed, query).slice(0, 3).map(({ command: c }) => command(c.id, c.title));
}

export function answerQuestion(question: string, context: AssistantContext): Answer {
  const intent = interpretQuestion(question);
  if (!intent) return textAnswer(
    'No reconocí el pedido. Probá con «Mostrame Sw en la zona D» o «¿Cómo funciona Archie?».',
    [], suggestCommands(question, context.commands),
  );
  const zoneName = 'zone' in intent ? intent.zone : undefined;
  const matches = zoneName ? context.zones.filter(z => normalizeQuestion(z.name) === zoneName) : [];
  if (zoneName && matches.length !== 1) return textAnswer(
    matches.length ? 'Hay más de una zona con ese nombre. Revisá los nombres en el paso Zonas.' : 'No encontré esa zona en el pozo activo. Revisá los nombres en el paso Zonas.',
    [], [command('step:zones', 'Abrir Zonas')],
  );
  const zone = matches[0];

  if (['summary', 'pay', 'cutoff', 'reading', 'warnings'].includes(intent.kind) && !context.result) {
    return textAnswer('Todavía no hay resultados vigentes del motor para esta pregunta.', [], [warningAction]);
  }
  switch (intent.kind) {
    case 'profile':
      return zone ? textAnswer(
        `Podés ir a la zona ${zone.name} y localizar ${intent.role} en el visor.`, [],
        [{ kind: 'curve', role: intent.role, zoneId: zone.id, label: `Mostrar ${intent.role} en la zona ${zone.name}` }],
      ) : textAnswer('Indicá una zona.');
    case 'summary': return summaryAnswer(context, intent.metric, zone);
    case 'pay': return zone ? payAnswer(context, zone) : textAnswer('Indicá una zona.');
    case 'cutoff': return cutoffAnswer(context, intent, zone);
    case 'reading': return readingAnswer(context, intent, zone);
    case 'method': return methodAnswer(context, intent.query);
    case 'warnings': return warningsAnswer(context, zone);
    case 'next':
      return context.nextStep
        ? textAnswer(`El flujo sugiere revisar ${context.nextStep.title}.`, [], [command(`step:${context.nextStep.id}`, `Abrir ${context.nextStep.title}`)])
        : textAnswer('Podés repasar los resultados en el Sumario.', [], [summaryAction]);
  }
}
