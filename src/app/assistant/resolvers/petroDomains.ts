/**
 * Resolvers de los dominios petrofísicos especializados:
 * Coherencia cruzada (G08), Presiones MDT (G05), SMLP/Lorenz (G03), GR espectral CGR (G06),
 * Movilidad Sxo/MOS/MHI (G07), MICP, Capas de pay/Punzados, Incertidumbre Monte Carlo y Corona.
 */
import { buildCrossCheckReport, CROSS_CHECK_ID } from '../../../modules/cross-check/model';
import { CROSS_CHECK_META, CROSS_CHECK_STATUS_LABEL } from '../../../petro/crossCheck';
import { coreSets } from '../../../modules/core/model';
import {
  CALIB_PARAMS,
  calibCurveKey,
  calibWindow,
  matrixDensityEstimates,
  paramValue,
  plugCementation,
  porosityCalibration,
  rhomaaZoneRows,
} from '../../../modules/core-calibration/model';
import { cellNum as flowCellNum, readFlowState, resolveSmlp, SMLP_CHARACTER_LABEL, SMLP_CHARACTER_TONE, TOTAL_KEY, unitsFor } from '../../../modules/flow-capacity/model';
import { FLUID_LABEL, pressureSets, summarizeMdtZones } from '../../../modules/mdt/model';
import { activeWaterDensity, mdtAnalysis } from '../../../modules/mdt/series';
import { cmrConclusion, cmrRows, entryHeights, fitRows, heightContext, MICP_ID, micpSamples, readMicpSettings } from '../../../modules/micp/model';
import {
  cellNum,
  CGR_SRC,
  clientResultOf,
  commandAction,
  CORE_SRC,
  CROSS_CHECK_SRC,
  depthAction,
  finite,
  FLOW_SRC,
  fmt,
  fmtDepth,
  fmtPlain,
  MDT_SRC,
  MICP_SRC,
  MOVABLE_SRC,
  panelAction,
  PAY_LAYERS_SRC,
  resolveCurveSeries,
  rowsOf,
  summaryAction,
  textAnswer,
  UNCERTAINTY_SRC,
  volumetricsAction,
} from './common';
import type { Action, Answer, AssistantContext, AssistantTableRow, ContextZone, Intent } from '../types';

const STATUS_TONE: Record<'ok' | 'warn' | 'tension' | 'unsupported', 'ok' | 'warn' | 'error' | 'neutral'> = {
  ok: 'ok',
  warn: 'warn',
  tension: 'error',
  unsupported: 'neutral',
};

export function crossCheckAnswer(
  context: AssistantContext,
  intent: Extract<Intent, { kind: 'cross-check' }>,
  zone?: ContextZone,
): Answer {
  const well = context.well;
  const interp = context.interpretation;
  if (!well || !interp) {
    return textAnswer('Necesito el pozo e interpretación activos para auditar coherencia cruzada.', [CROSS_CHECK_SRC], []);
  }
  const report = buildCrossCheckReport(well, interp, clientResultOf(context), context.registry);
  const sealIncluded = !zone;
  const zoneRows = zone ? report.zones.filter((r) => r.zoneId === zone.id) : report.zones;
  const items = [
    ...zoneRows.flatMap((z) => Object.values(z.checks)),
    ...(sealIncluded ? [report.seal] : []),
  ].filter((item) => !intent.checkId || item.id === intent.checkId);

  const relevant = items.filter((i) => i.status === 'tension' || i.status === 'warn');
  const display = (relevant.length > 0 ? relevant : items.filter((i) => i.status !== 'unsupported')).slice(0, 8);

  const summaryMsg = zone
    ? `Coherencia cruzada en zona ${zone.name}: estado general ${CROSS_CHECK_STATUS_LABEL[zoneRows[0]?.worstStatus ?? 'unsupported'].toLowerCase()}.`
    : `Coherencia cruzada del pozo (${CROSS_CHECK_STATUS_LABEL[report.overallStatus]}): ${report.counts.tension} tensión(es), ${report.counts.warn} atención, ${report.counts.ok} acuerdo(s), ${report.counts.unsupported} sin soporte.`;

  const tableRows: AssistantTableRow[] = display.map((item, idx) => ({
    id: `cc-${idx}-${item.id}-${item.zoneId ?? 'all'}`,
    cells: [
      { text: item.zoneName },
      { text: CROSS_CHECK_META[item.id].shortTitle },
      { text: CROSS_CHECK_STATUS_LABEL[item.status], tone: STATUS_TONE[item.status] },
      { text: item.headline },
    ],
    ...(item.focusRange
      ? {
          action: depthAction((item.focusRange[0] + item.focusRange[1]) / 2, `Ver ${item.zoneName}`, {
            top: item.focusRange[0],
            base: item.focusRange[1],
          }),
        }
      : {}),
  }));

  return textAnswer(
    relevant.length === 0 && report.counts.ok === 0
      ? `${summaryMsg} Cargá RMN, SCAL, corona, MDT o espectral para habilitar cruces independientes.`
      : `${summaryMsg}${relevant[0] ? ` Hallazgo principal: ${relevant[0].zoneName} (${CROSS_CHECK_META[relevant[0].id].shortTitle}) — ${relevant[0].headline}.` : ''}`,
    [CROSS_CHECK_SRC],
    [panelAction(CROSS_CHECK_ID, 'Abrir Coherencia cruzada')],
    tableRows.length > 0
      ? {
          table: {
            columns: [{ label: 'Ámbito' }, { label: 'Chequeo' }, { label: 'Estado' }, { label: 'Diagnóstico' }],
            rows: tableRows,
          },
        }
      : {},
  );
}

