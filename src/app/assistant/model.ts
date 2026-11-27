/**
 * Orquestador puro del Asistente v2 (0094): conecta parser determinista, memoria corta de sesión (follow-ups),
 * resolvers por dominio, comandos de navegación F26, modo «Preparar defensa» y autocompletado.
 */
import { searchCommands } from '../../ui/commands';
import { buildDefensePrep, formatDefenseForCopy } from './defense';
import { interpretQuestion, normalizeQuestion } from './intents';
import {
  commandAction,
  formatAnswerForCopy,
  resolveZone,
  summaryAction,
  textAnswer,
  warningAction,
  zoneErrorAnswer,
} from './resolvers/common';
import { cutoffAnswer, cutoffPairAnswer, cutoffStabilityAnswer } from './resolvers/cutoffs';
import { depthAnswer, filterSelectAnswer } from './resolvers/depthAndFilter';
import {
  cgrAnswer,
  coreAnswer,
  crossCheckAnswer,
  mdtAnswer,
  micpAnswer,
  movabilityAnswer,
  payLayersAnswer,
  smlpAnswer,
  uncertaintyAnswer,
} from './resolvers/petroDomains';
import {
  graphDiagAnswer,
  methodAnswer,
  nextAnswer,
  readingAnswer,
  snapshotDiffAnswer,
  warningsAnswer,
} from './resolvers/projectDiag';
import { compareAnswer, payAnswer, summaryAnswer, volumeAnswer } from './resolvers/summaryAndVol';
import { buildAutocomplete, buildDynamicChips } from './suggestions';
import type { Action, Answer, AssistantContext, Intent, NavigationCommand } from './types';

export type {
  Action,
  Answer,
  AssistantContext,
  AssistantTable,
  AssistantTableCell,
  AssistantTableRow,
  AutocompleteItem,
  ContextZone,
  CurveRole,
  DefenseCard,
  Intent,
  Metric,
} from './types';

export { buildAutocomplete, buildDynamicChips, buildDefensePrep, formatAnswerForCopy, formatDefenseForCopy };

const NAVIGATION_GROUPS = new Set(['Flujo', 'Paneles', 'Ayuda']);

export function suggestCommands(question: string, commands: readonly NavigationCommand[]): Action[] {
  const query = normalizeQuestion(question)
    .replace(/\b(?:el|la|los|de|al|que|quiero|abrir|mostrame|ir|por|favor)\b/g, ' ')
    .trim();
  if (!query) return [];
  const allowed = commands.filter(
    (c) =>
      c.id !== 'dock:assistant' &&
      (c.id.startsWith('step:') ||
        c.id.startsWith('dock:') ||
        (c.id.startsWith('zone:') && c.id !== 'zone:mark') ||
        c.id === 'help:equations') &&
      (NAVIGATION_GROUPS.has(c.group) || c.group === 'Zonas'),
  );
  return searchCommands(allowed, query)
    .slice(0, 3)
    .map(({ command: c }) => commandAction(c.id, c.title));
}

type ConcreteIntent = Exclude<Intent, { kind: 'followup' }>;

function mergeFollowup(
  followup: Extract<Intent, { kind: 'followup' }>,
  prev: Intent | null | undefined,
): ConcreteIntent | null {
  if (!prev || prev.kind === 'followup') return null;
  const applyZone = <T extends { zone?: string }>(base: T): T => {
    if (followup.wholeWell) {
      const copy = { ...base };
      delete copy.zone;
      return copy;
    }
    return followup.zone ? { ...base, zone: followup.zone } : base;
  };

  if (followup.fluid) {
    if (prev.kind === 'volume') {
      return applyZone({ ...prev, fluid: followup.fluid });
    }
    return { kind: 'volume', fluid: followup.fluid, ...(followup.zone ? { zone: followup.zone } : {}) };
  }

  if (followup.cutoff) {
    const fc = followup.cutoff;
    if (prev.kind === 'cutoff') {
      const variable = fc.variable ?? prev.variable;
      if (variable === prev.variable) {
        return { kind: 'cutoff', variable, threshold: fc.threshold, ...(followup.zone ? { zone: followup.zone } : prev.zone ? { zone: prev.zone } : {}) };
      }
      return {
        kind: 'cutoff-pair',
        changes: [
          { variable: prev.variable, threshold: prev.threshold },
          { variable, threshold: fc.threshold },
        ],
        ...(followup.zone ? { zone: followup.zone } : prev.zone ? { zone: prev.zone } : {}),
      };
    }
    if (prev.kind === 'cutoff-pair') {
      const targetVar = fc.variable ?? prev.changes[prev.changes.length - 1]!.variable;
      const updated = prev.changes.map((c) => (c.variable === targetVar ? { ...c, threshold: fc.threshold } : c));
      if (!prev.changes.some((c) => c.variable === targetVar)) updated.push({ variable: targetVar, threshold: fc.threshold });
      return {
        kind: 'cutoff-pair',
        changes: updated,
        ...(followup.zone ? { zone: followup.zone } : prev.zone ? { zone: prev.zone } : {}),
      };
    }
    if (fc.variable) {
      const inheritedZone = followup.zone ?? (!followup.wholeWell && 'zone' in prev ? prev.zone : undefined);
      return { kind: 'cutoff', variable: fc.variable, threshold: fc.threshold, ...(inheritedZone ? { zone: inheritedZone } : {}) };
    }
    return null;
  }

  switch (prev.kind) {
    case 'profile':
      return followup.zone ? { ...prev, zone: followup.zone } : null;
    case 'pay':
      return followup.zone ? { ...prev, zone: followup.zone } : null;
    case 'summary':
    case 'cutoff':
    case 'cutoff-pair':
    case 'cutoff-stability':
    case 'volume':
    case 'filter-select':
    case 'cross-check':
    case 'mdt':
    case 'smlp':
    case 'cgr':
    case 'movability':
    case 'pay-layers':
    case 'uncertainty':
    case 'core':
    case 'reading':
    case 'warnings':
      return applyZone(prev);
    case 'compare':
      return followup.zone ? { kind: 'summary', metric: 'netPay', zone: followup.zone } : prev;
    default:
      return null;
  }
}

