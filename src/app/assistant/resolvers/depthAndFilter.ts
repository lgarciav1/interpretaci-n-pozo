/**
 * Resolvers por profundidad (@ MD, diagnóstico "¿por qué no es pay?", trazabilidad "Origen")
 * y búsqueda booleana sobre curvas conectada con `PlotSelection` (G02 / enlace visor-gráficos).
 */
import { toEngineWell } from '../../../core/engine/engine';
import { formulaRegistry } from '../../../core/engine/formulas';
import { traceSample } from '../../../core/engine/provenance';
import { formulaModuleId } from '../../../core/formulas';
import { resolveParamsForModule } from '../../../core/module';
import { projectedEngineCurves } from '../../../core/preparation/plan';
import { sampleThickness } from '../../../core/well';
import cutoffsModule from '../../../modules/cutoffs';
import { maskCount, maskRuns } from '../../../plots/selection';
import { formatReadout, nearestIndex } from '../../../viewer/readout';
import {
  activeOutputKeyForPort,
  clientResultOf,
  cutoffAction,
  depthAction,
  FILTER_SRC,
  fmtDepth,
  fmtPlain,
  PROVENANCE_SRC,
  resolveCurveSeries,
  textAnswer,
  warningAction,
} from './common';
import type { Action, Answer, AssistantContext, AssistantTableRow, ContextZone, FilterCondition, Intent } from '../types';

function cutoffsAtZone(context: AssistantContext, zoneId: string | null) {
  const interp = context.interpretation;
  if (!interp) {
    return { vshMax: 0.4, phiMin: 0.08, swMax: 0.6, permOn: false, permMin: 1 };
  }
  const resolved = resolveParamsForModule(cutoffsModule, interp.params, zoneId ? [zoneId] : []);
  const raw = zoneId ? resolved.byZone.get(zoneId) ?? resolved.global : resolved.global;
  return {
    vshMax: Number(raw['vshCutoff']),
    phiMin: Number(raw['phiCutoff']),
    swMax: Number(raw['swCutoff']),
    permOn: Boolean(raw['permCutoffOn']),
    permMin: Number(raw['permCutoff']),
  };
}

function zoneAtDepth(zones: readonly ContextZone[], depth: number): ContextZone | undefined {
  return [...zones]
    .filter((z) => z.top <= depth && depth <= z.base)
    .sort((a, b) => a.top - b.top)[0];
}