export function mdtAnswer(
  context: AssistantContext,
  intent: Extract<Intent, { kind: 'mdt' }>,
  zone?: ContextZone,
): Answer {
  const well = context.well;
  const interp = context.interpretation;
  if (!well || !interp) {
    return textAnswer('Necesito el pozo activo para analizar presiones MDT.', [MDT_SRC], []);
  }
  const sets = pressureSets(well.pointSets);
  if (sets.length === 0) {
    return textAnswer(
      'Este pozo no tiene conjuntos de presiones MDT cargados todavía.',
      [MDT_SRC],
      [panelAction('mdt', 'Abrir Presiones MDT')],
    );
  }
  const set = sets[0]!;
  const dec = interp.pointSets[set.id];
  const rhoWater = activeWaterDensity(well, interp, set.id) ?? 1.0;
  const zRep = summarizeMdtZones(set, dec, context.zones, { rhoRef: rhoWater });
  const analysis = mdtAnalysis(well, interp);

  const zonesFiltered = zone ? zRep.zones.filter((z) => z.name === zone.name) : zRep.zones;
  const contacts = analysis.contacts.filter((c) => c.depth !== null && Number.isFinite(c.depth));
  const ovText = zRep.overall.n > 0
    ? `${zRep.overall.n} pruebas incluidas, EMW medio ${fmtPlain(zRep.overall.emwMeanGCm3, 3)} g/cm³ (${fmtPlain(zRep.overall.emwMeanLbGal, 2)} lb/gal)${zRep.overall.overpressured ? ' — indica sobrepresión (> 1,20 g/cm³)' : ''}.`
    : 'No hay pruebas incluidas con presión válida.';
  const compText = zRep.hasCompartmentAlert ? ' Alerta de compartimentalización (ρ_ap > 1,25 g/cm³).' : '';
  const contactText =
    contacts.length > 0
      ? ` Contactos: ${contacts.map((c) => `${c.kind} a ${fmtDepth(c.depth!)}`).join('; ')}.`
      : analysis.gradients.length > 0
        ? ` Gradientes trazados: ${analysis.gradients.filter((g) => g.spec.visible && Number.isFinite(g.density)).map((g) => `${g.fluid ? FLUID_LABEL[g.fluid] : g.spec.name} ${fmtPlain(g.density, 3)} g/cm³`).join(', ') || 'sin ajuste'}.`
        : '';

  const tableRows: AssistantTableRow[] =
    intent.focus === 'contacts' && contacts.length > 0
      ? contacts.map((c, i) => ({
          id: `c-${i}`,
          cells: [
            { text: c.kind },
            { text: fmtDepth(c.depth!), numeric: true },
            { text: `${c.upper.fluid ? FLUID_LABEL[c.upper.fluid] : '?'} / ${c.lower.fluid ? FLUID_LABEL[c.lower.fluid] : '?'}`, numeric: false },
            { text: c.warning ? 'Revisar' : 'Definido', tone: c.warning ? 'warn' : 'ok' },
          ],
          action: depthAction(c.depth!, `Ver ${c.kind} a ${fmtDepth(c.depth!)}`),
        }))
      : zonesFiltered.map((z) => ({
          id: `mdt-${z.key}`,
          cells: [
            { text: z.name },
            { text: String(z.n), numeric: true },
            { text: fmtPlain(z.emwMeanGCm3, 3), numeric: true },
            { text: fmtPlain(z.apparentDensityGCm3, 3), numeric: true },
            {
              text: z.compartmentAlert ? 'Compartim.' : z.invertedAlert ? 'Invertido' : 'Normal',
              tone: z.compartmentAlert ? 'warn' : z.invertedAlert ? 'error' : 'ok',
            },
          ],
          ...(Number.isFinite(z.top) && Number.isFinite(z.base)
            ? { action: depthAction((z.top + z.base) / 2, `Ver ${z.name}`, { top: z.top, base: z.base }) }
            : {}),
        }));

  return textAnswer(
    `Presiones MDT (${set.name}). ${ovText}${compText}${contactText}`,
    [MDT_SRC],
    [panelAction('mdt', 'Abrir Presiones MDT')],
    tableRows.length > 0
      ? {
          table: {
            columns:
              intent.focus === 'contacts' && contacts.length > 0
                ? [{ label: 'Contacto' }, { label: 'MD (m)', numeric: true }, { label: 'Fluidos' }, { label: 'Estado' }]
                : [{ label: 'Zona' }, { label: 'n', numeric: true }, { label: 'EMW (g/cm³)', numeric: true }, { label: 'ρ_ap (g/cm³)', numeric: true }, { label: 'Diagnóstico' }],
            rows: tableRows,
          },
        }
      : {},
  );
}

