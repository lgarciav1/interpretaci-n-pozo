/**
 * Pruebas dedicadas de G02 — Del Lazo a la Acción (docs/decisiones/0088):
 * 1. Banderas de usuario en `Interpretation.userFlags?`: captura exacta desde lazo/selección, proyección en filtros
 *    genéricos (p. ej. Pickett `= 1` / `= 0`), visibilidad en «Armar pistas» y pista Banderas, `Ctrl+Z`, persistencia
 *    v6/v7, compatibilidad con proyectos antiguos y preservación de `Well.curves` / `sameEngineInputs`.
 * 2. Exclusión QC en Preparación desde selección: curva medida sugerida por defecto (Y → X, remontando preparadas),
 *    motivo obligatorio persistido en `MaskInterval.reason`, invariantes científicas I01–I08 (original intacto,
 *    contexto exacto, activación explícita I04, dependencias MGT/densidad, snapshots I08, atomicidad `Ctrl+Z` I12,
 *    límite de 256 intervalos).
 */
import { describe, expect, it } from 'vitest';
import { plotContextOf } from '../src/app/plots/context';
import { useProject } from '../src/app/store/project';
import { syncPlotSelectionWithProject } from '../src/app/store/uiSync';
import { toEngineWell } from '../src/core/engine/engine';
import { sameComputation } from '../src/core/engine/context';
import { sameEngineInputs } from '../src/core/interpretation';
import { MaskEvaluator } from '../src/core/preparation/evaluate';
import { materializePreparation } from '../src/core/preparation/plan';
import { maskQualityCounts } from '../src/core/preparation/quality';
import { preparedCurveId } from '../src/core/preparation/source';
import { validatePreparation } from '../src/core/preparation/state';
import { addMaskInterval, entryPreparationPlan, restoreMaskInterval, setDensityReconstruction } from '../src/core/state/preparation';
import { addWell, createProject, makeId, setSource, updateWell } from '../src/core/state/project';
import { deserializeProject, serializeProject } from '../src/core/state/serialize';
import { createSnapshot } from '../src/core/state/snapshots';
import { addUserFlag, removeUserFlag, renameUserFlag } from '../src/core/state/userFlags';
import {
  evaluateUserFlag,
  maskToExactIntervals,
  sanitizeUserFlags,
  userFlagRoleId,
  type UserFlagDef,
} from '../src/core/userFlags';
import { createWell } from '../src/core/well';
import { registry } from '../src/modules';
import { defaultFilterRule, evaluatePlotFilters, filterCurveOptions, formatFilterRule, isFlagCurve, translatePlotFilters } from '../src/plots/filters';
import { clearPlotSelection, getPlotLink, makeSelection, setPlotSelection, type PlotSelection } from '../src/plots/link';
import { maskFromCloud, pointsInPolygon } from '../src/plots/selection';
import {
  defaultExclusionCurveId,
  excludeSelectionInPreparation,
  exclusionTargetInfo,
  resolveOriginalCurveId,
  saveSelectionAsUserFlag,
  withUserFlagCatalog,
  withUserFlagCurves,
} from '../src/plots/userFlags';
import { buildTrackCatalog } from '../src/viewer/catalog';
import { scopeOptions } from '../src/viewer/curveEdit';
import { resolveTracks } from '../src/viewer/resolve';
import { BUILTIN_LAYOUTS } from '../src/viewer/templates';

function makeTestWell() {
  // 10 muestras con separación uniforme 0,5 m (incluye cluster de arena limpia en índices 1, 2, 4 y borde 0 / 9)
  const depth = Float64Array.from([7800.0, 7800.5, 7801.0, 7801.5, 7802.0, 7802.5, 7803.0, 7803.5, 7804.0, 7804.5]);
  const zden = Float64Array.from([2.62, 2.24, 2.26, 2.58, 2.25, 2.61, 2.59, NaN, 2.63, 2.22]);
  const nphi = Float64Array.from([0.32, 0.21, 0.22, 0.34, 0.20, 0.33, 0.31, 0.29, 0.35, 0.19]);
  const rt = Float64Array.from([3.0, 45.0, 52.0, 2.5, 48.0, 2.1, 3.2, 2.8, 1.9, 60.0]);
  const gr = Float64Array.from([95, 28, 30, 92, 27, 98, 88, 90, 102, 25]);
  return createWell({
    id: 'w-g02',
    name: 'Pozo G02',
    depth,
    curves: [
      { id: 'c-gr', mnemonic: 'GR', unit: 'gAPI', role: 'GR', data: gr, origin: { kind: 'measured' } },
      { id: 'c-zden', mnemonic: 'ZDEN', unit: 'g/cm3', role: 'RHOB', data: zden, origin: { kind: 'measured' } },
      { id: 'c-nphi', mnemonic: 'NPHI', unit: 'v/v', role: 'NPHI', data: nphi, origin: { kind: 'measured' } },
      { id: 'c-at90', mnemonic: 'AT90', unit: 'ohm.m', role: 'RT', data: rt, origin: { kind: 'measured' } },
      { id: 'c-at10', mnemonic: 'AT10', unit: 'ohm.m', role: null, data: Float64Array.from(rt), origin: { kind: 'measured' } },
    ],
  });
}

