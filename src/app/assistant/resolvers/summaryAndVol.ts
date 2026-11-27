/**
 * Resolvers de Sumario por zona, explicación de poco pay, Volumetría (OOIP/OGIP) y Comparativa entre zonas.
 */
import {
  cellNum,
  depthAction,
  finite,
  fmt,
  fmtPlain,
  resolveZone,
  rowsOf,
  SUMMARY_SRC,
  summaryAction,
  summaryRowOf,
  textAnswer,
  VOLUMETRICS_SRC,
  volumetricsAction,
  cutoffAction,
  zoneErrorAnswer,
} from './common';
import type { Action, Answer, AssistantContext, AssistantTableRow, CompareMetric, ContextZone, Intent, Metric } from '../types';

const METRIC: Record<Metric, readonly [label: string, unit: string]> = {
  gross: ['Espesor bruto', 'm'],
  netSand: ['Arena neta', 'm'],
  netRes: ['Reservorio neto', 'm'],
  netPay: ['Pay neto', 'm'],
  ntgPay: ['N/G de pay', 'v/v'],
  phiPay: ['φ media del pay', 'v/v'],
  swPay: ['Sw media del pay', 'v/v'],
  vshPay: ['Vsh media del pay', 'v/v'],
  hphiShPay: ['h·φ·Sh del pay', 'm'],
};

export function summaryAnswer(context: AssistantContext, metric: Metric, zone?: ContextZone): Answer {
  const row = summaryRowOf(context, zone);
  const subject = zone ? `Zona ${zone.name}` : context.zones.length ? 'Total de las zonas' : 'Pozo completo';
  const [label, unit] = METRIC[metric];
  return textAnswer(`${subject}. ${label}: ${fmt(row?.[metric], unit)}.`, [SUMMARY_SRC], [summaryAction]);
}

export function payAnswer(context: AssistantContext, zone: ContextZone): Answer {
  const row = summaryRowOf(context, zone);
  if (!row) {
    return textAnswer(`El sumario todavía no informa pay para la zona ${zone.name}.`, [SUMMARY_SRC], [summaryAction]);
  }
  const sealNote = row.kind === 'Sello' ? ' Está marcada como zona sello.' : '';
  return textAnswer(
    `Zona ${zone.name}.${sealNote} De ${fmt(row.gross)} de espesor bruto, el sumario clasifica ${fmt(row.netRes)} como reservorio neto y ${fmt(row.netPay)} como pay. ` +
      `Reservorio sin dato para clasificar pay: ${fmt(row.noDataPay)}. Revisá qué filtros están activos y el barrido de cada cutoff.`,
    [SUMMARY_SRC],
    [summaryAction, cutoffAction],
  );
}