export function smlpAnswer(context: AssistantContext, zone?: ContextZone): Answer {
  const sumRows = rowsOf(context, 'FLOW_SUMMARY');
  const unitRows = rowsOf(context, 'FLOW_UNITS');
  if (sumRows.length === 0) {
    return textAnswer(
      'Capacidad de flujo y Lorenz (SMLP) no tiene resultados aún (necesita PHIE y PERM).',
      [FLOW_SRC],
      [commandAction('step:permeability', 'Abrir Permeabilidad')],
    );
  }
  const row = zone ? sumRows.find((r) => r.zone === zone.name) : sumRows.find((r) => r.zone === 'Total') ?? sumRows[0];
  if (!row) {
    return textAnswer(`No hay resumen SMLP para la zona ${zone?.name ?? 'solicitada'}.`, [FLOW_SRC], [summaryAction]);
  }
  const key = zone ? zone.id : TOTAL_KEY;
  const units = unitsFor(unitRows, key);
  const flowState = readFlowState(context.interpretation ?? undefined);
  const savedKeys = flowState.breaksByZone[key] ?? [];
  const resolved = resolveSmlp(units, savedKeys);

  const tableRows: AssistantTableRow[] = resolved.subUnits.map((su) => ({
    id: `smlp-${su.label}`,
    cells: [
      { text: su.label },
      { text: `${fmtDepth(su.top)}–${fmtDepth(su.base)}`, numeric: true },
      { text: `${fmtPlain(su.phiHFrac * 100, 1)} %`, numeric: true },
      { text: `${fmtPlain(su.kHFrac * 100, 1)} %`, numeric: true },
      {
        text: su.character ? SMLP_CHARACTER_LABEL[su.character] : '—',
        tone: su.character ? SMLP_CHARACTER_TONE[su.character] : 'neutral',
      },
    ],
    action: depthAction((su.top + su.base) / 2, `Ver ${su.label}`, { top: su.top - 1, base: su.base + 1 }),
  }));

  const lc = flowCellNum(row.lc);
  return textAnswer(
    `${zone ? `Zona ${zone.name}` : 'Conjunto del pozo'}. Coeficiente de Lorenz Lc = ${fmtPlain(lc, 3)}, k·h total = ${fmtPlain(row.kH, 1)} mD·m en ${units.length} tramos. ` +
      `Sub-unidades SMLP activas: ${resolved.subUnits.length} (${savedKeys.length} quiebre(s) guardado(s)).`,
    [FLOW_SRC],
    [summaryAction],
    tableRows.length > 0
      ? {
          table: {
            columns: [
              { label: 'Unidad' },
              { label: 'Tramo MD', numeric: true },
              { label: 'φ·h %', numeric: true },
              { label: 'k·h %', numeric: true },
              { label: 'Carácter SMLP' },
            ],
            rows: tableRows,
          },
        }
      : {},
  );
}