function makeLassoSelection(well = makeTestWell()): PlotSelection {
  // Lazo en Densidad–Neutrón encerrando los puntos limpios (NPHI ∈ [0.18, 0.24], ZDEN ∈ [2.20, 2.30]): índices 1, 2, 4, 9
  const nphi = well.curves.find((c) => c.id === 'c-nphi')!.data;
  const zden = well.curves.find((c) => c.id === 'c-zden')!.data;
  const xAxis = { kind: 'linear' as const, label: 'NPHI', min: -0.15, max: 0.45 };
  const yAxis = { kind: 'linear' as const, label: 'ZDEN', min: 1.95, max: 2.95, reversed: true };
  const poly = { x: [0.17, 0.25, 0.25, 0.17], y: [2.20, 2.20, 2.30, 2.30] };
  const cloudIdx = Int32Array.from([0, 1, 2, 3, 4, 5, 6, 8, 9]);
  const xs = Float64Array.from(cloudIdx, (i) => nphi[i]!);
  const ys = Float64Array.from(cloudIdx, (i) => zden[i]!);
  const inside = pointsInPolygon(poly, xs, ys, xAxis, yAxis);
  const mask = maskFromCloud(well.depth.values.length, cloudIdx, inside);
  const sel = makeSelection('crossplot', well.depth.values, mask, {
    kind: 'shapes',
    x: 'm:c-nphi',
    y: 'm:c-zden',
    shapes: [{ kind: 'lasso', poly }],
  });
  if (!sel) throw new Error('Selección vacía inesperada en test');
  return sel;
}