export function volumeAnswer(
  context: AssistantContext,
  intent: Extract<Intent, { kind: 'volume' }>,
  zone?: ContextZone,
): Answer {
  const volRows = rowsOf(context, 'VOLUMETRICS');
  if (volRows.length === 0) {
    return textAnswer(
      'Volumetría todavía no tiene resultados calculados. Definí zonas y abrí el paso Volumen para configurar área, fluido y Bo/Bg.',
      [VOLUMETRICS_SRC],
      [volumetricsAction],
    );
  }
  if (zone) {
    const r = volRows.find((x) => x.zone === zone.name);
    if (!r) return textAnswer(`No hay renglón volumétrico para la zona ${zone.name}.`, [VOLUMETRICS_SRC], [volumetricsAction]);
    if (r.fluid === 'Sello' || r.fluid === 'Sin hidrocarburo') {
      return textAnswer(
        `Zona ${zone.name} (${String(r.fluid)}). No aporta volumen de hidrocarburo in situ.`,
        [VOLUMETRICS_SRC],
        [volumetricsAction, depthAction((zone.top + zone.base) / 2, `Ver zona ${zone.name}`, { top: zone.top, base: zone.base })],
      );
    }
    const isGas = r.fluid === 'Gas';
    const siVal = isGas ? fmt(r.ogipSi, 'MMm³', 2) : fmt(r.ooipSi, 'Mm³', 1);
    const fieldVal = isGas ? fmt(r.ogipField, 'Bcf', 2) : fmt(r.ooipField, 'MMbbl', 2);
    const boBg = isGas ? `Bg ${fmtPlain(r.b, 4)}` : `Bo ${fmtPlain(r.b, 2)}`;
    return textAnswer(
      `Zona ${zone.name} (${String(r.fluid)}). Área ${fmt(r.area, 'km²', 2)}, h·φ·Sh ${fmt(r.hphiSh, 'm', 3)}, ${boBg} m³/m³. ` +
        `Volumen in situ (${isGas ? 'OGIP' : 'OOIP'}): ${siVal} (${fieldVal}).`,
      [VOLUMETRICS_SRC],
      [volumetricsAction, depthAction((zone.top + zone.base) / 2, `Ver zona ${zone.name}`, { top: zone.top, base: zone.base })],
    );
  }

  const total = volRows.find((x) => x.zone === 'Total');
  const zoneOnly = volRows.filter((x) => x.zone !== 'Total');
  const showOil = intent.fluid !== 'gas';
  const showGas = intent.fluid !== 'oil';

  const parts: string[] = [];
  if (showOil && finite(total?.ooipSi)) {
    parts.push(`Petróleo in situ (OOIP) total: ${fmt(total?.ooipSi, 'Mm³', 1)} (${fmt(total?.ooipField, 'MMbbl', 2)})`);
  }
  if (showGas && finite(total?.ogipSi)) {
    parts.push(`Gas in situ (OGIP) total: ${fmt(total?.ogipSi, 'MMm³', 2)} (${fmt(total?.ogipField, 'Bcf', 2)})`);
  }
  if (parts.length === 0) {
    parts.push('El total volumétrico no informa hidrocarburos con la configuración actual de fluidos y h·φ·Sh.');
  }

  const tableRows: AssistantTableRow[] = zoneOnly.map((r) => {
    const z = context.zones.find((item) => item.name === r.zone);
    return {
      id: `vol-${String(r.zone)}`,
      cells: [
        { text: String(r.zone ?? '') },
        { text: String(r.fluid ?? '—') },
        { text: fmtPlain(r.hphiSh, 3), numeric: true },
        { text: finite(r.ooipSi) ? `${fmtPlain(r.ooipSi, 1)} / ${fmtPlain(r.ooipField, 2)}` : '—', numeric: true },
        { text: finite(r.ogipSi) ? `${fmtPlain(r.ogipSi, 2)} / ${fmtPlain(r.ogipField, 2)}` : '—', numeric: true },
      ],
      ...(z ? { action: depthAction((z.top + z.base) / 2, `Ver zona ${z.name}`, { top: z.top, base: z.base }) } : {}),
    };
  });

  return textAnswer(
    `${parts.join('. ')}.`,
    [VOLUMETRICS_SRC],
    [volumetricsAction],
    tableRows.length > 0
      ? {
          table: {
            columns: [
              { label: 'Zona' },
              { label: 'Fluido' },
              { label: 'h·φ·Sh (m)', numeric: true },
              { label: 'OOIP (Mm³ / MMbbl)', numeric: true },
              { label: 'OGIP (MMm³ / Bcf)', numeric: true },
            ],
            rows: tableRows,
          },
        }
      : {},
  );
}

const COMPARE_META: Readonly<Record<CompareMetric, { label: string; unit: string; digits: number; source: 'sum' | 'ooip' | 'ogip' }>> = {
  gross: { label: 'Espesor bruto', unit: 'm', digits: 2, source: 'sum' },
  netSand: { label: 'Arena neta', unit: 'm', digits: 2, source: 'sum' },
  netRes: { label: 'Reservorio neto', unit: 'm', digits: 2, source: 'sum' },
  netPay: { label: 'Pay neto', unit: 'm', digits: 2, source: 'sum' },
  ntgPay: { label: 'N/G de pay', unit: 'v/v', digits: 3, source: 'sum' },
  phiPay: { label: 'φ media del pay', unit: 'v/v', digits: 3, source: 'sum' },
  swPay: { label: 'Sw media del pay', unit: 'v/v', digits: 3, source: 'sum' },
  vshPay: { label: 'Vsh media del pay', unit: 'v/v', digits: 3, source: 'sum' },
  kPay: { label: 'k media del pay', unit: 'mD', digits: 2, source: 'sum' },
  hphiShPay: { label: 'h·φ·Sh del pay', unit: 'm', digits: 3, source: 'sum' },
  ooip: { label: 'OOIP', unit: 'Mm³', digits: 1, source: 'ooip' },
  ogip: { label: 'OGIP', unit: 'MMm³', digits: 2, source: 'ogip' },
};

