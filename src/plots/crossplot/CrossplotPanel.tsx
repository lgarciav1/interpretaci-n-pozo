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
import type { ParamState } from '../../core/params';
import type { TrendSpec } from '../../core/trends';
import type { TrendModel } from '../../petro/regression';
import { registry } from '../../modules';
import rwManual from '../../modules/rw-manual';
import { Badge, Button, EmptyState, IconButton, Menu, SEQUENTIAL_PALETTE, curveStyle, ensureContrast, fillColor, formatNumber, rampColor, toast, useThemeTokens, type MenuEntry } from '../../ui';
import type { ThemeTokens } from '../../ui/tokens';
import { ControlGroup, CurveSelect, DriverCallout, ScaleControl, ZoneFilterChips } from '../controls';
import { CUTOFF_PASSES, cutoffParamFor, cutoffScope, normalizeCutoff, paramStep, resolveCutoffLine, type CutoffLine, type CutoffParamKey } from '../cutoffs';
import { depthRuns, effectiveScale, engineInputData, keyForRole, plotCurveOptions, resolvePlotCurve, zoneFilter, type PlotCurve } from '../data';
import { formatParam, grGuides, grWrite, inactiveDriver, normalizeParam, nudgeParam, paramChangeLabel, paramOfGuide, paramWrite, plotParamValue, plotScope, PLOT_PARAMS, RW_CORRECT_STORAGE, storedParamValue, type ParamWrite, type PlotScope } from '../params';
import { setPlotLink } from '../link';
import { evaluateTrend } from '../trend/compute';
import { formatR2, MODEL_LABEL, trendEquation } from '../trend/format';
import { trendColor } from '../trend/overlay';
import type { SeriesContext } from '../trend/series';
import { niceRange, pointsInRect, type DataRect, type XYAxis } from '../xy/axes';
import type { XYColorKey } from '../xy/figure';
import { XYPlot, type GuidePhase, type XYGuide, type XYHandle, type XYLineLayer, type XYPointLayer, type XYTrendLayer } from '../xy/XYPlot';
import { cutoffSplit } from '../histogram/histogram';
import { COLOR_LEVELS, colorLevel, gather, medianAt, plottableIndices, robustRange } from './crossplot';
import { CROSSPLOT_PROVIDER_ID, crossplotSeries, crossplotSeriesKey, parseCrossplotSeriesKey } from './series';
import { matrixParamsOf, matrixPointOf, mFromRotate, projectMatrixLine, representativeTemperature, rwAtFormation, rwAtReference, rwFromTranslate, snapMatrixToLithology, waterLineHandles, waterLineRt } from './drag';
import { BVW_LINES, CROSSPLOT_TEMPLATE_DEFS, DN_LITHOLOGIES, PICKETT_SW, bvwLine, densityNeutronLine, pickettLine, templateDef, type ArchieParams } from './templates';
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
}

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
  /** Temperatura representativa de los puntos visibles (°C; mediana de TEMP). */
  tRep: number;
  correct: boolean;
}

interface TemplateDrawing {
  lines: XYLineLayer[];
  guides: XYGuide[];
  points: XYPointLayer[];
  handles: XYHandle[];
  info: string | null;
  readouts: Readout[];
  warnings: DriverWarning[];
  dn: { rhoMa: number; matrixOffset: number; rhoFl: number } | null;
  pickett: PickettState | null;
}

