import { beforeAll, describe, expect, it } from 'vitest';
import tp from '../datos/pozo_tp_perfiles.csv?raw';
import { buildEquationEntries } from '../src/app/ecuaciones/model';
import {
  answerQuestion,
  buildAutocomplete,
  buildDefensePrep,
  buildDynamicChips,
  formatAnswerForCopy,
  formatDefenseForCopy,
  type AssistantContext,
} from '../src/app/assistant/model';
import { engineContext } from '../src/core/engine/context';
import type { ClientResult } from '../src/core/engine/client';
import { activeOutput, computeOnce, toEngineWell, type EngineRunResult } from '../src/core/engine/engine';
import { emptyInterpretation, type Interpretation } from '../src/core/interpretation';
import { emptyHistory, recordChange, undo } from '../src/core/state/history';
import { addPointSet } from '../src/core/state/pointSets';
import { addWell, createProject, setParam } from '../src/core/state/project';
import { createSnapshot } from '../src/core/state/snapshots';
import { sampleThickness, type Curve, type Well } from '../src/core/well';
import { readWellFile } from '../src/io';
import { registry } from '../src/modules';
import { CALIB_CURVE_SETTING, CALIB_PARAMS } from '../src/modules/core-calibration/model';
import { setCutoffPairRecipe } from '../src/modules/cutoff-sensitivity/surfaceModel';
import { tpCoreSet } from '../src/modules/core/tp';
import { MDT_PROVIDER_ID, mdtSeriesKey } from '../src/modules/mdt/model';
import { tpMdtSet } from '../src/modules/mdt/tp';
import { tpMicpSet } from '../src/modules/rock-typing/tp';
import { evalCutoffPairPoint } from '../src/petro/sensitivity';
import { makeSelection, selectionTitle } from '../src/plots/link';
import { formatNumber } from '../src/ui/format';

function asClientResult(res: EngineRunResult, well: Well, interp: Interpretation): ClientResult {
  const ew = toEngineWell(well);
  return {
    ...res,
    context: engineContext(ew, interp),
    seq: 1,
    wellId: well.id,
    gen: 1,
    roundTripMs: 1,
    coalesced: 0,
  };
}

let richCtx: AssistantContext;
let baseWell: Well;
let baseInterp: Interpretation;
let baseResult: ClientResult;
let snapshotId: string;
let baseProjectWithSnap: ReturnType<typeof createProject>;

beforeAll(() => {
  const { well: rawWell, zones } = readWellFile(tp, 'pozo_tp_perfiles.csv');
  // Sumar curvas espectrales sintéticas de TH/K/U sobre la malla del TP para ejercitar CGR G06 junto a datos reales
  const n = rawWell.depth.values.length;
  const thData = new Float64Array(n).fill(8);
  const kData = new Float64Array(n).fill(2);
  const uData = Float64Array.from(rawWell.depth.values, (_, i) => (i % 5 === 0 ? 6 : 1.5));
  const rxoData = rawWell.curves.find((c) => c.role === 'RXO')?.data ?? Float64Array.from(
    rawWell.curves.find((c) => c.role === 'RT')!.data,
    (rt) => (Number.isFinite(rt) ? Math.max(0.5, rt * 0.45) : NaN),
  );

  const makeCurve = (c: Curve): Curve => c;
  const wellBase: Well = {
    ...rawWell,
    curves: [
      ...rawWell.curves,
      makeCurve({ id: 'TH', mnemonic: 'THOR', role: 'TH', unit: 'ppm', data: thData, origin: { kind: 'measured' } }),
      makeCurve({ id: 'K', mnemonic: 'POTA', role: 'K', unit: '%', data: kData, origin: { kind: 'measured' } }),
      makeCurve({ id: 'U', mnemonic: 'URAN', role: 'U', unit: 'ppm', data: uData, origin: { kind: 'measured' } }),
      ...(rawWell.curves.some((c) => c.role === 'RXO')
        ? []
        : [makeCurve({ id: 'RXO_SYN', mnemonic: 'RXO', role: 'RXO', unit: 'ohm.m', data: rxoData, origin: { kind: 'measured' } })]),
    ],
  };

  let project = addWell(createProject(), wellBase, zones);
  project = addPointSet(project, wellBase.id, tpMdtSet('mdt-tp'));
  project = addPointSet(project, wellBase.id, tpCoreSet('core-tp'));
  project = addPointSet(project, wellBase.id, tpMicpSet('micp-tp'));

  // Snapshot inicial antes de ajustar parámetros
  const snapRes = createSnapshot(project, wellBase.id, 'Base inicial', { id: 'snap-base' });
  project = snapRes.project;
  snapshotId = snapRes.snapshot.id;

  // Configuramos área en zona D, tendencia MDT y Monte Carlo activo
  const dZone = zones.find((z) => z.name === 'D')!;
  const bZone = zones.find((z) => z.name === 'B')!;
  project = setParam(project, wellBase.id, 'area', 2.5, dZone.id);
  project = setParam(project, wellBase.id, 'area', 1.8, bZone.id);
  project = setParam(project, wellBase.id, 'uncertainty.calculate', true, null);
  project = setParam(project, wellBase.id, 'uncertainty.iterations', 200, null);

  baseProjectWithSnap = project;
  const entry = project.wells.find((w) => w.well.id === wellBase.id)!;
  entry.interpretation.trends.push({
    id: 'mdt-all',
    name: 'Gradiente general',
    visible: true,
    series: { provider: MDT_PROVIDER_ID, key: mdtSeriesKey('mdt-tp') },
    model: 'linear',
    mode: 'fit',
    selection: { excluded: [] },
    extend: true,
  });

  baseWell = entry.well;
  baseInterp = entry.interpretation;
  const rawComputed = computeOnce(registry, toEngineWell(baseWell), baseInterp);
  baseResult = asClientResult(rawComputed, baseWell, baseInterp);

  richCtx = {
    zones: baseInterp.zones,
    result: baseResult,
    equations: buildEquationEntries(registry),
    commands: [
      { id: 'dock:crossplot', title: 'Abrir la pestaña Crossplot', group: 'Paneles', run() {} },
      { id: 'file:save', title: 'Guardar el proyecto', group: 'Proyecto', run() {} },
    ],
    nextStep: { id: 'summary', title: 'Sumario por zona' },
    well: baseWell,
    rawWell: baseWell,
    interpretation: baseInterp,
    clientResult: baseResult,
    snapshots: project.snapshots.filter((s) => s.wellId === baseWell.id),
    registry,
    traceCurves: baseWell.curves,
  };
});

