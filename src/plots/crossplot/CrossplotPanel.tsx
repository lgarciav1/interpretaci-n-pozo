/**
 * Panel «Crossplot» (docs/decisiones/0014, D6–D7): cualquier curva contra cualquier otra en dos clics, escala log
 * automática según el rol, color por una tercera curva (barra de color) o por zona (leyenda), filtro por zonas,
 * cutoffs arrastrables en X e Y (reales para VSH/PHIE/SW, libres para el resto), tendencias sobre los puntos visibles
 * (proveedor `crossplot`, ecuación y R²) y plantillas (densidad–neutrón, Pickett, φ–Sw, GR–Rt) con líneas guía
 * calculadas con los parámetros del proyecto. Fase 7b (0015): el punto de matriz del densidad–neutrón, la recta de agua
 * del Pickett y las líneas de GR de la plantilla GR–Rt se arrastran y escriben sus parámetros (recálculo en vivo).
 *
 * Conectado con el visor: pasar sobre un punto marca su profundidad; el cursor del visor resalta el punto de esa
 * profundidad; la selección por rectángulo se ve como tramos; clic en un punto lo muestra en el visor.
 *
 * Presentación: no conoce los stores. Lo conecta `src/modules/crossplot/dock.tsx`.
 */
import { Fragment, memo, useEffect, useMemo, useState } from 'react';
import type { SourceRef } from '../../core/interpretation';
import type { CrossplotConfig, CrossplotTemplateId } from '../../core/plots';
import type { HiddenCurve } from '../../core/toolString';
import type { ParamState } from '../../core/params';
import type { TrendSpec } from '../../core/trends';
import type { TrendModel } from '../../petro/regression';
import { arpsResistivityC } from '../../petro/temperature';
import { registry } from '../../modules';
import rwManual from '../../modules/rw-manual';
import { SHARED_PARAMS } from '../../modules/sharedParams';
import { Badge, Button, Chip, EmptyState, IconButton, Menu, SEQUENTIAL_PALETTE, SegmentedControl, curveStyle, ensureContrast, fillColor, formatNumber, rampColor, toast, useThemeTokens, withAlpha, type MenuEntry } from '../../ui';
import type { ThemeTokens } from '../../ui/tokens';
import type { Zone } from '../../core/well';
import { ControlGroup, CurveSelect, DriverCallout, HiddenCurveNote, HiddenCurveState, ScaleControl, SelectionSummary, ZoneFilterChips } from '../controls';
import { CUTOFF_PASSES, cutoffParamFor, cutoffScope, guideStep, normalizeCutoff, resolveCutoffLine, type CutoffLine, type CutoffParamKey } from '../cutoffs';
import { effectiveScale, engineInputData, hiddenCurveOfKey, keyForRole, plotCurveOptions, resolvePlotCurve, zoneFilter, type PlotCurve, type ZoneFilter } from '../data';
import { clayEndpointWrite, clayEstimateWrites, formatParam, grGuides, grWrite, inactiveDriver, normalizeParam, nudgeParam, paramChangeLabel, paramOfGuide, paramWrite, plotParamValue, plotScope, PLOT_PARAMS, RW_CORRECT_STORAGE, storedParamValue, type ParamWrite, type PlotScope } from '../params';
import { clearPlotSelection, getPlotLink, makeSelection, setPlotLink, setPlotSelection } from '../link';
import { cloudMask, maskFromCloud, pointsInShape, unionMask, type DataPolygon, type SelectionShape } from '../selection';
import { usePlotSelection } from '../useLink';
import { depthPointKey } from '../trend/series';
import { evaluateTrend } from '../trend/compute';
import { formatR2, MODEL_LABEL, trendEquation } from '../trend/format';
import { trendColor } from '../trend/overlay';
import type { SeriesContext } from '../trend/series';
import { niceRange, type DataRect, type XYAxis } from '../xy/axes';
import type { XYColorKey } from '../xy/figure';
import { XYPlot, type GuidePhase, type XYGuide, type XYHandle, type XYLineLayer, type XYPointLayer, type XYPolygonLayer, type XYTrendLayer } from '../xy/XYPlot';
import { cutoffSplit } from '../histogram/histogram';
import { COLOR_LEVELS, colorLevel, gather, medianAt, plottableIndices, robustRange } from './crossplot';
import { CROSSPLOT_PROVIDER_ID, crossplotSeries, crossplotSeriesKey, parseCrossplotSeriesKey } from './series';
import { fitWaterLine, WATER_FIT_DEFAULTS, ownPickettParams, parseWaterHandle, waterLineDragWrites, waterLineNudgeWrites, ownValuesNotice, pickettByZone, zonesWithOwnPickett, type WaterFit } from './pickett';
import { matrixParamsOf, matrixPointOf, projectMatrixLine, representativeTemperature, rwAtFormation, snapMatrixToLithology, waterLineHandles, waterLineRt } from './drag';
import { crossplotTemplatePatch } from './applyTemplate';
import { thomasStieberLayers } from './templates';
import { BVW_LINES, CROSSPLOT_TEMPLATE_DEFS, DN_LITHOLOGIES, PICKETT_SW, TEMPLATE_GROUPS, bvwLine, densityNeutronLine, isLithologyTemplate, lithologyTemplateLayers, nmrDnLines, pickettLine, mineralogyTemplateLayers, mineralogyFullRange, templateDef, type ArchieParams, type MatrixColors } from './templates';
import { UMAA_CHART_RANGE } from '../../petro/lithologyIndices';
import { clayDistributionSummary, countClayDistribution, estimateClayEndpoints, type EndpointEstimate } from '../../petro/clayDistribution';
import '../plots.css';

export interface CrossplotPanelProps {
  ctx: SeriesContext;
  config: CrossplotConfig;
  onChange(patch: Partial<CrossplotConfig>, label: string): void;
  onParamCutoff(key: CutoffParamKey, zoneId: string | null, value: number, phase: GuidePhase): void;
  /** Parámetros elegidos sobre el gráfico (punto de matriz, recta de agua, GR): las escrituras de un movimiento. */
  onParams(label: string, writes: readonly ParamWrite[], phase: GuidePhase): void;
  /** Fuentes activas del motor (avisa si el módulo de un parámetro no alimenta la cadena); null sin resultado. */
  sources: Readonly<Record<string, SourceRef>> | null;
  /** Usar un módulo como fuente de un puerto («Usar Rw manual»). */
  onUseModule(port: string, moduleId: string, label: string): void;
  /** Profundidad bajo el cursor del visor (resalta el punto). */
  cursorDepth: number | null;
  /** Mostrar una profundidad en el visor (clic en un punto). */
  onShowDepth(depth: number): void;
  onAddTrend(spec: Omit<TrendSpec, 'id' | 'name'> & { name: string }): void;
  onRemoveTrend(id: string): void;
  /** Sacar del ajuste de una tendencia los puntos con esas claves (o volver a incluir todos con `keys = null`). */
  onExcludeFromTrend(id: string, keys: readonly string[] | null): void;
  /** Vuelve a mostrar la herramienta de una curva oculta por la sarta (atajo del estado vacío). */
  onShowTool?(hidden: HiddenCurve): void;
}

/** Herramienta de selección elegida (estado de interfaz de la sesión: sobrevive a cerrar y abrir la pestaña). */
let lastSelectTool: 'rect' | 'lasso' = 'rect';
const SELECT_TOOLS = [
  { value: 'rect' as const, label: 'Rectángulo', title: 'Arrastrá un rectángulo para seleccionar (Mayús suma)' },
  { value: 'lasso' as const, label: 'Lazo', title: 'Dibujá un lazo a mano alzada alrededor de los puntos (Mayús suma)' },
];

const fmt = (v: number) => formatNumber(v, { significant: 3 });
const pct = (v: number) => `${formatNumber(v, { digits: 0 })} %`;
const MODELS: TrendModel[] = ['linear', 'log', 'exp', 'power'];

function axisFor(curve: PlotCurve, scale: 'linear' | 'log', values: Float64Array, fixed: [number, number] | undefined, reversed: boolean): XYAxis {
  const base = { kind: scale, label: curve.short, ...(curve.unitText ? { unit: curve.unitText } : {}), ...(reversed ? { reversed: true } : {}) };
  if (fixed && (scale !== 'log' || fixed[0] > 0)) return { ...base, min: fixed[0], max: fixed[1] };
  const r = robustRange(values, scale === 'log');
  const nice = r ? niceRange([[r.min, r.max]], scale, { pad: 0.06 }) : null;
  // Una curva sin negativos (porosidad, Vsh) no muestra un eje que empieza en negativo.
  const min = nice && scale === 'linear' && r!.min >= 0 && nice.min < 0 ? 0 : nice?.min;
  return { ...base, min: min ?? (scale === 'log' ? 0.1 : 0), max: nice?.max ?? (scale === 'log' ? 1000 : 1) };
}

/** Aviso de un módulo que no alimenta la cadena, con su acción («Usar Rw manual»). */
interface DriverWarning {
  id: string;
  title: string;
  text: string;
  action: string;
  port: string;
  moduleId: string;
}

/** Valor leído para el panel aparte. */
interface Readout {
  label: string;
  value: string;
  color?: string;
  /** Símbolo de la manija que lo mueve (rombo = matriz, círculo = recta de agua). */
  point?: 'diamond' | 'circle';
}

/** Estado del gráfico de Pickett que hace falta para convertir un arrastre en parámetros. */
interface PickettState extends ArchieParams {
  /** Rw sale de `rw-manual` (si no, la recta usa la mediana de la curva RW activa y no se traslada). */
  manual: boolean;
  rwRef: number;
  tRef: number;
  /** Temperatura representativa de la recta (°C; mediana de TEMP de sus puntos). */
  tRep: number;
  correct: boolean;
}

/**
 * Una recta de agua del Pickett: la del alcance (global o una zona) o, con varias zonas filtradas que tienen valores
 * propios, la de cada zona (fase 8b, 0021). `key` = '' (una sola) o el id de la zona; va en el id de sus manijas.
 */
interface PickettUnit extends PickettState {
  rwSource: string;
  key: string;
  scope: PlotScope;
  color: string;
  /** Nombre de la zona (recta por zona). */
  zoneName?: string;
}

/** Zona acuífera elegida en el Pickett: sus puntos, el ajuste y la temperatura a la que se leyó. */
interface WaterZoneState {
  zones: { id: string; name: string; color: string }[];
  /** Puntos de la nube (posiciones k) de las zonas acuíferas que entran en el ajuste (limpios, si hay Vsh). */
  points: Int32Array;
  /** Limpieza: puntos de las zonas acuíferas, cuántos limpios (Vsh ≤ cutoff) y el cutoff; null sin curva de Vsh. */
  clean: { total: number; clean: number; cutoff: number; used: boolean } | null;
  fit: WaterFit | { problem: string } | null;
  /** Temperatura de la zona acuífera (mediana de TEMP de sus puntos), °C. */
  tWater: number;
  /** Escrituras que aplicaría «Ajustar recta a la zona acuífera» (vacío si no hay nada que cambiar). */
  writes: ParamWrite[];
  /** Por qué no se escribe Rw (fuente activa que no es la manual). */
  rwBlocked: boolean;
  /** La Rw (de referencia) o la m ajustadas caen fuera del rango del parámetro: se escribiría el extremo. */
  clamped: string | null;
  /** Valores que realmente se escribirían (redondeados al paso del parámetro); undefined si no se escribe ese. */
  written: { rwRef?: number; rwRefRaw?: number; m?: number };
  /** Rw de formación del ajuste (a la temperatura de la zona acuífera) y temperatura de referencia de Rw. */
  rwFormation: number;
  tRef: number;
}

interface TemplateDrawing {
  lines: XYLineLayer[];
  polygons: XYPolygonLayer[];
  guides: XYGuide[];
  points: XYPointLayer[];
  handles: XYHandle[];
  info: string | null;
  readouts: Readout[];
  warnings: DriverWarning[];
  dn: { rhoMa: number; matrixOffset: number; rhoFl: number } | null;
  /** Rectas de agua del Pickett (una, o una por zona). */
  pickett: PickettUnit[];
  water: WaterZoneState | null;
  /** Con alcance global y zonas con valores propios: ofrecer una recta por zona (ids de las zonas visibles). */
  byZoneOffer: string[] | null;
  /** Thomas–Stieber (0061): extremos vigentes, resumen de la nube y la propuesta de «Estimar de los datos». */
  clay: ClayState | null;
}

