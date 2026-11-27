/**
 * Resolvers de diagnóstico de proyecto (diff contra snapshot o defaults, grafo/sarta/preparación),
 * lectura automática, método en Ecuaciones, avisos y siguiente paso (retrocompatibles F26).
 */
import { portOf } from '../../../core/module';
import { emptyInterpretation } from '../../../core/interpretation';
import { describeDiff, diffInterpretations } from '../../../core/state/snapshots';
import { toolStringOf } from '../../../core/toolString';
import { cardsFrom, generalFrom } from '../../../modules/well-reading/model';
import { fold } from '../../../ui/commands';
import { filterEntries } from '../../ecuaciones/model';
import { levenshtein, normalizeQuestion } from '../intents';
import {
  clientResultOf,
  commandAction,
  DIAGNOSTICS_SRC,
  fmt,
  GENERAL_SRC,
  GRAPH_SRC,
  panelAction,
  PREP_SRC,
  READING_SRC,
  rowsOf,
  SNAPSHOT_SRC,
  summaryAction,
  textAnswer,
  warningAction,
} from './common';
import type { Action, Answer, AssistantContext, AssistantTableRow, ContextZone, Intent } from '../types';

export function snapshotDiffAnswer(
  context: AssistantContext,
  intent: Extract<Intent, { kind: 'snapshot-diff' }>,
): Answer {
  const interp = context.interpretation;
  if (!interp) {
    return textAnswer('Necesito el pozo activo para comparar cambios de interpretación.', [SNAPSHOT_SRC], []);
  }
  const snapshots = context.snapshots ?? [];
  let baseline = emptyInterpretation(interp.zones);
  let baseLabel = 'los valores de fábrica';
  let snapId: string | undefined;

  if (!intent.vsDefaults) {
    if (intent.target) {
      const targetNorm = normalizeQuestion(intent.target);
      const snap = snapshots.find((s) => normalizeQuestion(s.name) === targetNorm || s.id === intent.target)
        ?? snapshots.find((s) => normalizeQuestion(s.name).includes(targetNorm));
      if (!snap) {
        return textAnswer(
          snapshots.length > 0
            ? `No encontré un snapshot llamado «${intent.target}». Guardados: ${snapshots.map((s) => s.name).join(', ')}.`
            : 'Todavía no hay snapshots guardados en este pozo para comparar.',
          [SNAPSHOT_SRC],
          [{ kind: 'snapshots', label: 'Abrir Snapshots' }],
        );
      }
      baseline = snap.interpretation;
      baseLabel = `el snapshot «${snap.name}»`;
      snapId = snap.id;
    } else if (snapshots.length > 0) {
      const latest = snapshots[snapshots.length - 1]!;
      baseline = latest.interpretation;
      baseLabel = `el último snapshot («${latest.name}»)`;
      snapId = latest.id;
    }
  }

  const diffs = diffInterpretations(baseline, interp, context.registry);
  if (diffs.length === 0) {
    return textAnswer(
      `No hay diferencias respecto de ${baseLabel}.`,
      [SNAPSHOT_SRC],
      [
        ...(snapId ? [{ kind: 'curtain' as const, snapshotId: snapId, label: 'Abrir cortina antes/después' }] : []),
        { kind: 'snapshots', label: 'Abrir Snapshots' },
      ],
    );
  }

  const descriptions = diffs.map((d) => describeDiff(d, { registry: context.registry, zones: interp.zones as never }));
  const shown = descriptions.slice(0, 10);
  const rest = descriptions.length - shown.length;
  const tableRows: AssistantTableRow[] = shown.map((desc, idx) => ({
    id: `diff-${idx}`,
    cells: [{ text: String(idx + 1) }, { text: desc }],
  }));

  const actions: Action[] = [
    ...(snapId ? [{ kind: 'curtain' as const, snapshotId: snapId, label: 'Abrir cortina antes/después' }] : []),
    { kind: 'snapshots', label: 'Abrir Snapshots' },
  ];

  return textAnswer(
    `${diffs.length} cambio(s) respecto de ${baseLabel}${rest > 0 ? ` (muestro los primeros ${shown.length})` : ''}.`,
    [SNAPSHOT_SRC],
    actions,
    {
      table: {
        columns: [{ label: '#' }, { label: 'Cambio detectado' }],
        rows: tableRows,
      },
    },
  );
}

