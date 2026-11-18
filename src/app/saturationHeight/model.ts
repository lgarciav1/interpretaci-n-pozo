import { preparedData, entryContext } from '../preparation/data';
import { visibleWell } from '../plots/context';
import type { ClientResult } from '../../core/engine/client';
import { engineDecisionKey, sameContext } from '../../core/engine/context';
import { isJsonValue, sourceRefEquals, type SourceRef } from '../../core/interpretation';
import { pointNumbers, pointTexts, shiftedDepth } from '../../core/pointSets';
import { enableProjectInputRevisions } from '../../core/state/inputRevisions';
import { activeWellEntry, getWellEntry, updateInterpretation, type Project, type WellEntry } from '../../core/state/project';
import { canonicalJson } from '../../core/state/tracks';
import { createSnapshot } from '../../core/state/snapshots';
import { convert, parseUnit, sameDimension, type UnitId } from '../../core/units';
import { capillaryTransferFactor, compareExternalFwl, createSaturationHeightEvaluator, fitPressurePair, heightAboveFwl, transferCapillaryModel, validateCapillaryModel, type CapillaryModel, type PressurePair, type PressureTest } from '../../petro/saturationHeight';
import { EXAMPLE_PC_CLASSES } from '../../petro/rockTyping';
import { excludedIndices, selectionWindow } from '../../plots/trend/compute';
import { lowerBound } from '../../plots/trend/series';
import { parseMdtSeriesKey, pointStatuses, pressureSets } from '../../modules/mdt/model';
import { mdtSeries } from '../../modules/mdt/series';
import { CAPILLARY_KIND, classCount, rockModuleParams } from '../../modules/rock-typing/model';
import { SATURATION_HEIGHT_ID } from '../../modules/saturation-height/index';
import { readHeightScenario, type ClassModel, type HeightScenario } from '../../modules/saturation-height/scenario';
import { HEIGHT_LAB_KIND } from '../../modules/saturation-height/lab';

export interface ProfilePoint { sw: number; h: number; md: number; zoneId: string | null; rockType: number | null }
interface Support { zoneId: string | null; rockType: number | null; points: number; missingSw: number; missingGeometry: number; outside: number; compared: number; absoluteError: number }
interface HeightLine { rockType: number; reference: string; h: number[]; sw: number[]; factor: number }
export interface HeightPreview {
  fwlM: number | null;
  points: ProfilePoint[];
  lines: HeightLine[];
  support: Support[];
  issues: string[];
  pair: PressurePair | null;
  tests: { water: string[]; hydrocarbon: string[] };
  residualPa: number | null;
  admissible: boolean;
  sources: { sw: SourceRef | null; rock: SourceRef | null };
}

function readUnit(unit: string | undefined, target: UnitId): UnitId {
  const normalized = unit ? parseUnit(unit) : null;
  if (!normalized || !sameDimension(normalized, target)) throw new Error(`Unidad incompatible. Se esperaba una unidad convertible a ${target}.`);
  return normalized;
}

function curveFromSource(well: WellEntry['well'], entry: WellEntry, result: ClientResult, role: string, target: UnitId) {
  const source = result.sources[role];
  const explicit = entry.interpretation.sources[role];
  if (!source || (explicit && !sourceRefEquals(explicit, source))) return null;
  const output = source.kind === 'curve'
    ? well.curves.find(c => c.id === source.curveId)
    : result.outputs.find(o => o.active && o.moduleId === source.moduleId && o.port === role);
  const values = output && ('data' in output ? output.data : output.value);
  if (!(values instanceof Float64Array) || values.length !== well.depth.values.length) return null;
  const from = readUnit(output?.unit, target);
  return (i: number) => convert(values[i]!, from, target);
}

