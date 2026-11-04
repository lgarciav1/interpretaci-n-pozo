/**
 * Panel «Distribuciones por zona» (docs/decisiones/0066): boxplots por zona de una propiedad, una caja por serie
 * (interpretación actual, snapshots, otros pozos con zonas emparejadas por nombre). Filas en orden de profundidad con
 * el color de la zona, eje compartido arriba (log para k), avisos concretos por zona, leyenda de zonas clicable,
 * clic en una caja o en el nombre → el visor va a la zona, exportación a CSV y figura PNG.
 *
 * Presentación: no conoce los stores. Lo conecta `src/modules/zone-distribution/dock.tsx`. Pensado primero para un
 * contenedor angosto (nombre de la zona arriba de su fila); con ancho, nombres a la izquierda y controles al costado.
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { DistributionConfig } from '../../core/plots';
import { intervalDistribution, type DistributionInput, type DistributionMean, type DistributionStats } from '../../petro/distribution';
import { useCanvas } from '../../ui/canvas';
import { CATEGORICAL } from '../../ui/curves';
import { Button, Callout, Checkbox, Chip, EmptyState, IconButton, SegmentedControl, Spinner, formatNumber, useThemeTokens, useUiScaleFactor, type ThemeTokens } from '../../ui';
import { scalePx } from '../../ui/tokens';
import { withAlpha } from '../../ui/color';
import { ControlGroup, CurveSelect } from '../controls';
import { cutoffParamFor, type CutoffParamKey } from '../cutoffs';
import { resolvePlotCurve } from '../data';
import { clearPlotSelection, makeSelection, selectionTitle, setPlotLink, setPlotSelection } from '../link';
import { usePlotSelection } from '../useLink';
import type { SeriesContext } from '../trend/series';
import type { XYAxis } from '../xy/axes';
import type { GuidePhase } from '../xy/XYPlot';
import { registerXYFigure } from '../xy/figures';
import { XY_FIGURE_THEME } from '../xy/figure';
import {
  availabilityOf,
  buildCells,
  cellTooltip,
  distributionAxis,
  FILTER_LABEL,
  matchZones,
  MEAN_LABEL,
  plugCountText,
  propertyStat,
  shownRows,
  statsCsv,
  topsCsv,
  zoneNotes,
  zoneRows,
  ZONE_KIND_LABEL,
  type DistributionCell,
  type SeriesData,
  type SeriesKind,
  type ZoneRow,
} from './distribution';
import { DIST_METRICS, drawDistAxis, drawDistributionFigure, drawZoneRow, laneAt, laneValue, rowHeight, zoneLaneStyle, type LaneStyle, type RowHistScene } from './draw';
import { histogramAxis, histogramEdges, histTooltip, laneHistogram, usedSamples } from './hist';
import { CORE_LOG_SERIES, CORE_MIN_BOX, CORE_SERIES, corePropertyOf, plugCells, plugColumn, plugDiffText, plugLogCells, plugWarnings, type CorePlugs } from './plugs';
import { hasRange, VOLUME_LABEL, VOLUME_UNIT, volumeFraction, volumeMax, volumeText, volumeTitle, type VolumeData, type VolumeFluid } from './volume';
import { cutoffPassFraction, maskedRanges, maskFraction, passBaseFilter, rangeFraction, rangeMask, summaryPay, zoneCutoff, type CutoffPreview, type SummaryRow, type ZoneCutoff } from './interact';
import { Band, CutGrip, CutLine, type CutMark } from './marks';
import { defaultProperty, propertyOptions, seriesFromContext, translateKey, usesOnlyDefaults } from './series';
import '../plots.css';
import '../xy/xy.css';
import './distribution.css';

/** Id de la serie «interpretación actual» (el mismo que usa la comparación de snapshots). */
export const CURRENT_SERIES = '#current';

export interface DistributionSeriesItem {
  id: string;
  label: string;
  kind: SeriesKind;
  detail?: string;
  /** Estado del cálculo (solo las elegidas; 'idle' = candidata sin pedir). */
  status: 'idle' | 'pending' | 'error' | 'ready';
  message?: string;
  ctx?: SeriesContext;
}

export interface DistributionPanelProps {
  /** Contexto del pozo activo (la serie «Actual»). */
  ctx: SeriesContext;
  wellName: string;
  config: DistributionConfig;
  onChange(patch: Partial<DistributionConfig>, label: string): void;
  /** Candidatas (sin «Actual»), con el estado de las elegidas. */
  series: readonly DistributionSeriesItem[];
  /** Llevar el visor a un tramo. */
  onGoTo(top: number, base: number): void;
  /** Descargar un archivo de texto (CSV). */
  onDownload(name: string, text: string): void;
  /**
   * Cutoff real arrastrado (parámetro del módulo de cutoffs de una zona o global): la misma receta que el histograma
   * (`commitParamCutoff`): cada vista previa recalcula en vivo y el gesto entero es un solo deshacer.
   */
  onParamCutoff(key: CutoffParamKey, zoneId: string | null, value: number, phase: GuidePhase): void;
  /** Tabla ZONE_SUMMARY del último resultado del motor para este pozo (pay neto por zona); null si no hay. */
  summary: readonly SummaryRow[] | null;
  /** Plugs de corona incluidos del pozo activo (profundidad corrida) y su color por tema; null si no hay. */
  core?: { plugs: CorePlugs; colors: Readonly<Record<'light' | 'dark', string>> } | null;
  /** Volumen in situ por zona (determinista y, si está calculada, la incertidumbre); null si no hay resultado. */
  volume?: VolumeData | null;
  /** Abrir el módulo de incertidumbre en el inspector (no lo calcula: lo decide el usuario). */
  onOpenUncertainty?(): void;
}

/**
 * Estilo de cada serie: «Actual» con el acento; la corona con el color de su primera corona en el visor; snapshots y
 * pozos con la paleta categórica (pozos con borde punteado).
 */
function seriesStyles(items: readonly { id: string; kind: SeriesKind }[], theme: ThemeTokens, coreColor?: string): LaneStyle[] {
  const pal = CATEGORICAL[theme.name];
  let k = 1;
  return items.map((s) => (s.kind === 'current' ? { color: theme.color.accent } : s.kind === 'core' ? { color: coreColor ?? pal[0]! } : s.kind === 'coreLog' ? { color: theme.color.accent, dashed: true, fill: withAlpha(theme.color.accent, theme.name === 'dark' ? 0.14 : 0.1) } : { color: pal[k++ % pal.length]!, dashed: s.kind === 'well' }));
}

interface Hover {
  lane: number;
  x: number;
  y: number;
  /** Ancho de la fila: el tooltip se abre hacia el lado con lugar. */
  width: number;
}

const HOVER_NONE = { zone: -1, lane: -1, x: 0, y: 0, width: 0 };

/** Px que tiene que recorrer el puntero para que sea un arrastre (selección por rango) y no un clic (ir a la zona). */
const DRAG_PX = { mouse: 4, touch: 10 } as const;

/** Un % corto con coma decimal («<1», «100»). */
const pctText = (f: number) => (!Number.isFinite(f) ? '—' : f >= 0.995 ? '100' : f > 0 && f < 0.01 ? '<1' : formatNumber(f * 100, { digits: 0 }));
const fmt3 = (v: number) => formatNumber(v, { significant: 3 });

/** Cutoff por zona ya resuelto para dibujar y rotular. */
interface RowCut {
  mark: CutMark;
  /** Fracción ponderada del espesor que pasa (NaN si no aplica). */
  pass: number;
  /** Pay neto (m) del sumario del motor (NaN si no hay). */
  pay: number;
}

/** Captura del puntero; un id ya soltado (o sintético) no debe romper el gesto. */
const capture = (el: Element, pointerId: number) => {
  try {
    el.setPointerCapture?.(pointerId);
  } catch {
    /* sin captura: el gesto sigue mientras el puntero esté sobre la fila */
  }
};