export function cgrAnswer(context: AssistantContext, zone?: ContextZone): Answer {
  const rows = rowsOf(context, 'CGR_CALIBRATION');
  if (rows.length === 0) {
    return textAnswer(
      'El módulo GR espectral sin uranio (CGR) no corrió todavía (requiere curvas de Th y K).',
      [CGR_SRC],
      [commandAction('step:shale', 'Abrir Arcilla')],
    );
  }
  const globalRow = rows.find((r) => r.zoneId === null) ?? rows[0]!;
  const zoneRow = zone ? rows.find((r) => r.zoneId === zone.id || r.scope === zone.name) : undefined;
  const focusRow = zoneRow ?? globalRow;
  const uFrac = resolveCurveSeries(context, 'U_GR_FRAC');
  let uMean = NaN;
  let uMax = NaN;
  if (uFrac && context.well) {
    let sum = 0;
    let cnt = 0;
    const depth = context.well.depth.values;
    for (let i = 0; i < uFrac.data.length; i++) {
      if (zone && (depth[i]! < zone.top || depth[i]! > zone.base)) continue;
      const v = uFrac.data[i]!;
      if (Number.isFinite(v)) {
        sum += v;
        cnt++;
        if (!Number.isFinite(uMax) || v > uMax) uMax = v;
      }
    }
    if (cnt > 0) uMean = sum / cnt;
  }
  const igrSrc = context.result?.sources?.['IGR'];
  const igrUsesCgr = igrSrc?.kind === 'module' && igrSrc.moduleId === 'igr-cgr';

  const tableRows: AssistantTableRow[] = rows.slice(0, 8).map((r, i) => ({
    id: `cgr-${i}`,
    cells: [
      { text: String(r.scope ?? '') },
      { text: String(r.source ?? '') },
      { text: fmtPlain(r.r2, 3), numeric: true },
      { text: String(r.status ?? '') },
    ],
  }));

  const aVal = focusRow.a ?? globalRow.a;
  const bVal = focusRow.b ?? globalRow.b;
  const cVal = focusRow.c ?? globalRow.c;
  const srcVal = focusRow.source ?? globalRow.source;
  const scopeLabel = zoneRow
    ? `Zona ${String(zoneRow.scope)}`
    : zone
      ? `${String(globalRow.scope)} (ámbito ${zone.name})`
      : String(globalRow.scope);

  return textAnswer(
    `GR espectral CGR (${scopeLabel}): coeficientes ${String(srcVal)} (a=${fmtPlain(aVal, 2)}, b=${fmtPlain(bVal, 2)}, c=${fmtPlain(cVal, 2)}, R²=${fmtPlain(focusRow.r2, 3)}). ` +
      (Number.isFinite(uMean) ? `Aporte de uranio: media ${fmtPlain(uMean * 100, 1)} %, máx. ${fmtPlain(uMax * 100, 1)} %. ` : '') +
      `Fuente actual de IGR: ${igrUsesCgr ? 'GR sin uranio (CGR)' : 'GR total'}.`,
    [CGR_SRC],
    [commandAction('step:shale', 'Abrir Arcilla')],
    tableRows.length > 0
      ? {
          table: {
            columns: [{ label: 'Ámbito' }, { label: 'Coeficientes' }, { label: 'R²', numeric: true }, { label: 'Diagnóstico' }],
            rows: tableRows,
          },
        }
      : {},
  );
}

