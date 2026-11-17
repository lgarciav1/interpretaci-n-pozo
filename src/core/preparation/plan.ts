import { DENSITY_POLICY, type DensityReconstructionReport } from '../../ml/densityReconstruction';
import { densityIntervalMask, densityPredictorUnit, type DensityReconstructionConfig } from './density';
import { curveInputKey, curveProvenance, engineDecisionKey, identityKey, sameContext, wellInputKey, type CurveProvenance, type EngineContext } from '../engine/context';
import type { EngineCurve, EngineWell } from '../engine/engine';
import type { Interpretation } from '../interpretation';
import type { Registry } from '../registry';
import type { Curve, Well } from '../well';
import { selectDataCurves, type DataContext } from './projection';
import { preparedCurveId } from './source';
import { interpolationSourceProblem } from './interpolation';
import { maskRanges, preparationStateKey, PREPARATION_BUDGET, validatePreparation, type GapFill, type MedianFilter, type DepthShift, nodeGapFill, nodeFilter, nodeShift, nodeNormalization, normalizationKey, type CurveNormalization } from './state';
import { MIN_NORMALIZATION_SAMPLES, normalizationDomain, type NormalizationStats, type PhysicalDomain } from './normalization';
import { Quality } from './quality';
import { MGT_METHOD, type MgtConfig } from './mgt';
import { convert, getUnit } from '../units';

export interface ShiftFrame { referenceId: string; sourceDatum: string | null; targetDatum: string | null }
export interface MaskBinding {
  density?: { curveId: string; contentVersion: string; unit: string; role: string | null; mnemonic: string }[];
  mgt?: {
    caliperContentVersion: string;
    caliperUnit: string;
    acquisitionKey: string;
  };
  shiftFrame?: ShiftFrame;
  depthKey: string;
  contentVersion: string;
  mnemonic: string;
  role: string | null;
  unit: string;
}
export type PreparationBindings = Readonly<Record<string, MaskBinding | null>>;
export interface PlannedPreparation {
  density?: DensityReconstructionConfig;
  densityTargetMask?: Uint8Array;
  densityActive?: boolean;
  id: string;
  nodeId: string;
  sourceCurveId: string;
  mnemonic: string;
  role: string | null;
  unit: string;
  recipeKey: string;
  ranges: { top: number; base: number }[];
  gapFill?: GapFill;
  filter?: MedianFilter;
  shift?: DepthShift;
  /** Normalización (0060) y dominio físico del rol en la unidad de la curva (null = sin dominio declarado). */
  normalization?: { config: CurveNormalization; domain: PhysicalDomain | null };
  boundaries?: number[];
  provenance: CurveProvenance;
  /** Una máscara no corrige efectos ambientales. */
  correctionLedger: {
    effect: "borehole";
    method: string;
    version: number;
    reference: string;
    url: string;
    uncertainty: string;
    inputRevisionId: string;
    conditions: MgtConfig;
    definition: typeof MGT_METHOD;
  }[];
  mgt?: { config: MgtConfig; toInches: number };
}
export interface PreparationPlan {
  stateKey: string;
  context: EngineContext;
  originalKey: string;
  bindings: PreparationBindings;
  artifacts: PlannedPreparation[];
  diagnostics: { nodeId: string; status: 'disabled' | 'needs-input'; message: string }[];
  toolString?: Interpretation['toolString'];
}
export interface PreparedPayload { density?: { lower: Float64Array; upper: Float64Array; status: Uint8Array; report: DensityReconstructionReport }; sourceCounts?: { interpolated: number; filtered: number }; normalization?: NormalizationStats; id: string; version: string; data: Float64Array; quality: Uint16Array }
/** Artefactos que necesitan un buffer de trabajo del tamaño de la curva (uno compartido por el evaluador). */
export const needsScratch = (a: Pick<PlannedPreparation, 'filter' | 'shift' | 'normalization'>): boolean => !!(a.filter || a.shift || a.normalization);
export interface PreparedPackage { plan: PreparationPlan; artifacts: PreparedPayload[] }