describe('Asistente v2 — parser determinista y tolerancia tipográfica', () => {
  it('tolera errores tipográficos leves en palabras largas y protege palabras cortas / navegación', () => {
    const archie = answerQuestion('¿Como funicona Arhcie?', richCtx);
    expect(archie.actions).toContainEqual(expect.objectContaining({ kind: 'equation', id: 'sw-archie' }));
    expect(archie.text).toMatch(/arenas limpias/);

    const phi = answerQuestion('porocidad del pay total', richCtx);
    expect(phi.text).toMatch(/Total de las zonas\. φ media del pay:/);
    expect(phi.sources.join(' ')).toContain('ZONE_SUMMARY');

    // Tokens cortos (zonas A-E, roles cortos) no deben corregirse a otra cosa
    expect(answerQuestion('Pay neto en zona Z', richCtx).text).toContain('No encontré');
    expect(answerQuestion('Quiero abrir el crossplot', richCtx)).toMatchObject({
      text: expect.stringContaining('No reconocí'),
      actions: [{ kind: 'command', id: 'dock:crossplot' }],
    });
    expect(answerQuestion('Guardá el proyecto', richCtx).actions).toEqual([]);
  });
});

describe('Asistente v2 — volumetría, comparación multi-zona y memoria corta', () => {
  it('responde volumetría (OOIP) y comparativas entre zonas con filas clicables', () => {
    const ooip = answerQuestion('¿Cuánto petróleo in situ (OOIP) hay?', richCtx);
    expect(ooip.text).toMatch(/OOIP.*Mm³.*MMbbl/);
    expect(ooip.table?.rows.length).toBe(baseInterp.zones.length);
    expect(ooip.sources.join(' ')).toContain('VOLUMETRICS');

    const best = answerQuestion('¿Qué zona tiene más pay?', richCtx);
    expect(best.text).toMatch(/La zona [A-E] tiene el mayor pay neto:/);
    expect(best.table?.rows[0]?.action?.kind).toBe('depth');

    const pair = answerQuestion('Compará zona B vs zona D', richCtx);
    expect(pair.text).toContain('Comparación B vs D');
    expect(pair.table?.columns.map((c) => c.label)).toEqual(['Métrica', 'B', 'D', 'Δ (D − B)']);
    expect(pair.actions.some((a) => a.kind === 'depth' && a.label.includes('D'))).toBe(true);

    const all = answerQuestion('Compará todas las zonas', richCtx);
    expect(all.table?.rows.length).toBe(baseInterp.zones.length);
  });

  it('soporta repreguntas contextuales manteniendo la intención previa', () => {
    const q1 = answerQuestion('Pay neto en zona D', richCtx);
    expect(q1.intent?.kind).toBe('summary');

    const f1 = answerQuestion('¿y en la zona E?', { ...richCtx, previousIntent: q1.intent });
    expect(f1.text).toMatch(/^Zona E\. Pay neto:/);

    const fTotal = answerQuestion('¿y en el total?', { ...richCtx, previousIntent: q1.intent });
    expect(fTotal.text).toMatch(/^Total de las zonas\. Pay neto:/);

    const v1 = answerQuestion('¿Cuánto petróleo in situ hay en zona D?', richCtx);
    const vGas = answerQuestion('¿y para gas?', { ...richCtx, previousIntent: v1.intent });
    expect(vGas.intent).toMatchObject({ kind: 'volume', fluid: 'gas', zone: 'd' });

    const c1 = answerQuestion('¿Qué pasa si pongo Sw a 0,55 en zona D?', richCtx);
    const c2 = answerQuestion('¿y a 50 %?', { ...richCtx, previousIntent: c1.intent });
    expect(c2.intent).toMatchObject({ kind: 'cutoff', variable: 'sw', threshold: 0.5, zone: 'd' });
  });
});