interface TemplateContext {
  ctx: SeriesContext;
  scope: PlotScope;
  idx: Int32Array;
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
 * Parámetros de Archie para el gráfico de Pickett: a, m, n del alcance. Rw de la recta = Rw de formación de los
 * puntos visibles: con `rw-manual` como fuente, la Rw de referencia del alcance llevada con Arps (la fórmula del
 * motor) a la mediana de la temperatura de esos puntos; con otra fuente, la mediana de la curva RW activa (0014, D7).
 */
function pickettState(t: TemplateContext): PickettState & { rwSource: string } {
  const params: ParamState = t.ctx.interpretation.params;
  const z = t.scope.zoneId;
  const base = { a: plotParamValue(params, PLOT_PARAMS.a, z), m: plotParamValue(params, PLOT_PARAMS.m, z), n: plotParamValue(params, PLOT_PARAMS.n, z) };
  const rwRef = plotParamValue(params, PLOT_PARAMS.rwRef, z);
  const tRef = plotParamValue(params, PLOT_PARAMS.tRef, z);
  const correct = storedParamValue(params, RW_CORRECT_STORAGE, rwManual.params.correct, z) as boolean;
  const manual = !inactiveDriver(t.sources, 'RW', 'rw-manual');
  const temp = engineInputData(t.ctx, t.sources, 'TEMP');
  const tRep = temp ? representativeTemperature(temp, t.idx) : NaN;
  if (manual && (!correct || Number.isFinite(tRep))) {
    return { ...base, rw: rwAtFormation(rwRef, tRef, tRep, correct), manual: true, rwRef, tRef, tRep, correct, rwSource: correct ? 'Rw conocida llevada a la temperatura de los puntos visibles' : 'Rw conocida, sin corrección por temperatura' };
  }
  const rwCurve = t.ctx.computed.find((c) => c.active && c.port === 'RW');
  let rw = rwCurve ? medianAt(rwCurve.data, t.idx) : NaN;
  let rwSource = 'mediana de la curva RW en los puntos visibles';
  if (!(rw > 0)) {
    rw = rwRef;
    rwSource = 'Rw conocida del módulo «Rw conocida»';
  }
  return { ...base, rw, manual: false, rwRef, tRef, tRep, correct, rwSource };
}

/** Líneas guía y manijas de la plantilla, con colores del tema (la matemática está en `templates.ts` y `drag.ts`). */
function templateDrawing(id: CrossplotTemplateId | null, t: TemplateContext): TemplateDrawing {
  const { ctx, theme, scope } = t;
  const out: TemplateDrawing = { lines: [], guides: [], points: [], handles: [], info: null, readouts: [], warnings: [], dn: null, pickett: null };
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
    const p = pickettState(t);
    out.pickett = p;
    PICKETT_SW.forEach((sw, k) => {
      const l = pickettLine(sw, p, [0.005, 1]);
      out.lines.push({ id: `pk-${sw}`, name: `Sw ${pct(sw * 100)}`, x: l.rt, y: l.phi, color: k === 0 ? c(theme.color.info) : c(theme.color.textMuted), width: k === 0 ? 2 : 1.25, dash: k === 0 ? [] : [6, 4], label: `Sw ${pct(sw * 100)}`, labelAt: 'start' });
    });
    const water = out.lines[0]!;
    const pivot = t.cx.role === 'RT' && t.cy.role === 'PHIE' && t.xAxis.kind === 'log' && t.yAxis.kind === 'log';
    const rwRefText = formatParam(PLOT_PARAMS.rwRef, p.rwRef);
    const rwFormText = `${fmt(p.rw)} ohm·m`;
    const tRefText = `${fmt(p.tRef)} °C`;
    if (pivot) {
      const h = waterLineHandles(p, [t.xAxis.min, t.xAxis.max], [t.yAxis.min, t.yAxis.max]);
      const color = c(theme.color.info);
      const dm = t.dragging?.id === 'water-move' ? t.dragging : null;
      const dr = t.dragging?.id === 'water-rotate' ? t.dragging : null;
      // Durante el arrastre la manija queda bajo el puntero (sobre la recta ya redondeada al paso).
      const move = dm && dm.y > 0 ? { rt: waterLineRt(dm.y, p), phi: dm.y } : h.translate;
      out.handles.push({
        id: 'water-move',
        x: move.rt,
        y: move.phi,
        color,
        label: p.manual ? `Rw ${scope.text} · ${rwRefText} a ${tRefText}` : `Rw de formación · ${rwFormText}`,
        detail: p.manual ? (p.correct ? `${rwFormText} a ${fmt(p.tRep)} °C (formación)` : 'sin corrección por temperatura') : inactiveDriver(t.sources, 'RW', 'rw-manual') ? 'la Rw activa no es la manual' : 'sin temperatura de formación',
        ariaLabel: `Recta de agua, trasladar: cambia Rw ${scope.text}. Flechas para mover, Mayús para pasos largos`,
        valueText: p.manual ? `Rw ${rwRefText} a ${tRefText}; ${rwFormText} a temperatura de formación` : `Rw de formación ${rwFormText}`,
        grabPath: { x: water.x, y: water.y },
        labelAt: { x: 'left', y: 'below' },
        ...(p.manual ? {} : { disabled: true }),
      });
      if (h.rotate) {
        const rot = dr && dr.y > 0 && dr.y < 1 ? { rt: waterLineRt(dr.y, p), phi: dr.y } : h.rotate;
        const mText = formatParam(PLOT_PARAMS.m, p.m);
        out.handles.push({
          id: 'water-rotate',
          x: rot.rt,
          y: rot.phi,
          color,
          shape: 'square',
          cursor: 'crosshair',
          labelAt: { x: 'left', y: 'below' },
          label: `m ${scope.text} · ${mText}`,
          detail: 'gira alrededor de φ = 1',
          ariaLabel: `Recta de agua, rotar: cambia el exponente de cementación m ${scope.text}. Flechas para mover, Mayús para pasos largos`,
          valueText: `m ${mText}`,
        });
      }
      if (inactiveDriver(t.sources, 'RW', 'rw-manual')) {
        const active = t.sources?.['RW'];
        const from = active?.kind === 'module' ? `«${registryName(active.moduleId)}»` : active?.kind === 'curve' ? `la curva medida ${active.curveId}` : 'otra fuente';
        out.warnings.push({ id: 'rw', title: `La Rw activa sale de ${from}`, text: `Trasladar la recta de agua no cambiaría Sw. Rotarla sí cambia m. Con Rw manual, la recta parte de Rw ${rwRefText} a ${tRefText}.`, action: 'Usar Rw manual', port: 'RW', moduleId: 'rw-manual' });
      }
    }
    out.readouts.push(
      ...(p.manual ? [{ label: `Rw a ${tRefText}`, value: rwRefText, color: c(theme.color.info), point: 'circle' as const }] : []),
      { label: p.manual && p.correct ? `Rw a ${fmt(p.tRep)} °C` : 'Rw de formación', value: rwFormText },
      { label: 'm', value: formatParam(PLOT_PARAMS.m, p.m) },
      { label: 'a · n', value: `${fmt(p.a)} · ${fmt(p.n)}` },
    );
    out.info = pivot
      ? p.manual
        ? `Arrastrá la recta de agua (Sw 100 %) para elegir Rw y su manija cuadrada para rotarla y elegir m; las líneas de Sw se recalculan. Rw de la recta: ${p.rwSource}.`
        : `La manija cuadrada rota la recta de agua y elige m. Rw de la recta: ${p.rwSource}.`
      : `a ${fmt(p.a)} · m ${fmt(p.m)} · n ${fmt(p.n)} · Rw ${fmt(p.rw)} ohm·m (${p.rwSource}).`;
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
  }
  return out;
}

