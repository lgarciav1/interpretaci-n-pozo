/**
 * Panel «Distribuciones por zona» (docs/decisiones/0066): boxplots por zona de una propiedad, una caja por serie
 * (interpretación actual, snapshots, otros pozos con zonas emparejadas por nombre). Filas en orden de profundidad con
 * el color de la zona, eje compartido arriba (log para k), avisos concretos por zona, leyenda de zonas clicable,
 * clic en una caja o en el nombre → el visor va a la zona, exportación a CSV y figura PNG.
 *
 * Presentación: no conoce los stores. Lo conecta `src/modules/zone-distribution/dock.tsx`. Pensado primero para un
 * contenedor angosto (nombre de la zona arriba de su fila); con ancho, nombres a la izquierda y controles al costado.
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { DistributionConfig } from '../../core/plots';
import { intervalDistribution, type DistributionInput, type DistributionMean, type DistributionStats } from '../../petro/distribution';
import { useCanvas } from '../../ui/canvas';
import { CATEGORICAL } from '../../ui/curves';
import { Button, Callout, Checkbox, Chip, EmptyState, IconButton, SegmentedControl, Spinner, formatNumber, useThemeTokens, useUiScaleFactor, type ThemeTokens } from '../../ui';
import { scalePx } from '../../ui/tokens';
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
  MEAN_LABEL,
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
import { DIST_METRICS, drawDistAxis, drawDistributionFigure, drawZoneRow, laneAt, laneValue, rowHeight, zoneLaneStyle, type LaneStyle } from './draw';
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
}

/** Estilo de cada serie: «Actual» con el acento; snapshots y pozos con la paleta categórica (pozos con borde punteado). */
function seriesStyles(items: readonly { id: string; kind: SeriesKind }[], theme: ThemeTokens): LaneStyle[] {
  const pal = CATEGORICAL[theme.name];
  let k = 1;
  return items.map((s) => (s.kind === 'current' ? { color: theme.color.accent } : { color: pal[k++ % pal.length]!, dashed: s.kind === 'well' }));
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

export function DistributionPanel({ ctx, wellName, config, onChange, series, onGoTo, onDownload, onParamCutoff, summary }: DistributionPanelProps) {
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

  // Series elegidas, en el orden de las candidatas («Actual» primero).
  // Sin las que ya no existen (snapshot borrado, pozo quitado): si no, quitar «Actual» con una sola serie viva dejaría
  // la lista sin series reales y el panel mostraría «Actual» con su chip apagado.
  const chosen = useMemo(() => {
    const alive = config.series.filter((id) => id === CURRENT_SERIES || series.some((s) => s.id === id));
    return alive.length ? alive : [CURRENT_SERIES];
  }, [config.series, series]);
  const lanes = useMemo(() => {
    const out: { id: string; label: string; kind: SeriesKind; status: DistributionSeriesItem['status']; data: SeriesData | null }[] = [];
    if (chosen.includes(CURRENT_SERIES)) out.push({ id: CURRENT_SERIES, label: 'Actual', kind: 'current', status: 'ready', data: current });
    for (const s of series) {
      if (!chosen.includes(s.id)) continue;
      const k2 = s.ctx && key ? (s.kind === 'well' ? translateKey(ctx, key, s.ctx) : key) : null;
      out.push({ id: s.id, label: s.label, kind: s.kind, status: s.status, data: s.status === 'ready' && s.ctx ? seriesFromContext(s.ctx, k2, { id: s.id, label: s.label, kind: s.kind }) : null });
    }
    if (out.length === 0) out.push({ id: CURRENT_SERIES, label: 'Actual', kind: 'current', status: 'ready', data: current });
    return out;
  }, [chosen, series, current, ctx, key]);
  const styles = useMemo(() => seriesStyles(lanes, theme), [lanes, theme]);

  const allRows = useMemo(() => zoneRows(ctx.well.depth.values, ctx.interpretation.zones), [ctx]);
  const rows = useMemo(() => shownRows(allRows, { reservoirOnly: config.reservoirOnly, hidden: config.hiddenZones }), [allRows, config.reservoirOnly, config.hiddenZones]);
  const legendRows = useMemo(() => (config.reservoirOnly ? allRows.filter((r) => r.kind === 'reservoir') : allRows), [allRows, config.reservoirOnly]);

  const settings = useMemo(() => ({ filter, excludeWashout, mean: stat.mean }), [filter, excludeWashout, stat.mean]);
  // Celdas: las series sin datos todavía (calculando o con error) quedan como carril vacío.
  const cells = useMemo<DistributionCell[][]>(() => {
    const ready = lanes.filter((l) => l.data);
    const computed = buildCells(rows, ready.map((l) => l.data!), settings);
    return rows.map((_, i) => {
      let j = 0;
      return lanes.map((l) => (l.data ? computed[i]![j++]! : { stats: null, missing: 'curve', filtered: 0 }));
    });
  }, [rows, lanes, settings]);
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
  const liveAxis = useMemo<XYAxis | null>(() => (curve ? distributionAxis(cells, stat.scale, curve.short, unit, cutValues) : null), [cells, stat.scale, curve, unit, cutValues]);
  const axis = frozen ?? liveAxis;

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
    const figStyles = rows.map((r) => (lanes.length === 1 ? [zoneLaneStyle(r.color, th)] : seriesStyles(lanes, th)));
    const filterText = FILTER_LABEL[filter].toLowerCase();
    return registerXYFigure({
      id: 'distribuciones-por-zona',
      title: `Distribución de ${curve?.short ?? ''} por zona · ${filterText}`,
      x: axis,
      y: { kind: 'linear', min: 0, max: 1, label: 'Zona' },
      points: [
        ...(lanes.length > 1 ? lanes.map((l, k) => ({ id: `s-${l.id}`, name: l.label, x: [], y: [], color: figStyles[0]![k]!.color })) : []),
        { id: 'glyph', name: `Caja P25–P75 · línea: mediana · bigotes P10–P90 · rombo: ${MEAN_LABEL[stat.mean].toLowerCase()}`, x: [], y: [], color: th.color.text },
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
          },
          th,
        ),
    });
  }, [axis, rows, cells, lanes, stat.mean, filter, curve?.short, wellName, rowCuts]);

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
    const next = on ? chosen.filter((x) => x !== id) : [...chosen, id];
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
  const allSeries: DistributionSeriesItem[] = [{ id: CURRENT_SERIES, label: 'Actual', kind: 'current', status: 'ready' }, ...series];
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
            {series.length === 0 ? (
              <p className="plot-hint">Guardá un snapshot (o cargá otro pozo) para comparar distribuciones.</p>
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
                <ul className="zdist-key" aria-label="Cómo leer las cajas">
                  <li>
                    <span className="zdist-glyph zdist-glyph--box" aria-hidden="true" />
                    P25–P75 · mediana
                  </li>
                  <li>
                    <span className="zdist-glyph zdist-glyph--whisker" aria-hidden="true" />
                    P10–P90
                  </li>
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
              {rows.length === 0 ? (
                <EmptyState size="sm" icon="boxplot" title="Ninguna zona a la vista" description={config.reservoirOnly ? 'No hay zonas de tipo reservorio visibles. Cambiá el tipo en el paso Zonas o desmarcá «Solo zonas de reservorio».' : 'Tocá una zona en la leyenda para mostrarla.'} />
              ) : !axis ? (
                <EmptyState size="sm" icon="boxplot" title="Sin datos para graficar" description={`${curve.short} no tiene valores en las zonas visibles con el filtro «${FILTER_LABEL[filter]}».`} />
              ) : (
                <div className={`zdist-plot${band ? ' is-banding' : ''}`} data-testid="zdist-plot" style={{ ['--zd-pad' as string]: `${scalePx(DIST_METRICS.padX, ui)}px` }} onPointerLeave={() => setPlotLink({ hoverRuns: null })}>
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
                  {rows.map((r, i) => (
                    <ZoneRowView
                      key={r.id}
                      row={r}
                      cells={cells[i]!}
                      styles={rowStyles[i]!}
                      axis={axis}
                      labels={lanes.map((l) => (lanes.length > 1 ? l.label : ''))}
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
}

function ZoneRowView({ row, cells, styles, axis, labels, mean, unit, ui, hover, onHover, onGo, cut, param, passTitle, band, selFraction, selection, gesture, index, onCut }: ZoneRowViewProps) {
  const lane = hover?.lane ?? -1;
  const ref = useCanvas(
    (c, { width, height }, theme, u) => drawZoneRow(c, width, height, { axis, cells, styles, selection, ...(lane >= 0 ? { hover: lane } : {}) }, theme, u),
    [axis, cells, styles, lane, selection?.stats, selection?.color, selection?.lane],
  );
  const notes = zoneNotes(cells[0]);
  const height = rowHeight(cells.length, ui);
  const move = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const k = laneAt(e.clientY - rect.top, cells.length, ui);
    onHover(k >= 0 ? { lane: k, x: e.clientX - rect.left, y: e.clientY - rect.top, width: rect.width } : null);
  };
  const tip = hover && hover.lane >= 0 && cells[hover.lane] ? cellTooltip(row.name, labels[hover.lane] ?? '', cells[hover.lane]!, mean, unit) : null;
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
    </>
  );
}