describe('Asistente v2 — simulación exacta 1D/2D, estabilidad G09 y Ctrl+Z atómico', () => {
  it('simula 2 cutoffs exactamente igual a evalCutoffPairPoint y revierte en 1 solo Ctrl+Z', () => {
    const dZone = baseInterp.zones.find((z) => z.name === 'D')!;
    const ans = answerQuestion('¿Qué pasa si pongo φ a 0,12 y Sw a 0,55 en zona D?', richCtx);
    expect(ans.text).toContain('Simulación exacta con φ = 0,120 v/v y Sw = 0,550 v/v');

    // Verificación numérica exacta contra el kernel petrofísico
    const depth = baseWell.depth.values;
    const thickness = sampleThickness(depth);
    let start = 0;
    let end = depth.length;
    while (start < depth.length && depth[start]! < dZone.top) start++;
    while (end > start && depth[end - 1]! > dZone.base) end--;

    const vsh = activeOutput(baseResult.outputs, 'VSH')!.value as Float64Array;
    const phie = activeOutput(baseResult.outputs, 'PHIE')!.value as Float64Array;
    const sw = activeOutput(baseResult.outputs, 'SW')!.value as Float64Array;
    const expectedPt = evalCutoffPairPoint(
      vsh,
      phie,
      sw,
      thickness,
      { vshMax: 0.4, phiMin: 0.12, swMax: 0.55 },
      'phi-sw',
      0.12,
      0.55,
      [{ start, end }],
    );
    expect(ans.text).toContain(`${formatNumber(expectedPt.netPay, { digits: 2 })} m`);

    const applyAction = ans.actions.find((a) => a.kind === 'apply-cutoffs');
    expect(applyAction).toBeDefined();
    expect(applyAction?.kind === 'apply-cutoffs' ? applyAction.updates : []).toEqual([
      { key: 'phiCutoff', value: 0.12 },
      { key: 'swCutoff', value: 0.55 },
    ]);

    // Aplicar vía setCutoffPairRecipe y deshacer atómicamente con un único undo()
    if (applyAction?.kind === 'apply-cutoffs') {
      const prev = baseProjectWithSnap;
      const next = setCutoffPairRecipe(prev, baseWell.id, applyAction.zoneId, applyAction.updates);
      const history = recordChange(emptyHistory(), prev, 'Aplicar cutoffs simulados', 1000);
      const afterEntry = next.wells.find((w) => w.well.id === baseWell.id)!;
      expect(afterEntry.interpretation.params.zones[dZone.id]?.phiCutoff).toBe(0.12);
      expect(afterEntry.interpretation.params.zones[dZone.id]?.swCutoff).toBe(0.55);

      const undone = undo(history, next);
      expect(undone).not.toBeNull();
      const restoredEntry = undone!.project.wells.find((w) => w.well.id === baseWell.id)!;
      expect(restoredEntry.interpretation.params.zones[dZone.id]?.phiCutoff).toBeUndefined();
      expect(restoredEntry.interpretation.params.zones[dZone.id]?.swCutoff).toBeUndefined();
    }
  });

  it('evalúa estabilidad 2D G09 por zona y en tabla general', () => {
    const stabAll = answerQuestion('Estabilidad 2D de cutoffs', richCtx);
    expect(stabAll.sources.join(' ')).toContain('G09');
    expect(stabAll.table?.rows.length).toBeGreaterThanOrEqual(4);

    const stabD = answerQuestion('Estabilidad 2D en zona D', richCtx);
    expect(stabD.text).toMatch(/Zona D \(φ × Sw\)\. Estabilidad 2D: (Estable|Sensible|Crítica)/);
  });
});