interface ClayState {
  phiSand: number;
  phiShale: number;
  /** «62 % bajo la diagonal: predomina arcilla dispersa», o null sin muestras clasificadas. */
  summary: string | null;
  estimate: EndpointEstimate;
  /** Escrituras de la propuesta (vacío si no hay propuesta o ya es la vigente). */
  writes: ParamWrite[];
}

interface TemplateContext {
  ctx: SeriesContext;
  scope: PlotScope;
  idx: Int32Array;
  /** Rt y φ de la nube (posición k), para la zona acuífera. */
  cloudX: Float64Array;
  cloudY: Float64Array;
  filter: ZoneFilter;
  waterZones: readonly string[];
  theme: ThemeTokens;
  sources: Readonly<Record<string, SourceRef>> | null;
  cx: PlotCurve;
  cy: PlotCurve;
  xAxis: XYAxis;
  yAxis: XYAxis;
  /** Posición de una manija durante su arrastre (sigue al puntero en vez de saltar al medio del tramo visible). */
  dragging: { id: string; x: number; y: number } | null;
}

const signed = (s: string, v: number) => (v > 0 ? `+${s}` : s);
const registryName = (moduleId: string) => registry.get(moduleId)?.name ?? moduleId;

/**
 * Parámetros de Archie de una recta de agua: a, m, n del alcance. Rw de la recta = Rw de formación: con `rw-manual`
 * como fuente, la Rw de referencia del alcance llevada con Arps (la fórmula del motor) a la mediana de la temperatura de
 * `tempIdx` (los puntos de esa recta; con zona acuífera, los de la zona acuífera); con otra fuente, la mediana de la
 * curva RW activa en esos puntos (0014, D7).
 */
function pickettState(t: TemplateContext, zoneId: string | null, tempIdx: ArrayLike<number>): PickettState & { rwSource: string } {
  const params: ParamState = t.ctx.interpretation.params;
  const z = zoneId;
  const base = { a: plotParamValue(params, PLOT_PARAMS.a, z), m: plotParamValue(params, PLOT_PARAMS.m, z), n: plotParamValue(params, PLOT_PARAMS.n, z) };
  const rwRef = plotParamValue(params, PLOT_PARAMS.rwRef, z);
  const tRef = plotParamValue(params, PLOT_PARAMS.tRef, z);
  const correct = storedParamValue(params, RW_CORRECT_STORAGE, rwManual.params.correct, z) as boolean;
  const manual = !inactiveDriver(t.sources, 'RW', 'rw-manual');
  const temp = engineInputData(t.ctx, t.sources, 'TEMP');
  const tRep = temp ? representativeTemperature(temp, tempIdx) : NaN;
  if (manual && (!correct || Number.isFinite(tRep))) {
    return { ...base, rw: rwAtFormation(rwRef, tRef, tRep, correct), manual: true, rwRef, tRef, tRep, correct, rwSource: correct ? 'Rw conocida llevada a la temperatura de sus puntos' : 'Rw conocida, sin corrección por temperatura' };
  }
  const rwCurve = t.ctx.computed.find((c) => c.active && c.port === 'RW');
  let rw = rwCurve ? medianAt(rwCurve.data, tempIdx) : NaN;
  let rwSource = 'mediana de la curva RW en sus puntos';
  if (!(rw > 0)) {
    rw = rwRef;
    rwSource = 'Rw conocida del módulo «Rw conocida»';
  }
  return { ...base, rw, manual: false, rwRef, tRef, tRep, correct, rwSource };
}

/** Puntos de la nube (posiciones k) y muestras de las zonas dadas. */
function zonePoints(t: TemplateContext, ids: readonly string[]): { k: Int32Array; samples: Int32Array } {
  const zi = t.filter.zoneIndex;
  const allowed = new Set(ids.map((id) => t.filter.zones.findIndex((z) => z.id === id)).filter((j) => j >= 0));
  const k: number[] = [];
  for (let q = 0; q < t.idx.length; q++) if (allowed.has(zi[t.idx[q]!]!)) k.push(q);
  const kk = Int32Array.from(k);
  return { k: kk, samples: Int32Array.from(k, (q) => t.idx[q]!) };
}

/** Zona acuífera: puntos, ajuste de la recta y lo que escribiría (con el alcance de la recta del gráfico). */
function waterZoneState(t: TemplateContext, scope: PlotScope): WaterZoneState | null {
  const zones = t.filter.shown.filter((z) => t.waterZones.includes(z.id));
  if (zones.length === 0) return null;
  const all = zonePoints(
    t,
    zones.map((z) => z.id),
  );
  const params = t.ctx.interpretation.params;
  const base0 = pickettState(t, scope.zoneId, all.samples.length ? all.samples : t.idx);
  // Pickett es para formaciones limpias (Archie): el ajuste usa los puntos con Vsh ≤ el cutoff de Vsh del alcance. La
  // arcilla baja Rt sin que baje φ efectiva y aplana la recta. Si quedan menos de 5 limpios, se usan todos (y se avisa).
  const vsh = engineInputData(t.ctx, t.sources, 'VSH');
  const cutoff = storedParamValue(params, 'vshCutoff', SHARED_PARAMS.vshCutoff, scope.zoneId) as number;
  let k = all.k;
  let clean: WaterZoneState['clean'] = null;
  if (vsh) {
    const ck = Int32Array.from([...all.k].filter((q) => vsh[t.idx[q]!]! <= cutoff));
    clean = { total: all.k.length, clean: ck.length, cutoff, used: ck.length >= 5 };
    if (clean.used) k = ck;
  }
  // Temperatura de los MISMOS puntos que fijan Rw (vista previa y escritura coinciden).
  const base = k.length ? pickettState(t, scope.zoneId, Int32Array.from(k, (q) => t.idx[q]!)) : base0;
  // Cada Rt se lleva a la temperatura de referencia con Arps (como el motor, muestra a muestra): el ajuste da la Rw de
  // referencia y la mediana de Sw del motor queda en 1.
  const temp = engineInputData(t.ctx, t.sources, 'TEMP');
  let lnRwFactor: Float64Array | undefined;
  if (base.manual && base.correct && temp) {
    lnRwFactor = new Float64Array(t.idx.length).fill(NaN);
    for (const q of k) lnRwFactor[q] = Math.log(arpsResistivityC(1, base.tRef, temp[t.idx[q]!]!));
  }
  const depth = t.ctx.well.depth.values;
  const sampleStep = depth.length > 1 ? (depth[depth.length - 1]! - depth[0]!) / (depth.length - 1) : undefined;
  const fit = k.length
    ? fitWaterLine(t.cloudX, t.cloudY, k, {
        a: base.a,
        mCurrent: base.m,
        mRange: [PLOT_PARAMS.m.spec.min, PLOT_PARAMS.m.spec.max],
        sample: t.idx,
        ...(sampleStep ? { sampleStep } : {}),
        ...(lnRwFactor ? { lnRwFactor } : {}),
        normalizeM: (v) => normalizeParam(PLOT_PARAMS.m.spec, v),
      })
    : { problem: 'Las zonas acuíferas no tienen puntos en este gráfico.' };
  const rwFormation = fit && !('problem' in fit) ? (lnRwFactor ? rwAtFormation(fit.rw, base.tRef, base.tRep, true) : fit.rw) : NaN;
  const writes: ParamWrite[] = [];
  const written: WaterZoneState['written'] = {};
  const rwBlocked = !base.manual;
  let clamped: string | null = null;
  if (fit && !('problem' in fit)) {
    if (fit.mode === 'm-rw') {
      const m = normalizeParam(PLOT_PARAMS.m.spec, fit.m);
      written.m = m;
      if (Math.abs(m - plotParamValue(params, PLOT_PARAMS.m, scope.zoneId)) > 1e-9) writes.push(paramWrite(PLOT_PARAMS.m, m, scope));
    }
    if (!rwBlocked && (Number.isFinite(base.tRep) || !base.correct)) {
      // Con el factor de Arps por punto, fit.rw ya es la Rw de referencia; sin corrección por temperatura es igual.
      const raw = fit.rw;
      const spec = PLOT_PARAMS.rwRef.spec;
      if (raw < spec.min || raw > spec.max) clamped = `la Rw ajustada (${fmt(raw)} ohm·m a ${fmt(base.tRef)} °C) cae fuera del rango del parámetro (${fmt(spec.min)}–${fmt(spec.max)}): se usaría el extremo. Revisá que la zona sea acuífera y la temperatura.`;
      const rwRef = normalizeParam(spec, raw);
      written.rwRef = rwRef;
      written.rwRefRaw = raw;
      if (Math.abs(rwRef - base.rwRef) > 1e-12) writes.push(paramWrite(PLOT_PARAMS.rwRef, rwRef, scope));
    }
  }
  return { zones: zones.map((z) => ({ id: z.id, name: z.name, color: z.color })), points: k, clean, fit, tWater: base.tRep, writes, rwBlocked, clamped, written, rwFormation, tRef: base.tRef };
}