const NEEDS_RESULT = new Set<Intent['kind']>([
  'summary',
  'pay',
  'cutoff',
  'cutoff-pair',
  'cutoff-stability',
  'reading',
  'warnings',
  'volume',
  'compare',
  'smlp',
  'cgr',
  'movability',
  'pay-layers',
  'uncertainty',
]);

function finalize(answer: Answer, intent?: Intent): Answer {
  const copyText = formatAnswerForCopy(answer);
  return {
    ...answer,
    copyText,
    ...(intent ? { intent } : {}),
  };
}

export function answerQuestion(question: string, context: AssistantContext): Answer {
  const parsed = interpretQuestion(question);
  if (!parsed) {
    return finalize(
      textAnswer(
        'No reconocí el pedido. Probá con «Mostrame Sw en la zona D», «Compará B vs D» o «¿Cómo funciona Archie?».',
        [],
        suggestCommands(question, context.commands),
      ),
    );
  }

  const intent: ConcreteIntent | null = parsed.kind === 'followup'
    ? mergeFollowup(parsed, context.previousIntent)
    : parsed;
  if (!intent) {
    return finalize(
      textAnswer(
        'Hacé primero una pregunta de referencia (por ejemplo sobre pay, cutoffs o volumetría) para poder continuar con esa repregunta.',
        [],
        [summaryAction],
      ),
    );
  }

  const zoneName = 'zone' in intent ? intent.zone : undefined;
  let zone: AssistantContext['zones'][number] | undefined;
  if (zoneName) {
    const resolved = resolveZone(context, zoneName);
    if (resolved.status !== 'ok') return finalize(zoneErrorAnswer(resolved.status), intent);
    zone = resolved.zone;
  }

  if (NEEDS_RESULT.has(intent.kind) && !context.result) {
    return finalize(
      textAnswer('Todavía no hay resultados vigentes del motor para esta pregunta.', [], [warningAction]),
      intent,
    );
  }

  let ans: Answer;
  switch (intent.kind) {
    case 'profile':
      ans = zone
        ? textAnswer(
            `Podés ir a la zona ${zone.name} y localizar ${intent.role} en el visor.`,
            [],
            [{ kind: 'curve', role: intent.role, zoneId: zone.id, label: `Mostrar ${intent.role} en la zona ${zone.name}` }],
          )
        : textAnswer('Indicá una zona.');
      break;
    case 'summary':
      ans = summaryAnswer(context, intent.metric, zone);
      break;
    case 'pay':
      ans = zone ? payAnswer(context, zone) : textAnswer('Indicá una zona.');
      break;
    case 'cutoff':
      ans = cutoffAnswer(context, intent, zone);
      break;
    case 'cutoff-pair':
      ans = cutoffPairAnswer(context, intent, zone);
      break;
    case 'cutoff-stability':
      ans = cutoffStabilityAnswer(context, intent, zone);
      break;
    case 'volume':
      ans = volumeAnswer(context, intent, zone);
      break;
    case 'compare':
      ans = compareAnswer(context, intent);
      break;
    case 'depth':
      ans = depthAnswer(context, intent);
      break;
    case 'filter-select':
      ans = filterSelectAnswer(context, intent, zone);
      break;
    case 'cross-check':
      ans = crossCheckAnswer(context, intent, zone);
      break;
    case 'mdt':
      ans = mdtAnswer(context, intent, zone);
      break;
    case 'smlp':
      ans = smlpAnswer(context, zone);
      break;
    case 'cgr':
      ans = cgrAnswer(context, zone);
      break;
    case 'movability':
      ans = movabilityAnswer(context, zone);
      break;
    case 'micp':
      ans = micpAnswer(context);
      break;
    case 'pay-layers':
      ans = payLayersAnswer(context, zone);
      break;
    case 'uncertainty':
      ans = uncertaintyAnswer(context, intent, zone);
      break;
    case 'core':
      ans = coreAnswer(context, zone);
      break;
    case 'snapshot-diff':
      ans = snapshotDiffAnswer(context, intent);
      break;
    case 'graph-diag':
      ans = graphDiagAnswer(context, intent);
      break;
    case 'reading':
      ans = readingAnswer(context, intent, zone);
      break;
    case 'method':
      ans = methodAnswer(context, intent.query);
      break;
    case 'warnings':
      ans = warningsAnswer(context, zone);
      break;
    case 'next':
      ans = nextAnswer(context);
      break;
  }

  return finalize(ans, intent);
}