describe('Asistente v2 — profundidad @ MD, trazabilidad y filtro booleano conectado', () => {
  it('explica por qué una cota específica no es pay y traza el origen de PHIE', () => {
    const payCurve = activeOutput(baseResult.outputs, 'NET_PAY')!.value as Float64Array;
    const dZone = baseInterp.zones.find((z) => z.name === 'D')!;
    let failDepth = -1;
    let passDepth = -1;
    for (let i = 0; i < baseWell.depth.values.length; i++) {
      const z = baseWell.depth.values[i]!;
      if (z < dZone.top || z > dZone.base) continue;
      if (failDepth < 0 && payCurve[i] === 0) failDepth = z;
      if (passDepth < 0 && payCurve[i] === 1) passDepth = z;
    }
    expect(failDepth).toBeGreaterThan(0);
    expect(passDepth).toBeGreaterThan(0);

    const whyFail = answerQuestion(`¿Por qué a ${failDepth.toFixed(1)} m no es pay?`, richCtx);
    expect(whyFail.text).toContain('NO es pay');
    expect(whyFail.table?.rows.some((r) => r.cells.some((c) => c.tone === 'error'))).toBe(true);

    const whyPass = answerQuestion(`¿Por qué a ${passDepth.toFixed(1)} m no es pay?`, richCtx);
    expect(whyPass.text).toContain('SÍ clasifica como pay neto');

    const prov = answerQuestion(`¿De dónde sale PHIE a ${passDepth.toFixed(1)} m?`, richCtx);
    expect(prov.text).toContain('PHIE a');
    expect(prov.actions).toContainEqual(expect.objectContaining({ kind: 'provenance' }));
  });

  it('construye máscara booleana exacta y la conecta con PlotSelection y bandera G02', () => {
    const dZone = baseInterp.zones.find((z) => z.name === 'D')!;
    const phie = activeOutput(baseResult.outputs, 'PHIE')!.value as Float64Array;
    const sw = activeOutput(baseResult.outputs, 'SW')!.value as Float64Array;

    const ans = answerQuestion('Resaltá donde φ > 0,15 y Sw < 0,4 en zona D', richCtx);
    const selAct = ans.actions.find((a) => a.kind === 'apply-selection');
    const flagAct = ans.actions.find((a) => a.kind === 'save-selection-flag');
    expect(selAct).toBeDefined();
    expect(flagAct).toBeDefined();

    if (selAct?.kind === 'apply-selection') {
      let expectedCount = 0;
      for (let i = 0; i < baseWell.depth.values.length; i++) {
        const d = baseWell.depth.values[i]!;
        const inZone = d >= dZone.top && d <= dZone.base;
        const ok = inZone && Number.isFinite(phie[i]!) && phie[i]! > 0.15 && Number.isFinite(sw[i]!) && sw[i]! < 0.4;
        expect(selAct.mask[i] === 1).toBe(ok);
        if (ok) expectedCount++;
      }
      expect(expectedCount).toBeGreaterThan(0);
      expect(ans.text).toContain(`${expectedCount} muestras`);

      const plotSel = makeSelection('assistant', baseWell.depth.values, selAct.mask, {
        kind: 'filter',
        label: selAct.detailLabel,
      });
      expect(plotSel?.count).toBe(expectedCount);
      expect(plotSel?.runs.length).toBeGreaterThan(0);
      expect(selectionTitle(plotSel!)).toBe(selAct.detailLabel);
    }

    const emptyFilter = answerQuestion('Resaltá donde φ > 0,99 en zona D', richCtx);
    expect(emptyFilter.text).toContain('Ninguna muestra');
    expect(emptyFilter.text).toContain('Rangos observados:');
  });
});