describe('G02 — Banderas de usuario desde selección (0088)', () => {
  it('captura intervalos MD exactos (gap = 0), sin puentear huecos de 1 muestra ni salir de bordes', () => {
    const well = makeTestWell();
    const sel = makeLassoSelection(well);
    // Índices seleccionados: 1 (7800.5), 2 (7801.0), 4 (7802.0) y 9 (7804.5). El índice 3 (7801.5) NO está seleccionado.
    expect(Array.from(sel.mask)).toEqual([0, 1, 1, 0, 1, 0, 0, 0, 0, 1]);
    // Nota: sel.runs (maskRuns con gap=1 y ±half) une 1..2 con 4 y ensancha el borde 9 por encima de 7804.5.
    expect(sel.runs.at(-1)!.base).toBeGreaterThan(well.depth.values.at(-1)!);

    const exact = maskToExactIntervals(well.depth.values, sel.mask);
    expect(exact).toEqual([
      { top: 7800.5, base: 7801.0 },
      { top: 7802.0, base: 7802.0 },
      { top: 7804.5, base: 7804.5 },
    ]);
    // Evaluar sobre la profundidad reproduce bit a bit la máscara original (sin incluir índice 3).
    const evaluated = evaluateUserFlag(well.depth.values, { intervals: exact });
    expect(Array.from(evaluated)).toEqual(Array.from(sel.mask));
  });

  it('permite crear bandera desde lazo en Densidad–Neutrón, filtrar Pickett (= 1 y = 0) y no muta originales ni entradas del motor', () => {
    const well = makeTestWell();
    const project0 = addWell(createProject('TP'), well);
    const sel = makeLassoSelection(well);

    const project1 = saveSelectionAsUserFlag(project0, well.id, sel, {
      id: 'arena_ts',
      name: 'Arena limpia TS',
      color: '#0891b2',
    });

    const entry0 = project0.wells[0]!;
    const entry1 = project1.wells[0]!;
    // I01: originales intactos y mismas referencias; no invalida revisiones ni dispara recálculo del motor.
    expect(entry1.well).toBe(entry0.well);
    expect(entry1.well.curves).toBe(entry0.well.curves);
    expect(project1.inputRevisions).toBeUndefined();
    expect(sameEngineInputs(entry0.interpretation, entry1.interpretation)).toBe(true);

    // Proyección en contexto de gráficos (Pickett): disponible en Banderas y filtra = 1 / = 0
    const ctx = plotContextOf(entry1.well, entry1.interpretation, []);
    const flagKey = `r:${userFlagRoleId('arena_ts')}`;
    const opts = filterCurveOptions(ctx);
    const flagOpt = opts.find((o) => o.value === flagKey);
    expect(flagOpt).toEqual({ value: flagKey, label: 'Arena limpia TS · usuario', group: 'Banderas' });
    expect(isFlagCurve(ctx, flagKey)).toBe(true);

    const ruleYes = defaultFilterRule(ctx, flagKey, 'f1');
    expect(ruleYes).toEqual({ id: 'f1', curve: flagKey, op: 'eq', value: 1, enabled: true });
    const evalYes = evaluatePlotFilters(ctx, [ruleYes]);
    expect(evalYes.passed).toBe(4);
    expect(evalYes.summary).toBe('Arena limpia TS = Sí');
    expect(Array.from(evalYes.mask!)).toEqual([0, 1, 1, 0, 1, 0, 0, 0, 0, 1]);

    const ruleNo = { ...ruleYes, value: 0 };
    const evalNo = evaluatePlotFilters(ctx, [ruleNo]);
    expect(evalNo.passed).toBe(6);
    expect(evalNo.summary).toBe('Arena limpia TS = No');
    expect(formatFilterRule(ruleNo, evalNo.rules[0]!.curve, true)).toBe('Arena limpia TS = No');
    expect(Array.from(evalNo.mask!)).toEqual([1, 0, 0, 1, 0, 1, 1, 1, 1, 0]);
  });

  it('aparece en «Armar pistas» (grupo Banderas) y en la pista Banderas del visor', () => {
    const well = makeTestWell();
    const project = saveSelectionAsUserFlag(addWell(createProject('TP'), well), well.id, makeLassoSelection(well), {
      id: 'anom_baritina',
      name: 'Anomalía baritina',
      color: '#db2777',
    });
    const entry = project.wells[0]!;
    const roleId = userFlagRoleId('anom_baritina');
    const computed = withUserFlagCurves(well.depth.values, entry.interpretation.userFlags, []);
    const roles = withUserFlagCatalog(registry.roles, entry.interpretation.userFlags);

    // Idempotencia de withUserFlagCurves
    expect(withUserFlagCurves(well.depth.values, entry.interpretation.userFlags, computed)).toBe(computed);

    // Catálogo de «Armar pistas»
    const groups = buildTrackCatalog({
      roles,
      curves: well.curves,
      tools: registry.tools,
      producible: new Set(),
      computed: new Set(computed.map((c) => c.port)),
    });
    const flagsGroup = groups.find((g) => g.id === 'flags');
    const item = flagsGroup?.curves.find((c) => c.role === roleId);
    expect(item).toBeDefined();
    expect(item!.name).toBe('Anomalía baritina');
    expect(item!.flag).toBe(true);
    expect(item!.available).toBe(true);

    // Pista «Banderas» (`collect: 'flags'`) del visor
    const tracks = resolveTracks(BUILTIN_LAYOUTS.petrophysics, {
      depth: well.depth.values,
      curves: well.curves,
      computed,
      catalog: roles,
    });
    const flagTrack = tracks.find((t) => t.id === 'flags');
    const resolved = flagTrack?.curves.find((c) => c.role === roleId);
    expect(resolved).toBeDefined();
    expect(resolved!.kind).toBe('band');
    expect(resolved!.name).toBe('Anomalía baritina');
    expect(resolved!.short).toBe('Anomalía baritina');
  });

  it('se deshace/rehace en un paso de Ctrl+Z y soporta renombrar y quitar sin dejar basura', () => {
    const well = makeTestWell();
    const sel = makeLassoSelection(well);
    const store = useProject.getState();
    store.replace(addWell(createProject('TP'), well));
    const initial = useProject.getState().project;

    store.commit('Crear bandera «Arena limpia TS»', (p) =>
      saveSelectionAsUserFlag(p, well.id, sel, { id: 'uf1', name: 'Arena limpia TS' }),
    );
    const created = useProject.getState().project;
    expect(created.wells[0]!.interpretation.userFlags).toHaveLength(1);

    // Duplicado por nombre (sin distinguir mayúsculas) y fuera de rango se rechazan
    expect(() =>
      saveSelectionAsUserFlag(created, well.id, sel, { id: 'uf2', name: '  arena  LIMPIA ts ' }),
    ).toThrow(/Ya existe una bandera/);
    expect(() =>
      addUserFlag(created, well.id, { id: 'uf3', name: 'Fuera', intervals: [{ top: 7000, base: 7005 }] }),
    ).toThrow(/profundidad del pozo/);

    // Undo / redo exacto
    store.undo();
    expect(useProject.getState().project).toBe(initial);
    store.redo();
    expect(useProject.getState().project).toBe(created);

    // Renombrar y quitar
    const renamed = renameUserFlag(created, well.id, 'uf1', 'Arena limpia');
    expect(renamed.wells[0]!.interpretation.userFlags![0]!.name).toBe('Arena limpia');
    const cleared = removeUserFlag(renamed, well.id, 'uf1');
    expect(cleared.wells[0]!.interpretation.userFlags).toBeUndefined();
    store.replace(createProject());
  });

  it('persiste en proyectos v6 y v7 (incl. snapshots) y proyectos antiguos sin userFlags abren sin avisos', async () => {
    const well = makeTestWell();
    const base = addWell(createProject('TP'), well);
    const sel = makeLassoSelection(well);

    // Proyecto viejo v6 sin userFlags
    const legacyWarnings: string[] = [];
    const legacyText = await serializeProject(base);
    expect(JSON.parse(legacyText).version).toBe(6);
    const legacyReopened = await deserializeProject(legacyText, { onWarning: (m) => legacyWarnings.push(m) });
    expect(legacyWarnings).toEqual([]);
    expect(legacyReopened.wells[0]!.interpretation.userFlags).toBeUndefined();

    // Proyecto v6 con userFlags y snapshot
    const withFlag = saveSelectionAsUserFlag(base, well.id, sel, { id: 'uf_v6', name: 'Arena limpia TS', color: '#0891b2' });
    const withSnap = createSnapshot(withFlag, well.id, 'Snap 1', { id: 'snap-1' }).project;
    const textV6 = await serializeProject(withSnap);
    expect(JSON.parse(textV6).version).toBe(6);
    const warningsV6: string[] = [];
    const reopenedV6 = await deserializeProject(textV6, { onWarning: (m) => warningsV6.push(m) });
    expect(warningsV6).toEqual([]);
    expect(reopenedV6.wells[0]!.interpretation.userFlags).toEqual(withFlag.wells[0]!.interpretation.userFlags);
    expect(reopenedV6.snapshots[0]!.interpretation.userFlags).toEqual(withFlag.wells[0]!.interpretation.userFlags);

    // Proyecto v7 (con Preparación) + userFlags
    const withPrep = excludeSelectionInPreparation(withFlag, well.id, 'c-zden', sel, {
      reason: 'Anomalía baritina en pared',
      activateSource: false,
      makeId,
    });
    const textV7 = await serializeProject(withPrep);
    expect(JSON.parse(textV7).version).toBe(7);
    const reopenedV7 = await deserializeProject(textV7);
    expect(reopenedV7.wells[0]!.interpretation.userFlags).toEqual(withFlag.wells[0]!.interpretation.userFlags);
    expect(reopenedV7.wells[0]!.interpretation.preparation!.nodes[0]!.intervals[0]!.reason).toBe('Anomalía baritina en pared');

    // v6 descarta banderas inválidas con aviso sin romper el archivo; v7 las rechaza estrictamente
    const badV6 = JSON.parse(textV6);
    badV6.project.wells[0].interpretation.userFlags.push({ id: 'bad id!', name: 'Mala', intervals: [{ top: 10, base: 5 }] });
    const badV6Warnings: string[] = [];
    const recoveredV6 = await deserializeProject(JSON.stringify(badV6), { onWarning: (m) => badV6Warnings.push(m) });
    expect(badV6Warnings.length).toBeGreaterThan(0);
    expect(recoveredV6.wells[0]!.interpretation.userFlags).toHaveLength(1);

    const badV7 = JSON.parse(textV7);
    badV7.project.wells[0].interpretation.userFlags.push({ id: 'ok', name: 'Invertido', intervals: [{ top: 7810, base: 7800 }] });
    await expect(deserializeProject(JSON.stringify(badV7))).rejects.toThrow();

    // sanitizeUserFlags cubre casos borde directamente
    const errs: string[] = [];
    expect(sanitizeUserFlags([{ id: 'a', name: 'Ok', intervals: [{ top: 1, base: 2 }], extra: true }], 't', (m) => errs.push(m))).toEqual([]);
    expect(errs).toHaveLength(1);
    const valid: UserFlagDef[] | undefined = sanitizeUserFlags(
      [{ id: 'a', name: '  Ok  ', color: '#112233', intervals: [{ top: 2, base: 4 }, { top: 1, base: 3 }] }],
      't',
      (m) => errs.push(m),
    );
    expect(valid).toEqual([{ id: 'a', name: 'Ok', color: '#112233', intervals: [{ top: 1, base: 4 }] }]);
  });
});