export function graphDiagAnswer(
  context: AssistantContext,
  intent: Extract<Intent, { kind: 'graph-diag' }>,
): Answer {
  const interp = context.interpretation;
  const well = context.well;
  if (!interp || !well) {
    return textAnswer('Necesito el pozo activo para diagnosticar preparación, sarta o módulos.', [GRAPH_SRC], []);
  }

  if (intent.focus === 'preparation') {
    const nodes = interp.preparation?.nodes ?? [];
    if (nodes.length === 0) {
      return textAnswer(
        'No hay operaciones de Preparación de datos cargadas sobre las curvas de este pozo (se usan todas las curvas originales).',
        [PREP_SRC],
        [panelAction('preparation', 'Abrir Preparar datos')],
      );
    }
    const tableRows: AssistantTableRow[] = nodes.map((n) => {
      const c = (context.rawWell ?? well).curves.find((x) => x.id === n.input.curveId);
      const stages: string[] = [];
      if (n.intervals.length > 0) stages.push(`${n.intervals.length} exclusión(es)`);
      if ('gapFill' in n && n.gapFill) stages.push('interpolación');
      if ('filter' in n && n.filter) stages.push('mediana');
      if ('shift' in n && n.shift) stages.push(`corrimiento ${n.shift.offsetM} m`);
      if (n.kind === 'linear-normalization') stages.push('normalización');
      if (n.kind === 'mgt-borehole') stages.push('MGT');
      if (n.kind === 'density-reconstruction') stages.push('reconstrucción ML');
      return {
        id: n.id,
        cells: [
          { text: c?.mnemonic ?? n.input.curveId },
          { text: stages.join(', ') || n.kind },
          { text: n.enabled ? 'Activa' : 'Desactivada', tone: n.enabled ? 'ok' : 'neutral' },
        ],
      };
    });
    const activeCount = nodes.filter((n) => n.enabled).length;
    const totalExcl = nodes.reduce((s, n) => s + (n.enabled ? n.intervals.length : 0), 0);
    return textAnswer(
      `Preparación de datos: ${activeCount} receta(s) activa(s) de ${nodes.length} (${totalExcl} intervalo(s) excluidos).`,
      [PREP_SRC],
      [panelAction('preparation', 'Abrir Preparar datos')],
      {
        table: {
          columns: [{ label: 'Curva' }, { label: 'Operaciones' }, { label: 'Estado' }],
          rows: tableRows,
        },
      },
    );
  }

  // focus === 'missing'
  const nodes = clientResultOf(context)?.nodes ?? [];
  const disabledSet = new Set(interp.disabled);
  const ts = toolStringOf(interp);
  const actions: Action[] = [commandAction('tool-string:open', 'Abrir Sarta de perfilaje'), warningAction];
  const reg = context.registry;

  const diags = context.result?.diagnostics ?? [];
  const reasonOf = (moduleId: string, status: string) => {
    const msgs = diags.filter((d) => d.moduleId === moduleId && d.level !== 'info').map((d) => d.port || d.message);
    if (msgs.length > 0) return msgs.slice(0, 2).join(', ');
    if (status === 'missing-input') return 'faltan entradas requeridas';
    if (status === 'blocked') return 'bloqueado por dependencia';
    if (status === 'cycle') return 'ciclo de dependencias';
    return 'error de cálculo';
  };

  if (intent.target) {
    const tNorm = normalizeQuestion(intent.target);
    const matchingNodes = nodes.filter((nr) => {
      const mod = reg?.get(nr.moduleId);
      const modName = mod ? normalizeQuestion(mod.name) : '';
      const ports = mod ? Object.values(mod.outputs).map((o) => normalizeQuestion(portOf(o))) : [];
      return nr.moduleId === tNorm || modName.includes(tNorm) || ports.includes(tNorm);
    });

    if (matchingNodes.length > 0) {
      const details = matchingNodes.map((nr) => {
        const mod = reg?.get(nr.moduleId);
        const label = mod?.name ?? nr.moduleId;
        if (disabledSet.has(nr.moduleId)) return `«${label}» está desactivado manualmente.`;
        if (nr.status === 'ok') return `«${label}» corrió correctamente (revisá si elegiste otro método como fuente o faltan tramos con datos).`;
        return `«${label}» no se calculó (${reasonOf(nr.moduleId, nr.status)}).`;
      });
      const offToolsNote = ts.off.length > 0 ? ` Herramientas apagadas en sarta: ${ts.off.join(', ')}.` : '';
      return textAnswer(`${details.join(' ')}${offToolsNote}`, [GRAPH_SRC], actions);
    }
  }

  const failedNodes = nodes.filter((nr) => nr.status !== 'ok' && !disabledSet.has(nr.moduleId));
  if (failedNodes.length === 0 && ts.off.length === 0 && interp.disabled.length === 0) {
    return textAnswer('Todos los módulos habilitados del grafo corrieron sin errores de entradas faltantes.', [GRAPH_SRC], actions);
  }

  const tableRows: AssistantTableRow[] = failedNodes.slice(0, 8).map((nr) => {
    const mod = reg?.get(nr.moduleId);
    return {
      id: nr.moduleId,
      cells: [
        { text: mod?.name ?? nr.moduleId },
        { text: nr.status, tone: nr.status === 'error' ? 'error' : 'warn' },
        { text: reasonOf(nr.moduleId, nr.status) },
      ],
    };
  });

  return textAnswer(
    `Grafo del motor: ${failedNodes.length} módulo(s) sin calcular por entradas faltantes o error` +
      (interp.disabled.length ? `, ${interp.disabled.length} desactivado(s)` : '') +
      (ts.off.length ? `, ${ts.off.length} herramienta(s) apagada(s) en sarta.` : '.'),
    [GRAPH_SRC],
    actions,
    tableRows.length > 0
      ? {
          table: {
            columns: [{ label: 'Módulo' }, { label: 'Estado' }, { label: 'Falta' }],
            rows: tableRows,
          },
        }
      : {},
  );
}