describe('Asistente v2 — dominios G03–G08, MICP, capas, Monte Carlo, corona, snapshots y grafo', () => {
  it('responde Coherencia cruzada (G08), MDT (G05), SMLP (G03), CGR (G06), Movilidad (G07), MICP, Capas, Incertidumbre y Corona', () => {
    const cc = answerQuestion('¿Cómo está la coherencia cruzada?', richCtx);
    expect(cc.sources.join(' ')).toContain('G08');
    expect(cc.actions).toContainEqual(expect.objectContaining({ kind: 'panel', panelId: 'cross-check' }));

    const mdt = answerQuestion('Resumen de presiones MDT', richCtx);
    expect(mdt.text).toMatch(/EMW medio [\d,]+ g\/cm³/);
    expect(mdt.actions).toContainEqual(expect.objectContaining({ kind: 'panel', panelId: 'mdt' }));

    const smlp = answerQuestion('Unidades hidráulicas SMLP', richCtx);
    expect(smlp.text).toContain('Lorenz');
    expect(smlp.table?.rows.length).toBeGreaterThan(0);

    const cgr = answerQuestion('Calibración CGR y aporte de uranio', richCtx);
    expect(cgr.text).toContain('GR espectral CGR');
    expect(cgr.text).toContain('Aporte de uranio:');

    const mov = answerQuestion('Resumen de movilidad Sxo y MOS', richCtx);
    expect(mov.text).toContain('Sxo medio');
    expect(mov.text).toContain('MOS medio');

    const micp = answerQuestion('Resumen de MICP', richCtx);
    expect(micp.text).toContain('8 curva(s) evaluadas');
    expect(micp.table?.rows.length).toBe(8);

    const layers = answerQuestion('Capas de pay y punzados', richCtx);
    expect(layers.text).toMatch(/capa\(s\) de pay/);
    expect(layers.table?.rows[0]?.action?.kind).toBe('depth');

    const unc = answerQuestion('Incertidumbre P90 P50 P10 y tornado', richCtx);
    expect(unc.text).toContain('Parámetro dominante en Total petróleo:');
    expect(unc.table?.rows.length).toBeGreaterThan(0);

    const core = answerQuestion('Calibración con corona', richCtx);
    expect(core.text).toContain('plugs): sesgo');
  });

  it('informa cambios contra snapshot y prepara cortina antes/después', () => {
    const diff = answerQuestion('¿Qué cambié respecto a Base inicial?', richCtx);
    expect(diff.text).toMatch(/cambio\(s\) respecto de el snapshot «Base inicial»/);
    expect(diff.table?.rows.length).toBeGreaterThanOrEqual(2);
    expect(diff.actions).toContainEqual(expect.objectContaining({ kind: 'curtain', snapshotId }));

    const diffDef = answerQuestion('¿Qué cambié respecto a fábrica?', richCtx);
    expect(diffDef.text).toMatch(/valores de fábrica/);
  });

  it('diagnostica nodos del grafo / sarta y exclusiones de Preparación', () => {
    const offInterp: Interpretation = {
      ...emptyInterpretation(baseInterp.zones),
      disabled: ['invasion-step'],
      toolString: { mode: 'data', off: ['RXO_SYN'], order: [], plan: [], planOff: [] },
      preparation: {
        schemaVersion: 1,
        nodes: [
          {
            id: 'prep-gr',
            kind: 'mask',
            methodVersion: 1,
            enabled: true,
            input: { kind: 'original', inputRevisionId: 'rev-1', curveId: baseWell.curves[0]!.id },
            intervals: [{ id: 'i-1', top: 7800, base: 7805, reason: 'Derrumbe de prueba' }],
          },
        ],
      },
    };
    const offWell: Well = {
      ...baseWell,
      curves: baseWell.curves.filter((c) => c.role !== 'RXO'),
    };
    const offRaw = computeOnce(registry, toEngineWell(offWell), offInterp);
    const offClient = asClientResult(offRaw, offWell, offInterp);
    const diagCtx: AssistantContext = {
      ...richCtx,
      well: offWell,
      rawWell: offWell,
      interpretation: offInterp,
      result: offClient,
      clientResult: offClient,
    };

    const missSxo = answerQuestion('¿Por qué no calcula Sxo?', diagCtx);
    expect(missSxo.text).toContain('no se calculó');
    expect(missSxo.text).toContain('Herramientas apagadas en sarta: RXO_SYN');

    const prep = answerQuestion('¿Qué excluí en Preparación?', diagCtx);
    expect(prep.text).toContain('1 receta(s) activa(s)');
    expect(prep.table?.rows[0]?.cells[1]?.text).toContain('1 exclusión');
  });
});

describe('Asistente v2 — Preparar defensa, autocompletado, chips y copia con fuentes', () => {
  it('genera tarjetas dinámicas reales en Preparar defensa y formatea Markdown citando fuentes', () => {
    const cards = buildDefensePrep(richCtx);
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.length).toBeLessThanOrEqual(8);
    expect(cards.every((c) => c.question.length > 10 && c.sources.length > 0)).toBe(true);

    const mdGuide = formatDefenseForCopy(cards, baseWell.name);
    expect(mdGuide).toContain(`# Guía de defensa — ${baseWell.name}`);
    expect(mdGuide).toContain('**Fuente:**');

    const cmp = answerQuestion('Compará B vs D', richCtx);
    const mdAns = formatAnswerForCopy(cmp);
    expect(mdAns).toContain('| B | D |');
    expect(mdAns).toContain('Fuente:');
  });

  it('ofrece autocompletado contextual y chips dinámicos con las zonas del pozo', () => {
    const chips = buildDynamicChips(richCtx);
    expect(chips.length).toBeGreaterThanOrEqual(4);
    expect(chips.some((c) => c.includes('Resumen de presiones MDT'))).toBe(true);

    const ac = buildAutocomplete('comp', richCtx);
    expect(ac.some((item) => item.text.startsWith('Compará'))).toBe(true);
    expect(ac.length).toBeLessThanOrEqual(6);

    // Todas las sugerencias principales del autocompletado deben resolverse sin caer en "No reconocí"
    for (const prefix of ['q', 'r', 'c', 'm', 's', 'i', 'e']) {
      for (const item of buildAutocomplete(prefix, richCtx)) {
        const res = answerQuestion(item.text, richCtx);
        expect(res.text, `Sugerencia: ${item.text}`).not.toContain('No reconocí el pedido');
      }
    }
  });
});