export function movabilityAnswer(context: AssistantContext, zone?: ContextZone): Answer {
  const rows = rowsOf(context, 'MOVABLE_SUMMARY');
  if (rows.length === 0) {
    return textAnswer(
      'Hidrocarburo móvil (Sxo / MOS / MHI) no tiene resultados calculados todavía (requiere Rxo, PHIE y SW).',
      [MOVABLE_SRC],
      [commandAction('step:saturation', 'Abrir Saturación')],
    );
  }
  const picked = zone ? rows.filter((r) => r.zone === zone.name) : rows;
  const focus = picked[0] ?? rows[0]!;
  const tableRows: AssistantTableRow[] = picked.map((r) => ({
    id: `mov-${String(r.zone)}`,
    cells: [
      { text: String(r.zone ?? '') },
      { text: `${fmtPlain(r.resolvedPct, 1)} %`, numeric: true },
      { text: fmtPlain(r.sxoMean, 3), numeric: true },
      { text: fmtPlain(r.mosMean, 3), numeric: true },
      { text: fmtPlain(r.movableHcFrac, 3), numeric: true },
      { text: fmtPlain(r.mhiMean, 3), numeric: true },
    ],
  }));

  return textAnswer(
    `${zone ? `Zona ${zone.name}` : 'Resumen de movilidad (Sxo / MOS)'}: invasión resuelta ${fmtPlain(focus.resolvedPct, 1)} %, Sxo medio ${fmtPlain(focus.sxoMean, 3)} v/v, ` +
      `MOS medio ${fmtPlain(focus.mosMean, 3)} v/v, fracción móvil ${fmtPlain(focus.movableHcFrac, 3)}, MHI (Sw/Sxo) ${fmtPlain(focus.mhiMean, 3)}.`,
    [MOVABLE_SRC],
    [commandAction('step:saturation', 'Abrir Saturación'), panelAction('invasion-radial', 'Abrir Perfil radial')],
    tableRows.length > 0
      ? {
          table: {
            columns: [
              { label: 'Zona' },
              { label: 'Invasión %', numeric: true },
              { label: 'Sxo', numeric: true },
              { label: 'MOS', numeric: true },
              { label: 'HC móvil/Sh', numeric: true },
              { label: 'MHI', numeric: true },
            ],
            rows: tableRows,
          },
        }
      : {},
  );
}

export function micpAnswer(context: AssistantContext): Answer {
  const well = context.well;
  const interp = context.interpretation;
  if (!well || !interp) {
    return textAnswer('Necesito el pozo activo para consultar las curvas MICP.', [MICP_SRC], []);
  }
  const samples = micpSamples(well.pointSets);
  if (samples.length === 0) {
    return textAnswer('El pozo no tiene curvas de presión capilar (MICP) cargadas.', [MICP_SRC], [panelAction(MICP_ID, 'Abrir MICP')]);
  }
  const settings = readMicpSettings(interp.moduleState?.[MICP_ID]);
  const fits = fitRows(samples);
  const hCtx = heightContext(settings);
  const heights = entryHeights(fits, hCtx);

  const bvi = resolveCurveSeries(context, 'BVI_NMR');
  const phie = resolveCurveSeries(context, 'PHIE');
  let cmrMsg = '';
  if (bvi && phie) {
    const concl = cmrConclusion(cmrRows(well.depth.values, bvi.data, phie.data, samples, hCtx));
    if (concl) {
      cmrMsg = ` Contraste CMR/MICP a 100 psi: cociente ${fmtPlain(concl.ratio[0], 2)}–${fmtPlain(concl.ratio[1], 2)} (${concl.n} muestras).`;
    }
  }

  const tableRows: AssistantTableRow[] = fits.slice(0, 8).map((f, i) => ({
    id: `micp-${f.sample.id}`,
    cells: [
      { text: f.sample.label },
      { text: finite(f.sample.depthM) ? fmtDepth(f.sample.depthM) : '—', numeric: true },
      { text: f.thomeer ? fmtPlain(f.thomeer.pd, 1) : '—', numeric: true },
      { text: f.thomeer ? fmtPlain(f.thomeer.g, 2) : '—', numeric: true },
      { text: fmtPlain(f.kSwanson, 2), numeric: true },
      { text: fmtPlain(heights[i], 1), numeric: true },
    ],
    ...(finite(f.sample.depthM) ? { action: depthAction(f.sample.depthM, `Ver ${f.sample.label}`) } : {}),
  }));

  return textAnswer(
    `Análisis MICP: ${samples.length} curva(s) evaluadas (sistema ${settings.system === 'gas-water' ? 'gas–agua' : 'petróleo–agua'}, Δρ = ${fmtPlain(hCtx.deltaRhoGcc, 2)} g/cm³).${cmrMsg}`,
    [MICP_SRC],
    [panelAction(MICP_ID, 'Abrir MICP')],
    {
      table: {
        columns: [
          { label: 'Muestra' },
          { label: 'MD', numeric: true },
          { label: 'Pd (psi)', numeric: true },
          { label: 'G', numeric: true },
          { label: 'k Swanson (mD)', numeric: true },
          { label: 'h entrada (m)', numeric: true },
        ],
        rows: tableRows,
      },
    },
  );
}