export function planPreparation(well: EngineWell, i: Interpretation, inputRevisionId: string | null, registry: Pick<Registry, 'tools'>, bindings: PreparationBindings = {}, depthKey = `depth:${identityKey(well.depth)}`): PreparationPlan {
  if (i.preparation !== undefined) validatePreparation(i.preparation);
  const originals = well.curves.map(c => ({ ...c, provenance: curveProvenance(c, depthKey) }));
  const originalKey = curveInputKey(well.id, depthKey, originals);
  const artifacts: PlannedPreparation[] = [], diagnostics: PreparationPlan['diagnostics'] = [];
  const nodes = i.preparation?.nodes ?? [];
  if (nodes.length && well.curves.some(c => c.provenance?.origin === 'prepared')) throw new Error('La preparación necesita originales, no una proyección anterior.');
  if (nodes.length && !inputRevisionId) throw new Error('La preparación necesita revisiones de entradas.');
  for (const node of nodes) {
    if (!node.enabled) { diagnostics.push({ nodeId: node.id, status: 'disabled', message: 'Máscara desactivada.' }); continue; }
    const c = originals.find(c => c.id === node.input.curveId), binding = bindings[node.id];
    if (!c || !binding || binding.depthKey !== depthKey || binding.contentVersion !== c.provenance.contentVersion || binding.unit !== c.unit || binding.role !== c.role || binding.mnemonic !== c.mnemonic) {
      diagnostics.push({ nodeId: node.id, status: 'needs-input', message: `La máscara de '${node.input.curveId}' está vinculada a otros datos. Revisá su origen antes de aplicarla.` }); continue;
    }
    const id = preparedCurveId(node.id, 'masked');
    if (well.curves.some(c => c.id === id)) throw new Error('El identificador preparado colisiona con un original.');
    const ranges = maskRanges(node.intervals);
    if (node.kind === 'density-reconstruction') {
      if (c.role !== 'RHOB' || c.unit !== 'g/cm3' || !binding.density || binding.density.length !== node.density.predictors.length) throw new Error('Entradas de reconstrucción inválidas.');
      const parents = node.density.predictors.map(p => {
        const source = originals.find(x => x.id === p.curveId), fixed = binding.density!.find(x => x.curveId === p.curveId);
        if (!source || source.id === c.id || !fixed || fixed.contentVersion !== source.provenance.contentVersion || fixed.unit !== source.unit || fixed.role !== source.role || fixed.mnemonic !== source.mnemonic) throw new Error('Predictor de densidad obsoleto o incompatible.');
        densityPredictorUnit(source, p.role); return source;
      });
      const recipeKey = JSON.stringify(['density-rf-v1', c.id, c.provenance.contentVersion, depthKey, node.input.inputRevisionId, node.density, binding.density]);
      const provenance: CurveProvenance = { origin: 'prepared', contentVersion: `density:${recipeKey}`, depthKey, ancestorToolIds: [...new Set([c, ...parents].flatMap(p => { const t = registry.tools.ownerOf(p); return t ? [t.id] : []; }))].sort(), qualityKey: `density-quality:${recipeKey}` };
      artifacts.push({ id, nodeId: node.id, sourceCurveId: c.id, mnemonic: `${c.mnemonic} estimada ML`, role: c.role, unit: c.unit, recipeKey, ranges: [], provenance, density: node.density, densityTargetMask: densityIntervalMask(well.depth, node.density.washoutIntervals), densityActive: Object.values(i.sources).some(s => s.kind === 'curve' && s.curveId === id), correctionLedger: [] });
      continue;
    }
    if (node.kind === "mgt-borehole") {
      const caliper = originals.find((x) => x.id === node.mgt.caliperCurveId);
      if (
        c.role !== "GR" ||
        c.unit !== "gAPI" ||
        !binding.mgt ||
        caliper?.role !== "CALI" ||
        getUnit(caliper.unit)?.dimension !== "length" ||
        binding.mgt.caliperContentVersion !==
          caliper.provenance.contentVersion ||
        binding.mgt.caliperUnit !== caliper.unit
      )
        throw new Error(
          "Entradas MGT ausentes, incompatibles o pertenecientes a otra versión.",
        );
      const toInches = convert(1, caliper.unit, "in");
      const recipeKey = JSON.stringify([
        MGT_METHOD.id,
        1,
        c.id,
        c.provenance.contentVersion,
        caliper.id,
        caliper.provenance.contentVersion,
        depthKey,
        node.input.inputRevisionId,
        node.mgt,
        binding.mgt,
      ]);
      const ancestorToolIds = [
        ...new Set(
          [
            registry.tools.ownerOf(c)?.id,
            registry.tools.ownerOf(caliper)?.id,
          ].filter((x): x is string => !!x),
        ),
      ];
      const provenance: CurveProvenance = {
        origin: "prepared",
        contentVersion: `mgt:${recipeKey}`,
        depthKey,
        ancestorToolIds,
        qualityKey: `mgt-quality:${recipeKey}`,
      };
      artifacts.push({
        id,
        nodeId: node.id,
        sourceCurveId: c.id,
        mnemonic: `${c.mnemonic} MGT corregida`,
        role: c.role,
        unit: c.unit,
        recipeKey,
        ranges: [],
        provenance,
        mgt: { config: node.mgt, toInches },
        correctionLedger: [
          {
            effect: "borehole",
            method: MGT_METHOD.id,
            version: 1,
            reference: MGT_METHOD.reference,
            url: MGT_METHOD.url,
            uncertainty: MGT_METHOD.uncertainty,
            inputRevisionId: node.input.inputRevisionId,
            conditions: node.mgt,
            definition: MGT_METHOD,
          },
        ],
      });
      continue;
    }
    const gapFill = nodeGapFill(node);
    const filter = nodeFilter(node);
    const shift = nodeShift(node);
    const normalization = nodeNormalization(node);
    if (shift && (shift.referenceId !== well.id || !binding.shiftFrame || binding.shiftFrame.referenceId !== well.id || [binding.shiftFrame.sourceDatum, binding.shiftFrame.targetDatum].some(d => d !== null && d !== shift.datum))) throw new Error('La alineación requiere la misma referencia MD y datum declarado para origen y destino.');
    if ((gapFill || filter || shift) && i.zones.some(z => !Number.isFinite(z.top) || !Number.isFinite(z.base) || z.top >= z.base)) throw new Error('Las fronteras de zona deben ser finitas y ordenadas para interpolar.');
    const boundaries = gapFill || filter || shift ? [...new Set(i.zones.flatMap(z => [z.top, z.base]))].sort((a, b) => a - b) : undefined;
    if (gapFill || filter || shift || normalization) { const problem = interpolationSourceProblem(c, normalization ? 'La normalización' : shift ? 'La alineación' : filter ? 'El filtro' : undefined); if (problem) throw new Error(problem); }
    if (normalization && (normalization.top < well.depth[0]! || normalization.base > well.depth[well.depth.length - 1]!)) throw new Error('El intervalo de referencia de la normalización está fuera del pozo.');
    const domain = normalization ? normalizationDomain(c.role, c.unit) : null;
    // Sin normalización, la receta (y su contentVersion) es byte a byte la de antes de 0060.
    const recipe: unknown[] = [shift ? 'constant-shift' : filter ? 'median-filter' : gapFill ? 'linear-interpolation' : 'mask', 1, c.id, c.provenance.contentVersion, depthKey, c.role, c.unit, ranges, ...(gapFill ? [[gapFill.top, gapFill.base, gapFill.maxGapM], boundaries] : []), ...(filter ? [[filter.top, filter.base, filter.radiusM, filter.maxStepM], ...(gapFill ? [] : [boundaries])] : []), ...(shift ? [[shift.offsetM, shift.maxGapM, shift.referenceId, shift.depthKind, shift.datum], binding.shiftFrame, ...(!gapFill && !filter ? [boundaries] : [])] : [])];
    if (normalization) { recipe[0] = 'linear-normalization'; recipe.push([...normalizationKey(normalization), domain]); }
    const recipeKey = JSON.stringify(recipe);
    const owner = registry.tools.ownerOf(c);
    const provenance: CurveProvenance = { origin: 'prepared', contentVersion: `mask:${recipeKey}`, depthKey, ancestorToolIds: owner ? [owner.id] : [], qualityKey: `mask-quality:${recipeKey}` };
    artifacts.push({ id, nodeId: node.id, sourceCurveId: c.id, mnemonic: `${c.mnemonic} preparada`, role: c.role, unit: c.unit, recipeKey, ranges, ...(gapFill ? { gapFill: { ...gapFill }, boundaries } : {}), ...(filter ? { filter: { ...filter }, boundaries } : {}), ...(shift ? { shift: { ...shift }, boundaries } : {}), ...(normalization ? { normalization: { config: { ...normalization }, domain } } : {}), provenance, correctionLedger: [] });
  }
  if (well.depth.length * (artifacts.reduce((sum, a) => sum + (a.density ? 27 : 10), 0) + (artifacts.some(needsScratch) ? 10 : 0)) > PREPARATION_BUDGET) throw new Error('La preparación supera 128 MiB de artefactos y memoria de trabajo. Reducí la cantidad de curvas.');
  const preparationKey = nodes.length ? JSON.stringify([artifacts.map(a => [a.id, a.provenance]), diagnostics]) : 'identity';
  const context: EngineContext = Object.freeze({ wellId: well.id, inputRevisionId, depthKey, preparationKey,
    engineKey: curveInputKey(well.id, depthKey, [...originals, ...artifacts]) + '|' + engineDecisionKey(i) });
  return { stateKey: preparationStateKey(i.preparation), context, originalKey, bindings, artifacts, diagnostics, ...(i.toolString ? { toolString: i.toolString } : {}) };
}

