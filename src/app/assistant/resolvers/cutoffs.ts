/**
 * Resolvers de sensibilidad y simulación de cutoffs (1D F26 compatible, simulación exacta 1D/2D y estabilidad 2D G09).
 */
import type { Row } from '../../../modules/well-reading/model';
import {
  buildCutoffSurfaceView,
  evaluateCutoffScenario,
  PARAM_BY_VAR,
  VAR_SYMBOL,
} from '../../../modules/cutoff-sensitivity/surfaceModel';
import { type StabilityClass, type SweepVariable } from '../../../petro/sensitivity';
import {
  clientResultOf,
  cutoffAction,
  finite,
  fmt,
  fmtPlain,
  rowsOf,
  SURFACE_SRC,
  SWEEP_SRC,
  textAnswer,
} from './common';
import type { Action, Answer, AssistantContext, AssistantTableRow, ContextZone, Intent } from '../types';

const STABILITY_LABEL: Readonly<Record<StabilityClass, { label: string; tone: 'ok' | 'warn' | 'error' | 'neutral' }>> = {
  stable: { label: 'Estable', tone: 'ok' },
  sensitive: { label: 'Sensible', tone: 'warn' },
  critical: { label: 'Crítica', tone: 'error' },
  empty: { label: 'Sin pay', tone: 'neutral' },
  'no-data': { label: 'Sin dato', tone: 'neutral' },
};

function f26CutoffFallback(
  context: AssistantContext,
  intent: Extract<Intent, { kind: 'cutoff' }>,
  zone?: ContextZone,
): Answer {
  const series = rowsOf(context, 'CUTOFF_SWEEP').filter(
    (r) => r.variable === intent.variable && r.zoneId === (zone?.id ?? ''),
  );
  const current = series.find((r) => r.current === 1);
  const zonedTotal = !zone && context.zones.length > 0;
  const candidates = series.filter((r) => finite(r.threshold) && !(zonedTotal && r.current === 1));
  const nearest = candidates.reduce<Row | undefined>(
    (best, row) =>
      !best || Math.abs(Number(row.threshold) - intent.threshold) < Math.abs(Number(best.threshold) - intent.threshold)
        ? row
        : best,
    undefined,
  );
  if (!finite(current?.netPay) || !finite(nearest?.netPay)) {
    return textAnswer(
      'El barrido no informa neto pay para ese filtro y ámbito. Indicá una zona si el pozo tiene zonas.',
      [SWEEP_SRC],
      [cutoffAction],
    );
  }
  const variable = { phi: 'φ', sw: 'Sw', vsh: 'Vsh' }[intent.variable];
  const subject = zone ? `Zona ${zone.name}` : zonedTotal ? 'Total de las zonas' : 'Pozo completo';
  const baseline = zonedTotal
    ? 'Con los cutoffs vigentes en cada zona'
    : `Con el cutoff vigente de ${variable} en ${fmt(current.threshold, 'v/v')}`;
  const scope = zonedTotal ? ' aplicado a todas las zonas' : '';
  return textAnswer(
    `${subject}. ${baseline}, el barrido da ${fmt(current.netPay)} de pay neto. ` +
      `En el punto evaluado más próximo para ${variable}, ${fmt(nearest.threshold, 'v/v')}${scope}, da ${fmt(nearest.netPay)}. Los demás cortes se mantienen fijos.`,
    [SWEEP_SRC],
    [cutoffAction],
  );
}

function validateCutoffThreshold(variable: SweepVariable, threshold: number): string | null {
  if (variable === 'phi') {
    return threshold >= 0 && threshold <= 0.4 ? null : 'El cutoff de φ admite valores entre 0 y 0,4 v/v (0 % a 40 %).';
  }
  return threshold >= 0 && threshold <= 1 ? null : 'Indicá un umbral entre 0 y 1 v/v, o entre 0 % y 100 %.';
}