describe('G02 — Exclusión QC en Preparación desde selección (invariantes I01–I08)', () => {
  it('sugiere la curva medida objetivo correcta (Y → X, histograma, preparada → original)', () => {
    const well = makeTestWell();
    const project = addWell(createProject('TP'), well);
    const entry = project.wells[0]!;
    const sel = makeLassoSelection(well);

    // Crossplot con Y = ZDEN y X = NPHI → sugiere ZDEN
    expect(defaultExclusionCurveId(entry, sel)).toBe('c-zden');

    // Crossplot con Y calculada (`r:SW`) y X medida (`m:c-at10`) → cae a X (`c-at10`)
    const selCalcY: PlotSelection = {
      ...sel,
      detail: { kind: 'shapes', x: 'm:c-at10', y: 'r:SW', shapes: [] },
    };
    expect(defaultExclusionCurveId(entry, selCalcY)).toBe('c-at10');

    // Histograma de `r:NPHI` → resuelve a curva medida original `c-nphi`
    const selHist: PlotSelection = {
      ...sel,
      source: 'histogram',
      detail: { kind: 'bins', curve: 'r:NPHI', curveLabel: 'NPHI', edges: [0, 0.5], bins: [0] },
    };
    expect(defaultExclusionCurveId(entry, selHist)).toBe('c-nphi');

    // Si el gráfico usa una curva preparada (`m:prep:mask-1:masked`), remonta a su original (`c-zden`)
    const withPrep = addMaskInterval(project, well.id, 'c-zden', { id: 'e1', top: 7800.5, base: 7800.5 }, 'mask-1');
    const prepKey = `m:${preparedCurveId('mask-1', 'masked')}`;
    expect(resolveOriginalCurveId(withPrep.wells[0]!, prepKey)).toBe('c-zden');
    expect(resolveOriginalCurveId(withPrep.wells[0]!, 'r:RHOB')).toBe('c-zden');
  });

  it('respeta I01, I02, I04 (activación explícita), I06 (calidad), I08 (snapshots) e I12 (un Ctrl+Z)', async () => {
    const well = makeTestWell();
    const store = useProject.getState();
    store.replace(addWell(createProject('TP'), well));
    const initial = useProject.getState().project;
    const sel = makeLassoSelection(well);
    const originalDataCopy = Float64Array.from(well.curves.find((c) => c.id === 'c-zden')!.data);

    // Motivo obligatorio
    expect(() =>
      excludeSelectionInPreparation(initial, well.id, 'c-zden', sel, {
        reason: '   ',
        activateSource: false,
        makeId,
      }),
    ).toThrow(/motivo obligatorio/);

    // I04: sin activar explícitamente, la receta se guarda pero RHOB NO cambia de fuente silenciosamente
    store.commit(
      'Excluir 3 tramos de ZDEN',
      (p) =>
        excludeSelectionInPreparation(p, well.id, 'c-zden', sel, {
          reason: 'Baritina en ZDEN',
          activateSource: false,
          makeId,
        }),
      { group: 'g-excl-1' },
    );
    const savedInactive = useProject.getState().project;
    const entryInactive = savedInactive.wells[0]!;
    expect(entryInactive.interpretation.preparation?.nodes).toHaveLength(1);
    expect(entryInactive.interpretation.preparation!.nodes[0]!.intervals.map((r) => [r.top, r.base, r.reason])).toEqual([
      [7800.5, 7801.0, 'Baritina en ZDEN'],
      [7802.0, 7802.0, 'Baritina en ZDEN'],
      [7804.5, 7804.5, 'Baritina en ZDEN'],
    ]);
    // Fuente RHOB sigue sin cambiar
    expect(entryInactive.interpretation.sources.RHOB).toBeUndefined();
    // I01: originales intactos bit a bit
    expect(entryInactive.well.curves.find((c) => c.id === 'c-zden')!.data).toEqual(originalDataCopy);

    // I12: un solo Ctrl+Z revierte receta + migración de inputRevisions
    store.undo();
    expect(useProject.getState().project).toBe(initial);
    expect(useProject.getState().project.inputRevisions).toBeUndefined();

    // Con activación explícita (`activateSource: true`): receta + fuente en un único paso
    store.commit(
      'Excluir y activar ZDEN',
      (p) =>
        excludeSelectionInPreparation(p, well.id, 'c-zden', sel, {
          reason: 'Derrumbe en ZDEN',
          activateSource: true,
          makeId,
        }),
      { group: 'g-excl-2' },
    );
    const savedActive = useProject.getState().project;
    const node = savedActive.wells[0]!.interpretation.preparation!.nodes[0]!;
    expect(savedActive.wells[0]!.interpretation.sources.RHOB).toEqual({
      kind: 'curve',
      curveId: preparedCurveId(node.id, 'masked'),
    });

    // Evaluar con MaskEvaluator (I02 + I06): excluye solo los 4 índices seleccionados, conserva índice 3 y NaN original (7)
    const plan = entryPreparationPlan(savedActive, savedActive.wells[0]!, registry);
    const payloads = await new MaskEvaluator().evaluate(toEngineWell(savedActive.wells[0]!.well), plan);
    const data = materializePreparation(savedActive.wells[0]!.well, { plan, artifacts: payloads }, plan.context, registry);
    expect(payloads[0]!.data.length).toBe(well.depth.values.length);
    expect(Number.isNaN(payloads[0]!.data[1]!)).toBe(true);
    expect(Number.isNaN(payloads[0]!.data[2]!)).toBe(true);
    expect(payloads[0]!.data[3]).toBeCloseTo(2.58, 6); // índice 3 NO se excluyó
    expect(Number.isNaN(payloads[0]!.data[4]!)).toBe(true);
    expect(Number.isNaN(payloads[0]!.data[9]!)).toBe(true);
    expect(maskQualityCounts(payloads[0]!.quality)).toEqual({ excluded: 4, originallyMissing: 1, newlyExcluded: 4 });
    expect(data.well.depth).toBe(savedActive.wells[0]!.well.depth);

    // La clave de cómputo ignora `reason` y mantiene caché/equivalencia numérica
    const sameWithoutReason = addMaskInterval(
      restoreMaskInterval(savedActive, well.id, node.id),
      well.id,
      'c-zden',
      { id: 'r1', top: 7800.5, base: 7801.0 },
      node.id,
    );
    expect(
      sameComputation(
        entryPreparationPlan(sameWithoutReason, sameWithoutReason.wells[0]!, registry).context,
        entryPreparationPlan(
          addMaskInterval(
            restoreMaskInterval(savedActive, well.id, node.id),
            well.id,
            'c-zden',
            { id: 'r2', top: 7800.5, base: 7801.0, reason: 'Motivo documental' },
            node.id,
          ),
          addMaskInterval(
            restoreMaskInterval(savedActive, well.id, node.id),
            well.id,
            'c-zden',
            { id: 'r2', top: 7800.5, base: 7801.0, reason: 'Motivo documental' },
            node.id,
          ).wells[0]!,
          registry,
        ).context,
      ),
    ).toBe(true);

    // I08: snapshot conserva la revisión fijada y los motivos históricos
    const snapped = createSnapshot(savedActive, well.id, 'QC Baritina', { id: 'snap-qc' }).project;
    expect(snapped.snapshots[0]!.inputRevisionId).toBe(savedActive.wells[0]!.inputRevisionId);
    expect(snapped.snapshots[0]!.interpretation.preparation!.nodes[0]!.intervals[0]!.reason).toBe('Derrumbe en ZDEN');

    // Al volver a consultar target info (sobre la profundidad vigente tras migración v6→v7), detecta `alreadyUsingPrepared: true`
    const selActive = { ...sel, depth: savedActive.wells[0]!.well.depth.values };
    const infoActive = exclusionTargetInfo(savedActive, well.id, 'c-zden', selActive);
    expect(infoActive?.alreadyUsingPrepared).toBe(true);
    expect(infoActive?.blockingError).toBeNull();

    // I12: deshacer vuelve al estado inicial
    store.undo();
    expect(useProject.getState().project).toBe(initial);
    store.replace(createProject());
  });

  it('bloquea selección obsoleta (I03), >256 tramos, conflictos con reconstrucción de densidad (I05/I07) y motivos inválidos', () => {
    const well = makeTestWell();
    const project = addWell(createProject('TP'), well);
    const sel = makeLassoSelection(well);

    // I03: selección de otra profundidad (identidad distinta)
    const staleSel: PlotSelection = { ...sel, depth: Float64Array.from(well.depth.values) };
    expect(exclusionTargetInfo(project, well.id, 'c-zden', staleSel)?.blockingError).toMatch(/profundidad/);
    expect(() =>
      excludeSelectionInPreparation(project, well.id, 'c-zden', staleSel, {
        reason: 'Motivo',
        activateSource: false,
        makeId,
      }),
    ).toThrow(/profundidad/);

    // Conflicto con reconstrucción de densidad (predictor y curva objetivo)
    const withDensity = setDensityReconstruction(
      project,
      well.id,
      'c-zden',
      {
        washoutIntervals: [{ top: 7800.0, base: 7801.0 }],
        goodIntervals: [{ top: 7801.5, base: 7804.5 }],
        predictors: [
          { curveId: 'c-nphi', role: 'neutron', trusted: true, reliableIntervals: [{ top: 7800.0, base: 7804.5 }] },
          { curveId: 'c-gr', role: 'gr', trusted: true, reliableIntervals: [{ top: 7800.0, base: 7804.5 }] },
        ],
      },
      'dens-1',
    );
    const selDensity = { ...sel, depth: withDensity.wells[0]!.well.depth.values };
    expect(exclusionTargetInfo(withDensity, well.id, 'c-zden', selDensity)?.blockingError).toMatch(/reconstrucción/);
    expect(exclusionTargetInfo(withDensity, well.id, 'c-nphi', selDensity)?.blockingError).toMatch(/predictores/);

    // Límite de 256 intervalos separados
    const nMany = 600;
    const bigDepth = Float64Array.from({ length: nMany }, (_, i) => 7000 + i * 0.5);
    const bigWell = createWell({
      id: 'w-big',
      name: 'Grande',
      depth: bigDepth,
      curves: [{ id: 'c1', mnemonic: 'RHOB', unit: 'g/cm3', role: 'RHOB', data: new Float64Array(nMany).fill(2.4), origin: { kind: 'measured' } }],
    });
    const bigProj = addWell(createProject('Big'), bigWell);
    const checkerboard = new Uint8Array(nMany);
    for (let i = 0; i < nMany; i += 2) checkerboard[i] = 1; // 300 tramos separados > 256
    const bigSel = makeSelection('crossplot', bigDepth, checkerboard, { kind: 'interval', top: 7000, base: 7299.5 })!;
    expect(exclusionTargetInfo(bigProj, 'w-big', 'c1', bigSel)?.blockingError).toMatch(/256/);
    expect(() =>
      excludeSelectionInPreparation(bigProj, 'w-big', 'c1', bigSel, {
        reason: 'Demasiados tramos',
        activateSource: false,
        makeId,
      }),
    ).toThrow(/256/);

    // Revisión obsoleta tras reemplazo de curva (I03)
    const masked = addMaskInterval(project, well.id, 'c-zden', { id: 'e1', top: 7800.5, base: 7801.0 }, 'mask-1');
    const changed = updateWell(masked, well.id, (w) => ({
      ...w,
      curves: w.curves.map((c) => (c.id === 'c-zden' ? { ...c, data: new Float64Array(c.data.length).fill(2.5) } : c)),
    }));
    const selChanged: PlotSelection = { ...sel, depth: changed.wells[0]!.well.depth.values };
    expect(exclusionTargetInfo(changed, well.id, 'c-zden', selChanged)?.blockingError).toMatch(/otros datos/);

    // Detección de otra fuente activa en el rol (I04)
    const otherSource = setSource(project, well.id, 'RHOB', { kind: 'module', moduleId: 'custom-mod' });
    expect(exclusionTargetInfo(otherSource, well.id, 'c-zden', sel)?.otherActiveSource).toBe('módulo custom-mod');

    // validatePreparation rechaza reason vacío o >200 chars y acepta reason válido
    const validState = excludeSelectionInPreparation(project, well.id, 'c-zden', sel, {
      reason: 'Motivo OK',
      activateSource: false,
      makeId,
    }).wells[0]!.interpretation.preparation!;
    expect(() => validatePreparation(validState)).not.toThrow();
    const emptyReason = structuredClone(validState);
    emptyReason.nodes[0]!.intervals[0]!.reason = '   ';
    expect(() => validatePreparation(emptyReason)).toThrow(/motivo/);
    const longReason = structuredClone(validState);
    longReason.nodes[0]!.intervals[0]!.reason = 'x'.repeat(201);
    expect(() => validatePreparation(longReason)).toThrow(/motivo/);
    const paddedReason = structuredClone(validState);
    paddedReason.nodes[0]!.intervals[0]!.reason = `   ${'a'.repeat(200)}   `;
    expect(() => validatePreparation(paddedReason)).toThrow(/motivo/);
  });

  it('regresión revisión independiente: v7 estricto, syncPlotSelection en undo/redo, visibilidad/filtros/sarta y bordes', async () => {
    const well = makeTestWell();
    const base = addWell(createProject('TP'), well);
    const sel = makeLassoSelection(well);

    // #1: v7 rechaza userFlags vacío, nombres/orígenes sin normalizar o intervalos desordenados/solapados
    const withPrepAndFlag = excludeSelectionInPreparation(
      saveSelectionAsUserFlag(base, well.id, sel, { id: 'uf1', name: 'Arena limpia' }),
      well.id,
      'c-zden',
      sel,
      { reason: 'QC', activateSource: false, makeId },
    );
    const rawV7 = JSON.parse(await serializeProject(withPrepAndFlag));
    for (const mutator of [
      (f: any) => { f.project.wells[0].interpretation.userFlags = []; },
      (f: any) => { f.project.wells[0].interpretation.userFlags[0].name = '  Arena limpia  '; },
      (f: any) => { f.project.wells[0].interpretation.userFlags[0].source = '  origen  '; },
      (f: any) => { f.project.wells[0].interpretation.userFlags[0].intervals = [{ top: 7802, base: 7803 }, { top: 7800.5, base: 7802.5 }]; },
    ]) {
      const broken = structuredClone(rawV7);
      mutator(broken);
      await expect(deserializeProject(JSON.stringify(broken))).rejects.toThrow();
    }

    // #2: syncPlotSelectionWithProject preserva la selección al migrar v6 → v7, undo y redo, pero la limpia al cambiar grilla
    clearPlotSelection();
    setPlotSelection(sel);
    const migrated = excludeSelectionInPreparation(base, well.id, 'c-zden', sel, {
      reason: 'Baritina',
      activateSource: false,
      makeId,
    });
    expect(migrated.wells[0]!.well.depth.values).not.toBe(base.wells[0]!.well.depth.values);
    syncPlotSelectionWithProject(base, migrated);
    expect(getPlotLink().selection?.depth).toBe(migrated.wells[0]!.well.depth.values);
    // Undo (v7 → v6): re-vincula de vuelta a D0 sin destruir la selección
    syncPlotSelectionWithProject(migrated, base);
    expect(getPlotLink().selection?.depth).toBe(base.wells[0]!.well.depth.values);
    // Cambio real de profundidad: sí limpia la selección
    const shifted = updateWell(base, well.id, (w) => ({
      ...w,
      depth: { ...w.depth, values: Float64Array.from(w.depth.values, (d) => d + 10) },
    }));
    syncPlotSelectionWithProject(base, shifted);
    expect(getPlotLink().selection).toBeNull();

    // #3: ocultar bandera en visor conserva nombre legible (sin fugar UFLAG_...) y scopeOptions usa el nombre
    const flagged = saveSelectionAsUserFlag(base, well.id, sel, { id: 'uf-abc', name: 'Arena limpia TS' });
    const roleId = userFlagRoleId('uf-abc');
    const computed = withUserFlagCurves(well.depth.values, flagged.wells[0]!.interpretation.userFlags, []);
    const roles = withUserFlagCatalog(registry.roles, flagged.wells[0]!.interpretation.userFlags);
    const tracksHidden = resolveTracks(
      BUILTIN_LAYOUTS.petrophysics,
      { depth: well.depth.values, curves: well.curves, computed, catalog: roles },
      { roles: { [roleId]: { hidden: true } } },
    );
    const flagsTrack = tracksHidden.find((t) => t.id === 'flags');
    expect(flagsTrack?.hidden?.[0]?.name).toBe('Arena limpia TS');
    const visibleTrack = resolveTracks(BUILTIN_LAYOUTS.petrophysics, {
      depth: well.depth.values,
      curves: well.curves,
      computed,
      catalog: roles,
    }).find((t) => t.id === 'flags');
    const rc = visibleTrack!.curves.find((c) => c.role === roleId)!;
    expect(scopeOptions(rc)[1]!.label).toBe('Bandera «Arena limpia TS»');

    // #4: bandera borrada sigue siendo reconocida como bandera en filtros, y translatePlotFilters traduce por nombre
    const ctxEmpty = plotContextOf(base.wells[0]!.well, base.wells[0]!.interpretation, []);
    expect(isFlagCurve(ctxEmpty, `r:${roleId}`)).toBe(true);
    expect(formatFilterRule({ id: 'f1', curve: `r:${roleId}`, op: 'eq', value: 1, enabled: true }, null, true)).toBe('Bandera de usuario = Sí');

    const wellB = createWell({ id: 'w-b', name: 'Pozo B', depth: Float64Array.from(well.depth.values), curves: well.curves });
    const projB = saveSelectionAsUserFlag(addWell(createProject('B'), wellB), 'w-b', makeLassoSelection(wellB), {
      id: 'uf-otro-id',
      name: 'arena limpia ts',
    });
    const ctxA = plotContextOf(flagged.wells[0]!.well, flagged.wells[0]!.interpretation, []);
    const ctxB = plotContextOf(projB.wells[0]!.well, projB.wells[0]!.interpretation, []);
    const translated = translatePlotFilters(ctxA, [{ id: 'f1', curve: `r:${roleId}`, op: 'eq', value: 1, enabled: true }], ctxB);
    expect(translated?.[0]?.curve).toBe(`r:${userFlagRoleId('uf-otro-id')}`);
    // Sin bandera homónima (aunque coincida por azar el id) no aplica la bandera ajena
    const projC = saveSelectionAsUserFlag(addWell(createProject('C'), wellB), 'w-b', makeLassoSelection(wellB), {
      id: 'uf-abc',
      name: 'Otra anomalía distinta',
    });
    const ctxC = plotContextOf(projC.wells[0]!.well, projC.wells[0]!.interpretation, []);
    const translatedC = translatePlotFilters(ctxA, [{ id: 'f1', curve: `r:${roleId}`, op: 'eq', value: 1, enabled: true }], ctxC);
    expect(translatedC?.[0]?.curve).not.toBe(`r:${roleId}`);

    // #5: selectionTitle > 120 chars se recorta sin bloquear el guardado
    const longSel: PlotSelection = {
      ...sel,
      source: 'histogram',
      detail: { kind: 'bins', curve: 'm:c-gr', curveLabel: 'M'.repeat(140), edges: [0, 100], bins: [0, 1] },
    };
    const savedLong = saveSelectionAsUserFlag(base, well.id, longSel, { id: 'uf-long', name: 'Nombre largo OK' });
    expect(savedLong.wells[0]!.interpretation.userFlags![0]!.source!.length).toBeLessThanOrEqual(120);

    // #6: defaultExclusionCurveId prioriza curvas visibles según sarta y otherActiveSource muestra mnemónico de preparada
    const viewerSel: PlotSelection = { ...sel, source: 'viewer', detail: { kind: 'interval', top: 7800.5, base: 7801.0 } };
    expect(defaultExclusionCurveId(base.wells[0]!, viewerSel, [], new Set(['c-gr']))).toBe('c-zden');
    const wellTwoRhob = createWell({
      id: 'w-2r',
      name: 'Dos RHOB',
      depth: well.depth.values,
      curves: [
        ...well.curves,
        { id: 'c-rhob2', mnemonic: 'RHOB_2', unit: 'g/cm3', role: 'RHOB', data: Float64Array.from(well.curves[1]!.data), origin: { kind: 'measured' } },
      ],
    });
    const projTwo = addMaskInterval(addWell(createProject('2R'), wellTwoRhob), 'w-2r', 'c-rhob2', { id: 'e2', top: 7800.5, base: 7801.0 }, 'mask-r2');
    const selTwo = { ...sel, depth: projTwo.wells[0]!.well.depth.values };
    expect(exclusionTargetInfo(projTwo, 'w-2r', 'c-zden', selTwo)?.otherActiveSource).toBe('RHOB_2 (preparada)');

    // #8: addUserFlag rechaza intervalos inválidos en lugar de descartarlos, y evaluateUserFlag/maskToExactIntervals toleran standalone no monótonos
    expect(() =>
      addUserFlag(base, well.id, {
        id: 'uf-bad',
        name: 'Inválida',
        intervals: [{ top: 7800.5, base: 7801.0 }, { top: NaN, base: 7802.0 }],
      }),
    ).toThrow(/finitos/);
    expect(maskToExactIntervals([100, 99, 98], [1, 1, 0])).toEqual([{ top: 99, base: 100 }]);
    expect(Array.from(evaluateUserFlag([10, NaN, 12, 14], { intervals: [{ top: 11, base: 15 }] }))).toEqual([0, 0, 1, 1]);
  });
});
