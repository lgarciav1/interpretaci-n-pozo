/**
 * Modo «Preparar defensa» del Asistente v2 (0094): puro, determinista, sin LLM.
 * Audita los resultados vigentes del pozo cargado y genera 0–8 preguntas difíciles de examen oral con evidencia real.
 */
import { coreSets } from '../../modules/core/model';
import { calibCurveKey, calibWindow, porosityCalibration } from '../../modules/core-calibration/model';
import { buildCrossCheckReport, CROSS_CHECK_ID } from '../../modules/cross-check/model';
import { evaluateCutoffScenario } from '../../modules/cutoff-sensitivity/surfaceModel';
import { pressureSets, summarizeMdtZones } from '../../modules/mdt/model';
import { activeWaterDensity, mdtAnalysis } from '../../modules/mdt/series';
import { entryHeights, fitRows, heightContext, MICP_ID, micpSamples, readMicpSettings } from '../../modules/micp/model';
import { CROSS_CHECK_META, type CrossCheckId } from '../../petro/crossCheck';
import { formatNumber } from '../../ui/format';
import {
  cellNum,
  CGR_SRC,
  clientResultOf,
  commandAction,
  CORE_SRC,
  CROSS_CHECK_SRC,
  cutoffAction,
  depthAction,
  DIAGNOSTICS_SRC,
  finite,
  fmt,
  fmtPlain,
  MDT_SRC,
  MICP_SRC,
  MOVABLE_SRC,
  panelAction,
  resolveCurveSeries,
  rowsOf,
  SUMMARY_SRC,
  summaryAction,
  SURFACE_SRC,
  UNCERTAINTY_SRC,
  volumetricsAction,
  warningAction,
} from './resolvers/common';
import type { AssistantContext, DefenseCard } from './types';

const CROSS_CHECK_QUESTIONS: Readonly<Record<CrossCheckId, (zone: string) => string>> = {
  'sw-vs-swi': (z) => `¿Por qué en la zona ${z} una fracción del pay tiene Sw por debajo de Swi de SCAL?`,
  'bound-water': (z) => `¿Cómo explicás la diferencia de agua ligada entre BVW (Archie), BVI (RMN) y SCAL en ${z}?`,
  porosity: (z) => `¿A qué atribuís el sesgo de porosidad entre perfil, RMN y corona en ${z}?`,
  'mdt-vs-sw': (z) => `¿Cómo conciliás el contacto MDT con el pay o arenas acuíferas detectadas en ${z}?`,
  'seal-capacity': () => '¿La presión de desplazamiento (MICP/SCAL) del sello alcanza para sostener la columna de hidrocarburo?',
  'uranium-gr': (z) => `En ${z}, ¿por qué usar o no CGR sin uranio frente al aporte espectral observado?`,
  'hc-movability': (z) => `¿Qué significa la baja fracción de hidrocarburo móvil (MOS/Sh) observada en ${z}?`,
};

const SEV_RANK: Readonly<Record<DefenseCard['severity'], number>> = { error: 0, warn: 1, info: 2 };