/** Líneas y manijas del Pickett: una recta de agua (con su zona acuífera) o una por zona. */
function pickettDrawing(out: TemplateDrawing, t: TemplateContext, c: (hex: string) => string): void {
  const { ctx, theme, scope } = t;
  const params = ctx.interpretation.params;
  const pivot = t.cx.role === 'RT' && t.cy.role === 'PHIE' && t.xAxis.kind === 'log' && t.yAxis.kind === 'log';
  const byZone = pickettByZone(t.filter.selected, params);
  // Zonas con puntos en el gráfico (en orden de tope).
  const counts = new Map<number, number>();
  for (const s of t.idx) counts.set(t.filter.zoneIndex[s]!, (counts.get(t.filter.zoneIndex[s]!) ?? 0) + 1);
  const visible = t.filter.shown.filter((z) => counts.get(t.filter.zones.indexOf(z)));
  const water = byZone ? null : waterZoneState(t, scope);
  out.water = water;
  const units: PickettUnit[] = byZone
    ? visible.map((z) => {
        const { samples } = zonePoints(t, [z.id]);
        return { ...pickettState(t, z.id, samples), key: z.id, scope: { zoneId: z.id, text: `zona ${z.name}` }, color: c(z.color), zoneName: z.name };
      })
    : [{ ...pickettState(t, scope.zoneId, water && water.points.length ? Int32Array.from(water.points, (k) => t.idx[k]!) : t.idx), key: '', scope, color: c(theme.color.info) }];
  out.pickett = units;
  const fmtT = (v: number) => `${fmt(v)} °C`;

  // Puntos de la zona acuífera: anillos (no tapan el color por la tercera curva).
  if (water && water.points.length) {
    out.points.push({ id: 'pk-water', name: `Zona acuífera (${water.zones.map((z) => z.name).join(', ')})`, x: Array.from(water.points, (k) => t.cloudX[k]!), y: Array.from(water.points, (k) => t.cloudY[k]!), color: c(theme.color.info), dense: true, ring: true, radius: 3.6, alpha: 0.95 });
  }

  units.forEach((p, j) => {
    PICKETT_SW.forEach((sw, k) => {
      const l = pickettLine(sw, p, [0.005, 1]);
      if (!byZone) {
        out.lines.push({ id: `pk-${sw}`, name: `Sw ${pct(sw * 100)}`, x: l.rt, y: l.phi, color: k === 0 ? c(theme.color.info) : c(theme.color.textMuted), width: k === 0 ? 2 : 1.25, dash: k === 0 ? [] : [6, 4], label: `Sw ${pct(sw * 100)}`, labelAt: 'start' });
      } else {
        // Por zona: el color de la zona; las iso-Sw más finas y punteadas, sin rótulo (la leyenda las explica).
        out.lines.push(
          k === 0
            ? { id: `pk-${p.key}-${sw}`, name: `Sw 100 % · zona ${p.zoneName}`, x: l.rt, y: l.phi, color: p.color, width: 2, label: `Sw 100 % · ${p.zoneName}`, labelAt: 'start' }
            : { id: `pk-${p.key}-${sw}`, x: l.rt, y: l.phi, color: withAlpha(p.color, 0.7), width: 1, dash: [5, 4] },
        );
      }
    });
    if (!pivot) return;
    const water0 = out.lines.find((l) => l.id === (byZone ? `pk-${p.key}-1` : 'pk-1'))!;
    // Manijas repartidas a lo largo de cada recta para que las de zonas vecinas no se tapen.
    const spread = units.length > 1 ? j / (units.length - 1) : 0.5;
    const h = waterLineHandles(p, [t.xAxis.min, t.xAxis.max], [t.yAxis.min, t.yAxis.max], { translate: byZone ? 0.3 + 0.45 * spread : 0.5, rotate: byZone ? 0.06 + 0.1 * spread : 0.1 });
    const idMove = p.key ? `water-move:${p.key}` : 'water-move';
    const idRot = p.key ? `water-rotate:${p.key}` : 'water-rotate';
    const dm = t.dragging?.id === idMove ? t.dragging : null;
    const dr = t.dragging?.id === idRot ? t.dragging : null;
    const rwRefText = formatParam(PLOT_PARAMS.rwRef, p.rwRef);
    const rwFormText = `${fmt(p.rw)} ohm·m`;
    const tRefText = fmtT(p.tRef);
    // Con alcance global y zonas visibles con valor propio: se avisa en el rótulo (no cambian al arrastrar).
    const own = !byZone && !p.scope.zoneId ? { rw: ownValuesNotice(params, visible, ['Rw']), m: ownValuesNotice(params, visible, ['m']) } : { rw: '', m: '' };
    const move = dm && dm.y > 0 ? { rt: waterLineRt(dm.y, p), phi: dm.y } : h.translate;
    const formDetail = p.manual ? (p.correct ? `${rwFormText} a ${fmtT(p.tRep)} (formación)${p.tRep > ARPS_T_MAX_C ? ' · extrapolada: fuera de la carta' : ''}` : 'sin corrección por temperatura') : inactiveDriver(t.sources, 'RW', 'rw-manual') ? 'la Rw activa no es la manual' : 'sin temperatura de formación';
    out.handles.push({
      id: idMove,
      x: move.rt,
      y: move.phi,
      color: p.color,
      label: p.manual ? `Rw ${p.scope.text} · ${rwRefText} a ${tRefText}` : `Rw de formación${byZone ? ` ${p.scope.text}` : ''} · ${rwFormText}`,
      detail: [formDetail, own.rw].filter(Boolean).join(' · '),
      ariaLabel: `Recta de agua${byZone ? ` de la ${p.scope.text}` : ''}, trasladar: cambia Rw ${p.scope.text}. Flechas para mover, Mayús para pasos largos`,
      valueText: p.manual ? `Rw ${rwRefText} a ${tRefText}; ${rwFormText} a temperatura de formación` : `Rw de formación ${rwFormText}`,
      grabPath: { x: water0.x, y: water0.y },
      labelAt: { x: 'left', y: 'below' },
      ...(byZone ? { labelOnActive: true } : {}),
      ...(p.manual ? {} : { disabled: true }),
    });
    if (h.rotate) {
      const rot = dr && dr.y > 0 && dr.y < 1 ? { rt: waterLineRt(dr.y, p), phi: dr.y } : h.rotate;
      const mText = formatParam(PLOT_PARAMS.m, p.m);
      out.handles.push({
        id: idRot,
        x: rot.rt,
        y: rot.phi,
        color: p.color,
        shape: 'square',
        cursor: 'crosshair',
        labelAt: { x: 'left', y: 'below' },
        label: `m ${p.scope.text} · ${mText}`,
        detail: ['gira alrededor de φ = 1', own.m].filter(Boolean).join(' · '),
        ariaLabel: `Recta de agua${byZone ? ` de la ${p.scope.text}` : ''}, rotar: cambia el exponente de cementación m ${p.scope.text}. Flechas para mover, Mayús para pasos largos`,
        valueText: `m ${mText}`,
        ...(byZone ? { labelOnActive: true } : {}),
      });
    }
  });

  const p0 = units[0];
  if (pivot && inactiveDriver(t.sources, 'RW', 'rw-manual') && p0) {
    const active = t.sources?.['RW'];
    const from = active?.kind === 'module' ? `«${registryName(active.moduleId)}»` : active?.kind === 'curve' ? `la curva medida ${active.curveId}` : 'otra fuente';
    out.warnings.push({ id: 'rw', title: `La Rw activa sale de ${from}`, text: `Trasladar la recta de agua no cambiaría Sw. Rotarla sí cambia m. Con Rw manual, la recta parte de Rw ${formatParam(PLOT_PARAMS.rwRef, p0.rwRef)} a ${fmtT(p0.tRef)}.`, action: 'Usar Rw manual', port: 'RW', moduleId: 'rw-manual' });
  }

  // Vista previa del ajuste a la zona acuífera: la recta que quedaría (rayada), si cambia algo.
  if (water && water.fit && !('problem' in water.fit) && water.writes.length && p0) {
    const after = { ...p0 };
    for (const w of water.writes) {
      if (w.storage === PLOT_PARAMS.m.storage) after.m = w.value;
      if (w.storage === PLOT_PARAMS.rwRef.storage) after.rw = rwAtFormation(w.value, p0.tRef, p0.tRep, p0.correct);
    }
    const l = pickettLine(1, after, [0.005, 1]);
    out.lines.push({ id: 'pk-fit', name: 'Ajuste a la zona acuífera', x: l.rt, y: l.phi, color: c(theme.color.accent), width: 2, dash: [3, 3], label: 'Ajuste zona acuífera', labelAt: 'end', preview: true });
  }

  if (byZone) {
    for (const p of units) {
      out.readouts.push({ label: `Zona ${p.zoneName}`, value: `${p.manual ? `Rw ${formatParam(PLOT_PARAMS.rwRef, p.rwRef)}` : `Rw ${fmt(p.rw)} ohm·m`} · m ${formatParam(PLOT_PARAMS.m, p.m)}${ownPickettParams(params, p.key).length ? '' : ' (global)'}`, color: p.color, point: 'circle' });
    }
    out.info = pivot
      ? 'Una recta de agua por zona (color de la zona; Sw 50, 30 y 20 % punteadas): cada una usa los parámetros de su zona y arrastrarla escribe solo los de esa zona. Rótulos al pasar sobre las manijas.'
      : 'Una recta de agua por zona con los parámetros de cada una.';
    return;
  }
  const p = p0!;
  const rwRefText = formatParam(PLOT_PARAMS.rwRef, p.rwRef);
  const tRefText = fmtT(p.tRef);
  out.readouts.push(
    ...(p.manual ? [{ label: `Rw a ${tRefText}`, value: rwRefText, color: c(theme.color.info), point: 'circle' as const }] : []),
    { label: p.manual && p.correct ? `Rw a ${fmtT(p.tRep)}` : 'Rw de formación', value: `${fmt(p.rw)} ohm·m` },
    { label: 'm', value: formatParam(PLOT_PARAMS.m, p.m) },
    { label: 'a · n', value: `${fmt(p.a)} · ${fmt(p.n)}` },
  );
  const tempNote = water && water.points.length ? 'la recta se lee a la temperatura de la zona acuífera' : 'la recta se lee a la temperatura mediana de los puntos visibles';
  out.info = pivot
    ? p.manual
      ? `Arrastrá la recta de agua (Sw 100 %) para elegir Rw y su manija cuadrada para rotarla y elegir m; las líneas de Sw se recalculan. Rw de la recta: ${p.rwSource}; ${tempNote}.`
      : `La manija cuadrada rota la recta de agua y elige m. Rw de la recta: ${p.rwSource}.`
    : `a ${fmt(p.a)} · m ${fmt(p.m)} · n ${fmt(p.n)} · Rw ${fmt(p.rw)} ohm·m (${p.rwSource}).`;
  // Alcance global con zonas que tienen valores propios: ofrecer una recta por zona.
  if (!scope.zoneId && visible.length >= 2 && zonesWithOwnPickett(params, visible.map((z) => z.id)).length) out.byZoneOffer = visible.map((z) => z.id);
}

/**
 * Thomas–Stieber (0061): regiones, rectas y banda laminar con los extremos del alcance; los dos extremos son manijas
 * que se arrastran en vertical (φ de la arena en Vsh = 0, φ de la lutita en Vsh = 1) y escriben los parámetros de
 * `clay-distribution`. Resumen de la nube y propuesta de «Estimar de los datos» con el motor puro.
 */
function thomasStieberDrawing(out: TemplateDrawing, t: TemplateContext, c: (hex: string) => string): void {
  const { ctx, theme, scope } = t;
  const params = ctx.interpretation.params;
  const phiSand = plotParamValue(params, PLOT_PARAMS.phiSand, scope.zoneId);
  const phiShale = plotParamValue(params, PLOT_PARAMS.phiShale, scope.zoneId);
  const tol = plotParamValue(params, PLOT_PARAMS.clayBand, scope.zoneId);
  const colors = { dispersed: c(theme.name === 'dark' ? '#3fd0a8' : '#0f8b6f'), structural: c(theme.name === 'dark' ? '#f0b43c' : '#a8670a'), laminated: c(theme.color.text), band: c(theme.color.textMuted) };
  const layers = thomasStieberLayers(phiSand, phiShale, tol, colors);
  out.polygons.push(...layers.polygons);
  out.lines.push(...layers.lines);
  const onAxes = t.cx.role === 'VSH' && t.cy.role === 'PHIT';
  const sandText = formatParam(PLOT_PARAMS.phiSand, phiSand);
  const shaleText = formatParam(PLOT_PARAMS.phiShale, phiShale);
  const accent = c(theme.color.accent);
  if (onAxes) {
    const dragSand = t.dragging?.id === 'ts-sand' ? t.dragging : null;
    const dragShale = t.dragging?.id === 'ts-shale' ? t.dragging : null;
    out.handles.push(
      {
        id: 'ts-sand',
        x: 0,
        y: dragSand ? dragSand.y : phiSand,
        color: accent,
        cursor: 'ns-resize',
        label: `φ arena ${scope.text} · ${sandText}`,
        detail: 'arena limpia · Vsh 0',
        ariaLabel: `Extremo de arena limpia ${scope.text}: cambia la porosidad de la arena limpia. Flechas arriba y abajo para mover, Mayús para pasos largos`,
        valueText: `porosidad de la arena limpia ${sandText}`,
        labelAt: { x: 'right', y: 'above' },
      },
      {
        id: 'ts-shale',
        x: 1,
        y: dragShale ? dragShale.y : phiShale,
        color: accent,
        cursor: 'ns-resize',
        label: `φ lutita ${scope.text} · ${shaleText}`,
        detail: 'lutita · Vsh 1',
        ariaLabel: `Extremo de lutita ${scope.text}: cambia la porosidad de la lutita. Flechas arriba y abajo para mover, Mayús para pasos largos`,
        valueText: `porosidad de la lutita ${shaleText}`,
        labelAt: { x: 'left', y: 'above' },
      },
    );
  }
  const counts = onAxes ? countClayDistribution(t.cloudX, t.cloudY, phiSand, phiShale, tol) : null;
  const summary = counts ? clayDistributionSummary(counts) : null;
  const estimate: EndpointEstimate = onAxes ? estimateClayEndpoints(t.cloudX, t.cloudY) : { phiSand: null, phiShale: null, nSand: 0, nShale: 0, problem: 'Los ejes no son VSH y PHIT.' };
  const writes = estimate.phiSand !== null && estimate.phiShale !== null && !estimate.problem ? clayEstimateWrites(estimate.phiSand, estimate.phiShale, params, scope) : [];
  out.clay = { phiSand, phiShale, summary: summary?.text ?? null, estimate, writes };
  out.readouts.push(
    { label: 'φ arena limpia', value: sandText, color: accent, point: 'circle' },
    { label: 'φ lutita', value: shaleText, color: accent, point: 'circle' },
    { label: 'Banda laminar', value: `± ${formatParam(PLOT_PARAMS.clayBand, tol)}` },
  );
  if (summary && counts) {
    out.readouts.push({ label: 'Laminar · dispersa · estructural', value: `${pct(summary.pct.laminated)} · ${pct(summary.pct.dispersed)} · ${pct(summary.pct.structural)}` });
    out.readouts.push({ label: 'Sin clasificar', value: `${formatNumber(counts.unclassified, { digits: 0 })} de ${formatNumber(counts.total, { digits: 0 })}` });
  }
  out.info = onAxes
    ? 'Arrastrá los extremos (arena limpia a la izquierda, lutita a la derecha) para elegir sus porosidades; las rectas, las regiones y el resumen se recalculan. Región A (debajo de la diagonal): arcilla dispersa; región B (encima): estructural; sobre la diagonal: laminar. Quedan sin clasificar la arena limpia (Vsh < 0,1), la lutita (Vsh > 0,9) y los puntos fuera del diagrama. Orientativo: confirmar con corona, imágenes o RMN.'
    : 'Rectas de Thomas–Stieber con los extremos del proyecto. Los extremos se arrastran con VSH en X y PHIT en Y.';
}