export function payLayersAnswer(context: AssistantContext, zone?: ContextZone): Answer {
  const rows = rowsOf(context, 'PAY_INTERVALS');
  if (rows.length === 0) {
    return textAnswer(
      'No hay capas de pay ni punzados sugeridos que superen los criterios actuales (verificá cutoffs y espesor mínimo).',
      [PAY_LAYERS_SRC],
      [summaryAction],
    );
  }
  const filtered = zone ? rows.filter((r) => r.zone === zone.name || r.zoneId === zone.id) : rows;
  if (filtered.length === 0) {
    return textAnswer(`Ninguna capa sugerida en la zona ${zone!.name} supera el espesor mínimo.`, [PAY_LAYERS_SRC], [summaryAction]);
  }
  const top = filtered[0]!;
  const tableRows: AssistantTableRow[] = filtered.slice(0, 6).map((r, i) => ({
    id: `layer-${i}`,
    cells: [
      { text: String(r.rank ?? i + 1) },
      { text: String(r.zone ?? '') },
      { text: `${fmtDepth(cellNum(r.top))}–${fmtDepth(cellNum(r.base))}`, numeric: true },
      { text: fmtPlain(r.net, 2), numeric: true },
      { text: fmtPlain(r.phi, 3), numeric: true },
      { text: fmtPlain(r.sw, 3), numeric: true },
      { text: finite(r.khPct) ? `${fmtPlain(r.khPct, 1)} %` : '—', numeric: true },
    ],
    action: depthAction((cellNum(r.top) + cellNum(r.base)) / 2, `Ver capa #${String(r.rank)}`, {
      top: cellNum(r.top) - 2,
      base: cellNum(r.base) + 2,
    }),
  }));

  return textAnswer(
    `${filtered.length} capa(s) de pay${zone ? ` en zona ${zone.name}` : ''}. Mejor intervalo #${String(top.rank)} (${String(top.zone)}, ${fmtDepth(cellNum(top.top))}–${fmtDepth(cellNum(top.base))}): espesor neto ${fmt(top.net)}, φ=${fmtPlain(top.phi, 3)}, Sw=${fmtPlain(top.sw, 3)}` +
      (finite(top.khPct) ? `, aporta ${fmtPlain(top.khPct, 1)} % del k·h.` : '.'),
    [PAY_LAYERS_SRC],
    [summaryAction],
    {
      table: {
        columns: [
          { label: '#' },
          { label: 'Zona' },
          { label: 'Tope–Base MD', numeric: true },
          { label: 'Pay (m)', numeric: true },
          { label: 'φ', numeric: true },
          { label: 'Sw', numeric: true },
          { label: '% k·h', numeric: true },
        ],
        rows: tableRows,
      },
    },
  );
}