function geometry(entry: WellEntry, scenario: HeightScenario) {
  const md = entry.well.depth.values;
  const spec = scenario.geometry;
  if (spec.kind === 'vertical-md') {
    // A varying MD–TVD difference contradicts the vertical proxy. A constant difference can be datum alone.
    for (const { set } of mdtSelections(entry).filter(s => s.trend.id === scenario.mdt?.waterId || s.trend.id === scenario.mdt?.hydrocarbonId).slice(0, 1)) {
      const tvd = pointNumbers(set, 'tvd');
      if (!tvd) continue;
      const unit = readUnit('unit' in set.columns.tvd! ? set.columns.tvd.unit : undefined, 'm');
      const shifted = shiftedDepth(set, entry.interpretation.pointSets[set.id]);
      let smallest = Infinity, largest = -Infinity;
      for (let i = 0; i < tvd.length; i++) {
        const sampleMd = shifted[i]!;
        if (sampleMd < scenario.domainM[0] || sampleMd > scenario.domainM[1]) continue;
        const difference = set.depth[i]! - convert(tvd[i]!, unit, 'm');
        if (!Number.isFinite(difference)) continue;
        smallest = Math.min(smallest, difference);
        largest = Math.max(largest, difference);
      }
      if (largest - smallest > spec.maxMdTvdDriftM) throw new Error('La diferencia MD/TVD varía en MDT. Usá una trayectoria vertical revisada.');
    }
    return { atIndex: (i: number) => md[i]!, atMd: (value: number) => value };
  }
  const tvd = entry.well.curves.find(c => c.id === spec.curveId);
  if (!tvd) throw new Error('No se encontró la curva original de TVD seleccionada.');
  const unit = readUnit(tvd.unit, 'm');
  const sign = spec.direction === 'down' ? 1 : -1;
  const atIndex = (i: number) => sign * convert(tvd.data[i]!, unit, 'm') + spec.offsetM;
  let previousIndex: number | null = null;
  for (let i = 0; i < md.length; i++) {
    const value = atIndex(i);
    if (!Number.isFinite(value)) continue;
    if (previousIndex !== null) {
      const dz = value - atIndex(previousIndex), dm = md[i]! - md[previousIndex]!;
      if (dz < -1e-8 || dz > dm + 1e-8) throw new Error('La trayectoria normalizada debe respetar el sentido vertical y la distancia entre muestras MD.');
    }
    previousIndex = i;
  }
  return { atIndex, atMd: (value: number) => {
    const i = lowerBound(md, value);
    if (md[i] === value) return atIndex(i);
    if (i === 0 || i >= md.length || md[i]! - md[i - 1]! > spec.maxGapM) return NaN;
    const left = atIndex(i - 1), right = atIndex(i);
    return left + (right - left) * (value - md[i - 1]!) / (md[i]! - md[i - 1]!);
  } };
}

export function mdtSelections(entry: WellEntry) {
  return entry.interpretation.trends.flatMap(trend => {
    if (trend.series.provider !== 'mdt' || trend.mode !== 'fit' || trend.model !== 'linear') return [];
    const { setId, fluid } = parseMdtSeriesKey(trend.series.key);
    const set = pressureSets(entry.well.pointSets).find(p => p.id === setId);
    return fluid && set ? [{ trend, set, fluid }] : [];
  });
}

function pressureTests(entry: WellEntry, selected: ReturnType<typeof mdtSelections>[number], atMd: (value: number) => number): PressureTest[] {
  const { trend, set, fluid } = selected;
  const decision = entry.interpretation.pointSets[set.id];
  const series = mdtSeries(set, entry.interpretation, fluid);
  if (!series) throw new Error('El conjunto MDT no tiene presión.');
  const { start, end } = selectionWindow(trend.selection, series, entry.interpretation.zones);
  const excluded = excludedIndices(trend.selection.excluded, series);
  const column = set.columns.pressure;
  const unit = readUnit(column && 'unit' in column ? column.unit : undefined, 'kPa');
  const status = pointStatuses(set, decision);
  const byId = new Map(set.pointIds.map((id, index) => [id, status[index]!]));
  const tests: PressureTest[] = [];
  for (let i = start; i < end; i++) {
    if (excluded.has(i)) continue;
    const id = series.pointKey(i);
    const point = byId.get(id);
    if (point?.quality.proposeExclude && point.decided !== 'include') continue;
    tests.push({ id, depthM: atMd(series.x[i]!), pressurePa: 1000 * convert(series.y[i]!, unit, 'kPa') });
  }
  return tests;
}