/** Líneas guía y manijas de la plantilla, con colores del tema (la matemática está en `templates.ts` y `drag.ts`). */
function templateDrawing(id: CrossplotTemplateId | null, t: TemplateContext): TemplateDrawing {
  const { ctx, theme, scope } = t;
  const out: TemplateDrawing = { lines: [], polygons: [], guides: [], points: [], handles: [], info: null, readouts: [], warnings: [], dn: null, pickett: [], water: null, byZoneOffer: null, clay: null };
  const bg = theme.viewer.trackBg;
  const c = (hex: string) => ensureContrast(hex, bg, 3);
  const params = ctx.interpretation.params;
  if (id === 'density-neutron') {
    const fills = { sandstone: 'sand', limestone: 'limestone', dolomite: 'dolomite' } as const;
    for (const lith of DN_LITHOLOGIES) {
      const l = densityNeutronLine(lith);
      const color = c(fillColor(fills[lith.id], theme.name).color);
      out.lines.push({ id: `dn-${lith.id}`, name: lith.label, x: l.nphi, y: l.rhob, color, width: 1.5, label: lith.label, labelAt: 'start' });
      // Marcas cada 0,1 de porosidad (la de 0 es el punto de matriz).
      const ticks = l.phi.map((p, k) => (Math.abs(p * 10 - Math.round(p * 10)) < 1e-6 ? k : -1)).filter((k) => k >= 0);
      out.points.push({ id: `dn-ticks-${lith.id}`, x: ticks.map((k) => l.nphi[k]!), y: ticks.map((k) => l.rhob[k]!), color, radius: 2.6 });
    }
    out.info = 'Rectas de mezcla matriz–agua dulce (neutrón en unidades de caliza), marcas cada 0,1 de porosidad.';
    if (t.cx.role === 'NPHI' && t.cy.role === 'RHOB') {
      // Punto de matriz del proyecto (ρma de phi-density; corrección del neutrón de phi-neutron) y su línea.
      const rhoMa = plotParamValue(params, PLOT_PARAMS.rhoMa, scope.zoneId);
      const matrixOffset = plotParamValue(params, PLOT_PARAMS.matrixOffset, scope.zoneId);
      const rhoFl = plotParamValue(params, PLOT_PARAMS.rhoFl, scope.zoneId);
      out.dn = { rhoMa, matrixOffset, rhoFl };
      const pt = matrixPointOf(rhoMa, matrixOffset);
      const color = c(theme.color.accent);
      const line = projectMatrixLine(rhoMa, matrixOffset, rhoFl);
      out.lines.push({ id: 'dn-project', name: 'Matriz del proyecto', x: line.nphi, y: line.rhob, color, width: 2.25, label: 'Matriz del proyecto', labelAt: 'end' });
      const ticks = line.phi.map((p, k) => (k > 0 && Math.abs(p * 10 - Math.round(p * 10)) < 1e-6 ? k : -1)).filter((k) => k >= 0);
      out.points.push({ id: 'dn-project-ticks', x: ticks.map((k) => line.nphi[k]!), y: ticks.map((k) => line.rhob[k]!), color, radius: 3 });
      const idleD = inactiveDriver(t.sources, 'PHID', 'phi-density');
      const idleN = inactiveDriver(t.sources, 'PHIN', 'phi-neutron');
      if (idleD) out.warnings.push({ id: 'phid', title: 'La porosidad por densidad no sale de ρma', text: 'Mover la matriz en vertical no cambiaría PHIE.', action: 'Usar porosidad por densidad', port: 'PHID', moduleId: 'phi-density' });
      if (idleN) out.warnings.push({ id: 'phin', title: 'La porosidad neutrónica no usa esta corrección', text: 'Mover la matriz en horizontal no cambiaría PHIE.', action: 'Usar porosidad neutrónica', port: 'PHIN', moduleId: 'phi-neutron' });
      const lith = DN_LITHOLOGIES.find((l) => Math.abs(l.rhoMa - rhoMa) < 1e-9 && Math.abs(l.phiNMa - pt.nphi) < 1e-9);
      const rho = formatParam(PLOT_PARAMS.rhoMa, rhoMa);
      const nphiText = signed(formatParam(PLOT_PARAMS.matrixOffset, pt.nphi), pt.nphi);
      const corr = signed(formatParam(PLOT_PARAMS.matrixOffset, matrixOffset), matrixOffset);
      out.handles.push({
        id: 'matrix',
        x: pt.nphi,
        y: pt.rhob,
        color,
        shape: 'diamond',
        label: `Matriz ${scope.text} · ${rho}${lith ? ` · ${lith.label.toLowerCase()}` : ''}`,
        detail: `NPHI ${nphiText} · corrección ${corr}`,
        ariaLabel: `Punto de matriz ${scope.text}. Flechas arriba y abajo cambian la densidad de la matriz; izquierda y derecha, la lectura del neutrón en la matriz. Mayús para pasos largos`,
        valueText: `densidad de matriz ${rho}, neutrón en la matriz ${nphiText}`,
        grabPath: { x: line.nphi, y: line.rhob },
        // Debajo de la matriz (más densidad que la arenisca) no suele haber puntos.
        labelAt: { x: 'right', y: 'below' },
        ...(idleD && idleN ? { disabled: true } : {}),
      });
      out.readouts.push({ label: 'Densidad de la matriz', value: rho, color, point: 'diamond' }, { label: 'NPHI de la matriz', value: nphiText }, { label: 'Corrección del neutrón', value: corr });
      out.info = 'Rombo = punto de matriz del proyecto: arrastralo (o la línea que sale de él) para elegir ρma y la corrección del neutrón; se pega a arenisca, caliza y dolomía. Las rectas finas son de referencia.';
    }
  } else if (id === 'pickett') {
    pickettDrawing(out, t, c);
  } else if (id === 'phi-sw') {
    for (const bvw of BVW_LINES) {
      const l = bvwLine(bvw, 0.45);
      out.lines.push({ id: `bvw-${bvw}`, name: `BVW ${fmt(bvw)}`, x: l.phi, y: l.sw, color: c(theme.color.textMuted), width: 1.25, dash: [6, 4], label: `BVW ${fmt(bvw)}` });
    }
    out.info = 'Hipérbolas de volumen de agua constante (BVW = φ·Sw): los puntos de una zona a saturación irreducible se alinean sobre una.';
  } else if (id === 'gr-rt') {
    const draggable = t.cx.role === 'GR' && !inactiveDriver(t.sources, 'IGR', 'igr');
    out.guides.push(...grGuides(params, scope, { clean: c(fillColor('sand', theme.name).color), shale: c(fillColor('shale', theme.name).color) }, draggable));
    if (t.cx.role === 'GR' && inactiveDriver(t.sources, 'IGR', 'igr')) {
      out.warnings.push({ id: 'igr', title: 'El índice de arcilla no sale de este GR', text: 'Mover las líneas no cambiaría Vsh.', action: 'Usar índice de arcilla por GR', port: 'IGR', moduleId: 'igr' });
    }
    out.info = draggable ? 'GR de arena limpia y de arcilla del paso Arcilla: arrastralas para elegirlas (Vsh se recalcula en vivo).' : 'GR de arena limpia y de arcilla del paso Arcilla (de la zona si hay una sola filtrada).';
  } else if (id === 'th-k' || id === 'pe-density') {
    const layers = mineralogyTemplateLayers(id, c);
    out.polygons.push(...layers.polygons);
    out.lines.push(...layers.lines);
    out.points.push(...layers.points);
    out.info = layers.info;
  } else if (isLithologyTemplate(id)) {
    const lith = (f: 'sand' | 'limestone' | 'dolomite' | 'anhydrite' | 'salt') => c(fillColor(f, theme.name).color);
    const colors: MatrixColors = {
      quartz: lith('sand'), calcite: lith('limestone'), dolomite: lith('dolomite'), anhydrite: lith('anhydrite'), halite: lith('salt'),
      gypsum: c('#f9a8d4'), 'k-feldspar': c('#f472b6'), guide: c(theme.color.textMuted),
    };
    const layers = lithologyTemplateLayers(id, colors, c);
    out.polygons.push(...layers.polygons);
    out.lines.push(...layers.lines);
    out.points.push(...layers.points);
    out.info = layers.info;
    // Umaa fuera de la carta (típico con baritina en el lodo): decir cuántos puntos quedan afuera.
    if (id === 'rhomaa-umaa' && t.cx.role === 'UMAA') {
      let n = 0;
      let right = 0;
      for (const v of t.cx.data) {
        if (!Number.isFinite(v)) continue;
        n++;
        if (v > UMAA_CHART_RANGE.u[1]) right++;
      }
      if (n && right / n > 0.05) out.info = `El ${pct((100 * right) / n)} de las muestras tiene Umaa mayor que ${UMAA_CHART_RANGE.u[1]}, a la derecha de la calcita: PEF alto, típico de baritina en el lodo (no es la matriz). «Ver toda la nube» las muestra. ${layers.info}`;
    }
  } else if (id === 'thomas-stieber') {
    thomasStieberDrawing(out, t, c);
  } else if (id === 'nmr-dn') {
    const tol = plotParamValue(params, PLOT_PARAMS.nmrTolerance, scope.zoneId);
    const l = nmrDnLines(tol);
    const tolText = formatParam(PLOT_PARAMS.nmrTolerance, tol);
    out.lines.push(
      { id: 'nmr-1to1', name: 'Recta 1:1', x: l.oneToOne.x, y: l.oneToOne.y, color: c(theme.color.textMuted), width: 1.5, label: '1:1', labelAt: 'end' },
      { id: 'nmr-deficit', name: `Umbral de déficit (−${tolText})`, x: l.deficit.x, y: l.deficit.y, color: c(curveStyle('IND_NMR_DEFICIT', theme.name, ctx.catalog).color), width: 1.5, dash: [6, 4], label: `−${tolText}`, labelAt: 'end' },
    );
    out.readouts.push({ label: `Tolerancia ${scope.text}`, value: tolText });
    out.info = `La RMN no depende de la matriz: sin hidrocarburos livianos los puntos caen sobre la 1:1. Debajo de la recta punteada (RMN lee más de ${tolText} menos que densidad–neutrón) se marca el déficit de RMN: gas, crudo pesado o microporosidad. Sobre la 1:1, revisar la matriz.`;
  }
  return out;
}