describe('Asistente v2 — regresiones de auditoría (16 hallazgos)', () => {
  it('usa TOTAL_OIL/TOTAL_GAS y driver del tornado correspondiente en Incertidumbre y Defensa', () => {
    const unc = answerQuestion('Tornado de incertidumbre', richCtx);
    expect(unc.text).toContain('Total petróleo');

    const cards = buildDefensePrep(richCtx);
    const uncCard = cards.find((c) => c.id === 'def-unc-driver');
    expect(uncCard).toBeDefined();
    expect(uncCard!.summary).toContain('Total petróleo');

    // Caso mixto petróleo + gas con driver específico de TOTAL_GAS
    const mixedClient: ClientResult = {
      ...baseResult,
      outputs: baseResult.outputs.map((o) => {
        if (o.kind !== 'table') return o;
        if (o.moduleId === 'uncertainty' && o.port === 'UNCERTAINTY') {
          return {
            ...o,
            value: {
              rows: [
                { key: 'B', target: 'B', fluid: 'Petróleo', p90Field: 1, p50Field: 2, p10Field: 3, fieldUnit: 'MMbbl' },
                { key: 'TOTAL_GAS', target: 'Total gas', fluid: 'Gas', p90Field: 12, p50Field: 15, p10Field: 18, fieldUnit: 'Bcf' },
              ],
            },
          };
        }
        if (o.moduleId === 'uncertainty' && o.port === 'UNCERTAINTY_TORNADO') {
          return {
            ...o,
            value: {
              rows: [
                { key: 'B', rank: 1, param: 'sw', label: 'Sw zona B', base: 100, swing: 999, swingPct: 0.99 },
                { key: 'TOTAL_GAS', rank: 1, param: 'bg', label: 'Factor Bg', base: 100, swing: 40, swingPct: 0.25 },
              ],
            },
          };
        }
        return o;
      }),
    };
    const mixedCtx: AssistantContext = {
      ...richCtx,
      result: mixedClient,
      clientResult: mixedClient,
    };
    const mixedUnc = answerQuestion('Incertidumbre P90 P50 P10', mixedCtx);
    expect(mixedUnc.text).toContain('Total gas');
    expect(mixedUnc.text).toContain('Factor Bg');
    expect(mixedUnc.text).not.toContain('Sw zona B');

    const mixedCard = buildDefensePrep(mixedCtx).find((c) => c.id === 'def-unc-driver');
    expect(mixedCard?.summary).toContain('Factor Bg');
    expect(mixedCard?.summary).not.toContain('Sw zona B');
  });

  it('conserva coeficientes globales a,b,c en CGR por zona y abre el panel RADIAL_DOCK_ID en Movilidad', () => {
    const cgrD = answerQuestion('Calibración CGR en zona D', richCtx);
    expect(cgrD.text).toMatch(/a=[\d,]+, b=[\d,]+, c=[\d,]+/);
    expect(cgrD.text).not.toContain('a=—');

    const mov = answerQuestion('Movilidad Sxo en zona D', richCtx);
    expect(mov.actions).toContainEqual(expect.objectContaining({ kind: 'panel', panelId: 'invasion-radial' }));
  });

  it('soporta entre..y con % y combinador "o", y normaliza NPHI en % a v/v en filtros', () => {
    const betweenOr = answerQuestion('Resaltá donde VSH está entre 10 % y 30 % o Sw < 0,25 en zona D', richCtx);
    expect(betweenOr.intent?.kind).toBe('filter-select');
    if (betweenOr.intent?.kind === 'filter-select') {
      expect(betweenOr.intent.combinator).toBe('or');
      expect(betweenOr.intent.conditions[0]).toEqual({ curve: 'VSH', op: 'between', value: 0.1, valueMax: 0.3 });
    }

    const partialPct = answerQuestion('Resaltá donde VSH está entre 10 y 30 % en zona D', richCtx);
    if (partialPct.intent?.kind === 'filter-select') {
      expect(partialPct.intent.conditions[0]).toEqual({ curve: 'VSH', op: 'between', value: 0.1, valueMax: 0.3 });
    }

    // NPHI medida en % (0–100) debe convertirse a v/v antes de comparar con 0,2 v/v
    const nphiFrac = baseWell.curves.find((c) => c.role === 'NPHI')!;
    const nphiPctWell: Well = {
      ...baseWell,
      curves: baseWell.curves.map((c) =>
        c.id === nphiFrac.id
          ? { ...c, unit: '%', data: Float64Array.from(c.data, (v) => (Number.isFinite(v) ? v * 100 : NaN)) }
          : c,
      ),
    };
    const pctFilter = answerQuestion('Resaltá donde NPHI < 0,2 en zona D', { ...richCtx, well: nphiPctWell });
    const fracFilter = answerQuestion('Resaltá donde NPHI < 0,2 en zona D', richCtx);
    const pctAct = pctFilter.actions.find((a) => a.kind === 'apply-selection');
    const fracAct = fracFilter.actions.find((a) => a.kind === 'apply-selection');
    expect(pctAct && fracAct).toBeTruthy();
    if (pctAct?.kind === 'apply-selection' && fracAct?.kind === 'apply-selection') {
      expect(pctAct.mask).toEqual(fracAct.mask);
    }
  });

  it('valida rango φ <= 0,4 y respeta overrides zonales en simulaciones totales', () => {
    const badPhi = answerQuestion('Simular phi 0,6 en zona D', richCtx);
    expect(badPhi.text).toContain('0,4 v/v');
    expect(badPhi.actions.some((a) => a.kind === 'apply-cutoffs')).toBe(false);

    const bZone = baseInterp.zones.find((z) => z.name === 'B')!;
    const projWithOverride = setParam(baseProjectWithSnap, baseWell.id, 'swCutoff', 0.72, bZone.id);
    const ovEntry = projWithOverride.wells.find((w) => w.well.id === baseWell.id)!;
    const ovRes = asClientResult(computeOnce(registry, toEngineWell(ovEntry.well), ovEntry.interpretation), ovEntry.well, ovEntry.interpretation);
    const ovCtx: AssistantContext = {
      ...richCtx,
      interpretation: ovEntry.interpretation,
      result: ovRes,
      clientResult: ovRes,
    };

    const simTotal = answerQuestion('¿Qué pasa si pongo Sw a 0,55?', ovCtx);
    expect(simTotal.text).toContain('Las zonas con valor propio (B) mantienen su corte');

    const appliedProj = setCutoffPairRecipe(projWithOverride, baseWell.id, null, [{ key: 'swCutoff', value: 0.55 }]);
    const appliedEntry = appliedProj.wells.find((w) => w.well.id === baseWell.id)!;
    const appliedRes = computeOnce(registry, toEngineWell(appliedEntry.well), appliedEntry.interpretation);
    const appliedTotalRow = (activeOutput(appliedRes.outputs, 'ZONE_SUMMARY')?.value as { rows: { zone?: string; netPay?: number }[] }).rows.find(
      (r) => r.zone === 'Total',
    );
    expect(simTotal.text).toContain(`${formatNumber(Number(appliedTotalRow!.netPay), { digits: 2 })} m`);
  });

  it('evita falsos positivos fuzzy, ordena "mejor Sw del pay" por mínimo y soporta zonas de dos palabras', () => {
    const archivoAns = answerQuestion('¿Cómo funciona el archivo?', richCtx);
    expect(archivoAns.text).toContain('No encontré ese método');
    expect(archivoAns.text).not.toContain('Archie');
    expect(answerQuestion('¿Por qué resulta bajo el pay?', richCtx).text).toContain('No reconocí');
    expect(answerQuestion('¿Qué zona tiene menos espesor de gas?', richCtx).text).toContain('No reconocí');
    expect(answerQuestion('¿Qué cambié respecto a Lorenzo?', richCtx).text).toContain('snapshot llamado «lorenzo»');

    const bestSw = answerQuestion('¿Qué zona tiene mejor Sw del pay?', richCtx);
    expect(bestSw.intent).toEqual({ kind: 'compare', mode: 'rank', metric: 'swPay', direction: 'min' });
    expect(bestSw.text).toMatch(/menor sw media del pay/i);
    if (bestSw.table && bestSw.table.rows.length >= 2) {
      const first = Number.parseFloat(bestSw.table.rows[0]!.cells[1]!.text.replace(',', '.'));
      const second = Number.parseFloat(bestSw.table.rows[1]!.cells[1]!.text.replace(',', '.'));
      expect(first).toBeLessThanOrEqual(second);
    }

    // Zonas con nombre de dos palabras: Arena A y Arena B
    const twoWordZones = [
      { ...baseInterp.zones[0]!, name: 'Arena A' },
      { ...baseInterp.zones[1]!, name: 'Arena B' },
    ];
    let twoProj = addWell(createProject(), { ...baseWell, id: 'pozo-2w' }, twoWordZones);
    const za = twoWordZones[0]!;
    twoProj = setParam(twoProj, 'pozo-2w', 'area', 2.0, za.id);
    const twoEntry = twoProj.wells[0]!;
    const twoRes = asClientResult(computeOnce(registry, toEngineWell(twoEntry.well), twoEntry.interpretation), twoEntry.well, twoEntry.interpretation);
    const twoCtx: AssistantContext = {
      ...richCtx,
      zones: twoWordZones,
      well: twoEntry.well,
      rawWell: twoEntry.well,
      interpretation: twoEntry.interpretation,
      result: twoRes,
      clientResult: twoRes,
    };

    expect(answerQuestion('¿Cuál es el OOIP en zona Arena A?', twoCtx).text).toContain('Zona Arena A (Petróleo)');
    expect(answerQuestion('Compará Arena A vs Arena B', twoCtx).text).toContain('Comparación Arena A vs Arena B');
    expect(answerQuestion('Estabilidad 2D en zona Arena A', twoCtx).text).toContain('Zona Arena A');
    const qTwo = answerQuestion('Pay neto en zona Arena A', twoCtx);
    expect(answerQuestion('¿y en la zona Arena B?', { ...twoCtx, previousIntent: qTwo.intent }).text).toContain('Zona Arena B.');
  });

  it('usa CALIB_PARAMS.rhoFl/a y m:<curveId> en Corona, preserva zona en follow-up y admite clientResult omitido', () => {
    let customProj = setParam(baseProjectWithSnap, baseWell.id, CALIB_PARAMS.rhoFl.storage, 1.05, null);
    customProj = setParam(customProj, baseWell.id, CALIB_PARAMS.a.storage, 1.25, null);
    const customEntry = customProj.wells.find((w) => w.well.id === baseWell.id)!;
    const phiCurve = customEntry.well.curves.find((c) => c.role === 'NPHI')!;
    const coreSetId = tpCoreSet('core-tp').id;
    const prevCoreDec = customEntry.interpretation.pointSets[coreSetId];
    customEntry.interpretation.pointSets[coreSetId] = {
      ...prevCoreDec,
      points: prevCoreDec?.points ?? {},
      settings: { ...(prevCoreDec?.settings ?? {}), [CALIB_CURVE_SETTING]: `m:${phiCurve.id}` },
    };
    const customCore = answerQuestion('Calibración con corona', {
      ...richCtx,
      well: customEntry.well,
      interpretation: customEntry.interpretation,
    });
    expect(customCore.text).toContain('ρf=1,05');
    expect(customCore.text).toContain('a=1,25');

    // Follow-up de cutoff tras consulta zonal (no cutoff) hereda la zona previa
    const zSummary = answerQuestion('Pay neto en zona D', richCtx);
    const zFollow = answerQuestion('¿y con Sw a 0,55?', { ...richCtx, previousIntent: zSummary.intent });
    expect(zFollow.text).toContain('Zona D.');

    // Fallback clientResultOf cuando solo llega result
    const noClientFieldCtx: AssistantContext = { ...richCtx, clientResult: undefined };
    expect(answerQuestion('¿Cómo está la coherencia cruzada?', noClientFieldCtx).sources.join(' ')).toContain('G08');
    expect(answerQuestion('Estabilidad 2D en zona D', noClientFieldCtx).text).toContain('Zona D');

    // cutoff-pair y cutoff-stability sin result responden limpiamente
    const noResCtx: AssistantContext = { ...richCtx, result: null, clientResult: null };
    expect(answerQuestion('Simular phi 0,12 y sw 0,55 en zona D', noResCtx).text).toContain('Todavía no hay resultados vigentes');
    expect(answerQuestion('Estabilidad 2D en zona D', noResCtx).text).toContain('Todavía no hay resultados vigentes');

    // buildDefensePrep emite tanto tarjeta de corona como MICP cuando ambos están cargados (proyecto limpio bajo tope de 8)
    const { well: cleanWellRaw, zones: cleanZones } = readWellFile(tp, 'pozo_tp_perfiles.csv');
    const nphiClean = cleanWellRaw.curves.find((c) => c.role === 'NPHI')!;
    const biasedWell: Well = {
      ...cleanWellRaw,
      curves: cleanWellRaw.curves.map((c) =>
        c.id === nphiClean.id
          ? { ...c, data: Float64Array.from(c.data, (v) => (Number.isFinite(v) ? v + 0.08 : NaN)) }
          : c,
      ),
    };
    let coreMicpProj = addWell(createProject(), biasedWell, cleanZones);
    coreMicpProj = addPointSet(coreMicpProj, biasedWell.id, tpCoreSet('core-both'));
    coreMicpProj = addPointSet(coreMicpProj, biasedWell.id, tpMicpSet('micp-both'));
    const coreMicpEntry = coreMicpProj.wells[0]!;
    const bothCoreId = tpCoreSet('core-both').id;
    const prevBothDec = coreMicpEntry.interpretation.pointSets[bothCoreId];
    coreMicpEntry.interpretation.pointSets[bothCoreId] = {
      ...prevBothDec,
      points: prevBothDec?.points ?? {},
      settings: { ...(prevBothDec?.settings ?? {}), [CALIB_CURVE_SETTING]: `m:${nphiClean.id}` },
    };
    const coreMicpRes = asClientResult(
      computeOnce(registry, toEngineWell(coreMicpEntry.well), coreMicpEntry.interpretation),
      coreMicpEntry.well,
      coreMicpEntry.interpretation,
    );
    const bothCards = buildDefensePrep({
      zones: cleanZones,
      result: coreMicpRes,
      equations: richCtx.equations,
      commands: [],
      well: coreMicpEntry.well,
      rawWell: coreMicpEntry.well,
      interpretation: coreMicpEntry.interpretation,
      snapshots: [],
      registry,
    });
    expect(bothCards.some((c) => c.id === 'def-core-bias')).toBe(true);
    expect(bothCards.some((c) => c.id === 'def-micp-h')).toBe(true);
  });
});