export function buildDefensePrep(context: AssistantContext): DefenseCard[] {
  const well = context.well;
  const interp = context.interpretation;
  if (!well || !interp) return [];

  const cards: DefenseCard[] = [];
  const clientRes = clientResultOf(context);
  const zoneByName = new Map(context.zones.map((z) => [z.name, z]));

  // 1. Coherencia cruzada (G08): hasta 2 tensiones + 1 atención
  const ccReport = buildCrossCheckReport(well, interp, clientRes, context.registry);
  const ccItems = [
    ...ccReport.zones.flatMap((r) => Object.values(r.checks)),
    ccReport.seal,
  ];
  const tensions = ccItems.filter((i) => i.status === 'tension').slice(0, 2);
  const warns = tensions.length < 2 ? ccItems.filter((i) => i.status === 'warn').slice(0, 1) : [];
  for (const item of [...tensions, ...warns]) {
    const z = item.zoneId ? context.zones.find((x) => x.id === item.zoneId) : undefined;
    cards.push({
      id: `def-cc-${item.id}-${item.zoneId ?? 'all'}`,
      severity: item.status === 'tension' ? 'error' : 'warn',
      topic: `Coherencia cruzada · ${CROSS_CHECK_META[item.id].shortTitle}`,
      question: CROSS_CHECK_QUESTIONS[item.id](item.zoneName),
      summary: item.headline,
      evidence: [item.detail],
      sources: [CROSS_CHECK_SRC],
      actions: [
        panelAction(CROSS_CHECK_ID, 'Abrir Coherencia cruzada'),
        ...(item.focusRange && z
          ? [depthAction((item.focusRange[0] + item.focusRange[1]) / 2, `Ver zona ${z.name}`, { top: item.focusRange[0], base: item.focusRange[1] })]
          : []),
        { kind: 'ask', question: item.zoneId ? `Coherencia cruzada en zona ${item.zoneName}` : 'Coherencia cruzada', label: 'Consultar detalle' },
      ],
    });
  }

  // 2. Acantilados 2D de cutoffs (G09): evaluación directa sin discretización de grilla
  const nonSealZones = context.zones.filter((z) => z.kind !== 'seal');
  const cliffCandidates: { zoneName: string; zoneTop: number; zoneBase: number; status: 'critical' | 'sensitive'; relPct: number; pay: number; minPay: number; maxPay: number; zeroGain: boolean }[] = [];
  for (const z of nonSealZones) {
    const sim = evaluateCutoffScenario({
      well,
      interpretation: interp,
      result: clientRes,
      zoneId: z.id,
      changes: {},
    });
    if (!sim) continue;
    const st = sim.stability;
    if (st.status === 'critical' || st.status === 'sensitive') {
      cliffCandidates.push({
        zoneName: z.name,
        zoneTop: z.top,
        zoneBase: z.base,
        status: st.status,
        relPct: st.maxRelDelta !== null ? st.maxRelDelta * 100 : 100,
        pay: st.centerValue,
        minPay: st.minValue,
        maxPay: st.maxValue,
        zeroGain: st.zeroCenterWithGain,
      });
    }
  }
  cliffCandidates.sort((a, b) => (a.status === b.status ? b.relPct - a.relPct : a.status === 'critical' ? -1 : 1));
  const worstCliff = cliffCandidates[0];
  if (worstCliff) {
    cards.push({
      id: `def-g09-${worstCliff.zoneName}`,
      severity: worstCliff.status === 'critical' ? 'error' : 'warn',
      topic: 'Sensibilidad 2D de cutoffs (G09)',
      question: `¿Por qué elegiste esos valores de φ_mín y Sw_máx en la zona ${worstCliff.zoneName} si el pay presenta sensibilidad ${worstCliff.status === 'critical' ? 'crítica' : 'marcada'}?`,
      summary: worstCliff.zeroGain
        ? `Pay vigente 0,00 m al borde de un escalón positivo hasta ${fmtPlain(worstCliff.maxPay, 2)} m en ±Δ.`
        : `El pay (${fmtPlain(worstCliff.pay, 2)} m) varía hasta ±${fmtPlain(worstCliff.relPct, 1)} % (${fmtPlain(worstCliff.minPay, 2)}–${fmtPlain(worstCliff.maxPay, 2)} m) ante perturbaciones operativas ±Δ de los cortes.`,
      evidence: [
        `Evaluado exactamente alrededor de los cortes vigentes de ${worstCliff.zoneName} en ±0,01 v/v de φ y ±0,05 v/v de Sw.`,
      ],
      sources: [SURFACE_SRC],
      actions: [
        cutoffAction,
        depthAction((worstCliff.zoneTop + worstCliff.zoneBase) / 2, `Ver zona ${worstCliff.zoneName}`, {
          top: worstCliff.zoneTop,
          base: worstCliff.zoneBase,
        }),
        { kind: 'ask', question: `Estabilidad 2D en zona ${worstCliff.zoneName}`, label: 'Ver estabilidad 2D' },
      ],
    });
  }

  // 3. Pay sin dato o nulo con reservorio (ZONE_SUMMARY)
  const sumRows = rowsOf(context, 'ZONE_SUMMARY').filter((r) => r.zone !== 'Total');
  const gapZones = sumRows
    .map((r) => ({
      name: String(r.zone ?? ''),
      kind: String(r.kind ?? ''),
      netRes: cellNum(r.netRes),
      netPay: cellNum(r.netPay),
      noDataPay: cellNum(r.noDataPay),
    }))
    .filter((r) => r.kind !== 'Sello' && ((Number.isFinite(r.noDataPay) && r.noDataPay > 0.2) || (r.netRes > 0 && !(r.netPay > 0))));
  if (gapZones.length > 0) {
    const g = gapZones.sort((a, b) => (b.noDataPay || 0) - (a.noDataPay || 0))[0]!;
    const z = zoneByName.get(g.name);
    cards.push({
      id: `def-nodata-${g.name}`,
      severity: !Number.isFinite(g.netPay) ? 'error' : 'warn',
      topic: 'Clasificación de pay neto',
      question: `En la zona ${g.name}, ¿qué ocurre con los ${fmtPlain(g.netRes, 2)} m de reservorio neto frente al pay (${fmt(g.netPay)})?`,
      summary:
        Number.isFinite(g.noDataPay) && g.noDataPay > 0
          ? `Quedan ${fmtPlain(g.noDataPay, 2)} m de reservorio neto sin Sw (no clasificados como pay ni no-pay).`
          : `La zona tiene ${fmtPlain(g.netRes, 2)} m de reservorio neto pero el corte de Sw descarta prácticamente todo el espesor.`,
      evidence: [`Verificá cobertura de RT/RXO/PHIE y Rw en ${g.name}.`],
      sources: [SUMMARY_SRC],
      actions: [
        summaryAction,
        cutoffAction,
        ...(z ? [depthAction((z.top + z.base) / 2, `Ver zona ${z.name}`, { top: z.top, base: z.base })] : []),
        { kind: 'ask', question: `¿Por qué la zona ${g.name} tiene poco pay?`, label: 'Analizar pay' },
      ],
    });
  }

  // 4. Calidad de pozo: derrumbes (CALI washout) o efecto barita en PE / PEF
  const washCurve = resolveCurveSeries(context, 'IND_WASHOUT');
  const peCurve = resolveCurveSeries(context, 'PEF') ?? resolveCurveSeries(context, 'PE');
  if (washCurve || peCurve) {
    let worstZone: { name: string; pct: number; top: number; base: number } | null = null;
    if (washCurve) {
      for (const z of nonSealZones) {
        let tot = 0;
        let bad = 0;
        for (let i = 0; i < well.depth.values.length; i++) {
          const d = well.depth.values[i]!;
          if (d < z.top || d > z.base) continue;
          const v = washCurve.data[i]!;
          if (Number.isFinite(v)) {
            tot++;
            if (v >= 0.5) bad++;
          }
        }
        const pct = tot > 0 ? (100 * bad) / tot : 0;
        if (pct >= 10 && (!worstZone || pct > worstZone.pct)) {
          worstZone = { name: z.name, pct, top: z.top, base: z.base };
        }
      }
    }
    let bariteMax = NaN;
    if (peCurve) {
      for (let i = 0; i < peCurve.data.length; i++) {
        const v = peCurve.data[i]!;
        if (Number.isFinite(v) && v > 5.5 && (!Number.isFinite(bariteMax) || v > bariteMax)) bariteMax = v;
      }
    }
    if (worstZone || Number.isFinite(bariteMax)) {
      const msgs: string[] = [];
      if (worstZone) msgs.push(`${fmtPlain(worstZone.pct, 1)} % de muestras con indicador de derrumbe en zona ${worstZone.name}`);
      if (Number.isFinite(bariteMax)) msgs.push(`PE alcanza ${fmtPlain(bariteMax, 2)} b/e (> 5,5 b/e, posible efecto barita en el lodo)`);
      cards.push({
        id: 'def-qc-borehole',
        severity: 'warn',
        topic: 'Calidad de pozo y ambiente',
        question: '¿Cómo afectaron los derrumbes de pared o el lodo baritado a tus curvas de porosidad y litología?',
        summary: msgs.join('; ') + '.',
        evidence: ['Revisá el panel Preparar datos (exclusiones/reconstrucción ML) y el impacto sobre RHOB/PE.'],
        sources: [DIAGNOSTICS_SRC],
        actions: [
          panelAction('preparation', 'Abrir Preparar datos'),
          ...(worstZone ? [depthAction((worstZone.top + worstZone.base) / 2, `Ver zona ${worstZone.name}`, { top: worstZone.top, base: worstZone.base })] : []),
        ],
      });
    }
  }

  // 5. Presiones MDT (G05): compartimentalización o sobrepresión
  const pSets = pressureSets(well.pointSets);
  if (pSets.length > 0) {
    const set = pSets[0]!;
    const dec = interp.pointSets[set.id];
    const rhoW = activeWaterDensity(well, interp, set.id) ?? 1.0;
    const mdtRep = summarizeMdtZones(set, dec, context.zones, { rhoRef: rhoW });
    const mdtAn = mdtAnalysis(well, interp);
    const compZone = mdtRep.zones.find((z) => z.compartmentAlert);
    const mismatchGrad = mdtAn.gradients.find((g) => g.spec.visible && g.mismatch);
    if (compZone || mdtRep.overall.overpressured || mismatchGrad) {
      const details: string[] = [];
      if (compZone) details.push(`Zona ${compZone.name} con densidad aparente ${fmtPlain(compZone.apparentDensityGCm3, 3)} g/cm³ (> 1,25 g/cm³, sello/compartimentalización)`);
      if (mdtRep.overall.overpressured) details.push(`EMW medio ${fmtPlain(mdtRep.overall.emwMeanGCm3, 3)} g/cm³ (> 1,20 g/cm³)`);
      if (mismatchGrad) details.push(`Gradiente «${mismatchGrad.spec.name}» no coincide con el fluido asignado`);
      cards.push({
        id: 'def-mdt-g05',
        severity: compZone || mismatchGrad ? 'warn' : 'info',
        topic: 'Presiones MDT y compartimentos (G05)',
        question: '¿Qué evidencia muestran las presiones MDT sobre sobrepresión, fluidos y compartimentalización del reservorio?',
        summary: details.join('. ') + '.',
        evidence: [`Conjunto «${set.name}», ${mdtRep.overall.n} puntos incluidos.`],
        sources: [MDT_SRC],
        actions: [
          panelAction('mdt', 'Abrir Presiones MDT'),
          { kind: 'ask', question: 'Resumen de presiones MDT', label: 'Ver análisis MDT' },
        ],
      });
    }
  }

  // 6. G06 Uranio / G07 Movilidad
  const uCurve = resolveCurveSeries(context, 'U_GR_FRAC');
  const igrUsesCgr = context.result?.sources?.['IGR']?.kind === 'module' && context.result.sources['IGR'].moduleId === 'igr-cgr';
  if (uCurve && !igrUsesCgr) {
    let highCount = 0;
    let total = 0;
    for (let i = 0; i < uCurve.data.length; i++) {
      const v = uCurve.data[i]!;
      if (Number.isFinite(v)) {
        total++;
        if (v >= 0.2) highCount++;
      }
    }
    const pctHigh = total > 0 ? (100 * highCount) / total : 0;
    if (pctHigh >= 5) {
      cards.push({
        id: 'def-cgr-g06',
        severity: 'info',
        topic: 'GR espectral sin uranio (G06)',
        question: '¿Justificaste si el aporte de uranio distorsiona el cálculo de Vsh a partir del GR total?',
        summary: `En ${fmtPlain(pctHigh, 1)} % de las muestras con espectral, el uranio explica ≥ 20 % del GR y actualmente IGR sigue usando GR total.`,
        evidence: ['Podés comparar IGR con CGR sin uranio en el paso Arcilla.'],
        sources: [CGR_SRC],
        actions: [commandAction('step:shale', 'Abrir Arcilla'), { kind: 'ask', question: 'Resumen de CGR', label: 'Consultar CGR' }],
      });
    }
  }

  const movRows = rowsOf(context, 'MOVABLE_SUMMARY');
  const lowMov = movRows.find((r) => finite(r.movableHcFrac) && finite(r.resolvedPct) && Number(r.resolvedPct) > 20 && Number(r.movableHcFrac) < 0.25);
  if (lowMov) {
    cards.push({
      id: 'def-mov-g07',
      severity: 'warn',
      topic: 'Movilidad de hidrocarburo (G07)',
      question: `¿Por qué la fracción móvil (MOS/Sh) es baja (${fmtPlain(lowMov.movableHcFrac, 2)}) en la zona ${String(lowMov.zone)}?`,
      summary: `Sxo medio ${fmtPlain(lowMov.sxoMean, 3)} v/v frente a Sw medio ${fmtPlain(lowMov.swMean, 3)} v/v (MHI ${fmtPlain(lowMov.mhiMean, 2)}). Puede indicar petróleo pesado, invasión somera o necesidad de ajustar Rmf.`,
      evidence: [`Resolución de invasión en ${String(lowMov.zone)}: ${fmtPlain(lowMov.resolvedPct, 1)} %.`],
      sources: [MOVABLE_SRC],
      actions: [commandAction('step:saturation', 'Abrir Saturación'), { kind: 'ask', question: `Movilidad en zona ${String(lowMov.zone)}`, label: 'Consultar Sxo' }],
    });
  }

  // 7. Incertidumbre Monte Carlo o recordatorio antes de defender reservas
  const torRows = rowsOf(context, 'UNCERTAINTY_TORNADO');
  const uncRows = rowsOf(context, 'UNCERTAINTY');
  const volRows = rowsOf(context, 'VOLUMETRICS');
  if (uncRows.length > 0 && torRows.length > 0) {
    const q =
      uncRows.find((r) => r.key === 'TOTAL_OIL' && torRows.some((t) => t.key === r.key)) ??
      uncRows.find((r) => r.key === 'TOTAL_GAS' && torRows.some((t) => t.key === r.key)) ??
      uncRows.find((r) => torRows.some((t) => String(t.key ?? '') === String(r.key ?? ''))) ??
      uncRows[0]!;
    const matchingTor = torRows.filter((t) => String(t.key ?? '') === String(q.key ?? ''));
    const first = matchingTor[0] ?? torRows[0]!;
    const u = String(q.fieldUnit ?? '');
    cards.push({
      id: 'def-unc-driver',
      severity: 'info',
      topic: 'Incertidumbre y sensibilidad volumétrica',
      question: `¿Cuál es tu rango P90–P10 de volumen in situ y qué parámetro domina la incertidumbre?`,
      summary: `Para ${String(q.target)} (${String(q.fluid)}): P90=${fmtPlain(q.p90Field, 2)} ${u}, P50=${fmtPlain(q.p50Field, 2)} ${u}, P10=${fmtPlain(q.p10Field, 2)} ${u}. Driver #1: ${String(first.label)} (±${fmtPlain(Number(first.swingPct) * 100, 1)} %).`,
      evidence: ['Valores del simulador Monte Carlo y análisis tornado vigentes.'],
      sources: [UNCERTAINTY_SRC],
      actions: [volumetricsAction, { kind: 'ask', question: 'Tornado de incertidumbre', label: 'Ver tornado' }],
    });
  } else if (volRows.length > 0 && uncRows.length === 0) {
    cards.push({
      id: 'def-unc-off',
      severity: 'info',
      topic: 'Incertidumbre volumétrica',
      question: '¿Evaluaste el rango P90 / P50 / P10 alrededor del volumen determinista antes de la defensa?',
      summary: 'La simulación Monte Carlo está actualmente desactivada.',
      evidence: ['Activala en el paso Volumen (módulo Incertidumbre) para obtener cuantiles y tornado.'],
      sources: [UNCERTAINTY_SRC],
      actions: [volumetricsAction],
    });
  }

  // 8. Corona y MICP si hay datos
  const cSets = coreSets(well.pointSets);
  if (cSets.length > 0) {
    const set = cSets[0]!;
    const dec = interp.pointSets[set.id];
    const phiS = resolveCurveSeries(context, calibCurveKey(dec)) ?? resolveCurveSeries(context, 'PHIE');
    if (phiS) {
      const cal = porosityCalibration(set, dec, well.depth.values, phiS.data, calibWindow(dec), null);
      if (cal && cal.stats.n > 0 && Math.abs(cal.stats.bias) >= 0.02) {
        cards.push({
          id: 'def-core-bias',
          severity: Math.abs(cal.stats.bias) >= 0.04 ? 'error' : 'warn',
          topic: 'Calibración con plugs de corona',
          question: '¿Cómo justificás la diferencia sistemática entre la porosidad del perfil y la de plugs de corona?',
          summary: `Sesgo de ${fmtPlain(cal.stats.bias, 4)} v/v sobre ${cal.stats.n} plugs (RMSE ${fmtPlain(cal.stats.rmse, 4)} v/v).`,
          evidence: ['Verificá densidad de matriz (ρma), densidad de fluido y puesta en profundidad de la corona.'],
          sources: [CORE_SRC],
          actions: [panelAction('core-calibration', 'Abrir Calibración'), panelAction('core', 'Abrir Corona')],
        });
      }
    }
  }
  const mSamples = micpSamples(well.pointSets);
  if (mSamples.length > 0) {
    const settings = readMicpSettings(interp.moduleState?.[MICP_ID]);
    const fits = fitRows(mSamples);
    const heights = entryHeights(fits, heightContext(settings)).filter(Number.isFinite);
    if (heights.length > 0) {
      cards.push({
        id: 'def-micp-h',
        severity: 'info',
        topic: 'Presiones capilares MICP',
        question: '¿Qué altura de entrada y qué cutoff de Sw por flujo fraccional sugieren las curvas MICP?',
        summary: `${mSamples.length} curva(s) MICP con altura de entrada entre ${fmtPlain(Math.min(...heights), 1)} m y ${fmtPlain(Math.max(...heights), 1)} m (Δρ = ${fmtPlain(heightContext(settings).deltaRhoGcc, 2)} g/cm³).`,
        evidence: [`Sistema interfacial vigente: ${settings.system}.`],
        sources: [MICP_SRC],
        actions: [panelAction(MICP_ID, 'Abrir MICP'), { kind: 'ask', question: 'Resumen de MICP', label: 'Consultar MICP' }],
      });
    }
  }

  // Silence unused import helper if not needed directly
  void warningAction;
  void formatNumber;

  cards.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]);
  return cards.slice(0, 8);
}

export function formatDefenseForCopy(cards: readonly DefenseCard[], wellName?: string): string {
  if (cards.length === 0) return 'Sin observaciones críticas detectadas para el pozo actual.';
  const title = wellName ? `# Guía de defensa — ${wellName}` : '# Guía de defensa del pozo';
  const body = cards.map((c, idx) => {
    const tag = c.severity === 'error' ? 'CRÍTICO' : c.severity === 'warn' ? 'ATENCIÓN' : 'REVISIÓN';
    return [
      `## ${idx + 1}. [${tag}] ${c.topic}`,
      `**Pregunta probable:** ${c.question}`,
      `**Respuesta / dato:** ${c.summary}`,
      ...(c.evidence.length ? [`**Evidencia:** ${c.evidence.join(' · ')}`] : []),
      `**Fuente:** ${c.sources.join(' · ')}`,
    ].join('\n');
  });
  return `${title}\n\n${body.join('\n\n')}`;
}