export function uncertaintyAnswer(
  context: AssistantContext,
  intent: Extract<Intent, { kind: 'uncertainty' }>,
  zone?: ContextZone,
): Answer {
  const sumRows = rowsOf(context, 'UNCERTAINTY');
  const torRows = rowsOf(context, 'UNCERTAINTY_TORNADO');
  if (sumRows.length === 0) {
    return textAnswer(
      'La simulación Monte Carlo de incertidumbre está desactivada o sin zonas con volumen. Activá «Calcular simulación» en el módulo Incertidumbre del paso Volumen.',
      [UNCERTAINTY_SRC],
      [volumetricsAction],
    );
  }
  const totalRows = !zone
    ? sumRows.filter((r) => r.key === 'TOTAL_OIL' || r.key === 'TOTAL_GAS')
    : [];
  const pickedRows = zone
    ? sumRows.filter((r) => r.target === zone.name || r.key === zone.id)
    : totalRows.length > 0
      ? totalRows
      : sumRows.slice(0, 1);

  const primaryRow = pickedRows[0];
  if (!primaryRow) {
    return textAnswer(`No hay cuantiles P90/P50/P10 para la zona ${zone?.name ?? 'elegida'}.`, [UNCERTAINTY_SRC], [volumetricsAction]);
  }

  const torKey = String(primaryRow.key ?? '');
  const drivers = torRows.filter((r) => String(r.key ?? '') === torKey).slice(0, 4);
  const topDriver = drivers[0];
  const showQuantileTable = pickedRows.length > 1 || (intent.focus === 'quantiles' && drivers.length === 0) || drivers.length === 0;

  const summaryLines = pickedRows.map((row) => {
    const u = String(row.fieldUnit ?? '');
    return `Incertidumbre (${String(row.target)}, ${String(row.fluid)}): P90 = ${fmtPlain(row.p90Field, 2)} ${u}, P50 = ${fmtPlain(row.p50Field, 2)} ${u}, P10 = ${fmtPlain(row.p10Field, 2)} ${u}`;
  });
  if (topDriver) {
    summaryLines.push(
      `Parámetro dominante en ${String(primaryRow.target)}: ${String(topDriver.label)} (amplitud ${fmtPlain(Number(topDriver.swingPct) * 100, 1)} % sobre el caso base)`,
    );
  }

  const tableRows: AssistantTableRow[] =
    !showQuantileTable || (intent.focus === 'tornado' && drivers.length > 0)
      ? drivers.map((d) => ({
          id: `tor-${String(d.param)}`,
          cells: [
            { text: `${String(d.rank)}. ${String(d.label ?? d.param)}` },
            { text: fmtPlain(d.base, 0), numeric: true },
            { text: fmtPlain(d.swing, 0), numeric: true },
            { text: finite(d.swingPct) ? `${fmtPlain(Number(d.swingPct) * 100, 1)} %` : '—', numeric: true },
          ],
        }))
      : pickedRows.map((row, idx) => {
          const u = String(row.fieldUnit ?? '');
          return {
            id: `q-row-${idx}-${String(row.key)}`,
            cells: [
              { text: `${String(row.target ?? '')} (${String(row.fluid ?? '')})` },
              { text: `${fmtPlain(row.p90Field, 2)} ${u}`, numeric: true },
              { text: `${fmtPlain(row.p50Field, 2)} ${u}`, numeric: true },
              { text: `${fmtPlain(row.p10Field, 2)} ${u}`, numeric: true },
            ],
          };
        });

  return textAnswer(
    `${summaryLines.join('. ')}.`,
    [UNCERTAINTY_SRC],
    [volumetricsAction],
    {
      table: {
        columns:
          !showQuantileTable || (intent.focus === 'tornado' && drivers.length > 0)
            ? [{ label: 'Parámetro' }, { label: 'Base (m³)', numeric: true }, { label: 'Amplitud (m³)', numeric: true }, { label: 'Impacto', numeric: true }]
            : [{ label: 'Objetivo' }, { label: 'P90 (bajo)', numeric: true }, { label: 'P50', numeric: true }, { label: 'P10 (alto)', numeric: true }],
        rows: tableRows,
      },
    },
  );
}