export function validatePreparedPayloads(plan: PreparationPlan, payloads: unknown, n: number): asserts payloads is PreparedPayload[] {
  if (!Array.isArray(payloads) || payloads.length !== plan.artifacts.length) throw new Error('El paquete de preparación está incompleto.');
  const seen = new Set<string>();
  for (const p of payloads) {
    const expected = plan.artifacts.find(a => a.id === p?.id);
    if (!expected || seen.has(p.id) || p.version !== expected.provenance.contentVersion || !(p.data instanceof Float64Array) || !(p.quality instanceof Uint16Array) || p.data.length !== n || p.quality.length !== n) throw new Error('Artefacto preparado inválido, repetido u obsoleto.');
    if (expected.shift && (!p.sourceCounts || Object.keys(p.sourceCounts).length !== 2 || !['interpolated','filtered'].every(key => Number.isInteger(p.sourceCounts[key]) && p.sourceCounts[key] >= 0 && p.sourceCounts[key] <= n) || !expected.gapFill && p.sourceCounts.interpolated !== 0 || !expected.filter && p.sourceCounts.filtered !== 0)) throw new Error('Conteos de la entrada alineada inválidos.');
    if (!expected.shift && p.sourceCounts !== undefined) throw new Error('Conteos de alineación en un artefacto sin alineación.');
    const stats = p.normalization;
    if (expected.normalization) {
      const twoPoint = expected.normalization.config.method === 'two-point';
      if (!stats || typeof stats !== 'object' || Object.keys(stats).length !== 5 || !Number.isInteger(stats.samples) || stats.samples < MIN_NORMALIZATION_SAMPLES || stats.samples > n || !Number.isFinite(stats.sourceLow) || (twoPoint ? !(Number.isFinite(stats.sourceHigh) && stats.sourceHigh! > stats.sourceLow) : stats.sourceHigh !== null) || !Number.isFinite(stats.gain) || !(stats.gain > 0) || !Number.isInteger(stats.outOfDomain) || stats.outOfDomain < 0 || stats.outOfDomain > n) throw new Error('Estadísticas de normalización inválidas.');
    } else if (stats !== undefined) throw new Error('Estadísticas de normalización en un artefacto sin normalización.');
    if (expected.density) {
      const d = p.density;
      if (!d || !(d.lower instanceof Float64Array) || !(d.upper instanceof Float64Array) || !(d.status instanceof Uint8Array) || d.lower.length !== n || d.upper.length !== n || d.status.length !== n || !d.report || d.report.version !== 'density-rf-v1' || typeof d.report.accepted !== 'boolean' || !Array.isArray(d.report.reasons) || d.report.reasons.some((x: unknown) => typeof x !== 'string')) throw new Error('Banda o reporte de reconstrucción inválidos.');
      for (const key of ['rmse','r2','bandCoverage','halfWidth'] as const) if (d.report[key] !== null && !Number.isFinite(d.report[key])) throw new Error('Métricas ML inválidas.');
      for (const key of ['trainingCount','validationCount','calibrationCount','targetCount','estimatedCount'] as const) if (!Number.isInteger(d.report[key]) || d.report[key] < 0 || d.report[key] > n) throw new Error('Conteos ML inválidos.');
      if (!Number.isFinite(d.report.elapsedMs) || d.report.elapsedMs < 0 || d.report.nominalCoverage !== .9 || !Number.isFinite(d.report.validationCoverage) || d.report.validationCoverage < 0 || d.report.validationCoverage > 1 || (d.report.bandCoverage !== null && (d.report.bandCoverage < 0 || d.report.bandCoverage > 1))) throw new Error('Cobertura ML inválida.');
      if (d.report.accepted && (d.report.trainingCount < DENSITY_POLICY.minTrain || d.report.validationCount < DENSITY_POLICY.minValidation || d.report.calibrationCount < DENSITY_POLICY.minCalibration || d.report.rmse === null || d.report.rmse > DENSITY_POLICY.maxRmse || d.report.rmse < 0 || d.report.r2 === null || d.report.r2 < DENSITY_POLICY.minR2 || d.report.r2 > 1 || d.report.halfWidth === null || d.report.halfWidth < .005 || d.report.halfWidth > DENSITY_POLICY.maxHalfWidth || d.report.bandCoverage === null || d.report.bandCoverage < DENSITY_POLICY.minBandCoverage || d.report.validationCoverage < DENSITY_POLICY.minValidationCoverage || d.report.reasons.length)) throw new Error('El reporte no cumple la política de admisión ML.');
      let estimatedCount = 0, targetCount = 0;
      for (let k = 0; k < n; k++) {
        const status = d.status[k]!, q = p.quality[k]!, value = p.data[k]!;
        if (!expected.densityTargetMask || expected.densityTargetMask.length !== n || (status > 0) !== (expected.densityTargetMask[k] === 1)) throw new Error('Reconstrucción fuera del derrumbe declarado.');
        const estimated = status === 1; if (estimated) estimatedCount++; if (status > 0) targetCount++;
        if (!Number.isInteger(status) || status < 0 || status > 4 || (q & ~(Quality.OriginallyMissing | Quality.EstimatedML | Quality.UnsupportedML))) throw new Error('Estado de reconstrucción inválido.');
        if (estimated) {
          if (!d.report.accepted || !(q & Quality.EstimatedML) || (q & Quality.UnsupportedML) || ![value, d.lower[k], d.upper[k]].every(Number.isFinite) || Math.abs(d.lower[k]! - (value - d.report.halfWidth!)) > 1e-10 || Math.abs(d.upper[k]! - (value + d.report.halfWidth!)) > 1e-10) throw new Error('Estimación ML o banda incoherente.');
        } else {
          if ((q & Quality.EstimatedML) || !Number.isNaN(d.lower[k]) || !Number.isNaN(d.upper[k])) throw new Error('Banda en una muestra no estimada.');
          if (status > 0 ? !(q & Quality.UnsupportedML) || !Number.isNaN(value) : (q & Quality.UnsupportedML) || (Number.isFinite(value) ? !!(q & Quality.OriginallyMissing) : !Number.isNaN(value) || !(q & Quality.OriginallyMissing))) throw new Error('Calidad ML incoherente.');
        }
      }
      if (estimatedCount !== d.report.estimatedCount || targetCount !== d.report.targetCount) throw new Error('Conteos ML incompatibles con la curva.');
      seen.add(p.id); continue;
    } else if (p.density !== undefined) throw new Error('Banda ML sin receta de reconstrucción.');
    let outOfDomain = 0;
    for (let k = 0; k < n; k++) {
      let q = p.quality[k]!;
      const value = p.data[k]!;
      // Normalización (0060): toda salida finita lleva 256 y, fuera del dominio físico, 128 con su valor; el resto de
      // las banderas sigue las reglas de las etapas previas.
      if (expected.normalization) {
        if (Number.isFinite(value)) {
          if (!(q & Quality.Normalized)) throw new Error('Una salida normalizada finita no tiene la bandera de normalización.');
          if (q & Quality.OutOfDomain) outOfDomain++;
          q &= ~(Quality.Normalized | Quality.OutOfDomain);
        } else if (q & Quality.Normalized) throw new Error('Un faltante no puede estar normalizado.');
      }
      if (expected.mgt) {
        if (
          q === 64
            ? !Number.isFinite(value)
            : ![1, 128].includes(q) || !Number.isNaN(value)
        )
          throw new Error(
            "Calidad MGT incompatible: corregido finito o faltante/fuera de dominio explícitos.",
          );
        continue;
      }
      if (expected.shift) {
        const allowed = 1 | 2 | 8 | 16 | 32 | 128;
        if ((q & ~allowed) || !(q & 32) || ((q & 16) && !expected.filter)) throw new Error('Calidad de alineación inválida.');
        if (q & 128) { if (!Number.isNaN(value)) throw new Error('La falta de soporte debe conservar NaN.'); }
        else if (Number.isFinite(value)) {
          if ((q & 2) || ((q & 1) && !(q & 8))) throw new Error('Una salida alineada finita tiene calidad incompatible.');
        } else if (!Number.isNaN(value) || ![33, 34, 35].includes(q)) throw new Error('Faltante alineado inválido.');
        continue;
      }
      if (q === 0 || (q === 9 && expected.gapFill) || (q === 16 && expected.filter) || ((q === 24 || q === 25) && expected.filter && expected.gapFill)) {
        if (!Number.isFinite(value)) throw new Error('Una medición o estimación publicada debe ser finita.');
      } else if ((q !== 1 && q !== 2 && q !== 3) || !Number.isNaN(value)) throw new Error('La calidad de preparación no corresponde al valor publicado.');
    }
    if (stats && stats.outOfDomain !== outOfDomain) throw new Error('El conteo fuera de dominio de la normalización no coincide con las banderas.');
    seen.add(p.id);
  }
}