export function readingAnswer(
  context: AssistantContext,
  intent: Extract<Intent, { kind: 'reading' }>,
  zone?: ContextZone,
): Answer {
  const readingAction = commandAction('step:summary', 'Revisar el paso Sumario');
  if (!zone && !intent.phase) {
    const line = generalFrom(rowsOf(context, 'WELL_READING_GENERAL')).find((item) => item.kind === 'summary');
    if (line) return textAnswer(line.text, [GENERAL_SRC], [readingAction]);
  }
  const card = cardsFrom(rowsOf(context, 'WELL_READING')).find(
    (c) => (!zone || c.zoneId === zone.id) && (!intent.phase || c.kind === intent.phase),
  );
  if (!card) return textAnswer('La lectura automática no informa tramos para esa consulta.', [READING_SRC], [readingAction]);
  return textAnswer(
    `Primer tramo de la lectura automática${card.zone ? ` en ${card.zone}` : ''}, de ${fmt(card.top)} a ${fmt(card.base)} MD. ` +
      `Fluido probable: ${card.fluidLabel.toLowerCase()}, confianza ${card.confidenceLabel.toLowerCase()}. ${card.text} ${card.evidence.join(' · ')}`.trim(),
    [READING_SRC],
    [readingAction],
  );
}

export function methodAnswer(context: AssistantContext, query: string): Answer {
  const parts = (name: string) => fold(name).split(/[^\p{L}\p{N}]+/u);
  const matches = filterEntries(context.equations, query);
  const exact = context.equations.filter((e) => fold(e.name) === query || e.id === query);
  const byName = matches.filter((e) => query.split(' ').every((word) => parts(e.name).includes(word)));
  let entries = exact.length ? exact : byName.length ? byName : matches;

  // Fallback tipográfico acotado cuando la búsqueda exacta/subcadena no encuentra nada
  if (entries.length === 0 && query.length >= 4) {
    const queryWords = query.split(' ').filter((w) => w.length >= 4);
    if (queryWords.length > 0) {
      entries = context.equations.filter((e) => {
        const tokens = [...parts(e.name), ...parts(e.id)].filter((t) => t.length >= 4);
        return queryWords.some((qw) => {
          const maxD = qw.length >= 10 ? 2 : 1;
          return tokens.some((t) => t[0] === qw[0] && levenshtein(qw, t, maxD) <= maxD);
        });
      });
    }
  }

  const actions: Action[] = entries.slice(0, 4).map((entry): Action => ({ kind: 'equation', id: entry.id, label: entry.name }));
  if (entries.length !== 1) {
    return textAnswer(
      entries.length
        ? 'Encontré varios métodos. Elegí una ficha de Ecuaciones.'
        : 'No encontré ese método. Probá con su nombre en Ecuaciones.',
      ['Ecuaciones'],
      actions.length ? actions : [commandAction('help:equations', 'Abrir Ecuaciones')],
    );
  }
  return textAnswer(entries[0]!.docs.summary, [`Ecuaciones · ${entries[0]!.name}`], actions);
}

export function warningsAnswer(context: AssistantContext, zone?: ContextZone): Answer {
  const warnings = (context.result?.diagnostics ?? []).filter((d) => d.level !== 'info' && (!zone || d.zoneId === zone.id));
  return textAnswer(
    warnings.slice(0, 3).map((d) => d.message).join('\n') || 'El motor no informa avisos para este ámbito.',
    [DIAGNOSTICS_SRC],
    [warningAction],
  );
}

export function nextAnswer(context: AssistantContext): Answer {
  return context.nextStep
    ? textAnswer(
        `El flujo sugiere revisar ${context.nextStep.title}.`,
        [],
        [commandAction(`step:${context.nextStep.id}`, `Abrir ${context.nextStep.title}`)],
      )
    : textAnswer('Podés repasar los resultados en el Sumario.', [], [summaryAction]);
}