export function compareAnswer(context: AssistantContext, intent: Extract<Intent, { kind: 'compare' }>): Answer {
  const sumRows = rowsOf(context, 'ZONE_SUMMARY').filter((r) => r.zone !== 'Total');
  if (sumRows.length === 0) {
    return textAnswer('Todavía no hay zonas calculadas en el sumario para comparar.', [SUMMARY_SRC], [summaryAction]);
  }
  const volRows = rowsOf(context, 'VOLUMETRICS').filter((r) => r.zone !== 'Total');
  const volByName = new Map(volRows.map((r) => [String(r.zone ?? ''), r]));

  if (intent.mode === 'pair') {
    const rA = resolveZone(context, intent.zones[0]);
    if (rA.status !== 'ok') return zoneErrorAnswer(rA.status);
    const rB = resolveZone(context, intent.zones[1]);
    if (rB.status !== 'ok') return zoneErrorAnswer(rB.status);
    const zA = rA.zone;
    const zB = rB.zone;
    const sA = sumRows.find((r) => r.zone === zA.name);
    const sB = sumRows.find((r) => r.zone === zB.name);
    if (!sA || !sB) return textAnswer('Faltan filas del sumario para alguna de esas zonas.', [SUMMARY_SRC], [summaryAction]);

    const vA = volByName.get(zA.name);
    const vB = volByName.get(zB.name);
    const rowsSpec: { label: string; a: number; b: number; unit: string; digits: number }[] = [
      { label: 'Bruto', a: cellNum(sA.gross), b: cellNum(sB.gross), unit: 'm', digits: 2 },
      { label: 'Reservorio neto', a: cellNum(sA.netRes), b: cellNum(sB.netRes), unit: 'm', digits: 2 },
      { label: 'Pay neto', a: cellNum(sA.netPay), b: cellNum(sB.netPay), unit: 'm', digits: 2 },
      { label: 'N/G pay', a: cellNum(sA.ntgPay), b: cellNum(sB.ntgPay), unit: 'v/v', digits: 3 },
      { label: 'φ del pay', a: cellNum(sA.phiPay), b: cellNum(sB.phiPay), unit: 'v/v', digits: 3 },
      { label: 'Sw del pay', a: cellNum(sA.swPay), b: cellNum(sB.swPay), unit: 'v/v', digits: 3 },
      { label: 'h·φ·Sh pay', a: cellNum(sA.hphiShPay), b: cellNum(sB.hphiShPay), unit: 'm', digits: 3 },
    ];
    if (finite(vA?.ooipSi) || finite(vB?.ooipSi)) {
      rowsSpec.push({ label: 'OOIP (Mm³)', a: cellNum(vA?.ooipSi), b: cellNum(vB?.ooipSi), unit: 'Mm³', digits: 1 });
    }
    if (finite(vA?.ogipSi) || finite(vB?.ogipSi)) {
      rowsSpec.push({ label: 'OGIP (MMm³)', a: cellNum(vA?.ogipSi), b: cellNum(vB?.ogipSi), unit: 'MMm³', digits: 2 });
    }

    const tableRows: AssistantTableRow[] = rowsSpec.map((item) => {
      const diff = Number.isFinite(item.a) && Number.isFinite(item.b) ? item.b - item.a : NaN;
      const sign = Number.isFinite(diff) && diff > 0 ? '+' : '';
      return {
        id: item.label,
        cells: [
          { text: item.label },
          { text: Number.isFinite(item.a) ? `${fmtPlain(item.a, item.digits)} ${item.unit}` : '—', numeric: true },
          { text: Number.isFinite(item.b) ? `${fmtPlain(item.b, item.digits)} ${item.unit}` : '—', numeric: true },
          { text: Number.isFinite(diff) ? `${sign}${fmtPlain(diff, item.digits)}` : '—', numeric: true },
        ],
      };
    });

    const dPay = cellNum(sB.netPay) - cellNum(sA.netPay);
    const payLead = Number.isFinite(dPay)
      ? dPay > 0
        ? `La zona ${zB.name} supera a ${zA.name} por ${fmtPlain(dPay, 2)} m de pay neto.`
        : dPay < 0
          ? `La zona ${zA.name} supera a ${zB.name} por ${fmtPlain(-dPay, 2)} m de pay neto.`
          : `Ambas zonas tienen exactamente ${fmtPlain(sA.netPay, 2)} m de pay neto.`
      : `Comparativa entre zona ${zA.name} y zona ${zB.name}.`;

    const actions: Action[] = [
      depthAction((zA.top + zA.base) / 2, `Ver zona ${zA.name}`, { top: zA.top, base: zA.base }),
      depthAction((zB.top + zB.base) / 2, `Ver zona ${zB.name}`, { top: zB.top, base: zB.base }),
      summaryAction,
    ];
    return textAnswer(`Comparación ${zA.name} vs ${zB.name}. ${payLead}`, [SUMMARY_SRC, ...(volRows.length ? [VOLUMETRICS_SRC] : [])], actions, {
      table: {
        columns: [
          { label: 'Métrica' },
          { label: zA.name, numeric: true },
          { label: zB.name, numeric: true },
          { label: `Δ (${zB.name} − ${zA.name})`, numeric: true },
        ],
        rows: tableRows,
      },
    });
  }

  if (intent.mode === 'rank') {
    const meta = COMPARE_META[intent.metric];
    const scored = sumRows
      .map((r) => {
        const zName = String(r.zone ?? '');
        const vr = volByName.get(zName);
        const val = meta.source === 'ooip' ? cellNum(vr?.ooipSi) : meta.source === 'ogip' ? cellNum(vr?.ogipSi) : cellNum(r[intent.metric]);
        return {
          zoneName: zName,
          zone: context.zones.find((z) => z.name === zName),
          value: val,
          netPay: cellNum(r.netPay),
          ntgPay: cellNum(r.ntgPay),
        };
      })
      .filter((x) => Number.isFinite(x.value));

    if (scored.length === 0) {
      return textAnswer(`Ninguna zona tiene dato válido de ${meta.label.toLowerCase()} para armar el ranking.`, [SUMMARY_SRC], [summaryAction]);
    }
    scored.sort((a, b) => (intent.direction === 'max' ? b.value - a.value : a.value - b.value));
    const winner = scored[0]!;
    const tableRows: AssistantTableRow[] = scored.map((item, idx) => ({
      id: `rank-${item.zoneName}`,
      cells: [
        { text: `${idx + 1}. ${item.zoneName}` },
        { text: `${fmtPlain(item.value, meta.digits)} ${meta.unit}`, numeric: true, ...(idx === 0 ? { tone: 'ok' as const } : {}) },
        { text: fmtPlain(item.netPay, 2), numeric: true },
        { text: fmtPlain(item.ntgPay, 3), numeric: true },
      ],
      ...(item.zone ? { action: depthAction((item.zone.top + item.zone.base) / 2, `Ver zona ${item.zoneName}`, { top: item.zone.top, base: item.zone.base }) } : {}),
    }));

    const adj = intent.direction === 'max' ? 'mayor' : 'menor';
    return textAnswer(
      `La zona ${winner.zoneName} tiene el ${adj} ${meta.label.toLowerCase()}: ${fmtPlain(winner.value, meta.digits)} ${meta.unit}.`,
      [meta.source === 'sum' ? SUMMARY_SRC : VOLUMETRICS_SRC],
      [
        ...(winner.zone
          ? [depthAction((winner.zone.top + winner.zone.base) / 2, `Ver zona ${winner.zoneName}`, { top: winner.zone.top, base: winner.zone.base })]
          : []),
        summaryAction,
      ],
      {
        table: {
          columns: [
            { label: 'Zona' },
            { label: `${meta.label} (${meta.unit})`, numeric: true },
            { label: 'Pay (m)', numeric: true },
            { label: 'N/G', numeric: true },
          ],
          rows: tableRows,
        },
      },
    );
  }

  // intent.mode === 'all'
  const tableRows: AssistantTableRow[] = sumRows.map((r) => {
    const zName = String(r.zone ?? '');
    const z = context.zones.find((item) => item.name === zName);
    return {
      id: `all-${zName}`,
      cells: [
        { text: zName },
        { text: fmtPlain(r.gross, 2), numeric: true },
        { text: fmtPlain(r.netRes, 2), numeric: true },
        { text: fmtPlain(r.netPay, 2), numeric: true },
        { text: fmtPlain(r.ntgPay, 3), numeric: true },
        { text: fmtPlain(r.phiPay, 3), numeric: true },
        { text: fmtPlain(r.swPay, 3), numeric: true },
      ],
      ...(z ? { action: depthAction((z.top + z.base) / 2, `Ver zona ${z.name}`, { top: z.top, base: z.base }) } : {}),
    };
  });

  return textAnswer(
    `Comparativa de las ${sumRows.length} zonas del pozo (tocá una fila para verla en el visor).`,
    [SUMMARY_SRC],
    [summaryAction],
    {
      table: {
        columns: [
          { label: 'Zona' },
          { label: 'Bruto (m)', numeric: true },
          { label: 'Res. (m)', numeric: true },
          { label: 'Pay (m)', numeric: true },
          { label: 'N/G', numeric: true },
          { label: 'φ', numeric: true },
          { label: 'Sw', numeric: true },
        ],
        rows: tableRows,
      },
    },
  );
}