/** Reconstrucción en el cliente: no evalúa recetas, publica solo el paquete completo del mismo contexto. */
export function materializePreparation(well: Well, prepared: PreparedPackage, context: EngineContext, registry: Pick<Registry, 'tools'>): DataContext {
  const { plan, artifacts: payloads } = prepared;
  if (!sameContext(context, plan.context) || plan.originalKey !== wellInputKey({ id: well.id, depth: well.depth.values, curves: well.curves })) throw new Error('La preparación no corresponde a los originales vigentes.');
  validatePreparedPayloads(plan, payloads, well.depth.values.length);
  const byId = new Map(payloads.map(p => [p.id, p]));
  const curves: Curve[] = [...well.curves, ...plan.artifacts.map(a => ({ id: a.id, mnemonic: a.mnemonic, role: a.role, unit: a.unit, data: byId.get(a.id)!.data, origin: { kind: 'prepared' as const }, provenance: a.provenance }))];
  const engineWell: EngineWell = { id: well.id, depth: well.depth.values, curves };
  if (!context.engineKey.startsWith(wellInputKey(engineWell) + '|')) throw new Error('La proyección reconstruida no coincide con el cálculo.');
  const lineage = new Map(curves.map(c => [c.id, c.provenance ?? { ...curveProvenance(c, context.depthKey), ancestorToolIds: registry.tools.ownerOf(c) ? [registry.tools.ownerOf(c)!.id] : [] }]));
  return { well: plan.artifacts.length ? { ...well, curves } : well, engineWell, context, preparationStateKey: plan.stateKey, ...selectDataCurves(curves, plan, registry.tools), lineage, quality: new Map(payloads.map(p => [p.id, p.quality])) };
}

export function projectedEngineCurves(well: EngineWell, plan: PreparationPlan, payloads: PreparedPayload[]): readonly EngineCurve[] {
  const byId = new Map(payloads.map(p => [p.id, p]));
  return [...well.curves, ...plan.artifacts.map(a => ({ id: a.id, mnemonic: a.mnemonic, role: a.role, unit: a.unit, provenance: a.provenance, data: byId.get(a.id)!.data }))];
}