function measuredModel(entry: WellEntry, model: Extract<ClassModel['model'], { kind: 'point-set' }>): CapillaryModel {
  const set = entry.well.pointSets.find(s => s.id === model.setId && (s.kind === CAPILLARY_KIND || s.kind === HEIGHT_LAB_KIND) && !s.synthetic);
  const pressure = set && pointNumbers(set, 'pc'), sw = set && pointNumbers(set, 'sw'), samples = set && pointTexts(set, 'sample');
  if (!set || !pressure || !sw || !samples) throw new Error('Faltan datos capilares revisionados para la muestra.');
  const pcColumn = set.columns.pc, swColumn = set.columns.sw;
  const pcUnit = readUnit(pcColumn && 'unit' in pcColumn ? pcColumn.unit : undefined, 'kPa');
  const swUnit = readUnit(swColumn && 'unit' in swColumn ? swColumn.unit : undefined, 'v/v');
  const decisions = entry.interpretation.pointSets[set.id];
  const points = Array.from(samples.flatMap((sample, i) => sample === model.sample && decisions?.points[set.pointIds[i]!]?.status !== 'exclude'
    ? [{ pressurePa: convert(pressure[i]!, pcUnit, 'kPa') * 1000, sw: convert(sw[i]!, swUnit, 'v/v') }] : []));
  if (samples.some((sample, i) => sample === model.sample && decisions?.points[set.pointIds[i]!]?.status === 'exclude')) {
    throw new Error('La muestra contiene puntos excluidos. Seleccioná un tramo continuo revisado.');
  }
  points.sort((a, b) => a.pressurePa - b.pressurePa);
  return { kind: 'table', points };
}

function makeLine(model: CapillaryModel, rockType: number, reference: string, factor: number, maxH: number, delta: number) {
  const evaluate = createSaturationHeightEvaluator(delta, model);
  if (!evaluate) return null;
  const range = model.kind === 'table'
    ? [model.points[0]!.pressurePa, model.points.at(-1)!.pressurePa]
    : model.rangePa;
  const lo = Math.max(range[0]! / delta, model.kind === 'brooks-corey' && !model.entryPlateau ? model.entryPressurePa / delta : 0);
  const hi = Math.min(maxH, range[1]! / delta);
  if (!(lo < hi)) return null;
  const vertices = model.kind === 'table'
    ? model.points.map(p => p.pressurePa / delta)
    : [model.entryPressurePa / delta, ...Array.from({ length: 160 }, (_, i) => lo + (hi - lo) * i / 159)];
  const h = [...new Set([lo, ...vertices.filter(v => v > lo && v < hi), hi])].sort((a, b) => a - b);
  const valid = h.flatMap(value => {
    const sw = evaluate(value);
    return sw === null ? [] : [{ h: value, sw }];
  });
  if (valid.length < 2) return null;
  return { line: { rockType, reference, factor, h: valid.map(p => p.h), sw: valid.map(p => p.sw) }, evaluate };
}