function exactSimulationAnswer(
  context: AssistantContext,
  changes: readonly { variable: SweepVariable; threshold: number }[],
  zone?: ContextZone,
): Answer {
  for (const ch of changes) {
    const err = validateCutoffThreshold(ch.variable, ch.threshold);
    if (err) return textAnswer(err, [], [cutoffAction]);
  }
  const changesMap: Partial<Record<SweepVariable, number>> = {};
  for (const ch of changes) changesMap[ch.variable] = ch.threshold;

  const sim = evaluateCutoffScenario({
    well: context.well!,
    interpretation: context.interpretation!,
    result: clientResultOf(context),
    zoneId: zone?.id ?? null,
    changes: changesMap,
  });
  if (!sim) {
    return textAnswer(
      'La simulación exacta necesita VSH, PHIE y SW activas o medidas en el pozo.',
      [SURFACE_SRC],
      [cutoffAction],
    );
  }

  const subject = zone ? `Zona ${zone.name}` : context.zones.length > 0 ? 'Total de las zonas' : 'Pozo completo';
  const desc = changes.map((c) => `${VAR_SYMBOL[c.variable]} = ${fmtPlain(c.threshold, 3)} v/v`).join(' y ');
  const bPay = sim.baseline.netPay;
  const pPay = sim.proposed.netPay;
  const dPay = Number.isFinite(bPay) && Number.isFinite(pPay) ? pPay - bPay : NaN;
  const relPct = Number.isFinite(dPay) && Number.isFinite(bPay) && bPay > 1e-9 ? (100 * dPay) / bPay : NaN;
  const sign = Number.isFinite(dPay) && dPay > 0 ? '+' : '';
  const stabMeta = STABILITY_LABEL[sim.stability.status];
  const stabVar =
    sim.stability.maxRelDelta !== null ? ` (variación máxima ±${fmtPlain(sim.stability.maxRelDelta * 100, 1)} % en ±Δ)` : '';

  const rows: AssistantTableRow[] = [
    {
      id: 'netRes',
      cells: [
        { text: 'Reservorio neto (m)' },
        { text: fmtPlain(sim.baseline.netRes, 2), numeric: true },
        { text: fmtPlain(sim.proposed.netRes, 2), numeric: true },
        {
          text:
            Number.isFinite(sim.proposed.netRes - sim.baseline.netRes)
              ? `${sim.proposed.netRes - sim.baseline.netRes > 0 ? '+' : ''}${fmtPlain(sim.proposed.netRes - sim.baseline.netRes, 2)}`
              : '—',
          numeric: true,
        },
      ],
    },
    {
      id: 'netPay',
      cells: [
        { text: 'Pay neto (m)' },
        { text: fmtPlain(bPay, 2), numeric: true },
        { text: fmtPlain(pPay, 2), numeric: true },
        {
          text: Number.isFinite(dPay) ? `${sign}${fmtPlain(dPay, 2)} m${Number.isFinite(relPct) ? ` (${sign}${fmtPlain(relPct, 1)} %)` : ''}` : '—',
          numeric: true,
        },
      ],
    },
    {
      id: 'hphiSh',
      cells: [
        { text: 'h·φ·Sh (m)' },
        { text: fmtPlain(sim.baseline.hphiShPay, 3), numeric: true },
        { text: fmtPlain(sim.proposed.hphiShPay, 3), numeric: true },
        {
          text: Number.isFinite(sim.proposed.hphiShPay - sim.baseline.hphiShPay)
            ? `${sim.proposed.hphiShPay - sim.baseline.hphiShPay > 0 ? '+' : ''}${fmtPlain(sim.proposed.hphiShPay - sim.baseline.hphiShPay, 3)}`
            : '—',
          numeric: true,
        },
      ],
    },
  ];
  if (sim.hasOil) {
    const dO = sim.proposed.ooipMm3 - sim.baseline.ooipMm3;
    rows.push({
      id: 'ooip',
      cells: [
        { text: 'OOIP (Mm³)' },
        { text: fmtPlain(sim.baseline.ooipMm3, 1), numeric: true },
        { text: fmtPlain(sim.proposed.ooipMm3, 1), numeric: true },
        { text: Number.isFinite(dO) ? `${dO > 0 ? '+' : ''}${fmtPlain(dO, 1)}` : '—', numeric: true },
      ],
    });
  }
  if (sim.hasGas) {
    const dG = sim.proposed.ogipMMm3 - sim.baseline.ogipMMm3;
    rows.push({
      id: 'ogip',
      cells: [
        { text: 'OGIP (MMm³)' },
        { text: fmtPlain(sim.baseline.ogipMMm3, 2), numeric: true },
        { text: fmtPlain(sim.proposed.ogipMMm3, 2), numeric: true },
        { text: Number.isFinite(dG) ? `${dG > 0 ? '+' : ''}${fmtPlain(dG, 2)}` : '—', numeric: true },
      ],
    });
  }
  rows.push({
    id: 'stability',
    cells: [
      { text: 'Estabilidad 2D local' },
      { text: '—', numeric: true },
      { text: stabMeta.label, tone: stabMeta.tone },
      { text: sim.stability.maxRelDelta !== null ? `±${fmtPlain(sim.stability.maxRelDelta * 100, 1)} %` : '—', numeric: true },
    ],
  });

  const updates = changes.map((c) => ({ key: PARAM_BY_VAR[c.variable], value: c.threshold }));
  const overriddenNames = !zone
    ? [...new Set(changes.flatMap((c) => sim.overriddenZones[c.variable]))]
    : [];
  const overrideNote =
    overriddenNames.length > 0
      ? ` Las zonas con valor propio (${overriddenNames.join(', ')}) mantienen su corte y no se modifican al aplicar globalmente.`
      : '';
  const scopeText = zone ? ` en la zona ${zone.name}` : context.zones.length > 0 ? ' (aplicado globalmente)' : '';
  const actions: Action[] = [
    {
      kind: 'apply-cutoffs',
      zoneId: zone?.id ?? null,
      updates,
      label: 'Aplicar estos cutoffs',
    },
    cutoffAction,
  ];

  return textAnswer(
    `${subject}. Simulación exacta con ${desc}${scopeText}: el pay neto pasa de ${fmt(bPay)} a ${fmt(pPay)}` +
      (Number.isFinite(dPay) ? ` (${sign}${fmtPlain(dPay, 2)} m${Number.isFinite(relPct) ? `, ${sign}${fmtPlain(relPct, 1)} %` : ''}). ` : '. ') +
      `En ese punto, la estabilidad 2D es ${stabMeta.label.toLowerCase()}${stabVar}.${overrideNote} Podés aplicar los cortes con deshacer atómico (Ctrl+Z).`,
    ['Simulación exacta de cutoffs · evalCutoffPairPoint'],
    actions,
    {
      table: {
        columns: [
          { label: 'Métrica' },
          { label: 'Vigente', numeric: true },
          { label: 'Simulado', numeric: true },
          { label: 'Cambio', numeric: true },
        ],
        rows,
      },
    },
  );
}