export function CrossplotPanel(props: CrossplotPanelProps) {
  const { ctx, config, onChange } = props;
  const theme = useThemeTokens();
  const [preview, setPreview] = useState<{ id: string; value: number } | null>(null);
  const [selectTool, setSelectToolState] = useState<'rect' | 'lasso'>(lastSelectTool);
  const setSelectTool = (t: 'rect' | 'lasso') => {
    lastSelectTool = t;
    setSelectToolState(t);
  };
  const [dragging, setDragging] = useState<{ id: string; x: number; y: number } | null>(null);
  const options = useMemo(() => plotCurveOptions(ctx), [ctx]);
  // Motivo corto de cada plantilla que no se puede armar con este pozo (para el menú).
  const templateAvailability = useMemo(() => {
    const m = new Map<CrossplotTemplateId, string>();
    for (const t of CROSSPLOT_TEMPLATE_DEFS) {
      const r = crossplotTemplatePatch(ctx, t.id);
      if (!r.ok) m.set(t.id, r.reason);
    }
    return m;
  }, [ctx]);
  const depth = ctx.well.depth.values;
  const zones = ctx.interpretation.zones;

  // Curvas por defecto: densidad contra neutrón si hay; si no, las dos primeras.
  const xKey = config.x ?? keyForRole(ctx, 'NPHI') ?? options[0]?.value ?? null;
  const yKey = config.y ?? keyForRole(ctx, 'RHOB') ?? options[1]?.value ?? options[0]?.value ?? null;
  const cx = useMemo(() => resolvePlotCurve(ctx, xKey), [ctx, xKey]);
  const cy = useMemo(() => resolvePlotCurve(ctx, yKey), [ctx, yKey]);
  const colorKey = config.color.kind === 'curve' ? config.color.curve : null;
  const cc = useMemo(() => resolvePlotCurve(ctx, colorKey), [ctx, colorKey]);
  // Curvas elegidas que la sarta oculta (0032): se conserva la elección y se dice por qué no se ven.
  const hiddenX = cx ? null : hiddenCurveOfKey(ctx, xKey);
  const hiddenY = cy ? null : hiddenCurveOfKey(ctx, yKey);
  const hiddenColor = cc ? null : hiddenCurveOfKey(ctx, colorKey);
  const xScale = effectiveScale(config.xScale, cx);
  const yScale = effectiveScale(config.yScale, cy);
  const filter = useMemo(() => zoneFilter(depth, zones, config.zones), [depth, zones, config.zones]);
  const scope = cutoffScope(config.zones, zones);
  const pscope = plotScope(config.zones, zones);

  // Muestras graficables y su posición en la nube (para el cursor del visor).
  const cloud = useMemo(() => {
    if (!cx || !cy) return null;
    const idx = plottableIndices(cx.data, cy.data, filter.include, xScale === 'log', yScale === 'log');
    const pos = new Int32Array(depth.length).fill(-1);
    idx.forEach((s, k) => (pos[s] = k));
    return { idx, pos, x: gather(cx.data, idx), y: gather(cy.data, idx), d: gather(depth, idx) };
  }, [cx, cy, filter, xScale, yScale, depth]);

  // Al cerrarse el panel, el visor deja de marcar el punto bajo el puntero. La selección queda: es de todos los gráficos.
  useEffect(() => () => setPlotLink({ hoverDepth: null }), []);

  // Selección compartida (0021): máscara sobre las muestras; acá se resaltan sus puntos y se atenúa el resto. Sobrevive a
  // cambiar los ejes o el filtro (un lazo en el densidad–neutrón se ve en el Pickett).
  const selection = usePlotSelection(depth);
  const emphasis = useMemo(() => (selection && cloud ? { layerId: 'cloud', mask: cloudMask(selection.mask, cloud.idx) } : null), [selection, cloud]);
  const shownSel = useMemo(() => {
    if (!emphasis) return 0;
    let c = 0;
    for (let k = 0; k < emphasis.mask.length; k++) c += emphasis.mask[k]!;
    return c;
  }, [emphasis]);
  const selShapes = selection?.detail.kind === 'shapes' && cx && cy && selection.detail.x === cx.key && selection.detail.y === cy.key ? selection.detail.shapes : null;

  const xAxis = useMemo(() => (cx && cloud ? axisFor(cx, xScale, cloud.x, config.xRange, config.xReversed) : null), [cx, cloud, xScale, config.xRange, config.xReversed]);
  const yAxis = useMemo(() => (cy && cloud ? axisFor(cy, yScale, cloud.y, config.yRange, config.yReversed) : null), [cy, cloud, yScale, config.yRange, config.yReversed]);

  // Color de cada punto: rampa cuantizada (tercera curva), color de zona o uno solo.
  const coloring = useMemo(() => {
    if (!cloud) return null;
    const neutral = theme.color.textSubtle;
    if (config.color.kind === 'curve' && cc) {
      const vals = gather(cc.data, cloud.idx);
      const log = cc.scale === 'log';
      const r = robustRange(vals, log, 0.02, 0.98) ?? { min: 0, max: 1 };
      const stops = SEQUENTIAL_PALETTE[theme.name];
      const ramp = Array.from({ length: COLOR_LEVELS }, (_, k) => rampColor((k + 0.5) / COLOR_LEVELS, stops));
      const level = Int16Array.from(vals, (v) => colorLevel(v, r.min, r.max, log));
      const key: XYColorKey = { title: cc.short, min: r.min, max: r.max, colors: stops, ...(cc.unitText ? { unit: cc.unitText } : {}) };
      return { kind: 'curve' as const, color: (k: number) => (level[k]! < 0 ? neutral : ramp[level[k]!]!), key, curve: cc, vals, log, range: r, stops };
    }
    if (config.color.kind === 'zone') {
      const zc = filter.zones.map((z) => z.color);
      const zi = filter.zoneIndex;
      const counts = new Map<number, number>();
      for (const s of cloud.idx) counts.set(zi[s]!, (counts.get(zi[s]!) ?? 0) + 1);
      return { kind: 'zone' as const, color: (k: number) => zc[zi[cloud.idx[k]!]!] ?? neutral, counts };
    }
    const single = cy ? curveStyle(cy.role, theme.name, ctx.catalog).color : theme.color.accent;
    return { kind: 'none' as const, color: () => single };
  }, [cloud, config.color.kind, cc, filter, theme, cy, ctx.catalog]);

  const sources = props.sources;
  const tpl = useMemo(
    () => (cloud && cx && cy && xAxis && yAxis ? templateDrawing(config.template, { ctx, scope: pscope, idx: cloud.idx, cloudX: cloud.x, cloudY: cloud.y, filter, waterZones: config.pickettWaterZones ?? NO_ZONES, theme, sources, cx, cy, xAxis, yAxis, dragging }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config.template, ctx, pscope.zoneId, pscope.text, cloud, filter, config.pickettWaterZones, theme, sources, cx, cy, xAxis, yAxis, dragging],
  );

  // Cutoffs en X e Y.
  const params = ctx.interpretation.params;
  const lineX = cx ? resolveCutoffLine('x', cx, config.cutoffs, params, scope, preview) : null;
  const lineY = cy && cy.key !== cx?.key ? resolveCutoffLine('y', cy, config.cutoffs, params, scope, preview) : null;
  const cutLines = [lineX, lineY].filter((l): l is CutoffLine => !!l);

  const guides = useMemo<XYGuide[]>(() => {
    const out: XYGuide[] = [...(tpl?.guides ?? [])];
    for (const l of cutLines) {
      const vals = l.axis === 'x' ? cloud?.x : cloud?.y;
      const pass = l.param ? CUTOFF_PASSES[l.param] : null;
      // El valor justo en el corte va al lado que acepta el motor de cutoffs (φ ≥ mínimo; Vsh y Sw ≤ máximo).
      const split = vals ? cutoffSplit(vals, l.value, undefined, pass === 'above' ? 'above' : 'below') : null;
      const n = split?.n ?? 0;
      const below = split && n ? split.below : NaN;
      out.push({
        id: l.id,
        axis: l.axis,
        value: l.value,
        // Corte de k desactivado (0054): gris punteado; arrastrarlo lo activa.
        color: l.inactive ? theme.color.textSubtle : l.param ? theme.color.error : theme.color.accent,
        dash: l.param && !l.inactive ? [] : [6, 4],
        width: 1.75,
        draggable: true,
        ...guideStep(l.param),
        label: `${l.title} · ${fmt(l.value)}`,
        ...(l.inactive
          ? { detail: 'Arrastrá para activar el corte' }
          : n
            ? { detail: pass ? `Pasa ${pct(pass === 'below' ? below : 100 - below)}` : `${pct(below)} ≤ · ${pct(100 - below)} >` }
            : {}),
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tpl, cloud, theme, lineX?.id, lineX?.value, lineX?.title, lineX?.inactive, lineY?.id, lineY?.value, lineY?.title, lineY?.inactive]);

  const points = useMemo<XYPointLayer[]>(() => {
    if (!cloud || !coloring || !cx || !cy) return [];
    const zi = filter.zoneIndex;
    const zname = (k: number) => filter.zones[zi[cloud.idx[k]!]!]?.name;
    const u = (c: PlotCurve) => (c.unitText ? ` ${c.unitText}` : '');
    return [
      ...(tpl?.points ?? []),
      {
        id: 'cloud',
        name: `${cy.short} vs. ${cx.short}`,
        x: cloud.x,
        y: cloud.y,
        color: coloring.color,
        dense: true,
        interactive: true,
        radius: cloud.idx.length > 20000 ? 1.6 : 2.2,
        label: (k: number) =>
          [
            `${formatNumber(cloud.d[k]!, { digits: 2 })} m${zname(k) ? ` · zona ${zname(k)}` : ''}`,
            `${cx.short} ${fmt(cloud.x[k]!)}${u(cx)} · ${cy.short} ${fmt(cloud.y[k]!)}${u(cy)}`,
            coloring.kind === 'curve' ? `${coloring.curve.short} ${fmt(coloring.vals[k]!)}${u(coloring.curve)}` : null,
            'Clic: ver en el visor',
          ]
            .filter(Boolean)
            .join('\n'),
      },
    ];
  }, [cloud, coloring, cx, cy, filter, tpl]);

  // Tendencias sobre la nube de estos ejes (cualquier filtro de zonas con que se hayan creado).
  const trendRows = useMemo(() => {
    if (!cx || !cy) return [];
    return ctx.interpretation.trends
      .map((spec, index) => ({ spec, index }))
      .filter(({ spec }) => {
        if (spec.series.provider !== CROSSPLOT_PROVIDER_ID) return false;
        const k = parseCrossplotSeriesKey(spec.series.key);
        return !!k && k.x === cx.key && k.y === cy.key;
      })
      .map(({ spec, index }) => {
        const series = crossplotSeries(ctx, spec.series.key);
        const result = series ? evaluateTrend(spec, series, zones) : null;
        return { spec, index, series, result, color: trendColor(spec, index, theme) };
      });
  }, [ctx, cx, cy, zones, theme]);
  const trends = useMemo<XYTrendLayer[]>(
    () =>
      trendRows
        .filter((t) => t.spec.visible && t.result?.coeffs && t.result.span)
        .map((t) => ({ id: t.spec.id, name: t.spec.name, coeffs: t.result!.coeffs!, span: t.result!.span!, color: t.color, extend: t.spec.extend, emphasis: true, label: [trendEquation(t.result!, t.series), `R² ${formatR2(t.result!.r2)} · n ${t.result!.n}`] as const })),
    [trendRows],
  );

  const highlight = useMemo(() => {
    if (props.cursorDepth === null || !cloud) return null;
    // Muestra del cursor (bisección) → punto de la nube.
    let lo = 0;
    let hi = depth.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >>> 1;
      if (depth[mid]! <= props.cursorDepth) lo = mid;
      else hi = mid;
    }
    const s = Math.abs(depth[lo]! - props.cursorDepth) <= Math.abs(depth[hi]! - props.cursorDepth) ? lo : hi;
    const k = cloud.pos[s] ?? -1;
    return k >= 0 ? { layerId: 'cloud', index: k } : null;
  }, [props.cursorDepth, cloud, depth]);

  if (options.length < 2) return <EmptyState size="sm" icon="scatter" title="Faltan curvas" description={ctx.hidden?.size ? 'Hacen falta al menos dos curvas para un crossplot y la sarta oculta las demás: prendé herramientas en la sarta.' : 'Hacen falta al menos dos curvas para un crossplot.'} />;

  // ── acciones ─────────────────────────────────────────────────────────────────────────────────────────────────
  const setAxisCurve = (axis: 'x' | 'y', key: string) =>
    onChange(
      axis === 'x' ? { x: key, template: null, xScale: 'auto', xRange: undefined, xReversed: false } : { y: key, template: null, yScale: 'auto', yRange: undefined, yReversed: false },
      axis === 'x' ? 'Cambiar el eje X del crossplot' : 'Cambiar el eje Y del crossplot',
    );
  const swap = () =>
    onChange({ x: yKey, y: xKey, xScale: config.yScale, yScale: config.xScale, xReversed: config.yReversed, yReversed: config.xReversed, xRange: config.yRange, yRange: config.xRange, template: null }, 'Intercambiar los ejes del crossplot');
  const applyTemplate = (id: CrossplotTemplateId) => {
    const r = crossplotTemplatePatch(ctx, id);
    if (!r.ok) toast({ tone: 'warn', title: r.title, description: r.description });
    else onChange(r.patch, r.label);
  };
  const toggleCutoff = (c: PlotCurve | null) => {
    if (!c) return;
    if (config.cutoffs[c.key] !== undefined) {
      const { [c.key]: _gone, ...rest } = config.cutoffs;
      onChange({ cutoffs: rest }, 'Quitar cutoff del crossplot');
      return;
    }
    const param = cutoffParamFor(c.role);
    const vals = c === cx ? cloud?.x : cloud?.y;
    const med = vals && vals.length ? [...vals].sort((a, b) => a - b)[vals.length >> 1]! : NaN;
    onChange({ cutoffs: { ...config.cutoffs, [c.key]: param ? true : +med.toPrecision(3) } }, param ? 'Mostrar cutoff en el crossplot' : 'Agregar cutoff libre');
  };
  const onGuide = (id: string, value: number, phase: GuidePhase) => {
    const gp = paramOfGuide(id);
    if (gp === 'grClean' || gp === 'grShale') {
      const w = grWrite(gp, value, params, pscope);
      props.onParams(paramChangeLabel(PLOT_PARAMS[gp]), w ? [w] : [], phase);
      return;
    }
    const l = cutLines.find((q) => q.id === id);
    if (!l) return;
    if (l.param) {
      const v = normalizeCutoff(l.param, value);
      setPreview(phase === 'preview' ? { id, value: v } : null);
      props.onParamCutoff(l.param, l.zoneId, phase === 'cancel' ? value : v, phase);
      return;
    }
    if (phase === 'preview') setPreview({ id, value });
    else {
      setPreview(null);
      if (phase === 'commit') onChange({ cutoffs: { ...config.cutoffs, [l.curveKey]: value } }, 'Mover cutoff libre');
    }
  };
  // ── parámetros sobre el gráfico (fase 7b, 0015) ─────────────────────────────────────────────────────────────
  /** Escrituras del punto de matriz en (nphi, rhob), acotadas y redondeadas al paso de cada parámetro. */
  const matrixWrites = (nphi: number, rhob: number): ParamWrite[] => {
    const v = matrixParamsOf({ nphi, rhob });
    return [paramWrite(PLOT_PARAMS.rhoMa, normalizeParam(PLOT_PARAMS.rhoMa.spec, v.rhoMa), pscope), paramWrite(PLOT_PARAMS.matrixOffset, normalizeParam(PLOT_PARAMS.matrixOffset.spec, v.matrixOffset), pscope)];
  };
  /** Recta de agua de una manija (la única, o la de su zona con una recta por zona). */
  const waterUnit = (key: string) => tpl?.pickett.find((u) => u.key === key) ?? null;
  const MATRIX_LABEL = 'Mover el punto de matriz';
  const WATER_FIT_LABEL = 'Ajustar la recta de agua a la zona acuífera';
  const onHandle = (id: string, pos: { x: number; y: number }, phase: GuidePhase) => {
    setDragging(phase === 'preview' ? { id, ...pos } : null);
    if (id === 'matrix' && xAxis && yAxis) {
      const snap = snapMatrixToLithology({ nphi: pos.x, rhob: pos.y }, { x: xAxis.max - xAxis.min, y: yAxis.max - yAxis.min });
      props.onParams(MATRIX_LABEL, matrixWrites(snap.point.nphi, snap.point.rhob), phase);
      return;
    }
    if (id === 'ts-sand' || id === 'ts-shale') {
      const which = id === 'ts-sand' ? 'phiSand' : 'phiShale';
      const w = clayEndpointWrite(which, pos.y, params, pscope);
      props.onParams(paramChangeLabel(PLOT_PARAMS[which]), w ? [w] : [], phase);
      return;
    }
    const w = parseWaterHandle(id);
    const u = w ? waterUnit(w.key) : null;
    if (w && u) props.onParams(paramChangeLabel(w.which === 'move' ? PLOT_PARAMS.rwRef : PLOT_PARAMS.m), waterLineDragWrites(u, w.which, { rt: pos.x, phi: pos.y }), phase);
  };
  /** Flechas sobre una manija: un paso del parámetro (Mayús ×10), en la dirección en pantalla. */
  const onNudge = (id: string, dx: -1 | 0 | 1, dy: -1 | 0 | 1, big: boolean) => {
    if (id === 'matrix' && tpl?.dn) {
      const writes: ParamWrite[] = [];
      // Derecha = más NPHI de matriz = menos corrección; arriba = menos densidad si el eje está invertido.
      if (dx) writes.push(paramWrite(PLOT_PARAMS.matrixOffset, nudgeParam(PLOT_PARAMS.matrixOffset.spec, tpl.dn.matrixOffset, (dx * (xAxis?.reversed ? 1 : -1)) as 1 | -1, big), pscope));
      if (dy) writes.push(paramWrite(PLOT_PARAMS.rhoMa, nudgeParam(PLOT_PARAMS.rhoMa.spec, tpl.dn.rhoMa, (dy * (yAxis?.reversed ? -1 : 1)) as 1 | -1, big), pscope));
      props.onParams(MATRIX_LABEL, writes, 'commit');
      return;
    }
    // Extremos de Thomas–Stieber: solo en vertical (arriba = más porosidad).
    if ((id === 'ts-sand' || id === 'ts-shale') && tpl?.clay) {
      if (!dy) return;
      const which = id === 'ts-sand' ? 'phiSand' : 'phiShale';
      const cur = which === 'phiSand' ? tpl.clay.phiSand : tpl.clay.phiShale;
      const w = clayEndpointWrite(which, nudgeParam(PLOT_PARAMS[which].spec, cur, (dy * (yAxis?.reversed ? -1 : 1)) as 1 | -1, big), params, pscope);
      if (w) props.onParams(paramChangeLabel(PLOT_PARAMS[which]), [w], 'commit');
      return;
    }
    // Recta de agua: derecha o arriba = más Rw (trasladar) o más m (rotar).
    const dir = (dx || dy) as 1 | -1;
    const w = parseWaterHandle(id);
    const u = w ? waterUnit(w.key) : null;
    if (w && u) {
      const writes = waterLineNudgeWrites(u, w.which, dir, big);
      if (writes.length) props.onParams(paramChangeLabel(w.which === 'move' ? PLOT_PARAMS.rwRef : PLOT_PARAMS.m), writes, 'commit');
    }
  };
  /** «Ajustar recta a la zona acuífera»: m y Rw del ajuste en un solo `commit` (un Ctrl+Z), con el alcance del gráfico. */
  const applyWaterFit = () => {
    const wz = tpl?.water;
    if (!wz || wz.writes.length === 0) return;
    props.onParams(WATER_FIT_LABEL, wz.writes, 'commit');
  };
  const toggleWaterZone = (id: string) => {
    const cur = config.pickettWaterZones ?? [];
    const next = cur.includes(id) ? cur.filter((z) => z !== id) : [...cur, id];
    onChange({ pickettWaterZones: next.length ? next : undefined }, next.length > cur.length ? 'Elegir la zona acuífera del Pickett' : 'Quitar la zona acuífera del Pickett');
  };
  const removeGuide = (id: string) => {
    const l = cutLines.find((q) => q.id === id);
    if (!l) return;
    const { [l.curveKey]: _gone, ...rest } = config.cutoffs;
    onChange({ cutoffs: rest }, 'Quitar cutoff del crossplot');
  };
  /**
   * Rectángulo o lazo elegido: sus muestras pasan a ser LA selección (reemplaza la de cualquier fuente). Con Mayús se
   * suman a la selección vigente; las formas se conservan para dibujarlas si los ejes son los mismos.
   */
  const selectShape = (shape: SelectionShape, additive: boolean) => {
    if (!cloud || !cx || !cy || !xAxis || !yAxis) return;
    const inside = pointsInShape(shape, cloud.x, cloud.y, xAxis, yAxis);
    let mask = maskFromCloud(depth.length, cloud.idx, inside);
    let shapes: SelectionShape[] = [shape];
    if (additive && selection) {
      mask = unionMask(selection.mask, mask);
      const d = selection.detail;
      if (d.kind === 'shapes' && d.x === cx.key && d.y === cy.key) shapes = [...d.shapes, shape];
    } else if (inside.length === 0) {
      clearPlotSelection();
      return;
    }
    setPlotSelection(makeSelection('crossplot', depth, mask, { kind: 'shapes', x: cx.key, y: cy.key, shapes }));
  };
  const onRect = (r: DataRect, additive: boolean) => selectShape({ kind: 'rect', rect: r }, additive);
  const onLasso = (poly: DataPolygon, additive: boolean) => selectShape({ kind: 'lasso', poly }, additive);
  /** Claves (de punto de la serie de la tendencia) de las muestras seleccionadas que están en esa serie. */
  const selectedKeys = (series: { indexOfKey?(k: string): number } | null): string[] => {
    if (!selection || !series?.indexOfKey) return [];
    const out: string[] = [];
    for (let i = 0; i < selection.mask.length; i++) {
      if (!selection.mask[i]) continue;
      const k = depthPointKey(depth[i]!);
      if (series.indexOfKey(k) >= 0) out.push(k);
    }
    return out;
  };
  const addTrend = (model: TrendModel) => {
    if (!cx || !cy) return;
    const key = crossplotSeriesKey({ x: cx.key, y: cy.key, zones: filter.selected });
    const names = filter.selected.map((id) => zones.find((z) => z.id === id)?.name).filter(Boolean);
    props.onAddTrend({
      name: `${cy.short} vs. ${cx.short}${names.length ? ` (${names.join(', ')})` : ''}`,
      visible: true,
      series: { provider: CROSSPLOT_PROVIDER_ID, key },
      model,
      mode: 'fit',
      selection: { excluded: [] },
      extend: true,
    });
  };

  const colorValue = config.color.kind === 'curve' ? config.color.curve : config.color.kind === 'zone' ? '__zone' : '__none';
  const tplDef = templateDef(config.template);
  // Por secciones (litología y mineralogía; porosidad y fluidos). Una plantilla sin sus curvas sigue en el menú con el
  // motivo (al elegirla, el aviso explica qué falta o qué herramienta prender).
  const templateItems: MenuEntry[] = TEMPLATE_GROUPS.flatMap((g): MenuEntry[] => [
    { type: 'label', id: `group-${g.id}`, label: g.label },
    ...CROSSPLOT_TEMPLATE_DEFS.filter((t) => t.group === g.id).map((t): MenuEntry => {
      const r = templateAvailability.get(t.id);
      return { id: t.id, label: t.label, description: r ? `${t.description} · ${r}` : t.description, icon: config.template === t.id ? 'check' : undefined, onSelect: () => applyTemplate(t.id) };
    }),
  ]);
  const trendItems: MenuEntry[] = MODELS.map((m) => ({ id: m, label: MODEL_LABEL[m], onSelect: () => addTrend(m) }));
  const n = cloud?.idx.length ?? 0;

  // Cuadrantes (con los dos cutoffs): % de los puntos visibles en cada uno.
  const quad = lineX && lineY && cloud && n > 0 ? quadrants(cloud.x, cloud.y, lineX, lineY, cx!.short, cy!.short) : null;

  return (
    <div className="plot-host">
      <div className="plot-panel" data-testid="crossplot-panel">
        <div className="plot-panel__side">
          <div className="plot-panel__controls">
            <ControlGroup title="Ejes" aside={<IconButton size="sm" icon="swap" label="Intercambiar X e Y" onClick={swap} />}>
              <div className="plot-row">
                <span className="plot-row__axis">X</span>
                <CurveSelect label="Curva del eje X" value={xKey} options={options} hidden={hiddenX} onChange={(v) => setAxisCurve('x', v)} />
              </div>
              <div className="plot-row">
                <span className="plot-row__axis" />
                <ScaleControl label="Escala del eje X" value={config.xScale} onChange={(v) => onChange({ xScale: v, xRange: undefined }, 'Cambiar la escala del eje X')} />
                <IconButton size="sm" icon="reverse" pressed={config.xReversed} label={config.xReversed ? 'Eje X normal' : 'Invertir el eje X'} onClick={() => onChange({ xReversed: !config.xReversed }, 'Invertir el eje X')} />
              </div>
              <div className="plot-row">
                <span className="plot-row__axis">Y</span>
                <CurveSelect label="Curva del eje Y" value={yKey} options={options} hidden={hiddenY} onChange={(v) => setAxisCurve('y', v)} />
              </div>
              <div className="plot-row">
                <span className="plot-row__axis" />
                <ScaleControl label="Escala del eje Y" value={config.yScale} onChange={(v) => onChange({ yScale: v, yRange: undefined }, 'Cambiar la escala del eje Y')} />
                <IconButton size="sm" icon="reverse" pressed={config.yReversed} label={config.yReversed ? 'Eje Y normal' : 'Invertir el eje Y'} onClick={() => onChange({ yReversed: !config.yReversed }, 'Invertir el eje Y')} />
              </div>
            </ControlGroup>
            <ControlGroup title="Color">
              <CurveSelect
                label="Color de los puntos"
                value={colorValue}
                options={options}
                hidden={hiddenColor}
                extra={[
                  { value: '__zone', label: 'Por zona' },
                  { value: '__none', label: 'Un solo color' },
                ]}
                onChange={(v) => onChange({ color: v === '__zone' ? { kind: 'zone' } : v === '__none' ? { kind: 'none' } : { kind: 'curve', curve: v } }, 'Cambiar el color del crossplot')}
              />
              {hiddenColor && <HiddenCurveNote hidden={hiddenColor} what="Color" {...(props.onShowTool ? { onShowTool: props.onShowTool } : {})} />}
            </ControlGroup>
            <ControlGroup title="Zonas">
              <ZoneFilterChips zones={filter.zones} selected={filter.selected} onChange={(ids) => onChange({ zones: ids }, 'Filtrar el crossplot por zona')} />
            </ControlGroup>
            <ControlGroup title="Plantilla" aside={tplDef && <Button size="sm" variant="ghost" onClick={() => onChange({ template: null }, 'Quitar la plantilla del crossplot')}>Quitar</Button>}>
              <Menu
                aria-label="Plantillas de crossplot"
                align="start"
                minWidth={300}
                items={templateItems}
                trigger={(t) => (
                  <Button size="sm" block icon="scatter" iconRight="chevron-down" {...t}>
                    {tplDef ? tplDef.label : 'Elegir plantilla'}
                  </Button>
                )}
              />
            </ControlGroup>
            <ControlGroup title="Cutoffs">
              <div className="plot-row">
                <Button size="sm" variant={lineX ? 'secondary' : 'ghost'} icon={lineX ? 'x' : 'plus'} disabled={!cx} onClick={() => toggleCutoff(cx)} title={lineX ? 'Quitar el cutoff de X' : 'Agregar un cutoff en X'}>
                  X
                </Button>
                <Button size="sm" variant={lineY ? 'secondary' : 'ghost'} icon={lineY ? 'x' : 'plus'} disabled={!cy} onClick={() => toggleCutoff(cy)} title={lineY ? 'Quitar el cutoff de Y' : 'Agregar un cutoff en Y'}>
                  Y
                </Button>
              </div>
              <p className="plot-hint">VSH, PHIE y SW usan el cutoff real (recalcula el pay); el resto, una línea libre. Arrastralos o usá las flechas en su manija.</p>
            </ControlGroup>
            <ControlGroup
              title="Tendencias"
              aside={
                <Menu
                  aria-label="Agregar tendencia"
                  minWidth={180}
                  items={trendItems}
                  trigger={(t) => (
                    <Button size="sm" variant="ghost" icon="trend" disabled={n < 3} {...t}>
                      Agregar
                    </Button>
                  )}
                />
              }
            >
              {trendRows.length === 0 ? (
                <p className="plot-hint">Ajuste sobre los puntos visibles (zonas filtradas), con ecuación y R². Se edita en el panel Tendencias.</p>
              ) : (
                <ul className="plot-legend">
                  {trendRows.map((t) => {
                    const excluded = t.spec.selection.excluded.length;
                    const fit = t.spec.mode === 'fit';
                    return (
                      <li key={t.spec.id} title={t.result?.coeffs ? `${trendEquation(t.result, t.series)} · R² ${formatR2(t.result.r2)}` : (t.result?.problem ?? '')}>
                        <span className="plot-dot" style={{ background: t.color }} aria-hidden="true" />
                        <span className="plot-row__label">
                          {MODEL_LABEL[t.spec.model]}
                          {excluded > 0 && <span className="plot-muted"> · {formatNumber(excluded, { digits: 0 })} excl.</span>}
                        </span>
                        <span className="num">R² {t.result ? formatR2(t.result.r2) : '—'}</span>
                        {fit && selection && (
                          <IconButton size="sm" icon="filter" label={`Excluir del ajuste de ${t.spec.name} los puntos seleccionados`} onClick={() => props.onExcludeFromTrend(t.spec.id, selectedKeys(t.series))} />
                        )}
                        {fit && excluded > 0 && <IconButton size="sm" icon="refresh" label={`Volver a incluir en el ajuste de ${t.spec.name} los ${excluded} puntos excluidos`} onClick={() => props.onExcludeFromTrend(t.spec.id, null)} />}
                        <IconButton size="sm" icon="trash" label={`Borrar la tendencia ${t.spec.name}`} onClick={() => props.onRemoveTrend(t.spec.id)} />
                      </li>
                    );
                  })}
                </ul>
              )}
            </ControlGroup>
          </div>
          <aside className="plot-panel__aside" aria-label="Leyenda y lecturas">
            <div className="plot-aside-block" data-testid="crossplot-selection">
              <div className="plot-group__head">
                <span className="plot-group__title">Selección</span>
                <SegmentedControl size="sm" aria-label="Herramienta de selección" value={selectTool} onChange={setSelectTool} options={SELECT_TOOLS} />
              </div>
              <dl className="plot-kv num">
                <dt>Visibles</dt>
                <dd data-testid="crossplot-count">{formatNumber(n, { digits: 0 })}</dd>
                {selection && (
                  <>
                    <dt>Seleccionados</dt>
                    <dd data-testid="crossplot-selected">
                      {formatNumber(shownSel, { digits: 0 })}
                      {shownSel !== selection.count ? <span className="plot-muted"> de {formatNumber(selection.count, { digits: 0 })}</span> : null}
                    </dd>
                  </>
                )}
              </dl>
              {selection ? (
                <SelectionSummary selection={selection} onClear={clearPlotSelection} />
              ) : (
                <p className="plot-hint">
                  Arrastrá un {selectTool === 'lasso' ? 'lazo' : 'rectángulo'} sobre los puntos para marcarlos en el visor y en el histograma (Mayús suma). En el visor, Mayús + arrastre marca un tramo.
                </p>
              )}
            </div>
            {quad && (
              <div className="plot-aside-block">
                <div className="plot-group__title">Cuadrantes</div>
                <div className="plot-quad num" aria-label="Porcentaje de puntos en cada cuadrante de los cutoffs">
                  {quad.map((q) => (
                    <span key={q.id} className={q.pass ? 'is-pass' : undefined} title={q.title}>
                      {pct(q.value)}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {tplDef && tpl?.info && (
              <div className="plot-aside-block" data-testid="crossplot-template-info">
                <div className="plot-group__title">
                  <Badge tone="accent">{tplDef.label}</Badge>
                  {config.template === 'pe-density' && <Button size="sm" variant="ghost" onClick={() => onChange(mineralogyFullRange(), 'Ver todos los minerales de PE–densidad')}>Ver todos los minerales</Button>}
                  {config.template === 'pe-density' && <Button size="sm" variant="ghost" onClick={() => onChange({ xRange: [0, 8], yRange: [1.3, 3.2] }, 'Ver minerales principales de PE–densidad')}>Rango principal</Button>}
                  {config.template === 'rhomaa-umaa' && <Button size="sm" variant="ghost" onClick={() => onChange({ xRange: undefined }, 'Ver toda la nube de ρmaa–Umaa')}>Ver toda la nube</Button>}
                  {config.template === 'rhomaa-umaa' && <Button size="sm" variant="ghost" onClick={() => onChange({ xRange: [...UMAA_CHART_RANGE.u], yRange: [...UMAA_CHART_RANGE.rho] }, 'Volver al rango de la carta ρmaa–Umaa')}>Rango de la carta</Button>}
                  {tpl.readouts.length > 0 && <span className="plot-muted"> {tpl.pickett.length > 1 || tpl.pickett[0]?.key ? 'una recta por zona' : pscope.zoneId ? pscope.text : 'global'}</span>}
                </div>
                {tpl.readouts.length > 0 && (
                  <dl className="plot-params">
                    {tpl.readouts.map((r) => (
                      <Fragment key={r.label}>
                        <dt>
                          {r.color && <span className={`plot-swatch${r.point ? ` is-${r.point}` : ''}`} style={{ ['--swatch' as string]: r.color }} aria-hidden="true" />}
                          {r.label}
                        </dt>
                        <dd>{r.value}</dd>
                      </Fragment>
                    ))}
                  </dl>
                )}
                {tpl.warnings.map((w) => (
                  <DriverCallout key={w.id} title={w.title} action={w.action} onAction={() => props.onUseModule(w.port, w.moduleId, w.action)}>
                    {w.text}
                  </DriverCallout>
                ))}
                <p className="plot-hint">{tpl.info}</p>
                {config.template === 'thomas-stieber' && tpl.clay && (
                  <ClayEstimateBlock clay={tpl.clay} onApply={() => props.onParams(CLAY_ESTIMATE_LABEL, tpl.clay!.writes, 'commit')} />
                )}
                {tpl.byZoneOffer && (
                  <Button size="sm" variant="secondary" icon="layers" onClick={() => onChange({ zones: tpl.byZoneOffer! }, 'Ver una recta de agua por zona')} title="Filtra las zonas visibles: cada una se dibuja con su recta y sus parámetros">
                    Una recta por zona
                  </Button>
                )}
                {config.template === 'pickett' && cx?.role === 'RT' && cy?.role === 'PHIE' && (
                  <WaterZoneBlock
                    zones={filter.shown}
                    chosen={config.pickettWaterZones ?? NO_ZONES}
                    water={tpl.water}
                    byZone={tpl.pickett.length > 0 && tpl.pickett[0]!.key !== ''}
                    onToggle={toggleWaterZone}
                    onApply={applyWaterFit}
                  />
                )}
              </div>
            )}
          </aside>
        </div>
        <div className="plot-panel__main">
          {hiddenX || hiddenY ? (
            <HiddenCurveState hidden={(hiddenX ?? hiddenY)!} icon="scatter" {...(props.onShowTool ? { onShowTool: props.onShowTool } : {})} />
          ) : !cx || !cy ? (
            <EmptyState size="sm" icon="scatter" title="Elegí las curvas" description="Una de las curvas elegidas ya no está en el pozo o todavía se está calculando." />
          ) : !xAxis || !yAxis || n === 0 ? (
            <EmptyState size="sm" icon="scatter" title="Sin puntos" description="Las dos curvas no tienen valores juntos en las zonas elegidas." />
          ) : (
            <CloudPlot
              x={xAxis}
              y={yAxis}
              points={points}
              lines={tpl?.lines ?? NO_LINES}
              polygons={tpl?.polygons ?? []}
              trends={trends}
              guides={guides}
              handles={tpl?.handles ?? NO_HANDLES}
              onHandleChange={onHandle}
              onHandleNudge={onNudge}
              title={tplDef ? `Crossplot ${tplDef.label}` : `Crossplot ${cy.short} vs. ${cx.short}`}
              ariaLabel={`Crossplot de ${cy.label} contra ${cx.label}, ${formatNumber(n, { digits: 0 })} puntos`}
              colorKey={coloring?.kind === 'curve' ? coloring.key : undefined}
              highlight={highlight}
              selectionShapes={selShapes}
              emphasis={emphasis}
              selectTool={selectTool}
              onGuideChange={onGuide}
              onGuideRemove={removeGuide}
              onSelectRect={onRect}
              onSelectLasso={onLasso}
              depthOf={(k) => cloud!.d[k]!}
              onShowDepth={props.onShowDepth}
            />
          )}
          {cx && cy && n > 0 && coloring?.kind === 'curve' && (
            <div className="plot-keybar" aria-label={`Color por ${coloring.curve.label}`}>
              <span className="plot-keybar__title">
                {coloring.curve.short}
                {coloring.curve.unitText ? ` (${coloring.curve.unitText})` : ''}
              </span>
              <span className="num">{fmt(coloring.range.min)}</span>
              <span className="plot-keybar__ramp" style={{ background: `linear-gradient(to right, ${coloring.stops.join(', ')})` }} />
              <span className="num">{fmt(coloring.range.max)}</span>
              {coloring.log && <span className="plot-muted">escala log</span>}
            </div>
          )}
          {cx && cy && n > 0 && coloring?.kind === 'zone' && (
            <ul className="plot-keybar" aria-label="Zonas">
              {filter.zones.map((z, j) =>
                coloring.counts.get(j) ? (
                  <li key={z.id} title={`${formatNumber(coloring.counts.get(j)!, { digits: 0 })} puntos`}>
                    <span className="plot-dot" style={{ background: z.color }} aria-hidden="true" />
                    {z.name}
                  </li>
                ) : null,
              )}
              {coloring.counts.get(-1) ? (
                <li>
                  <span className="plot-dot" style={{ background: theme.color.textSubtle }} aria-hidden="true" />
                  Sin zona
                </li>
              ) : null}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Zona acuífera del Pickett (fase 8b, 0021): qué zonas se toman con Sw = 1 (sus puntos van con anillos), el ajuste de
 * la recta a esos puntos (vista previa rayada en el gráfico) y el botón que lo escribe en un solo Ctrl+Z.
 */
function WaterZoneBlock({ zones, chosen, water, byZone, onToggle, onApply }: { zones: readonly Zone[]; chosen: readonly string[]; water: WaterZoneState | null; byZone: boolean; onToggle(id: string): void; onApply(): void }) {
  if (byZone) {
    return (
      <div className="plot-water" data-testid="pickett-water">
        <div className="plot-group__title">Zona acuífera (Sw = 1)</div>
        <p className="plot-hint">Con una recta por zona no se ajusta a la zona acuífera: filtrá una sola zona (o ninguna) para ajustar la recta de ese alcance.</p>
      </div>
    );
  }
  const fit = water?.fit;
  const ok = fit && !('problem' in fit) ? fit : null;
  return (
    <div className="plot-water" data-testid="pickett-water">
      <div className="plot-group__title">Zona acuífera (Sw = 1)</div>
      {zones.length === 0 ? (
        <p className="plot-muted">El pozo no tiene zonas.</p>
      ) : (
        <div className="plot-chips" role="group" aria-label="Zonas acuíferas">
          {zones.map((z) => {
            const on = chosen.includes(z.id);
            return (
              <Chip key={z.id} color={z.color} selected={on} onClick={() => onToggle(z.id)} title={on ? `Dejar de tomar la zona ${z.name} como acuífera` : `Tomar la zona ${z.name} como acuífera (Sw = 1)`}>
                {z.name}
              </Chip>
            );
          })}
        </div>
      )}
      {!water ? (
        <p className="plot-hint">Elegí la zona (o las zonas) con agua: sus puntos se marcan con anillos y la recta se ajusta a ellos.</p>
      ) : fit && 'problem' in fit ? (
        <p className="plot-hint">{fit.problem}</p>
      ) : ok ? (
        <>
          <dl className="plot-params" data-testid="pickett-water-fit">
            <dt>m</dt>
            <dd>
              {ok.mode === 'm-rw'
                ? `${formatParam(PLOT_PARAMS.m, ok.m)}${Number.isFinite(ok.mUpper) ? ` (cota superior ${formatNumber(ok.mUpper, { digits: 2 })})` : ''}`
                : `${formatParam(PLOT_PARAMS.m, ok.m)} (se conserva)`}
            </dd>
            <dt>Rw de formación</dt>
            <dd>
              {fmt(water.rwFormation)} ohm·m{Number.isFinite(water.tWater) ? ` a ${fmt(water.tWater)} °C` : ''}
            </dd>
            {water.written.rwRef !== undefined && (
              <>
                <dt>Rw que se escribe</dt>
                <dd>
                  {formatParam(PLOT_PARAMS.rwRef, water.written.rwRef)} a {fmt(water.tRef)} °C
                </dd>
              </>
            )}
            <dt>Puntos</dt>
            <dd>
              {ok.mode === 'm-rw' ? `${formatNumber(ok.used, { digits: 0 })} de ${formatNumber(ok.n, { digits: 0 })} · R² ${formatR2(ok.r2)}` : `${formatNumber(ok.used, { digits: 0 })} de ${formatNumber(ok.n, { digits: 0 })}`}
            </dd>
            <dt>Dispersión</dt>
            <dd>
              ×{formatNumber(Math.exp(ok.spread), { digits: 2 })} en Rt
            </dd>
          </dl>
          {water.clean && (
            <p className="plot-hint">
              {water.clean.used
                ? `Ajuste con los ${formatNumber(water.clean.clean, { digits: 0 })} puntos limpios (Vsh ≤ ${fmt(water.clean.cutoff)}, anillos) de ${formatNumber(water.clean.total, { digits: 0 })} de la zona.`
                : `Menos de 5 puntos limpios (Vsh ≤ ${fmt(water.clean.cutoff)}): el ajuste usa todos los de la zona.`}
            </p>
          )}
          {ok.mode === 'm-rw' && <p className="plot-hint">m por mínimos cuadrados es una cota inferior: el error en la porosidad la achata. La cota superior sale de la regresión inversa; si están lejos, m es poco confiable.</p>}
          {ok.reason && (
            <p className="plot-hint">
              Se conserva m = {formatParam(PLOT_PARAMS.m, ok.m)}: {ok.reason}. Se ajusta solo Rw, condicionada a esa m; si la zona tiene hidrocarburo tiende a quedar sobreestimada (y con ella la Sw).
            </p>
          )}
          {ok.spread > WATER_FIT_DEFAULTS.maxSpread && (
            <p className="plot-hint plot-hint--warn">
              Atención: la zona no se comporta como acuífera. Rt se dispersa ×{formatNumber(Math.exp(ok.spread), { digits: 2 })} alrededor de la recta de agua (una zona acuífera limpia, menos de ×{formatNumber(Math.exp(WATER_FIT_DEFAULTS.maxSpread), { digits: 2 })}): puede haber hidrocarburo, arcilla o capas distintas. Revisá la elección de la zona.
            </p>
          )}
          {water.rwBlocked && <p className="plot-hint">Rw no se escribe: la Rw activa no es la manual.</p>}
          {water.clamped && <p className="plot-hint plot-hint--warn">Atención: {water.clamped}</p>}
          <Button size="sm" variant="primary" icon="check" block disabled={water.writes.length === 0} onClick={onApply} title="m por mínimos cuadrados de log Rt sobre log φ (sin los puntos alejados); Rw tal que la mediana de Sw de la zona sea 1. Un Ctrl+Z lo deshace.">
            {water.writes.length === 0 ? (water.clamped ? 'Sin cambios posibles' : 'La recta ya pasa por la zona acuífera') : 'Ajustar recta a la zona acuífera'}
          </Button>
        </>
      ) : null}
    </div>
  );
}

const CLAY_ESTIMATE_LABEL = 'Estimar φ de arena y de lutita de los datos';

/**
 * Thomas–Stieber (0061): resumen de la nube y «Estimar de los datos» (percentil 95 de PHIT con Vsh ≤ 0,1 y mediana con
 * Vsh ≥ 0,9) en un solo `commit` (un Ctrl+Z). Sin muestras suficientes, el motivo.
 */
function ClayEstimateBlock({ clay, onApply }: { clay: ClayState; onApply(): void }) {
  const e = clay.estimate;
  const ok = e.phiSand !== null && e.phiShale !== null && !e.problem;
  return (
    <div className="plot-water" data-testid="thomas-stieber">
      {clay.summary && (
        <p className="plot-summary" data-testid="thomas-stieber-summary">
          {clay.summary}
        </p>
      )}
      {ok ? (
        <p className="plot-hint">
          De los puntos visibles: φ arena {formatParam(PLOT_PARAMS.phiSand, e.phiSand!)} ({formatNumber(e.nSand, { digits: 0 })} muestras con Vsh ≤ 0,1) · φ lutita {formatParam(PLOT_PARAMS.phiShale, e.phiShale!)} ({formatNumber(e.nShale, { digits: 0 })} con Vsh ≥ 0,9).
        </p>
      ) : (
        <p className="plot-hint plot-hint--warn" data-testid="thomas-stieber-problem">
          No se pueden estimar los extremos: {e.problem}
        </p>
      )}
      <Button size="sm" variant="secondary" block disabled={!ok || clay.writes.length === 0} onClick={onApply} title="φ arena: percentil 95 de PHIT con Vsh ≤ 0,1; φ lutita: mediana de PHIT con Vsh ≥ 0,9 (puntos visibles). Un Ctrl+Z lo deshace.">
        {ok && clay.writes.length === 0 ? 'Los extremos ya coinciden con los datos' : 'Estimar de los datos'}
      </Button>
    </div>
  );
}

/** Temperatura más alta de la carta de Rw (Gen-9, ~400 °F): por encima, la corrección de Arps se extrapola. */
const ARPS_T_MAX_C = 200;

const NO_LINES: XYLineLayer[] = [];
const NO_HANDLES: XYHandle[] = [];
const NO_ZONES: string[] = [];

function quadrants(x: Float64Array, y: Float64Array, lx: CutoffLine, ly: CutoffLine, xName: string, yName: string) {
  const c = [0, 0, 0, 0]; // [arriba-izq, arriba-der, abajo-izq, abajo-der] en VALORES (≤ / >)
  for (let k = 0; k < x.length; k++) {
    // Inclusividad del motor: un mínimo (φ) acepta el valor en el corte («arriba»); un máximo (Vsh, Sw) lo deja abajo.
    const right = lx.param && CUTOFF_PASSES[lx.param] === 'above' ? x[k]! >= lx.value : x[k]! > lx.value;
    const up = ly.param && CUTOFF_PASSES[ly.param] === 'above' ? y[k]! >= ly.value : y[k]! > ly.value;
    c[(up ? 0 : 2) + (right ? 1 : 0)]!++;
  }
  const n = x.length;
  const passX = lx.param ? CUTOFF_PASSES[lx.param] : null;
  const passY = ly.param ? CUTOFF_PASSES[ly.param] : null;
  // Mismo borde que el conteo: un mínimo (φ) es «≥ / <»; el resto, «> / ≤».
  const op = (hi: boolean, pass: 'below' | 'above' | null) => (pass === 'above' ? (hi ? '≥' : '<') : hi ? '>' : '≤');
  const names = (up: boolean, right: boolean) => `${xName} ${op(right, passX)} ${fmt(lx.value)} · ${yName} ${op(up, passY)} ${fmt(ly.value)}`;
  return [
    [true, false],
    [true, true],
    [false, false],
    [false, true],
  ].map(([up, right], j) => ({
    id: `${up}${right}`,
    value: (100 * c[j]!) / n,
    title: names(up!, right!),
    pass: !!passX && !!passY && (passX === 'above') === right && (passY === 'above') === up,
  }));
}

interface CloudPlotProps {
  x: XYAxis;
  y: XYAxis;
  points: XYPointLayer[];
  lines: XYLineLayer[];
  polygons: XYPolygonLayer[];
  trends: XYTrendLayer[];
  guides: XYGuide[];
  handles: XYHandle[];
  onHandleChange(id: string, pos: { x: number; y: number }, phase: GuidePhase): void;
  onHandleNudge(id: string, dx: -1 | 0 | 1, dy: -1 | 0 | 1, big: boolean): void;
  title: string;
  ariaLabel: string;
  colorKey: XYColorKey | undefined;
  highlight: { layerId: string; index: number } | null;
  selectionShapes: readonly SelectionShape[] | null;
  emphasis: { layerId: string; mask: Uint8Array } | null;
  selectTool: 'rect' | 'lasso';
  onGuideChange(id: string, value: number, phase: GuidePhase): void;
  onGuideRemove(id: string): void;
  onSelectRect(r: DataRect, additive: boolean): void;
  onSelectLasso(poly: DataPolygon, additive: boolean): void;
  depthOf(k: number): number;
  onShowDepth(depth: number): void;
}

/** El gráfico en sí (memo: el cursor del visor solo cambia `highlight`, que redibuja la capa de interacción). */
const CloudPlot = memo(function CloudPlot(p: CloudPlotProps) {
  return (
    <XYPlot
      height="fill"
      className="plot-panel__plot"
      data-testid="crossplot-plot"
      figureId="crossplot-libre"
      figureTitle={p.title}
      ariaLabel={p.ariaLabel}
      x={p.x}
      y={p.y}
      points={p.points}
      lines={p.lines}
      polygons={p.polygons}
      trends={p.trends}
      guides={p.guides}
      handles={p.handles}
      onHandleChange={p.onHandleChange}
      onHandleNudge={p.onHandleNudge}
      {...(p.colorKey ? { colorKey: p.colorKey } : {})}
      highlight={p.highlight}
      selectionShapes={p.selectionShapes}
      emphasis={p.emphasis}
      selectTool={p.selectTool}
      onGuideChange={p.onGuideChange}
      onGuideRemove={p.onGuideRemove}
      onSelectRect={p.onSelectRect}
      onSelectLasso={p.onSelectLasso}
      onEscape={() => {
        if (!getPlotLink().selection) return false;
        clearPlotSelection();
        return true;
      }}
      onPointHover={(layer, k) => layer === 'cloud' && setPlotLink({ hoverDepth: p.depthOf(k) })}
      onPointLeave={() => setPlotLink({ hoverDepth: null })}
      onPointClick={(layer, k) => layer === 'cloud' && p.onShowDepth(p.depthOf(k))}
    />
  );
});