/** Datos de la serie actual en la forma que pide el motor (null si la propiedad no está). */
function inputOf(s: SeriesData): DistributionInput | null {
  if (!s.values) return null;
  return {
    values: s.values,
    thickness: s.thickness,
    ...(s.netRes ? { netRes: s.netRes } : {}),
    ...(s.netPay ? { netPay: s.netPay } : {}),
    ...(s.washout ? { washout: s.washout } : {}),
    ...(s.phi ? { phi: s.phi } : {}),
  };
}

export function DistributionPanel({ ctx, wellName, config, onChange, series, onGoTo, onDownload, onParamCutoff, summary, core = null, volume = null, onOpenUncertainty }: DistributionPanelProps) {
  const theme = useThemeTokens();
  const ui = useUiScaleFactor();
  const options = useMemo(() => propertyOptions(ctx), [ctx]);
  const key = config.curve && options.some((o) => o.value === config.curve) ? config.curve : defaultProperty(options);
  const curve = useMemo(() => resolvePlotCurve(ctx, key), [ctx, key]);
  const current = useMemo(() => seriesFromContext(ctx, key, { id: CURRENT_SERIES, label: 'Actual', kind: 'current' }), [ctx, key]);
  const avail = availabilityOf(current);
  const stat = propertyStat(curve?.role ?? curve?.short ?? '', avail.phi, curve?.scale);
  const unit = curve?.unitText || undefined;
  // Filtro efectivo: si faltan las banderas, toda la zona (el control queda deshabilitado).
  const filter = (config.filter === 'netRes' && !avail.netRes) || (config.filter === 'netPay' && !avail.netPay) ? 'all' : config.filter;
  const excludeWashout = config.excludeWashout && avail.washout;
  const view = config.view === 'hist' ? 'hist' : 'box';

  // Corona (V2): la propiedad elegida tiene equivalente por rol y el conjunto la trae en una unidad comparable.
  const coreProp = corePropertyOf(curve?.role);
  const coreCol = useMemo(() => (core ? plugColumn(core.plugs, coreProp, curve?.unit) : null), [core, coreProp, curve?.unit]);
  const coreColor = core?.colors[theme.name];

  // Series elegidas, en el orden de las candidatas («Actual» primero).
  // Sin las que ya no existen (snapshot borrado, pozo quitado): si no, quitar «Actual» con una sola serie viva dejaría
  // la lista sin series reales y el panel mostraría «Actual» con su chip apagado.
  const chosen = useMemo(() => {
    // «Perfil en plugs» solo existe junto con la corona.
    const coreChosen = config.series.includes(CORE_SERIES) && !!coreCol;
    const alive = config.series.filter((id) => id === CURRENT_SERIES || (id === CORE_SERIES && !!coreCol) || (id === CORE_LOG_SERIES && coreChosen) || series.some((s) => s.id === id));
    return alive.length ? alive : [CURRENT_SERIES];
  }, [config.series, series, coreCol]);
  const lanes = useMemo(() => {
    const out: { id: string; label: string; kind: SeriesKind; status: DistributionSeriesItem['status']; data: SeriesData | null }[] = [];
    if (chosen.includes(CURRENT_SERIES)) out.push({ id: CURRENT_SERIES, label: 'Actual', kind: 'current', status: 'ready', data: current });
    if (chosen.includes(CORE_SERIES) && coreCol) out.push({ id: CORE_SERIES, label: 'Corona', kind: 'core', status: 'ready', data: null });
    if (chosen.includes(CORE_LOG_SERIES) && chosen.includes(CORE_SERIES) && coreCol && current.values) out.push({ id: CORE_LOG_SERIES, label: 'Perfil en plugs', kind: 'coreLog', status: 'ready', data: null });
    for (const s of series) {
      if (!chosen.includes(s.id)) continue;
      const k2 = s.ctx && key ? (s.kind === 'well' ? translateKey(ctx, key, s.ctx) : key) : null;
      out.push({ id: s.id, label: s.label, kind: s.kind, status: s.status, data: s.status === 'ready' && s.ctx ? seriesFromContext(s.ctx, k2, { id: s.id, label: s.label, kind: s.kind }) : null });
    }
    if (out.length === 0) out.push({ id: CURRENT_SERIES, label: 'Actual', kind: 'current', status: 'ready', data: current });
    return out;
  }, [chosen, series, current, ctx, key, coreCol]);
  const styles = useMemo(() => seriesStyles(lanes, theme, coreColor), [lanes, theme, coreColor]);

  const allRows = useMemo(() => zoneRows(ctx.well.depth.values, ctx.interpretation.zones), [ctx]);
  const rows = useMemo(() => shownRows(allRows, { reservoirOnly: config.reservoirOnly, hidden: config.hiddenZones }), [allRows, config.reservoirOnly, config.hiddenZones]);
  const legendRows = useMemo(() => (config.reservoirOnly ? allRows.filter((r) => r.kind === 'reservoir') : allRows), [allRows, config.reservoirOnly]);

  const settings = useMemo(() => ({ filter, excludeWashout, mean: stat.mean }), [filter, excludeWashout, stat.mean]);
  // Plugs de corona por zona (peso 1 por plug; bandera de reservorio/pay de la muestra de perfil más cercana).
  const corePart = useMemo(
    () => (coreCol && coreProp && core && lanes.some((l) => l.kind === 'core') ? plugCells(rows, core.plugs, coreCol, coreProp, ctx.well.depth.values, { ...(current.netRes ? { netRes: current.netRes } : {}), ...(current.netPay ? { netPay: current.netPay } : {}) }, filter) : null),
    [coreCol, coreProp, core, lanes, rows, ctx.well.depth.values, current.netRes, current.netPay, filter],
  );
  // Perfil en plugs (D21): la curva actual en la muestra de cada plug, mismas reglas que la corona.
  const coreLogPart = useMemo(
    () =>
      coreCol && coreProp && core && current.values && lanes.some((l) => l.kind === 'coreLog')
        ? plugLogCells(rows, core.plugs, coreCol, coreProp, ctx.well.depth.values, current.values, { ...(current.netRes ? { netRes: current.netRes } : {}), ...(current.netPay ? { netPay: current.netPay } : {}), ...(current.washout ? { washout: current.washout } : {}) }, filter, excludeWashout)
        : null,
    [coreCol, coreProp, core, lanes, rows, ctx.well.depth.values, current, filter, excludeWashout],
  );
  // Celdas: las series sin datos todavía (calculando o con error) quedan como carril vacío.
  const cells = useMemo<DistributionCell[][]>(() => {
    const ready = lanes.filter((l) => l.data);
    const computed = buildCells(rows, ready.map((l) => l.data!), settings);
    return rows.map((_, i) => {
      let j = 0;
      return lanes.map((l): DistributionCell =>
        l.kind === 'core'
          ? (corePart?.cells[i] ?? { stats: null, missing: 'plugs', filtered: 0 })
          : l.kind === 'coreLog'
          ? (coreLogPart?.[i] ?? { stats: null, missing: 'plugs', filtered: 0 })
          : l.data
          ? computed[i]![j++]!
          : { stats: null, missing: 'curve', filtered: 0 },
      );
    });
  }, [rows, lanes, settings, corePart, coreLogPart]);
  // Diferencia de medias corona − perfil en plugs por zona (tooltip de las dos series).
  const plugDiffs = useMemo(() => {
    const kc = lanes.findIndex((l) => l.kind === 'core');
    const kl = lanes.findIndex((l) => l.kind === 'coreLog');
    return rows.map((_, i) => (kc >= 0 && kl >= 0 && coreProp ? plugDiffText(cells[i]?.[kc], cells[i]?.[kl], coreProp, unit) : null));
  }, [lanes, rows, cells, coreProp, unit]);
  const coreNotes = useMemo(() => (coreCol && coreProp ? plugWarnings(coreProp, coreCol, curve?.role ?? null, core?.plugs.phiMatch) : []), [coreCol, coreProp, curve?.role, core]);

  // Vista «Histogramas» (V2): muestras usadas por fila y serie (las mismas de la caja), clases del histograma del dock.
  const samples = useMemo(() => {
    if (view !== 'hist') return null;
    const ready = lanes.filter((l) => l.data);
    const zonesOf = matchZones(rows, ready.map((l) => l.data!));
    return rows.map((_, i) => {
      let j = 0;
      return lanes.map((l, k) => {
        if (l.kind === 'core' || l.kind === 'coreLog') {
          const p = cells[i]?.[k]?.plugs;
          return p ? { xs: p.values, ws: p.values.map(() => 1) } : null;
        }
        if (!l.data) return null;
        const z = zonesOf[i]![j++];
        const inp = inputOf(l.data);
        return z && inp ? usedSamples(inp, settings, z.ranges) : null;
      });
    });
  }, [view, lanes, rows, settings, cells]);
  const pooled = useMemo(() => (samples ? Float64Array.from(samples.flatMap((r) => r.flatMap((x) => x?.xs ?? []))) : null), [samples]);
  // ── cutoff (V2): el real del módulo de cutoffs si el rol lo tiene; si no, una línea libre opcional ────────────────
  const param = cutoffParamFor(curve?.role ?? null);
  const params = ctx.interpretation.params;
  const [preview, setPreview] = useState<CutoffPreview | null>(null);
  // Eje congelado mientras se arrastra un cutoff (incluye a los cutoffs: si no, crecería con la manija).
  const [frozen, setFrozen] = useState<XYAxis | null>(null);
  // `?? {}`: una configuración guardada en memoria antes de la V2 no tiene el campo (las de archivo pasan por el saneado).
  const freeLines = config.cutoffs ?? {};
  const freeStored = !param && key ? freeLines[key] : undefined;
  const freeValue = preview && !param ? preview.value : freeStored;
  const globalCut: ZoneCutoff | null = param ? zoneCutoff(params, param, null, preview) : freeValue !== undefined ? { value: freeValue, own: false, inactive: false, side: 'below' } : null;
  const zoneCuts = useMemo(() => rows.map((r) => (param ? zoneCutoff(params, param, r.id, preview) : globalCut)), [rows, param, params, preview, globalCut?.value]); // eslint-disable-line react-hooks/exhaustive-deps
  const cutValues = useMemo(() => [globalCut?.value ?? NaN, ...zoneCuts.map((c) => c?.value ?? NaN)].filter(Number.isFinite), [globalCut?.value, zoneCuts]);
  const liveAxis = useMemo<XYAxis | null>(
    () => (!curve ? null : view === 'hist' && pooled ? histogramAxis(pooled, stat.scale, curve.short, unit, cutValues) : distributionAxis(cells, stat.scale, curve.short, unit, cutValues)),
    [cells, stat.scale, curve, unit, cutValues, view, pooled],
  );
  const axis = frozen ?? liveAxis;
  // Histogramas por fila: clases sobre el eje compartido, cada serie como fracción de su peso, fila escalada a su pico.
  const hists = useMemo<RowHistScene[] | null>(() => {
    if (!samples || !axis || !pooled) return null;
    const edges = histogramEdges(axis, pooled);
    return samples.map((row) => {
      return { edges, lanes: row.map((x) => (x ? laneHistogram(x.xs, x.ws, edges) : null)) };
    });
  }, [samples, axis, pooled]);

  // Muestras de la serie actual (el cutoff y la selección son del pozo activo).
  const currentInput = useMemo(() => inputOf(current), [current]);
  const depth = ctx.well.depth.values;
  const selection = usePlotSelection(depth);
  // Rango que se está arrastrando (vista previa local; la selección compartida se arma al soltar).
  const [band, setBand] = useState<[number, number] | null>(null);
  const ownRange = selection?.detail.kind === 'range' && selection.detail.curve === key ? ([selection.detail.min, selection.detail.max] as const) : null;
  const shownBand = band ?? ownRange;
  const currentLane = lanes.findIndex((l) => l.id === CURRENT_SERIES);

  // % que pasa, pay neto y % seleccionado por zona; caja de la selección de otra fuente.
  const passBase = passBaseFilter(filter, param);
  // Con Sw los pesos son h·φ (como la caja): el % es de volumen poral, no de espesor.
  const weightText = stat.mean === 'poreVolume' ? 'volumen poral' : 'espesor';
  const passTitle = !param
    ? `${weightText[0]!.toUpperCase()}${weightText.slice(1)} filtrado por debajo de la línea libre`
    : passBase === filter
    ? `${weightText[0]!.toUpperCase()}${weightText.slice(1)} filtrado que pasa el cutoff de la zona`
    : passBase === 'netRes'
    ? `${weightText[0]!.toUpperCase()}${weightText.slice(1)} del reservorio neto que pasa el cutoff (el filtro ya lo aplica)`
    : `${weightText[0]!.toUpperCase()}${weightText.slice(1)} de toda la zona que pasa el cutoff (el filtro ya lo aplica)`;
  const rowCuts = useMemo<(RowCut | null)[]>(() => {
    const base = { ...settings, filter: passBase };
    return rows.map((r, i) => {
      const c = zoneCuts[i];
      if (!c) return null;
      const tone = param ? (c.inactive ? 'inactive' : 'real') : 'free';
      const side = param ? c.side : 'below';
      const pass = currentInput && tone !== 'inactive' ? cutoffPassFraction(currentInput, base, r.ranges, c.value, side).fraction : NaN;
      const sign = side === 'below' ? '≤' : '≥';
      const scopeText = !param ? 'Línea libre' : c.own ? `Cutoff de la zona ${r.name}` : `Cutoff de la zona ${r.name} (sigue al global)`;
      return {
        mark: { value: c.value, tone, side: tone === 'real' ? c.side : null, own: c.own, label: `${scopeText} · ${sign} ${fmt3(c.value)}${tone === 'inactive' ? ' (inactivo: arrastrá para activarlo)' : ''}`, text: fmt3(c.value) },
        pass,
        pay: param ? summaryPay(summary, r.name) : NaN,
      };
    });
  }, [rows, zoneCuts, param, settings, passBase, currentInput, summary]);
  const selFraction = useMemo(() => {
    if (!currentInput) return rows.map(() => NaN);
    if (band) return rows.map((r) => rangeFraction(currentInput, settings, r.ranges, band[0], band[1]).fraction);
    const m = selection?.mask;
    if (!m || m.length !== depth.length) return null;
    return rows.map((r) => maskFraction(currentInput, settings, r.ranges, m).fraction);
  }, [rows, currentInput, settings, band, selection, depth]);
  // Selección de otra fuente (lazo, tramo del visor, clases del histograma, rango de otra propiedad): su caja por zona.
  const selStats = useMemo<(DistributionStats | null)[] | null>(() => {
    const m = selection?.mask;
    if (!m || ownRange || !currentInput || currentLane < 0 || m.length !== depth.length) return null;
    if ((settings.filter === 'netRes' && !currentInput.netRes) || (settings.filter === 'netPay' && !currentInput.netPay) || (settings.mean === 'poreVolume' && !currentInput.phi)) return null;
    return rows.map((r) => {
      const sub = maskedRanges(r.ranges, m);
      return sub.length ? intervalDistribution(currentInput, settings, sub) : null;
    });
  }, [selection, ownRange, currentInput, currentLane, rows, settings, depth]);

  // Una sola serie: cajas con el color de la zona (legible sobre el fondo); varias: el color de cada serie.
  const rowStyles = useMemo(
    () => rows.map((r) => (lanes.length === 1 ? [zoneLaneStyle(r.color, theme)] : styles)),
    [rows, lanes.length, styles, theme],
  );

  // Tramo de cada fila para marcar en el visor: el mismo arreglo mientras no cambien las filas, así mover el puntero
  // dentro de una zona no vuelve a avisar al visor en cada movimiento (`setPlotLink` compara por identidad).
  const rowRuns = useMemo(() => rows.map((r) => [{ top: r.top, base: r.base }]), [rows]);
  const [hover, setHover] = useState(HOVER_NONE);
  useEffect(() => () => setPlotLink({ hoverRuns: null }), []);

  // Figura exportable mientras el panel está a la vista (Exportar → Figuras).
  useEffect(() => {
    if (!axis || rows.length === 0) return;
    const th = XY_FIGURE_THEME;
    const figStyles = rows.map((r) => (lanes.length === 1 ? [zoneLaneStyle(r.color, th)] : seriesStyles(lanes, th, core?.colors.light)));
    const hasCore = lanes.some((l) => l.kind === 'core');
    const glyph =
      view === 'hist'
        ? `Histograma por ${stat.mean === 'poreVolume' ? 'volumen poral' : 'espesor'}, cada serie a su pico · línea: mediana · rombo: ${stat.mean === 'geometric' ? 'media geométrica' : 'media'}`
        : `Caja P25–P75 · línea: mediana · bigotes P10–P90 · rombo: ${MEAN_LABEL[stat.mean].toLowerCase()}`;
    const filterText = FILTER_LABEL[filter].toLowerCase();
    return registerXYFigure({
      id: 'distribuciones-por-zona',
      title: `${view === 'hist' ? 'Histogramas' : 'Distribución'} de ${curve?.short ?? ''} por zona · ${filterText}`,
      x: axis,
      y: { kind: 'linear', min: 0, max: 1, label: 'Zona' },
      points: [
        ...(lanes.length > 1 ? lanes.map((l, k) => ({ id: `s-${l.id}`, name: l.label, x: [], y: [], color: figStyles[0]![k]!.color })) : []),
        { id: 'glyph', name: glyph, x: [], y: [], color: th.color.text },
        ...(hasCore ? [{ id: 'plugs', name: `Corona: un punto por plug (pesos iguales); caja desde ${CORE_MIN_BOX} plugs`, x: [], y: [], color: core?.colors.light ?? th.color.text }] : []),
      ],
      lines: [],
      trends: [],
      guides: [],
      plot: (c, w, h) =>
        drawDistributionFigure(
          c,
          w,
          h,
          {
            axis,
            rows: rows.map((r, i) => {
              const rc = rowCuts[i];
              return {
                name: r.name,
                color: r.color,
                note: zoneNotes(cells[i]?.[0]).map((n) => n.text).join(' · '),
                cutoff: rc ? { value: rc.mark.value, color: rc.mark.tone === 'real' ? th.color.error : rc.mark.tone === 'free' ? th.color.accent : th.color.textSubtle, dashed: rc.mark.tone !== 'real' } : null,
              };
            }),
            cells,
            styles: figStyles,
            hists: view === 'hist' ? hists : null,
          },
          th,
        ),
    });
  }, [axis, rows, cells, lanes, stat.mean, filter, curve?.short, wellName, rowCuts, view, hists, core]);

  // Escape mientras se arrastra un rango: lo descarta (la selección anterior queda).
  const rangeDrag = useRef<{ pointerId: number; x0: number; v0: number; moved: boolean; touch: boolean; row: number } | null>(null);
  useEffect(() => {
    if (!band) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      rangeDrag.current = null;
      setBand(null);
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [band]);

  if (options.length === 0) return <EmptyState size="sm" icon="boxplot" title="Sin curvas" description="El pozo no tiene curvas para graficar." />;

  const setSeries = (id: string) => {
    const on = chosen.includes(id);
    if (on && chosen.length === 1) return;
    let next = on ? chosen.filter((x) => x !== id) : [...chosen, id];
    // La corona se activa con «Perfil en plugs» (su comparación equivalente) y lo arrastra al apagarse.
    if (id === CORE_SERIES) next = on ? next.filter((x) => x !== CORE_LOG_SERIES) : next.includes(CORE_LOG_SERIES) ? next : [...next, CORE_LOG_SERIES];
    onChange({ series: next }, on ? 'Quitar serie de las distribuciones' : 'Agregar serie a las distribuciones');
  };
  const toggleZone = (id: string) => {
    const hidden = config.hiddenZones.includes(id) ? config.hiddenZones.filter((x) => x !== id) : [...config.hiddenZones, id];
    onChange({ hiddenZones: hidden }, 'Mostrar u ocultar zonas en las distribuciones');
  };
  const goTo = (r: ZoneRow) => onGoTo(r.top, r.base);
  const fileBase = `${wellName}_distribuciones_${curve?.short ?? 'propiedad'}`;
  const exportStats = () =>
    onDownload(`${fileBase}.csv`, statsCsv(rows, lanes, cells, { property: curve?.short ?? '', unit: unit ?? '', filter, excludeWashout, mean: stat.mean }));
  const exportTops = () => onDownload(`${wellName}_topes.csv`, topsCsv(allRows));

  /** Cutoff movido desde una manija: el real va a los parámetros (zona o global), la línea libre a la configuración. */
  const onCut = (zoneId: string | null, value: number, phase: GuidePhase) => {
    if (phase === 'preview') setFrozen((f) => f ?? axis);
    else setFrozen(null);
    if (param) {
      setPreview(phase === 'preview' ? { zoneId, value } : null);
      onParamCutoff(param, zoneId, value, phase);
      return;
    }
    if (!key) return;
    if (phase === 'preview') setPreview({ zoneId: null, value });
    else {
      setPreview(null);
      if (phase === 'commit' && value !== freeLines[key]) onChange({ cutoffs: { ...freeLines, [key]: value } }, 'Mover la línea libre de las distribuciones');
    }
  };
  const addFreeLine = () => {
    if (!key || !axis) return;
    const p50 = cells.map((row) => row[0]?.stats?.p50).find((v) => v !== undefined && Number.isFinite(v));
    const v = p50 ?? (axis.min + axis.max) / 2;
    onChange({ cutoffs: { ...freeLines, [key]: +v.toPrecision(3) } }, 'Agregar línea libre a las distribuciones');
  };
  const removeFreeLine = () => {
    if (!key) return;
    const { [key]: _gone, ...rest } = freeLines;
    onChange({ cutoffs: rest }, 'Quitar la línea libre de las distribuciones');
  };

  /** Selección por rango: las muestras usadas de las zonas visibles con valor en [a, b]. */
  const commitRange = (a: number, b: number) => {
    if (!currentInput || !curve || !key || !(Math.abs(b - a) > 0)) return;
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    const mask = rangeMask(depth.length, currentInput, settings, rows.flatMap((r) => r.ranges), lo, hi);
    const sel = makeSelection('distribution', depth, mask, { kind: 'range', curve: key, curveLabel: curve.short, min: lo, max: hi });
    if (sel) setPlotSelection(sel);
    else clearPlotSelection();
  };
  /** Gestos sobre una fila: arrastre horizontal = rango; clic sin arrastre = ir a la zona en el visor. */
  const gesture = {
    down(e: ReactPointerEvent<HTMLCanvasElement>, i: number) {
      if (e.button !== 0 || !axis) return;
      const r = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - r.left;
      rangeDrag.current = { pointerId: e.pointerId, x0: x, v0: laneValue(axis, r.width, x, ui), moved: false, touch: e.pointerType === 'touch', row: i };
      capture(e.currentTarget, e.pointerId);
    },
    /** true si el puntero está arrastrando un rango (no hay tooltip). */
    move(e: ReactPointerEvent<HTMLCanvasElement>): boolean {
      const d = rangeDrag.current;
      if (!d || d.pointerId !== e.pointerId || !axis) return false;
      const r = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - r.left;
      if (!d.moved && Math.abs(x - d.x0) > (d.touch ? DRAG_PX.touch : DRAG_PX.mouse)) d.moved = true;
      if (d.moved) setBand([d.v0, laneValue(axis, r.width, x, ui)]);
      return d.moved;
    },
    up(e: ReactPointerEvent<HTMLCanvasElement>) {
      const d = rangeDrag.current;
      if (!d || d.pointerId !== e.pointerId) return;
      rangeDrag.current = null;
      if (!d.moved) {
        const r = rows[d.row];
        if (r) goTo(r);
        return;
      }
      const rect = e.currentTarget.getBoundingClientRect();
      if (axis) commitRange(d.v0, laneValue(axis, rect.width, e.clientX - rect.left, ui));
      setBand(null);
    },
    cancel() {
      rangeDrag.current = null;
      setBand(null);
    },
  };

  const noZones = allRows.length === 0;
  const pending = lanes.filter((l) => l.status === 'pending').length;
  const allSeries: DistributionSeriesItem[] = [
    { id: CURRENT_SERIES, label: 'Actual', kind: 'current', status: 'ready' },
    ...(coreCol ? [{ id: CORE_SERIES, label: 'Corona', kind: 'core' as const, status: 'ready' as const, detail: `${core!.plugs.ids.length} plugs` }] : []),
    ...(coreCol && chosen.includes(CORE_SERIES) && current.values ? [{ id: CORE_LOG_SERIES, label: 'Perfil en plugs', kind: 'coreLog' as const, status: 'ready' as const, detail: 'la curva actual en la muestra de cada plug' }] : []),
    ...series,
  ];
  const coreOn = lanes.some((l) => l.kind === 'core');
  const showVolume = config.volume === true && !!volume && volume.fluids.length > 0 && lanes.some((l) => l.id === CURRENT_SERIES);
  const volMax = (f: VolumeFluid) => (volume ? volumeMax(volume, f, rows.map((r) => r.id)) : NaN);
  const styleOf = (id: string) => {
    const k = lanes.findIndex((l) => l.id === id);
    return k >= 0 ? styles[k] : undefined;
  };

  return (
    <div className="zdist-host">
      <div className="zdist" data-testid="zone-distribution-panel">
        <div className="zdist__side">
          <ControlGroup title="Propiedad">
            <CurveSelect label="Propiedad" value={key} options={options} onChange={(v) => onChange({ curve: v }, 'Cambiar la propiedad de las distribuciones')} />
            <p className="plot-hint">
              {MEAN_LABEL[stat.mean]}
              {stat.scale === 'log' ? ' · eje logarítmico' : ''}
              {stat.fallback ? ' (falta φe para ponderar por volumen poral)' : ''}
            </p>
          </ControlGroup>
          <ControlGroup title="Vista">
            <SegmentedControl
              size="sm"
              block
              aria-label="Vista de las distribuciones"
              value={view}
              onChange={(v) => onChange({ view: v }, v === 'hist' ? 'Ver histogramas por zona' : 'Ver cajas por zona')}
              options={[
                { value: 'box', label: 'Cajas', title: 'Boxplot por zona: P10–P90, P25–P75, mediana y media' },
                { value: 'hist', label: 'Histogramas', title: 'Histograma ponderado por zona sobre el mismo eje, cada serie escalada a su pico' },
              ]}
            />
            <Checkbox
              checked={config.volume === true}
              disabled={!volume || volume.fluids.length === 0}
              onChange={(on) => onChange({ volume: on }, on ? 'Mostrar el volumen in situ por zona' : 'Ocultar el volumen in situ por zona')}
              label="Volumen in situ por zona"
              description={
                !volume
                  ? 'Todavía no hay resultado del volumen in situ.'
                  : volume.fluids.length === 0
                  ? 'Ninguna zona tiene petróleo o gas elegido (módulo de volumen in situ).'
                  : `Determinista y P90–P10 de la incertidumbre, en ${volume.fluids.map((f) => VOLUME_UNIT[f]).join(' y ')}. Solo de la interpretación actual.`
              }
            />
          </ControlGroup>
          <ControlGroup title="Muestras">
            <SegmentedControl
              size="sm"
              block
              aria-label="Qué muestras entran"
              value={filter}
              onChange={(v) => onChange({ filter: v }, 'Cambiar el filtro de las distribuciones')}
              options={[
                { value: 'all', label: 'Zona', title: 'Todas las muestras de la zona' },
                { value: 'netRes', label: 'Reservorio', title: avail.netRes ? 'Solo reservorio neto (cutoffs de Vsh y φ)' : 'Falta la bandera de reservorio neto (módulo de cutoffs)', disabled: !avail.netRes },
                { value: 'netPay', label: 'Pay', title: avail.netPay ? 'Solo pay neto (además Sw)' : 'Falta la bandera de pay neto (módulo de cutoffs)', disabled: !avail.netPay },
              ]}
            />
            <Checkbox checked={config.reservoirOnly} onChange={(on) => onChange({ reservoirOnly: on }, on ? 'Solo zonas de reservorio' : 'Todas las zonas')} label="Solo zonas de reservorio" />
            <Checkbox
              checked={excludeWashout}
              disabled={!avail.washout}
              onChange={(on) => onChange({ excludeWashout: on }, on ? 'Excluir derrumbe' : 'Incluir derrumbe')}
              label="Excluir derrumbe"
              description={avail.washout ? 'Muestras con el indicador de derrumbe. Activado, las medias dejan de coincidir con el sumario por zona.' : 'No hay indicador de derrumbe calculado'}
            />
          </ControlGroup>
          <ControlGroup title="Series">
            <div className="plot-chips" role="group" aria-label="Series a comparar" data-testid="zdist-series">
              {allSeries.map((s) => {
                const on = chosen.includes(s.id);
                const st = s.id === CURRENT_SERIES ? undefined : series.find((x) => x.id === s.id);
                const col = styleOf(s.id)?.color;
                return (
                  <Chip
                    key={s.id}
                    {...(on && col ? { color: col } : {})}
                    selected={on}
                    title={st?.status === 'error' ? `${s.label}: ${st.message ?? 'no se pudo calcular'}` : `${on ? 'Quitar' : 'Comparar'} ${s.label}${s.detail ? ` (${s.detail})` : ''}`}
                    onClick={() => setSeries(s.id)}
                  >
                    {s.label}
                    {on && st?.status === 'pending' && <Spinner size={10} label="Calculando" />}
                    {on && st?.status === 'error' && <span className="zdist-chip-err">!</span>}
                  </Chip>
                );
              })}
            </div>
            {coreOn && (
              <p className="plot-hint" data-testid="zdist-core-hint">
                Corona: un punto por plug en su zona (profundidad corrida); caja desde {CORE_MIN_BOX} plugs, pesos iguales, media {stat.mean === 'geometric' ? 'geométrica' : 'aritmética'}. El filtro usa la bandera de la muestra de perfil más cercana (hasta un paso de muestreo). «Perfil en plugs» es la curva actual en esas mismas muestras: compará la corona con esa caja, no con la de toda la zona (que suma tramos sin cortar).
                {corePart && corePart.outside > 0 ? ` ${corePart.outside} ${corePart.outside === 1 ? 'plug queda' : 'plugs quedan'} fuera del perfil.` : ''}
              </p>
            )}
            {coreOn && coreNotes.some((n) => n.tone === 'warn') && (
              <p className="plot-hint zdist-warn">{coreNotes.filter((n) => n.tone === 'warn').map((n) => n.text).join(' · ')}</p>
            )}
            {!coreCol && core && coreProp === null && <p className="plot-hint">La corona se compara con φ, k o densidad de matriz (PHIE/PHIT, PERM, RHOMAA).</p>}
            {series.length === 0 && !core ? (
              <p className="plot-hint">Guardá un snapshot (o cargá otro pozo o la corona) para comparar distribuciones.</p>
            ) : series.some((s) => s.kind === 'well' && chosen.includes(s.id)) ? (
              <p className="plot-hint">Otros pozos: zonas emparejadas por nombre; borde punteado.</p>
            ) : null}
          </ControlGroup>
          <ControlGroup title="Cutoff">
            {param && globalCut ? (
              <>
                <div className="plot-row">
                  <span className={`plot-cut-swatch${globalCut.inactive ? '' : ' is-real'}`} aria-hidden="true" />
                  <span className="plot-row__label num" data-testid="zdist-cut-text">
                    Global {globalCut.side === 'below' ? '≤' : '≥'} {fmt3(globalCut.value)}
                    {zoneCuts.some((c) => c?.own) ? ` · ${zoneCuts.filter((c) => c?.own).length} ${zoneCuts.filter((c) => c?.own).length === 1 ? 'zona con valor propio' : 'zonas con valor propio'}` : ''}
                  </span>
                </div>
                <p className="plot-hint">
                  {globalCut.inactive
                    ? 'El corte de permeabilidad está desactivado: arrastrar su manija lo activa y recalcula el reservorio y el pay.'
                    : 'Es el cutoff del módulo de cutoffs. La manija del eje mueve el global; la marca de cada zona, el de esa zona. Recalcula reservorio, pay y sumario.'}{' '}
                  {`El % que pasa es del ${weightText} ${passBase === filter ? 'filtrado' : passBase === 'netRes' ? 'del reservorio neto (el filtro ya aplica este cutoff)' : 'de toda la zona (el filtro ya aplica este cutoff)'}.`}
                </p>
              </>
            ) : freeStored !== undefined ? (
              <>
                <div className="plot-row">
                  <span className="plot-cut-swatch" aria-hidden="true" />
                  <span className="plot-row__label num">Línea libre ≤ {fmt3(freeValue ?? freeStored)}</span>
                  <IconButton size="sm" icon="trash" label="Quitar la línea libre" onClick={removeFreeLine} />
                </div>
                <p className="plot-hint">No cambia la petrofísica. El % es del espesor filtrado por debajo de la línea.</p>
              </>
            ) : (
              <>
                <Button size="sm" icon="plus" disabled={!axis || !key} onClick={addFreeLine}>
                  Agregar línea libre
                </Button>
                <p className="plot-hint">{curve ? `${curve.short} no tiene cutoff en el módulo de cutoffs (solo Vsh, φe, Sw y k).` : ''}</p>
              </>
            )}
          </ControlGroup>
          <ControlGroup title="Selección">
            <p className="plot-hint">Arrastrá sobre las cajas para elegir un rango: se marca en el visor y en los demás gráficos. Clic en una caja: el visor va a la zona. Esc quita la selección.</p>
          </ControlGroup>
          <ControlGroup title="Exportar">
            <div className="zdist-actions">
              <Button size="sm" icon="download" variant="secondary" disabled={!axis} onClick={exportStats}>
                Estadísticas
              </Button>
              <Button size="sm" icon="download" variant="secondary" disabled={noZones} onClick={exportTops}>
                Topes
              </Button>
            </div>
            <p className="plot-hint">CSV. La figura PNG está en Exportar → Figuras.</p>
          </ControlGroup>
        </div>

        <div className="zdist__main">
          {usesOnlyDefaults(ctx.interpretation.params) && (
            <Callout tone="info" className="zdist-note">
              La interpretación usa todos los parámetros por defecto.
            </Callout>
          )}
          {noZones ? (
            <EmptyState size="sm" icon="boxplot" title="Sin zonas" description="Definí zonas (paso Zonas) para ver la distribución de la propiedad en cada una." />
          ) : !curve ? (
            <EmptyState size="sm" icon="boxplot" title="Elegí una propiedad" description="La propiedad elegida ya no está en el pozo o todavía se está calculando." />
          ) : (
            <>
              <div className="zdist-head">
                <div className="plot-chips zdist-zones" role="group" aria-label="Zonas visibles" data-testid="zdist-zone-legend">
                  {legendRows.map((r) => {
                    const on = !config.hiddenZones.includes(r.id);
                    return (
                      <Chip key={r.id} color={r.color} selected={on} title={on ? `Ocultar la zona ${r.name}` : `Mostrar la zona ${r.name}`} onClick={() => toggleZone(r.id)}>
                        {r.name}
                      </Chip>
                    );
                  })}
                </div>
                <ul className="zdist-key" aria-label={view === 'hist' ? 'Cómo leer los histogramas' : 'Cómo leer las cajas'}>
                  {view === 'hist' ? (
                    <>
                      <li title="Peso por clase (espesor; volumen poral para Sw; un plug = 1), como fracción de cada serie y escalado a su pico: se comparan formas, no alturas">
                        <span className="zdist-glyph zdist-glyph--hist" aria-hidden="true" />
                        {stat.mean === 'poreVolume' ? 'Por volumen poral' : 'Por espesor'} · escalado al pico
                      </li>
                      <li>
                        <span className="zdist-glyph zdist-glyph--median" aria-hidden="true" />
                        Mediana
                      </li>
                    </>
                  ) : (
                    <>
                      <li>
                        <span className="zdist-glyph zdist-glyph--box" aria-hidden="true" />
                        P25–P75 · mediana
                      </li>
                      <li>
                        <span className="zdist-glyph zdist-glyph--whisker" aria-hidden="true" />
                        P10–P90
                      </li>
                    </>
                  )}
                  {coreOn && (
                    <li>
                      <span className="zdist-glyph zdist-glyph--plug" style={{ ['--plug' as string]: coreColor }} aria-hidden="true" />
                      Plug
                    </li>
                  )}
                  <li>
                    <span className="zdist-glyph zdist-glyph--mean" aria-hidden="true" />
                    {stat.mean === 'geometric' ? 'Media geométrica' : 'Media'}
                  </li>
                  {pending > 0 && (
                    <li role="status">
                      <Spinner size={12} />
                      Calculando {pending === 1 ? 'una serie' : `${pending} series`}…
                    </li>
                  )}
                </ul>
              </div>
              {selection && (
                <div className="plot-selection zdist-selection" data-testid="zdist-selection">
                  <span className="plot-selection__title">{selectionTitle(selection, (d) => formatNumber(d, { digits: 1 }))}</span>
                  <span className="plot-muted num">
                    {formatNumber(selection.count, { digits: 0 })} muestras · {selection.runs.length} {selection.runs.length === 1 ? 'tramo' : 'tramos'} en el visor
                    {selStats ? ' · barra fina: su distribución en cada zona' : ''}
                  </span>
                  <Button size="sm" variant="ghost" icon="x" onClick={clearPlotSelection} title="Quitar la selección (Esc)">
                    Quitar selección
                  </Button>
                </div>
              )}
              {showVolume && volume && <VolumeStatus volume={volume} onOpenUncertainty={onOpenUncertainty} />}
              {rows.length === 0 ? (
                <EmptyState size="sm" icon="boxplot" title="Ninguna zona a la vista" description={config.reservoirOnly ? 'No hay zonas de tipo reservorio visibles. Cambiá el tipo en el paso Zonas o desmarcá «Solo zonas de reservorio».' : 'Tocá una zona en la leyenda para mostrarla.'} />
              ) : !axis ? (
                <EmptyState size="sm" icon="boxplot" title="Sin datos para graficar" description={`${curve.short} no tiene valores en las zonas visibles con el filtro «${FILTER_LABEL[filter]}».`} />
              ) : (
                <div className={`zdist-plot${band ? ' is-banding' : ''}${showVolume ? ' has-volume' : ''}`} data-view={view} data-testid="zdist-plot" style={{ ['--zd-pad' as string]: `${scalePx(DIST_METRICS.padX, ui)}px` }} onPointerLeave={() => setPlotLink({ hoverRuns: null })}>
                  <div className="zdist-axis-label">
                    <span className="zdist-axis-title">{unit ? `${curve.short} (${unit})` : curve.short}</span>
                    <span className="zdist-axis-filter">{FILTER_LABEL[filter]}</span>
                  </div>
                  <div className="zdist-axis">
                    <AxisCanvas axis={axis} ui={ui} />
                    <div className="zdist-marks">
                      {shownBand && <Band axis={axis} range={shownBand} className="is-axis" />}
                      {globalCut && (
                        <CutGrip
                          axis={axis}
                          param={param}
                          variant="axis"
                          ui={ui}
                          data-testid="zdist-cut-global"
                          mark={{
                            value: globalCut.value,
                            tone: !param ? 'free' : globalCut.inactive ? 'inactive' : 'real',
                            label: `${param ? 'Cutoff global' : 'Línea libre'} · ${globalCut.side === 'below' ? '≤' : '≥'} ${fmt3(globalCut.value)}${globalCut.inactive ? ' (inactivo: arrastrá para activarlo)' : ''}`,
                            text: fmt3(globalCut.value),
                          }}
                          onChange={(v, phase) => onCut(null, v, phase)}
                        />
                      )}
                    </div>
                  </div>
                  {showVolume && volume && (
                    <div className="zdist-vol-head" aria-hidden="true">
                      <span className="zdist-axis-title">In situ</span>
                      <span className="zdist-axis-filter">{volume.fluids.map((f) => VOLUME_UNIT[f]).join(' · ')}</span>
                    </div>
                  )}
                  {rows.map((r, i) => (
                    <ZoneRowView
                      key={r.id}
                      row={r}
                      cells={cells[i]!}
                      styles={rowStyles[i]!}
                      axis={axis}
                      labels={lanes.map((l) => (lanes.length > 1 ? l.label : ''))}
                      laneNames={lanes.map((l) => l.label)}
                      view={view}
                      hist={hists?.[i] ?? null}
                      coreNotes={coreNotes.map((n) => n.text)}
                      plugDiff={plugDiffs[i] ?? null}
                      weightText={weightText}
                      volume={showVolume && volume ? <VolumeCell zone={r} volume={volume} max={volMax} /> : null}
                      mean={stat.mean}
                      unit={unit}
                      ui={ui}
                      hover={hover.zone === i ? hover : null}
                      onHover={(h) => {
                        setHover(h ? { zone: i, ...h } : HOVER_NONE);
                        setPlotLink({ hoverRuns: h ? rowRuns[i]! : null });
                      }}
                      onGo={() => goTo(r)}
                      cut={rowCuts[i] ?? null}
                      param={param}
                      passTitle={passTitle}
                      band={shownBand}
                      selFraction={selFraction?.[i] ?? NaN}
                      selection={selStats?.[i] && currentLane >= 0 ? { lane: currentLane, stats: selStats[i]!, color: theme.color.accent } : null}
                      gesture={gesture}
                      index={i}
                      onCut={(v, phase) => onCut(r.id, v, phase)}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function AxisCanvas({ axis, ui }: { axis: XYAxis; ui: number }) {
  const ref = useCanvas((c, { width, height }, theme, u) => drawDistAxis(c, width, height, axis, theme, u), [axis]);
  return <canvas ref={ref} className="zdist-axis__canvas" style={{ height: rowAxisHeight(ui) }} aria-hidden="true" />;
}

const rowAxisHeight = (ui: number) => Math.round(DIST_METRICS.axis * ui);

interface ZoneRowViewProps {
  row: ZoneRow;
  cells: readonly DistributionCell[];
  styles: readonly LaneStyle[];
  axis: XYAxis;
  labels: readonly string[];
  mean: DistributionMean;
  unit: string | undefined;
  ui: number;
  hover: Hover | null;
  onHover(h: Hover | null): void;
  onGo(): void;
  /** Cutoff de la zona (null: la propiedad no tiene). */
  cut: RowCut | null;
  param: CutoffParamKey | null;
  /** Sobre qué se mide el % que pasa (tooltip). */
  passTitle: string;
  /** Rango seleccionado (o que se arrastra) sobre esta propiedad. */
  band: readonly [number, number] | null;
  /** Fracción del espesor filtrado de la zona en la selección (NaN sin selección). */
  selFraction: number;
  /** Caja fina de la selección de otra fuente. */
  selection: { lane: number; stats: DistributionStats; color: string } | null;
  gesture: {
    down(e: ReactPointerEvent<HTMLCanvasElement>, i: number): void;
    move(e: ReactPointerEvent<HTMLCanvasElement>): boolean;
    up(e: ReactPointerEvent<HTMLCanvasElement>): void;
    cancel(): void;
  };
  index: number;
  onCut(value: number, phase: GuidePhase): void;
  /** Nombre de cada serie (tooltip de los histogramas). */
  laneNames: readonly string[];
  view: 'box' | 'hist';
  /** Histogramas de la fila (vista «Histogramas»). */
  hist: RowHistScene | null;
  /** Avisos de la serie de corona (unidad, base de φ) para su tooltip. */
  coreNotes: readonly string[];
  /** «Corona − perfil en plugs: +0,012 v/v» de la zona (tooltip de las dos series), o null. */
  plugDiff: string | null;
  /** «espesor» o «volumen poral» (tooltip de los histogramas). */
  weightText: string;
  /** Franja del volumen in situ de la zona (o null). */
  volume: ReactNode;
}

function ZoneRowView({ row, cells, styles, axis, labels, mean, unit, ui, hover, onHover, onGo, cut, param, passTitle, band, selFraction, selection, gesture, index, onCut, laneNames, view, hist, coreNotes, plugDiff, weightText, volume }: ZoneRowViewProps) {
  const lane = hover?.lane ?? -1;
  const ref = useCanvas(
    (c, { width, height }, theme, u) => drawZoneRow(c, width, height, { axis, cells, styles, selection, ...(lane >= 0 && view === 'box' ? { hover: lane } : {}), ...(view === 'hist' && hist ? { hist } : {}) }, theme, u),
    [axis, cells, styles, lane, selection?.stats, selection?.color, selection?.lane, view, hist],
  );
  const notes = zoneNotes(cells[0]);
  // n de plugs de la zona a la vista (no solo en el tooltip) cuando la corona no es la primera serie.
  const coreCell = cells.findIndex((c, k) => k > 0 && c.plugs?.source === 'core');
  if (coreCell > 0) notes.push({ text: `corona: ${plugCountText(cells[coreCell]!)}`, tone: (cells[coreCell]!.stats?.n ?? 0) > 0 && cells[coreCell]!.stats!.n < CORE_MIN_BOX ? 'warn' : 'muted' });
  const height = rowHeight(cells.length, ui, view);
  const move = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const k = laneAt(e.clientY - rect.top, cells.length, ui, view);
    onHover(k >= 0 ? { lane: k, x: e.clientX - rect.left, y: e.clientY - rect.top, width: rect.width } : null);
  };
  const tip = !hover || hover.lane < 0
    ? null
    : view === 'hist' && hist
    ? [
        ...histTooltip(
          row.name,
          laneValue(axis, hover.width, hover.x, ui),
          hist.edges,
          cells.map((c, k) => ({ label: laneNames[k] ?? '', hist: hist.lanes[k] ?? null, stats: c.stats, plugs: !!c.plugs })),
          weightText,
          unit,
        ),
        ...(plugDiff ? [plugDiff] : []),
      ]
    : cells[hover.lane]
    ? cellTooltip(row.name, labels[hover.lane] ?? '', cells[hover.lane]!, mean, unit, [...(plugDiff && cells[hover.lane]!.plugs ? [plugDiff] : []), ...(cells[hover.lane]!.plugs?.source === 'core' ? coreNotes : [])])
    : null;
  const showPass = !!cut && cut.mark.tone !== 'inactive' && Number.isFinite(cut.pass);
  const showPay = !!cut && Number.isFinite(cut.pay);
  const showSel = Number.isFinite(selFraction);
  const first = cells[0]?.stats;
  const summary = first && first.n > 0 ? `P10 ${formatNumber(first.p10, { significant: 3 })}, P50 ${formatNumber(first.p50, { significant: 3 })}, P90 ${formatNumber(first.p90, { significant: 3 })}` : 'sin dato';
  return (
    <>
      <div className="zdist-label" style={{ ['--zone' as string]: row.color }}>
        <button type="button" className="zdist-label__name" onClick={onGo} title={`Ir a la zona ${row.name} en el visor`} data-testid={`zdist-zone-${row.name}`}>
          <span className="zdist-label__text">{row.name}</span>
          {row.kind !== 'formation' && <span className="zdist-label__kind">{ZONE_KIND_LABEL[row.kind].toLowerCase()}</span>}
        </button>
        {notes.length > 0 && (
          <span className="zdist-label__notes num">
            {notes.map((n, j) => (
              <span key={j} className={n.tone === 'warn' ? 'is-warn' : undefined}>
                {n.text}
              </span>
            ))}
          </span>
        )}
        {(showPass || showPay || showSel || cut?.mark.own) && (
          <span className="zdist-label__notes zdist-label__cut num">
            {showPass && (
              <span className="is-pass" title={passTitle} data-testid={`zdist-pass-${row.name}`}>
                {cut!.mark.tone === 'free' ? `≤ línea ${pctText(cut!.pass)} %` : `pasa ${pctText(cut!.pass)} %`}
              </span>
            )}
            {cut?.mark.own && (
              <span title="Esta zona tiene su propio cutoff">
                propio {cut.mark.side === 'below' ? '≤' : cut.mark.side === 'above' ? '≥' : ''} {cut.mark.text}
              </span>
            )}
            {showPay && (
              <span title="Pay neto del sumario por zona (se actualiza cuando el motor recalcula)" data-testid={`zdist-pay-${row.name}`}>
                pay {formatNumber(cut!.pay, { digits: 1 })} m
              </span>
            )}
            {showSel && (
              <span className={selFraction > 0 ? 'is-sel' : undefined} title="Espesor filtrado de la zona dentro de la selección" data-testid={`zdist-sel-${row.name}`}>
                sel. {pctText(selFraction)} %
              </span>
            )}
          </span>
        )}
      </div>
      <div className="zdist-cell" style={{ ['--zone' as string]: row.color }}>
        <canvas
          ref={ref}
          className="zdist-row"
          style={{ height }}
          role="img"
          aria-label={`Zona ${row.name}: ${summary}`}
          onPointerDown={(e) => gesture.down(e, index)}
          onPointerMove={(e) => {
            if (gesture.move(e)) onHover(null);
            else move(e);
          }}
          onPointerUp={(e) => gesture.up(e)}
          onPointerCancel={() => gesture.cancel()}
          onPointerLeave={() => onHover(null)}
        />
        <div className="zdist-marks">
          {band && <Band axis={axis} range={band} />}
          {cut && <CutLine axis={axis} mark={cut.mark} />}
          {cut && param && <CutGrip axis={axis} param={param} mark={cut.mark} ui={ui} variant="row" onChange={onCut} data-testid={`zdist-cut-${row.name}`} />}
        </div>
        {tip && hover && (
          <div className={`xy-plot__tip${hover.x > hover.width / 2 ? ' is-left' : ''}`} style={{ left: hover.x, top: hover.y }} role="tooltip">
            {tip.join('\n')}
          </div>
        )}
      </div>
      {volume}
    </>
  );
}

/** Estado del volumen arriba del gráfico: totales por fluido, si la incertidumbre está calculada y el enlace para hacerlo. */
function VolumeStatus({ volume, onOpenUncertainty }: { volume: VolumeData; onOpenUncertainty: (() => void) | undefined }) {
  return (
    <div className="zdist-vol-status" data-testid="zdist-volume-status">
      <span className="zdist-vol-status__totals num">
        {volume.fluids.map((f) => {
          const t = volume.total[f];
          return (
            <span key={f}>
              {VOLUME_LABEL[f]} <strong>{volumeText(t?.det)}</strong> {VOLUME_UNIT[f]}
              {hasRange(t) && (
                <span className="plot-muted">
                  {' '}
                  (P90–P10 {volumeText(t.p90)}–{volumeText(t.p10)})
                </span>
              )}
            </span>
          );
        })}
      </span>
      <span className="zdist-vol-status__key">
        <span className="zdist-vol-glyph zdist-vol-glyph--det" aria-hidden="true" />
        determinista
        {volume.uncertainty !== 'none' && (
          <>
            <span className={`zdist-vol-glyph zdist-vol-glyph--range${volume.uncertainty === 'stale' ? ' is-stale' : ''}`} aria-hidden="true" />
            P90–P10 · P50
          </>
        )}
      </span>
      {volume.uncertainty === 'none' ? (
        onOpenUncertainty && (
          <Button size="sm" variant="ghost" icon="activity" onClick={onOpenUncertainty} data-testid="zdist-open-uncertainty" title="Abre el módulo de incertidumbre: la simulación se corre desde allí">
            Calcular incertidumbre
          </Button>
        )
      ) : volume.uncertainty === 'stale' ? (
        <span className="zdist-vol-status__stale">
          Incertidumbre desactualizada
          {onOpenUncertainty && (
            <Button size="sm" variant="ghost" icon="refresh" onClick={onOpenUncertainty} data-testid="zdist-open-uncertainty">
              Recalcular
            </Button>
          )}
        </span>
      ) : null}
    </div>
  );
}

/** Volumen de una zona: punto del determinista y, si hay incertidumbre, barra P90–P10 con marca en P50. */
function VolumeCell({ zone, volume, max }: { zone: ZoneRow; volume: VolumeData; max(f: VolumeFluid): number }) {
  const z = volume.byZone[zone.id];
  const fluids = volume.fluids.filter((f) => z?.[f]);
  return (
    <div className="zdist-vol" style={{ ['--zone' as string]: zone.color }} data-testid={`zdist-vol-${zone.name}`}>
      {fluids.length === 0 ? (
        <span className="zdist-vol__none">{z?.note ?? 'sin volumen'}</span>
      ) : (
        fluids.map((f) => {
          const v = z![f]!;
          const m = max(f);
          const at = (x: number | undefined) => `${(volumeFraction(x, m) * 100).toFixed(2)}%`;
          const range = hasRange(v);
          return (
            <div key={f} className={`zdist-vol__lane${volume.uncertainty === 'stale' ? ' is-stale' : ''}`} title={volumeTitle(zone.name, f, v, volume.uncertainty)}>
              <span className="zdist-vol__track">
                {range && <span className="zdist-vol__bar" style={{ left: at(v.p90), width: `${((volumeFraction(v.p10, m) - volumeFraction(v.p90, m)) * 100).toFixed(2)}%` }} />}
                {range && Number.isFinite(v.p50) && <span className="zdist-vol__p50" style={{ left: at(v.p50) }} />}
                {Number.isFinite(v.det) && <span className="zdist-vol__det" style={{ left: at(v.det) }} />}
              </span>
              <span className="zdist-vol__value num">
                {volumeText(v.det)}
                <span className="zdist-vol__unit"> {VOLUME_UNIT[f]}</span>
              </span>
            </div>
          );
        })
      )}
    </div>
  );
}