export function cutoffAnswer(
  context: AssistantContext,
  intent: Extract<Intent, { kind: 'cutoff' }>,
  zone?: ContextZone,
): Answer {
  const err = validateCutoffThreshold(intent.variable, intent.threshold);
  if (err) return textAnswer(err, [], [cutoffAction]);
  // Compatibilidad estricta F26 cuando el contexto mínimo no provee pozo ni interpretación
  if (!context.well || !context.interpretation) {
    return f26CutoffFallback(context, intent, zone);
  }
  return exactSimulationAnswer(context, [{ variable: intent.variable, threshold: intent.threshold }], zone);
}

export function cutoffPairAnswer(
  context: AssistantContext,
  intent: Extract<Intent, { kind: 'cutoff-pair' }>,
  zone?: ContextZone,
): Answer {
  for (const ch of intent.changes) {
    const err = validateCutoffThreshold(ch.variable, ch.threshold);
    if (err) return textAnswer(err, [], [cutoffAction]);
  }
  if (!context.well || !context.interpretation) {
    return textAnswer(
      'La simulación combinada de dos cutoffs necesita el pozo e interpretación activos.',
      [],
      [cutoffAction],
    );
  }
  return exactSimulationAnswer(context, intent.changes, zone);
}

export function cutoffStabilityAnswer(
  context: AssistantContext,
  intent: Extract<Intent, { kind: 'cutoff-stability' }>,
  zone?: ContextZone,
): Answer {
  if (!context.well || !context.interpretation) {
    return textAnswer('Necesito el pozo activo para evaluar la superficie 2D de estabilidad.', [], [cutoffAction]);
  }
  const pairId = intent.pair ?? 'phi-sw';
  const clientRes = clientResultOf(context);
  if (zone || context.zones.length === 0) {
    const view = buildCutoffSurfaceView({
      well: context.well,
      interpretation: context.interpretation,
      result: clientRes,
      zoneId: zone?.id ?? null,
      pairId,
      metric: 'netPay',
      steps: 21,
    });
    if (!view) return textAnswer('Faltan VSH, PHIE o SW para armar la superficie 2D de estabilidad.', [SURFACE_SRC], [cutoffAction]);
    const st = view.stability;
    const meta = STABILITY_LABEL[st.status];
    const rel = st.maxRelDelta !== null ? `${fmtPlain(st.maxRelDelta * 100, 1)} %` : '—';
    const subject = zone ? `Zona ${zone.name}` : 'Pozo completo';
    return textAnswer(
      `${subject} (${view.pair.label}). Estabilidad 2D: ${meta.label}. ` +
        `Pay vigente: ${fmt(st.centerValue)}; rango dentro de la caja ±Δ: ${fmtPlain(st.minValue, 2)}–${fmtPlain(st.maxValue, 2)} m (variación máx. ${rel}).` +
        (st.zeroCenterWithGain ? ' Atención: pay actual cero junto a un escalón positivo en ±Δ.' : ''),
      [SURFACE_SRC],
      [cutoffAction],
    );
  }

  // Analizar todas las zonas + Total en tabla
  const targets: ({ id: string | null; name: string })[] = [
    ...context.zones.filter((z) => z.kind !== 'seal').map((z) => ({ id: z.id, name: z.name })),
    { id: null, name: 'Total' },
  ];
  const tableRows: AssistantTableRow[] = [];
  let worstText = 'Todas las zonas reservorio evaluadas se mantienen estables.';
  let criticalCount = 0;
  let sensitiveCount = 0;

  for (const t of targets) {
    const view = buildCutoffSurfaceView({
      well: context.well,
      interpretation: context.interpretation,
      result: clientRes,
      zoneId: t.id,
      pairId,
      metric: 'netPay',
      steps: 21,
    });
    if (!view) continue;
    const st = view.stability;
    const meta = STABILITY_LABEL[st.status];
    if (st.status === 'critical') criticalCount++;
    else if (st.status === 'sensitive') sensitiveCount++;
    tableRows.push({
      id: `stab-${t.name}`,
      cells: [
        { text: t.name },
        { text: `${VAR_SYMBOL[view.pair.xVar]} ${fmtPlain(view.xCurrent, 3)} / ${VAR_SYMBOL[view.pair.yVar]} ${fmtPlain(view.yCurrent, 3)}`, numeric: true },
        { text: fmtPlain(st.centerValue, 2), numeric: true },
        { text: st.maxRelDelta !== null ? `±${fmtPlain(st.maxRelDelta * 100, 1)} %` : '—', numeric: true },
        { text: meta.label, tone: meta.tone },
      ],
    });
  }
  if (tableRows.length === 0) {
    return textAnswer('Faltan curvas para evaluar estabilidad 2D de cutoffs.', [SURFACE_SRC], [cutoffAction]);
  }
  if (criticalCount > 0 || sensitiveCount > 0) {
    worstText = `Detecté ${criticalCount} ámbito(s) en acantilado crítico y ${sensitiveCount} sensible(s) dentro de ±Δ (par φ × Sw).`;
  }
  return textAnswer(
    `Diagnóstico 2D de estabilidad de cutoffs. ${worstText}`,
    [SURFACE_SRC],
    [cutoffAction],
    {
      table: {
        columns: [
          { label: 'Ámbito' },
          { label: 'Cutoffs (φ / Sw)', numeric: true },
          { label: 'Pay (m)', numeric: true },
          { label: 'Variación ±Δ', numeric: true },
          { label: 'Estado' },
        ],
        rows: tableRows,
      },
    },
  );
}