export function heightPreview(entry: WellEntry, result: ClientResult, scenario: HeightScenario | 'demo'): HeightPreview {
  const demo = scenario === 'demo';
  const well = visibleWell(result.preparation ? preparedData(entry.well, result)!.well : entry.well, entry.interpretation);
  const md = well.depth.values;
  const preview: HeightPreview = {
    fwlM: null, points: [], lines: [], support: [], issues: [], pair: null, tests: { water: [], hydrocarbon: [] }, residualPa: null, admissible: false,
    sources: { sw: result.sources.SW ?? null, rock: result.sources.ROCK_TYPE ?? null },
  };
  const domain = demo ? [md[0]!, md.at(-1)!] as const : scenario.domainM;
  const contains = (z: number) => z >= domain[0] && z <= domain[1];
  const geo = demo ? { atIndex: (i: number) => md[i]!, atMd: (value: number) => value } : geometry(entry, scenario);
  let delta: number | null = null;
  if (demo) {
    preview.fwlM = md[Math.floor(md.length * 0.65)]!;
    delta = 2000;
  } else {
    if (scenario.fwl.kind === 'external' && contains(scenario.fwl.depthM)) preview.fwlM = scenario.fwl.depthM;
    if (scenario.mdt) {
      const selections = mdtSelections(entry);
      const water = selections.find(s => s.trend.id === scenario.mdt?.waterId && s.fluid === 'water');
      const hc = selections.find(s => s.trend.id === scenario.mdt?.hydrocarbonId && s.fluid === scenario.phase);
      try {
        if (!water || !hc || water.set !== hc.set || water.set.synthetic) throw new Error('Elegí dos tendencias lineales de fases compatibles, del mismo conjunto MDT real.');
        const waterTests = pressureTests(entry, water, geo.atMd);
        const hcTests = pressureTests(entry, hc, geo.atMd);
        preview.tests = { water: waterTests.map(p => p.id), hydrocarbon: hcTests.map(p => p.id) };
        if ([...waterTests, ...hcTests].some(p => !contains(p.depthM))) throw new Error('Hay pruebas sin TVD o fuera del intervalo declarado.');
        const pair = fitPressurePair(waterTests, hcTests, domain);
        if (!pair.ok) throw new Error(pair.reason);
        preview.pair = pair;
        if (scenario.fwl.kind === 'mdt') {
          preview.fwlM = pair.classicFwlM;
        } else {
          const external = scenario.fwl;
          if (external.tolerancePa === null || !external.toleranceReference || !external.acceptEquality) throw new Error('El FWL externo requiere tolerancia sustentada y aceptación de igualdad de presión para comparar con MDT.');
          const check = compareExternalFwl(pair, external.depthM, external.tolerancePa);
          preview.residualPa = check.residualPa ?? null;
          if (!check.ok) throw new Error(`${check.reason} El gráfico muestra solo el escenario externo.`);
        }
        delta = pair.deltaGradientPaPerM;
      } catch (error) {
        preview.issues.push((error as Error).message);
      }
    } else {
      preview.issues.push('Faltan gradientes MDT revisados para predecir presión capilar.');
    }
  }
  if (preview.fwlM === null) {
    preview.issues.push('Falta un nivel de agua libre admisible en el intervalo y datum elegidos.');
    return preview;
  }
  const swValues = curveFromSource(well, entry, result, 'SW', 'v/v');
  const rockValues = curveFromSource(well, entry, result, 'ROCK_TYPE', 'unitless');
  if (!swValues) preview.sources.sw = null;
  if (!rockValues) preview.sources.rock = null;
  if (!swValues) preview.issues.push('Falta una fuente efectiva y compatible de Sw.');
  if (!rockValues) preview.issues.push('Falta tipo de roca del perfil. Se muestran puntos con clase desconocida.');
  const params = rockModuleParams(entry.interpretation.params);
  const nClasses = classCount(params);
  const readClass = (i: number) => {
    const value = rockValues?.(i);
    return value !== undefined && Number.isInteger(value) && value >= 0 && value < nClasses ? value : null;
  };
  const fwl = preview.fwlM;
  const evaluators = new Map<number, (height: number) => number | null>();
  const sameClasses = demo || !!scenario.classification && preview.sources.rock?.kind === 'module' &&
    preview.sources.rock.moduleId === 'rock-typing' && params.method === scenario.classification.method &&
    JSON.stringify(params.method === 'fzi' ? params.bounds : []) === JSON.stringify(scenario.classification.bounds);
  if (!demo && scenario.classes.length && !sameClasses) preview.issues.push('El esquema de clases declarado difiere del perfil efectivo.');
  if (!demo && !scenario.classes.length) preview.issues.push('Faltan ensayos Pc–Sw compatibles o modelos trazados por clase.');
  if (delta !== null && sameClasses && rockValues) {
    const classes = demo ? Array.from({ length: nClasses }, (_, rockType): ClassModel => {
      const example = EXAMPLE_PC_CLASSES[Math.min(EXAMPLE_PC_CLASSES.length - 1, nClasses - rockType - 1)]!;
      return { rockType, reference: example.label, assignment: 'Ilustrativo', conditions: 'Ilustrativo', saturationBasis: 'Ilustrativo',
        model: { kind: 'brooks-corey', entryPressurePa: 1000 * convert(example.pd, 'psi', 'kPa'), lambda: example.lambda, irreducibleSw: example.swirr, rangePa: [0, 30e6], entryPlateau: true },
        basis: { kind: 'lab', drainage: 'primary', phase: 'oil', wetting: 'aire', nonWetting: 'mercurio', angleConvention: 'Ilustrativo', transfer: { source: { tensionNPerM: 0.480, angleDeg: 140, angleUncertaintyDeg: 1 }, destination: { tensionNPerM: 0.030, angleDeg: 0, angleUncertaintyDeg: 1 }, maxRelativeUncertainty: 0.05, geometryEvidence: 'Ilustrativo' } } };
    }) : scenario.classes;
    for (const rock of classes) {
      try {
        if (rock.rockType >= nClasses) throw new Error('Clase fuera del esquema activo.');
        const original = rock.model.kind === 'point-set' ? measuredModel(entry, rock.model) : rock.model;
        if (!validateCapillaryModel(original)) throw new Error('Modelo fuera de dominio o tabla sin orden físico.');
        const transfer = rock.basis.kind === 'lab' ? rock.basis.transfer : null;
        const ratio = transfer
          ? capillaryTransferFactor(transfer.source, transfer.destination, transfer.maxRelativeUncertainty, transfer.geometry)
          : { ok: true as const, factor: 1 };
        if (!ratio.ok) throw new Error(ratio.reason);
        const scaled = transferCapillaryModel(original, ratio.factor);
        const plotted = scaled && makeLine(scaled, rock.rockType, rock.reference, ratio.factor, fwl - domain[0], delta);
        if (!plotted) throw new Error('La línea queda fuera del intervalo de altura cubierto.');
        preview.lines.push(plotted.line);
        evaluators.set(rock.rockType, plotted.evaluate);
      } catch (error) {
        preview.issues.push(`Clase ${rock.rockType + 1}: ${(error as Error).message}`);
      }
    }
  }
  const support = new Map<string, Support>();
  for (const { start, end, zoneId } of result.segments) {
    for (let i = start; i < end; i++) {
      const rockType = readClass(i), key = JSON.stringify([zoneId, rockType]);
      let counts = support.get(key);
      if (!counts) {
        counts = { zoneId, rockType, points: 0, missingSw: 0, missingGeometry: 0, outside: 0, compared: 0, absoluteError: 0 };
        support.set(key, counts);
      }
      const z = geo.atIndex(i);
      if (!Number.isFinite(z)) { counts.missingGeometry++; continue; }
      if (!contains(z)) { counts.outside++; continue; }
      const sw = swValues?.(i);
      if (sw === undefined || !(sw >= 0 && sw <= 1)) { counts.missingSw++; continue; }
      const h = heightAboveFwl(z, fwl)!;
      preview.points.push({ sw, h, md: md[i]!, zoneId, rockType });
      counts.points++;
      const predicted = rockType === null ? null : evaluators.get(rockType)?.(h);
      if (predicted != null) { counts.compared++; counts.absoluteError += Math.abs(sw - predicted); }
    }
  }
  preview.support = [...support.values()];
  preview.admissible = !demo && preview.points.length > 0 && (!scenario.mdt || delta !== null) &&
    scenario.classes.every(c => preview.lines.some(l => l.rockType === c.rockType));
  return preview;
}