function provenanceAtDepth(
  context: AssistantContext,
  idx: number,
  actualDepth: number,
  zone: ContextZone | undefined,
  role: string,
): Answer {
  const result = clientResultOf(context);
  const well = context.well;
  if (!result || !well) {
    return textAnswer('Todavía no hay resultados vigentes del motor para trazar el origen de esa curva.', [], [warningAction]);
  }
  const outputKey = activeOutputKeyForPort(context, role);
  if (!outputKey) {
    const measured = resolveCurveSeries(context, role);
    if (measured) {
      const val = measured.data[idx]!;
      return textAnswer(
        `A ${fmtDepth(actualDepth)} MD (${zone ? `zona ${zone.name}` : 'fuera de zonas'}), ${measured.label} es una curva medida (${formatReadout(val)} ${measured.unit}), no calculada por un módulo.`,
        [PROVENANCE_SRC],
        [depthAction(actualDepth, `Ir a ${fmtDepth(actualDepth)}`)],
      );
    }
    return textAnswer(`La salida ${role} no está calculada en esta corrida del pozo.`, [PROVENANCE_SRC], [warningAction]);
  }

  const baseReg = context.registry;
  if (!baseReg) {
    return textAnswer(
      `La curva ${role} a ${fmtDepth(actualDepth)} proviene de la salida ${outputKey}. Abrí el panel Origen para inspeccionar su cadena.`,
      [PROVENANCE_SRC],
      [{ kind: 'provenance', outputKey, depth: actualDepth, label: 'Abrir panel Origen' }],
    );
  }

  const rawWell = context.rawWell ?? well;
  const curves =
    context.traceCurves ??
    (result.preparation
      ? projectedEngineCurves(toEngineWell(rawWell), result.preparation.plan, result.preparation.artifacts)
      : rawWell.curves);
  const formulas = context.interpretation?.formulas;
  const needsFormulaReg = formulas?.length && context.interpretation && formulas.some((f) => !baseReg.get(formulaModuleId(f.mnemonic)));
  const activeReg =
    needsFormulaReg
      ? formulaRegistry(baseReg, curves, context.interpretation!, []).registry
      : baseReg;

  const outcome = traceSample(result, activeReg, curves, idx, outputKey);
  if (outcome.status !== 'ok') {
    return textAnswer(
      `No se pudo trazar ${outputKey} a ${fmtDepth(actualDepth)} (${outcome.status}). Revisá Avisos o abrí Origen.`,
      [PROVENANCE_SRC],
      [{ kind: 'provenance', outputKey, depth: actualDepth, label: 'Abrir panel Origen' }, warningAction],
    );
  }

  const targetLink = outcome.links[outcome.links.length - 1]!;
  const valStr =
    outcome.target.value !== null && Number.isFinite(outcome.target.value)
      ? `${formatReadout(outcome.target.value)} ${outcome.target.unit ?? ''}`.trim()
      : 'sin dato';
  const inputsSummary = targetLink.inputs
    .map((inp) => {
      const srcName =
        inp.source.kind === 'module'
          ? inp.source.name
          : inp.source.kind === 'curve'
            ? `${inp.source.mnemonic}${inp.source.prepared ? ' (preparada)' : ''}`
            : 'ausente';
      const vStr = inp.value !== null && Number.isFinite(inp.value) ? formatReadout(inp.value) : '—';
      return `${inp.port}: ${vStr} [${srcName}]`;
    })
    .join('; ');
  const paramsSummary = targetLink.params
    .slice(0, 4)
    .map((p) => `${p.label}=${typeof p.value === 'number' ? fmtPlain(p.value, 3) : p.optionLabel ?? String(p.value)}`)
    .join(', ');

  let gapMsg = '';
  if (outcome.gap) {
    const gLink = outcome.links.find((l) => l.moduleId === outcome.gap!.moduleId);
    const gInp = outcome.gap.inputKey ? gLink?.inputs.find((i) => i.key === outcome.gap!.inputKey) : undefined;
    gapMsg = ` La cadena se corta en «${gLink?.name ?? outcome.gap.moduleId}»${gInp ? ` por falta de dato en ${gInp.port}` : ''}.`;
  }

  const tableRows: AssistantTableRow[] = targetLink.inputs.map((inp) => ({
    id: `in-${inp.key}`,
    cells: [
      { text: inp.port },
      { text: inp.value !== null && Number.isFinite(inp.value) ? formatReadout(inp.value) : 'sin dato', numeric: true, tone: inp.gap ? 'error' : 'neutral' },
      {
        text:
          inp.source.kind === 'module'
            ? inp.source.name
            : inp.source.kind === 'curve'
              ? `${inp.source.mnemonic}${inp.source.prepared ? ' (prep.)' : ''}`
              : 'ausente',
      },
    ],
  }));

  return textAnswer(
    `${role} a ${fmtDepth(actualDepth)} MD (${zone ? `zona ${zone.name}` : 'fuera de zonas'}) = ${valStr}, calculado por «${targetLink.name}» (${outcome.links.length} eslabón/es).` +
      (inputsSummary ? ` Entradas: ${inputsSummary}.` : '') +
      (paramsSummary ? ` Parámetros: ${paramsSummary}.` : '') +
      gapMsg,
    [`${PROVENANCE_SRC} · ${outputKey}`],
    [
      { kind: 'provenance', outputKey, depth: actualDepth, label: 'Abrir panel Origen' },
      depthAction(actualDepth, `Ir a ${fmtDepth(actualDepth)}`),
    ],
    tableRows.length > 0
      ? {
          table: {
            columns: [{ label: 'Entrada' }, { label: 'Valor a MD', numeric: true }, { label: 'Fuente' }],
            rows: tableRows,
          },
        }
      : {},
  );
}