export function CrossplotPanel(props: CrossplotPanelProps) {
  const { ctx, config, onChange } = props;
  const theme = useThemeTokens();
  const [preview, setPreview] = useState<{ id: string; value: number } | null>(null);
  const [selection, setSelection] = useState<{ count: number; runs: number; rect: DataRect } | null>(null);
  const [dragging, setDragging] = useState<{ id: string; x: number; y: number } | null>(null);
  const options = useMemo(() => plotCurveOptions(ctx), [ctx]);
  const depth = ctx.well.depth.values;
  const zones = ctx.interpretation.zones;

  // Curvas por defecto: densidad contra neutrón si hay; si no, las dos primeras.
  const xKey = config.x ?? keyForRole(ctx, 'NPHI') ?? options[0]?.value ?? null;
  const yKey = config.y ?? keyForRole(ctx, 'RHOB') ?? options[1]?.value ?? options[0]?.value ?? null;
  const cx = useMemo(() => resolvePlotCurve(ctx, xKey), [ctx, xKey]);
  const cy = useMemo(() => resolvePlotCurve(ctx, yKey), [ctx, yKey]);
  const colorKey = config.color.kind === 'curve' ? config.color.curve : null;
  const cc = useMemo(() => resolvePlotCurve(ctx, colorKey), [ctx, colorKey]);
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

  useEffect(() => () => setPlotLink({ hoverDepth: null, selection: null }), []);
  // La selección se refiere a la nube de antes: al cambiar los ejes o el filtro, se suelta.
  useEffect(() => {
    setSelection(null);
    setPlotLink({ selection: null });
  }, [cloud]);

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
    () => (cloud && cx && cy && xAxis && yAxis ? templateDrawing(config.template, { ctx, scope: pscope, idx: cloud.idx, theme, sources, cx, cy, xAxis, yAxis, dragging }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [config.template, ctx, pscope.zoneId, pscope.text, cloud, theme, sources, cx, cy, xAxis, yAxis, dragging],
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
        color: l.param ? theme.color.error : theme.color.accent,
        dash: l.param ? [] : [6, 4],
        width: 1.75,
        draggable: true,
        ...(l.param ? { step: paramStep(l.param) } : {}),
        label: `${l.title} · ${fmt(l.value)}`,
        ...(n ? { detail: pass ? `Pasa ${pct(pass === 'below' ? below : 100 - below)}` : `${pct(below)} ≤ · ${pct(100 - below)} >` } : {}),
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tpl, cloud, theme, lineX?.id, lineX?.value, lineX?.title, lineY?.id, lineY?.value, lineY?.title]);

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

  if (options.length < 2) return <EmptyState size="sm" icon="scatter" title="Faltan curvas" description="Hacen falta al menos dos curvas para un crossplot." />;

  // ── acciones ─────────────────────────────────────────────────────────────────────────────────────────────────
  const setAxisCurve = (axis: 'x' | 'y', key: string) =>
    onChange(
      axis === 'x' ? { x: key, template: null, xScale: 'auto', xRange: undefined, xReversed: false } : { y: key, template: null, yScale: 'auto', yRange: undefined, yReversed: false },
      axis === 'x' ? 'Cambiar el eje X del crossplot' : 'Cambiar el eje Y del crossplot',
    );
  const swap = () =>
    onChange({ x: yKey, y: xKey, xScale: config.yScale, yScale: config.xScale, xReversed: config.yReversed, yReversed: config.xReversed, xRange: config.yRange, yRange: config.xRange, template: null }, 'Intercambiar los ejes del crossplot');
  const applyTemplate = (id: CrossplotTemplateId) => {
    const def = templateDef(id)!;
    const x = keyForRole(ctx, def.x.role);
    const y = keyForRole(ctx, def.y.role);
    if (!x || !y) {
      toast({ tone: 'warn', title: `No se puede armar «${def.label}»`, description: `Hace falta ${!x ? def.x.role : def.y.role} en el pozo (medida o calculada).` });
      return;
    }
    const color = def.colorRole ? keyForRole(ctx, def.colorRole) : null;
    onChange(
      {
        x,
        y,
        xScale: def.x.scale,
        yScale: def.y.scale,
        xReversed: !!def.x.reversed,
        yReversed: !!def.y.reversed,
        xRange: def.x.range,
        yRange: def.y.range,
        template: id,
        ...(color ? { color: { kind: 'curve' as const, curve: color } } : {}),
      },
      `Usar la plantilla ${def.label}`,
    );
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
  /** Rw de referencia que pone la recta de agua por `pt` (Rw de formación → temperatura de referencia, como el motor). */
  const rwWrite = (pt: { rt: number; phi: number }): ParamWrite[] => {
    const p = tpl?.pickett;
    if (!p || !p.manual) return [];
    const rwRef = rwAtReference(rwFromTranslate(pt, p.a, p.m), p.tRef, p.tRep, p.correct);
    return [paramWrite(PLOT_PARAMS.rwRef, normalizeParam(PLOT_PARAMS.rwRef.spec, rwRef), pscope)];
  };
  const mWrite = (pt: { rt: number; phi: number }): ParamWrite[] => {
    const p = tpl?.pickett;
    const m = p ? mFromRotate(pt, p.a, p.rw) : NaN;
    return Number.isFinite(m) ? [paramWrite(PLOT_PARAMS.m, normalizeParam(PLOT_PARAMS.m.spec, m), pscope)] : [];
  };
  const MATRIX_LABEL = 'Mover el punto de matriz';
  const onHandle = (id: string, pos: { x: number; y: number }, phase: GuidePhase) => {
    setDragging(phase === 'preview' ? { id, ...pos } : null);
    if (id === 'matrix' && xAxis && yAxis) {
      const snap = snapMatrixToLithology({ nphi: pos.x, rhob: pos.y }, { x: xAxis.max - xAxis.min, y: yAxis.max - yAxis.min });
      props.onParams(MATRIX_LABEL, matrixWrites(snap.point.nphi, snap.point.rhob), phase);
    } else if (id === 'water-move') props.onParams(paramChangeLabel(PLOT_PARAMS.rwRef), rwWrite({ rt: pos.x, phi: pos.y }), phase);
    else if (id === 'water-rotate') props.onParams(paramChangeLabel(PLOT_PARAMS.m), mWrite({ rt: pos.x, phi: pos.y }), phase);
  };
  /** Flechas sobre una manija: un paso del parámetro (Mayús ×10), en la dirección en pantalla. */
  const onNudge = (id: string, dx: -1 | 0 | 1, dy: -1 | 0 | 1, big: boolean) => {
    const z = pscope.zoneId;
    if (id === 'matrix' && tpl?.dn) {
      const writes: ParamWrite[] = [];
      // Derecha = más NPHI de matriz = menos corrección; arriba = menos densidad si el eje está invertido.
      if (dx) writes.push(paramWrite(PLOT_PARAMS.matrixOffset, nudgeParam(PLOT_PARAMS.matrixOffset.spec, tpl.dn.matrixOffset, (dx * (xAxis?.reversed ? 1 : -1)) as 1 | -1, big), pscope));
      if (dy) writes.push(paramWrite(PLOT_PARAMS.rhoMa, nudgeParam(PLOT_PARAMS.rhoMa.spec, tpl.dn.rhoMa, (dy * (yAxis?.reversed ? -1 : 1)) as 1 | -1, big), pscope));
      props.onParams(MATRIX_LABEL, writes, 'commit');
      return;
    }
    // Recta de agua: derecha o arriba = más Rw (trasladar) o más m (rotar).
    const dir = (dx || dy) as 1 | -1;
    if (id === 'water-move' && tpl?.pickett?.manual) {
      props.onParams(paramChangeLabel(PLOT_PARAMS.rwRef), [paramWrite(PLOT_PARAMS.rwRef, nudgeParam(PLOT_PARAMS.rwRef.spec, plotParamValue(params, PLOT_PARAMS.rwRef, z), dir, big), pscope)], 'commit');
    } else if (id === 'water-rotate' && tpl?.pickett) {
      props.onParams(paramChangeLabel(PLOT_PARAMS.m), [paramWrite(PLOT_PARAMS.m, nudgeParam(PLOT_PARAMS.m.spec, tpl.pickett.m, dir, big), pscope)], 'commit');
    }
  };
  const removeGuide = (id: string) => {
    const l = cutLines.find((q) => q.id === id);
    if (!l) return;
    const { [l.curveKey]: _gone, ...rest } = config.cutoffs;
    onChange({ cutoffs: rest }, 'Quitar cutoff del crossplot');
  };
  const onRect = (r: DataRect) => {
    if (!cloud) return;
    const inside = pointsInRect(r, cloud.x, cloud.y);
    if (inside.length === 0) {
      setSelection(null);
      setPlotLink({ selection: null });
      return;
    }
    const mark = new Uint8Array(depth.length);
    for (const k of inside) mark[cloud.idx[k]!] = 1;
    const runs = depthRuns(depth, (i) => mark[i] === 1, 1);
    setSelection({ count: inside.length, runs: runs.length, rect: r });
    setPlotLink({ selection: { runs, count: inside.length } });
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
  const templateItems: MenuEntry[] = CROSSPLOT_TEMPLATE_DEFS.map((t) => ({ id: t.id, label: t.label, description: t.description, icon: config.template === t.id ? 'check' : undefined, onSelect: () => applyTemplate(t.id) }));
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
                <CurveSelect label="Curva del eje X" value={xKey} options={options} onChange={(v) => setAxisCurve('x', v)} />
              </div>
              <div className="plot-row">
                <span className="plot-row__axis" />
                <ScaleControl label="Escala del eje X" value={config.xScale} onChange={(v) => onChange({ xScale: v, xRange: undefined }, 'Cambiar la escala del eje X')} />
                <IconButton size="sm" icon="reverse" pressed={config.xReversed} label={config.xReversed ? 'Eje X normal' : 'Invertir el eje X'} onClick={() => onChange({ xReversed: !config.xReversed }, 'Invertir el eje X')} />
              </div>
              <div className="plot-row">
                <span className="plot-row__axis">Y</span>
                <CurveSelect label="Curva del eje Y" value={yKey} options={options} onChange={(v) => setAxisCurve('y', v)} />
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
                extra={[
                  { value: '__zone', label: 'Por zona' },
                  { value: '__none', label: 'Un solo color' },
                ]}
                onChange={(v) => onChange({ color: v === '__zone' ? { kind: 'zone' } : v === '__none' ? { kind: 'none' } : { kind: 'curve', curve: v } }, 'Cambiar el color del crossplot')}
              />
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
                  {trendRows.map((t) => (
                    <li key={t.spec.id} title={t.result?.coeffs ? `${trendEquation(t.result, t.series)} · R² ${formatR2(t.result.r2)}` : (t.result?.problem ?? '')}>
                      <span className="plot-dot" style={{ background: t.color }} aria-hidden="true" />
                      <span className="plot-row__label">{MODEL_LABEL[t.spec.model]}</span>
                      <span className="num">R² {t.result ? formatR2(t.result.r2) : '—'}</span>
                      <IconButton size="sm" icon="trash" label={`Borrar la tendencia ${t.spec.name}`} onClick={() => props.onRemoveTrend(t.spec.id)} />
                    </li>
                  ))}
                </ul>
              )}
            </ControlGroup>
          </div>
          <aside className="plot-panel__aside" aria-label="Leyenda y lecturas">
            <div className="plot-aside-block">
              <div className="plot-group__title">Puntos</div>
              <dl className="plot-kv num">
                <dt>Visibles</dt>
                <dd data-testid="crossplot-count">{formatNumber(n, { digits: 0 })}</dd>
                {selection && (
                  <>
                    <dt>Seleccionados</dt>
                    <dd>{formatNumber(selection.count, { digits: 0 })}</dd>
                  </>
                )}
              </dl>
              {selection ? (
                <div className="plot-row">
                  <span className="plot-row__label">
                    {selection.runs} {selection.runs === 1 ? 'tramo marcado' : 'tramos marcados'} en el visor
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setSelection(null);
                      setPlotLink({ selection: null });
                    }}
                  >
                    Limpiar
                  </Button>
                </div>
              ) : (
                <p className="plot-hint">Arrastrá un rectángulo para marcar esas muestras en el visor.</p>
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
                  {tpl.readouts.length > 0 && <span className="plot-muted"> {pscope.zoneId ? pscope.text : 'global'}</span>}
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
              </div>
            )}
          </aside>
        </div>
        <div className="plot-panel__main">
          {!cx || !cy ? (
            <EmptyState size="sm" icon="scatter" title="Elegí las curvas" description="Una de las curvas elegidas ya no está en el pozo o todavía se está calculando." />
          ) : !xAxis || !yAxis || n === 0 ? (
            <EmptyState size="sm" icon="scatter" title="Sin puntos" description="Las dos curvas no tienen valores juntos en las zonas elegidas." />
          ) : (
            <CloudPlot
              x={xAxis}
              y={yAxis}
              points={points}
              lines={tpl?.lines ?? NO_LINES}
              trends={trends}
              guides={guides}
              handles={tpl?.handles ?? NO_HANDLES}
              onHandleChange={onHandle}
              onHandleNudge={onNudge}
              title={tplDef ? `Crossplot ${tplDef.label}` : `Crossplot ${cy.short} vs. ${cx.short}`}
              ariaLabel={`Crossplot de ${cy.label} contra ${cx.label}, ${formatNumber(n, { digits: 0 })} puntos`}
              colorKey={coloring?.kind === 'curve' ? coloring.key : undefined}
              highlight={highlight}
              selection={selection?.rect ?? null}
              onGuideChange={onGuide}
              onGuideRemove={removeGuide}
              onSelectRect={onRect}
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

const NO_LINES: XYLineLayer[] = [];
const NO_HANDLES: XYHandle[] = [];

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
  trends: XYTrendLayer[];
  guides: XYGuide[];
  handles: XYHandle[];
  onHandleChange(id: string, pos: { x: number; y: number }, phase: GuidePhase): void;
  onHandleNudge(id: string, dx: -1 | 0 | 1, dy: -1 | 0 | 1, big: boolean): void;
  title: string;
  ariaLabel: string;
  colorKey: XYColorKey | undefined;
  highlight: { layerId: string; index: number } | null;
  selection: DataRect | null;
  onGuideChange(id: string, value: number, phase: GuidePhase): void;
  onGuideRemove(id: string): void;
  onSelectRect(r: DataRect): void;
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
      trends={p.trends}
      guides={p.guides}
      handles={p.handles}
      onHandleChange={p.onHandleChange}
      onHandleNudge={p.onHandleNudge}
      {...(p.colorKey ? { colorKey: p.colorKey } : {})}
      highlight={p.highlight}
      selection={p.selection}
      onGuideChange={p.onGuideChange}
      onGuideRemove={p.onGuideRemove}
      onSelectRect={p.onSelectRect}
      onPointHover={(layer, k) => layer === 'cloud' && setPlotLink({ hoverDepth: p.depthOf(k) })}
      onPointLeave={() => setPlotLink({ hoverDepth: null })}
      onPointClick={(layer, k) => layer === 'cloud' && p.onShowDepth(p.depthOf(k))}
    />
  );
});