export function coreAnswer(context: AssistantContext, zone?: ContextZone): Answer {
  const well = context.well;
  const interp = context.interpretation;
  const actions: Action[] = [panelAction('core-calibration', 'Abrir Calibración'), panelAction('core', 'Abrir Corona')];
  if (!well || !interp) {
    return textAnswer('Necesito el pozo activo para resumir calibración con corona y densidad de matriz.', [CORE_SRC], actions);
  }
  const sets = coreSets(well.pointSets);
  const rhoRows = rowsOf(context, 'RHOMAA_ZONES');
  if (sets.length === 0 && rhoRows.length === 0) {
    return textAnswer('El pozo no tiene plugs de corona cargados ni tabla ρmaa activa.', [CORE_SRC], actions);
  }

  const msgs: string[] = [];
  const tableRows: AssistantTableRow[] = [];

  if (sets.length > 0) {
    const set = sets[0]!;
    const dec = interp.pointSets[set.id];
    const scope = zone ? { zones: interp.zones, zoneId: zone.id } : null;
    const logPhi = resolveCurveSeries(context, calibCurveKey(dec)) ?? resolveCurveSeries(context, 'PHIE');
    if (logPhi) {
      const cal = porosityCalibration(set, dec, well.depth.values, logPhi.data, calibWindow(dec), scope);
      if (cal && cal.stats.n > 0) {
        msgs.push(
          `Calibración φ vs. ${set.name} (${cal.stats.n} plugs): sesgo ${fmtPlain(cal.stats.bias, 4)} v/v, RMSE ${fmtPlain(cal.stats.rmse, 4)} v/v` +
            (finite(cal.stats.r2) ? `, R² = ${fmtPlain(cal.stats.r2, 3)}` : ''),
        );
        tableRows.push({
          id: 'core-phi',
          cells: [
            { text: `φ perfil vs plugs (n=${cal.stats.n})` },
            { text: fmtPlain(cal.stats.bias, 4), numeric: true },
            { text: fmtPlain(cal.stats.rmse, 4), numeric: true },
            { text: finite(cal.stats.r2) ? fmtPlain(cal.stats.r2, 3) : '—', numeric: true },
          ],
        });
      }
    }
    const rhoFl = paramValue(interp.params, CALIB_PARAMS.rhoFl, zone?.id ?? null);
    const aParam = paramValue(interp.params, CALIB_PARAMS.a, zone?.id ?? null);
    const rhob = resolveCurveSeries(context, 'RHOB');
    const rhoEst = matrixDensityEstimates(set, dec, well.depth.values, rhob?.data ?? null, rhoFl, calibWindow(dec), scope);
    if (rhoEst.grain || rhoEst.fit) {
      const grainTxt = rhoEst.grain ? `grano P50=${fmtPlain(rhoEst.grain.median, 3)} g/cm³` : '';
      const fitTxt = rhoEst.fit ? `ρma ajustada=${fmtPlain(rhoEst.fit.rhoMa, 3)} g/cm³ (ρf=${fmtPlain(rhoFl, 2)})` : '';
      msgs.push([grainTxt, fitTxt].filter(Boolean).join(', '));
    }
    const cem = plugCementation(set, dec, aParam, scope);
    if (cem && finite(cem.fixedA?.m)) {
      msgs.push(`exponente m desde F (a=${fmtPlain(aParam, 2)}): ${fmtPlain(cem.fixedA!.m, 2)} (R²=${fmtPlain(cem.fixedA!.r2, 3)})`);
    }
  }

  const parsedRho = rhomaaZoneRows(rhoRows);
  const targetRho = zone ? parsedRho.find((r) => r.zoneId === zone.id) : parsedRho.at(-1);
  if (targetRho && finite(targetRho.median)) {
    msgs.push(`ρmaa mediana (${targetRho.zone}): ${fmtPlain(targetRho.median, 3)} g/cm³ (n=${targetRho.n})`);
  }

  return textAnswer(
    msgs.length > 0 ? `${msgs.join('. ')}.` : 'Sin suficientes plugs válidos en el ámbito consultado para ajustar calibración.',
    [CORE_SRC],
    actions,
    tableRows.length > 0
      ? {
          table: {
            columns: [{ label: 'Ajuste' }, { label: 'Sesgo', numeric: true }, { label: 'RMSE', numeric: true }, { label: 'R²', numeric: true }],
            rows: tableRows,
          },
        }
      : {},
  );
}