export function depthAnswer(context: AssistantContext, intent: Extract<Intent, { kind: 'depth' }>): Answer {
  const well = context.well;
  if (!well) {
    return textAnswer('Cargá un pozo para consultar valores y diagnósticos por profundidad.', [], []);
  }
  const depth = well.depth.values;
  if (depth.length === 0) {
    return textAnswer('El pozo no tiene muestras de profundidad.', [], []);
  }
  const idx = nearestIndex(depth, intent.depth);
  if (idx < 0) {
    return textAnswer(
      `La profundidad ${fmtDepth(intent.depth)} queda fuera del rango medido del pozo (${fmtDepth(depth[0]!)}–${fmtDepth(depth[depth.length - 1]!)}).`,
      [],
      [],
    );
  }
  const actualDepth = depth[idx]!;
  const zone = zoneAtDepth(context.zones, actualDepth);

  if (intent.mode === 'provenance') {
    return provenanceAtDepth(context, idx, actualDepth, zone, intent.role ?? 'PHIE');
  }

  const vshS = resolveCurveSeries(context, 'VSH');
  const phiS = resolveCurveSeries(context, 'PHIE');
  const swS = resolveCurveSeries(context, 'SW');
  const permS = resolveCurveSeries(context, 'PERM');
  const grS = resolveCurveSeries(context, 'GR');
  const rtS = resolveCurveSeries(context, 'RT');
  const payS = resolveCurveSeries(context, 'NET_PAY');
  const resS = resolveCurveSeries(context, 'NET_RES');
  const washS = resolveCurveSeries(context, 'IND_WASHOUT');

  const valAt = (s: ReturnType<typeof resolveCurveSeries>) => (s ? s.data[idx]! : NaN);
  const vsh = valAt(vshS);
  const phi = valAt(phiS);
  const sw = valAt(swS);
  const perm = valAt(permS);
  const netPay = valAt(payS);
  const netRes = valAt(resS);
  const wash = valAt(washS);
  const cuts = cutoffsAtZone(context, zone?.id ?? null);

  interface CheckRow {
    label: string;
    valueText: string;
    ruleText: string;
    status: string;
    tone: 'ok' | 'error' | 'warn';
    reason?: string;
  }

  const checks: CheckRow[] = [];
  if (!vshS || !Number.isFinite(vsh)) {
    checks.push({ label: 'Vsh', valueText: 'sin dato', ruleText: `≤ ${fmtPlain(cuts.vshMax, 3)}`, status: 'Sin dato', tone: 'warn', reason: 'falta Vsh' });
  } else {
    const ok = vsh <= cuts.vshMax;
    checks.push({
      label: 'Vsh',
      valueText: fmtPlain(vsh, 3),
      ruleText: `≤ ${fmtPlain(cuts.vshMax, 3)}`,
      status: ok ? 'Pasa' : 'Rechaza',
      tone: ok ? 'ok' : 'error',
      ...(!ok ? { reason: `Vsh (${fmtPlain(vsh, 3)}) > máx. (${fmtPlain(cuts.vshMax, 3)})` } : {}),
    });
  }

  if (!phiS || !Number.isFinite(phi)) {
    checks.push({ label: 'φe', valueText: 'sin dato', ruleText: `≥ ${fmtPlain(cuts.phiMin, 3)}`, status: 'Sin dato', tone: 'warn', reason: 'falta φe' });
  } else {
    const ok = phi >= cuts.phiMin;
    checks.push({
      label: 'φe',
      valueText: fmtPlain(phi, 3),
      ruleText: `≥ ${fmtPlain(cuts.phiMin, 3)}`,
      status: ok ? 'Pasa' : 'Rechaza',
      tone: ok ? 'ok' : 'error',
      ...(!ok ? { reason: `φe (${fmtPlain(phi, 3)}) < mín. (${fmtPlain(cuts.phiMin, 3)})` } : {}),
    });
  }

  if (cuts.permOn && Number.isFinite(cuts.permMin)) {
    if (!permS || !Number.isFinite(perm)) {
      checks.push({ label: 'k (PERM)', valueText: 'sin dato', ruleText: `≥ ${fmtPlain(cuts.permMin, 2)} mD`, status: 'Sin dato', tone: 'warn', reason: 'falta PERM con corte activo' });
    } else {
      const ok = perm >= cuts.permMin;
      checks.push({
        label: 'k (PERM)',
        valueText: `${fmtPlain(perm, 2)} mD`,
        ruleText: `≥ ${fmtPlain(cuts.permMin, 2)} mD`,
        status: ok ? 'Pasa' : 'Rechaza',
        tone: ok ? 'ok' : 'error',
        ...(!ok ? { reason: `k (${fmtPlain(perm, 2)} mD) < mín. (${fmtPlain(cuts.permMin, 2)} mD)` } : {}),
      });
    }
  }

  if (!swS || !Number.isFinite(sw)) {
    checks.push({ label: 'Sw', valueText: 'sin dato', ruleText: `≤ ${fmtPlain(cuts.swMax, 3)}`, status: 'Sin dato', tone: 'warn', reason: 'falta Sw' });
  } else {
    const ok = sw <= cuts.swMax;
    checks.push({
      label: 'Sw',
      valueText: fmtPlain(sw, 3),
      ruleText: `≤ ${fmtPlain(cuts.swMax, 3)}`,
      status: ok ? 'Pasa' : 'Rechaza',
      tone: ok ? 'ok' : 'error',
      ...(!ok ? { reason: `Sw (${fmtPlain(sw, 3)}) > máx. (${fmtPlain(cuts.swMax, 3)})` } : {}),
    });
  }

  const fails = checks.filter((c) => c.tone === 'error').map((c) => c.reason!);
  const missing = checks.filter((c) => c.tone === 'warn').map((c) => c.reason!);
  const isPay = Number.isFinite(netPay) ? netPay >= 0.5 : fails.length === 0 && missing.length === 0;
  const isRes = Number.isFinite(netRes) ? netRes >= 0.5 : fails.filter((r) => !r.startsWith('Sw')).length === 0;
  const washNote = Number.isFinite(wash) && wash >= 0.5 ? ' Hay indicador de derrumbe activo en esta muestra.' : '';

  const headline =
    intent.mode === 'why-pay'
      ? isPay
        ? `A ${fmtDepth(actualDepth)} MD (${zone ? `zona ${zone.name}` : 'fuera de zonas'}) la muestra SÍ clasifica como pay neto (pasa todos los cortes).`
        : fails.length > 0
          ? `A ${fmtDepth(actualDepth)} MD (${zone ? `zona ${zone.name}` : 'fuera de zonas'}) NO es pay (${isRes ? 'sí es reservorio neto' : 'tampoco alcanza reservorio neto'}): ${fails.join('; ')}.${missing.length ? ` Además: ${missing.join(', ')}.` : ''}${washNote}`
          : `A ${fmtDepth(actualDepth)} MD (${zone ? `zona ${zone.name}` : 'fuera de zonas'}) queda sin dato de pay porque ${missing.join(', ')}.${washNote}`
      : `Muestra a ${fmtDepth(actualDepth)} MD (${zone ? `zona ${zone.name}` : 'fuera de zonas'}). Pay neto: ${Number.isFinite(netPay) ? (isPay ? 'sí' : 'no') : 'sin dato'}.` +
        (grS ? ` GR=${formatReadout(grS.data[idx]!)} ${grS.unit}.` : '') +
        (rtS ? ` RT=${formatReadout(rtS.data[idx]!)} ${rtS.unit}.` : '') +
        washNote;

  const provKey = activeOutputKeyForPort(context, 'NET_PAY') ?? activeOutputKeyForPort(context, 'SW') ?? activeOutputKeyForPort(context, 'PHIE');
  const actions: Action[] = [
    depthAction(actualDepth, `Ver ${fmtDepth(actualDepth)} en visor`),
    ...(provKey ? [{ kind: 'provenance' as const, outputKey: provKey, depth: actualDepth, label: 'Abrir panel Origen' }] : []),
    cutoffAction,
  ];

  const rows: AssistantTableRow[] = checks.map((c) => ({
    id: `chk-${c.label}`,
    cells: [
      { text: c.label },
      { text: c.valueText, numeric: true },
      { text: c.ruleText, numeric: true },
      { text: c.status, tone: c.tone },
    ],
  }));
  if (grS && Number.isFinite(grS.data[idx]!)) {
    rows.push({
      id: 'chk-gr',
      cells: [{ text: grS.label }, { text: `${formatReadout(grS.data[idx]!)} ${grS.unit}`, numeric: true }, { text: 'referencia', numeric: true }, { text: 'Leída', tone: 'neutral' }],
    });
  }
  if (rtS && Number.isFinite(rtS.data[idx]!)) {
    rows.push({
      id: 'chk-rt',
      cells: [{ text: rtS.label }, { text: `${formatReadout(rtS.data[idx]!)} ${rtS.unit}`, numeric: true }, { text: 'referencia', numeric: true }, { text: 'Leída', tone: 'neutral' }],
    });
  }

  return textAnswer(headline, [PROVENANCE_SRC, 'Cutoffs vigentes'], actions, {
    table: {
      columns: [
        { label: 'Curva / Criterio' },
        { label: 'Valor a MD', numeric: true },
        { label: 'Corte', numeric: true },
        { label: 'Estado' },
      ],
      rows,
    },
  });
}