export function heightDecisionKey(entry: WellEntry) {
  const i = entry.interpretation;
  return canonicalJson([engineDecisionKey(i), i.preparation ?? null, i.trends, i.pointSets]);
}

export function applyHeightScenario(project: Project, entry: WellEntry, result: ClientResult, scenario: HeightScenario, filters: { zone: string; rock: string }): Project {
  const current = getWellEntry(project, entry.well.id);
  if (current !== entry || activeWellEntry(project) !== entry || !sameContext(result.context, entryContext(entry, project))) {
    throw new Error('El pozo, sus entradas o su interpretación cambiaron. Volvé a revisar el escenario.');
  }
  const prior = entry.interpretation.moduleState?.[SATURATION_HEIGHT_ID];
  if (prior && typeof prior === 'object' && 'version' in prior && prior.version !== 1) throw new Error('El recibo existente tiene una versión no admitida.');
  const preview = heightPreview(entry, result, readHeightScenario(scenario));
  if (!preview.admissible) {
    throw new Error('El escenario carece de puntos válidos o hay modelos de clase pendientes de revisión.');
  }
  const fixed = enableProjectInputRevisions(project);
  const evidence = {
    version: 1, interpretation: 'exploratory', scenario, filters, sources: preview.sources, engineSources: { sw: result.sources.SW ?? null, rock: result.sources.ROCK_TYPE ?? null }, decisionKey: heightDecisionKey(entry),
    fwlM: preview.fwlM, pair: preview.pair, tests: preview.tests, externalResidualPa: preview.residualPa,
    support: preview.support, issues: preview.issues, inputRevisionId: getWellEntry(fixed, entry.well.id).inputRevisionId,
  };
  if (!isJsonValue(evidence)) throw new Error('La evidencia contiene valores no serializables.');
  const applied = updateInterpretation(fixed, entry.well.id, value => ({
    ...value, moduleState: { ...value.moduleState, [SATURATION_HEIGHT_ID]: evidence },
  }));
  return createSnapshot(applied, entry.well.id, 'Saturación por altura · escenario revisado').project;
}