function formatCondExpr(cond: FilterCondition): string {
  const f1 = fmtPlain(cond.value, 3);
  if (cond.op === 'between') return `${cond.curve} en [${f1}, ${fmtPlain(cond.valueMax, 3)}]`;
  return `${cond.curve} ${cond.op} ${f1}`;
}

function evalCond(v: number, c: FilterCondition): boolean {
  if (!Number.isFinite(v)) return false;
  switch (c.op) {
    case '>': return v > c.value;
    case '>=': return v >= c.value;
    case '<': return v < c.value;
    case '<=': return v <= c.value;
    case '=': return Math.abs(v - c.value) <= 1e-6;
    case 'between': return v >= c.value && v <= (c.valueMax ?? c.value);
  }
}

export function filterSelectAnswer(
  context: AssistantContext,
  intent: Extract<Intent, { kind: 'filter-select' }>,
  zone?: ContextZone,
): Answer {
  const well = context.well;
  if (!well) {
    return textAnswer('Cargá un pozo para filtrar y resaltar tramos por condición sobre curvas.', [FILTER_SRC], []);
  }
  const resolved = intent.conditions.map((c) => ({ cond: c, series: resolveCurveSeries(context, c.curve) }));
  const missing = resolved.filter((r) => !r.series).map((r) => r.cond.curve);
  if (missing.length > 0) {
    return textAnswer(
      `No encontré la(s) curva(s) ${missing.join(', ')} en el pozo activo ni en el último cálculo.`,
      [FILTER_SRC],
      [],
    );
  }

  const depth = well.depth.values;
  const n = depth.length;
  const thickness = sampleThickness(depth);
  const mask = new Uint8Array(n);
  let scopeThickness = 0;
  let selectedThickness = 0;

  for (let i = 0; i < n; i++) {
    const d = depth[i]!;
    if (zone && (d < zone.top || d > zone.base)) continue;
    const hi = thickness[i] ?? 0;
    if (Number.isFinite(hi) && hi > 0) scopeThickness += hi;
    const pass =
      intent.combinator === 'and'
        ? resolved.every((r) => evalCond(r.series!.data[i]!, r.cond))
        : resolved.some((r) => evalCond(r.series!.data[i]!, r.cond));
    if (pass) {
      mask[i] = 1;
      if (Number.isFinite(hi) && hi > 0) selectedThickness += hi;
    }
  }

  const count = maskCount(mask);
  const labelExpr = intent.conditions.map(formatCondExpr).join(intent.combinator === 'and' ? ' ∧ ' : ' ∨ ') + (zone ? ` (${zone.name})` : '');

  if (count === 0) {
    const stats = resolved.map((r) => {
      let min = Infinity;
      let max = -Infinity;
      for (let i = 0; i < n; i++) {
        if (zone && (depth[i]! < zone.top || depth[i]! > zone.base)) continue;
        const v = r.series!.data[i]!;
        if (Number.isFinite(v)) {
          if (v < min) min = v;
          if (v > max) max = v;
        }
      }
      return `${r.cond.curve} ∈ [${fmtPlain(min, 3)}, ${fmtPlain(max, 3)}] ${r.series!.unit}`;
    });
    return textAnswer(
      `Ninguna muestra${zone ? ` en la zona ${zone.name}` : ''} cumple ${labelExpr}. Rangos observados: ${stats.join('; ')}.`,
      [FILTER_SRC],
      [],
    );
  }

  const runs = maskRuns(depth, mask);
  const sortedRuns = [...runs].sort((a, b) => b.base - b.top - (a.base - a.top));
  const thickest = sortedRuns[0]!;
  const pct = scopeThickness > 0 ? (100 * selectedThickness) / scopeThickness : NaN;

  const tableRows: AssistantTableRow[] = sortedRuns.slice(0, 5).map((r, i) => ({
    id: `run-${i}`,
    cells: [
      { text: `#${i + 1}` },
      { text: fmtDepth(r.top), numeric: true },
      { text: fmtDepth(r.base), numeric: true },
      { text: `${fmtPlain(Math.max(0, r.base - r.top), 2)} m`, numeric: true },
    ],
    action: depthAction((r.top + r.base) / 2, `Ver ${fmtDepth(r.top)}–${fmtDepth(r.base)}`, {
      top: r.top - 2,
      base: r.base + 2,
    }),
  }));

  return textAnswer(
    `${count} muestras (${fmtPlain(selectedThickness, 2)} m${Number.isFinite(pct) ? `, ${fmtPlain(pct, 1)} % del ámbito` : ''}) en ${runs.length} tramo(s) cumplen ${labelExpr}. ` +
      `Tramo más grueso: ${fmtDepth(thickest.top)}–${fmtDepth(thickest.base)}.`,
    [FILTER_SRC],
    [
      {
        kind: 'apply-selection',
        mask,
        detailLabel: labelExpr,
        top: Math.max(depth[0]!, thickest.top - 5),
        base: Math.min(depth[n - 1]!, thickest.base + 5),
        label: 'Resaltar en visor y gráficos',
      },
      {
        kind: 'save-selection-flag',
        mask,
        detailLabel: labelExpr,
        defaultName: labelExpr.slice(0, 40),
        label: 'Guardar como bandera',
      },
    ],
    {
      table: {
        columns: [
          { label: 'Tramo' },
          { label: 'Tope', numeric: true },
          { label: 'Base', numeric: true },
          { label: 'Espesor', numeric: true },
        ],
        rows: tableRows,
      },
    },
  );
}
