/**
 * Panel «Distribuciones por zona» (docs/decisiones/0066): boxplots por zona de una propiedad, una caja por serie
 * (interpretación actual, snapshots, otros pozos con zonas emparejadas por nombre). Filas en orden de profundidad con
 * el color de la zona, eje compartido arriba (log para k), avisos concretos por zona, leyenda de zonas clicable,
 * clic en una caja o en el nombre → el visor va a la zona, exportación a CSV y figura PNG.
 *
 * Presentación: no conoce los stores. Lo conecta `src/modules/zone-distribution/dock.tsx`. Pensado primero para un
 * contenedor angosto (nombre de la zona arriba de su fila); con ancho, nombres a la izquierda y controles al costado.
 */
import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { DistributionConfig } from '../../core/plots';
import type { DistributionMean } from '../../petro/distribution';
import { useCanvas } from '../../ui/canvas';
import { CATEGORICAL } from '../../ui/curves';
import { Button, Callout, Checkbox, Chip, EmptyState, SegmentedControl, Spinner, formatNumber, useThemeTokens, useUiScaleFactor, type ThemeTokens } from '../../ui';
import { ControlGroup, CurveSelect } from '../controls';
import { resolvePlotCurve } from '../data';
import { setPlotLink } from '../link';
import type { SeriesContext } from '../trend/series';
import type { XYAxis } from '../xy/axes';
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
import { DIST_METRICS, drawDistAxis, drawDistributionFigure, drawZoneRow, laneAt, rowHeight, zoneLaneStyle, type LaneStyle } from './draw';
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

export function DistributionPanel({ ctx, wellName, config, onChange, series, onGoTo, onDownload }: DistributionPanelProps) {
  const theme = useThemeTokens();
  const ui = useUiScaleFactor();
  const options = useMemo(() => propertyOptions(ctx), [ctx]);
  const key = config.curve && options.some((o) => o.value === config.curve) ? config.curve : defaultProperty(options);
  const curve = useMemo(() => resolvePlotCurve(ctx, key), [ctx, key]);
  const current = useMemo(() => seriesFromContext(ctx, key, { id: CURRENT_SERIES, label: 'Actual', kind: 'current' }), [ctx, key]);
  const avail = availabilityOf(current);
  const stat = propertyStat(curve?.role ?? curve?.short ?? '', avail.phi);
  const unit = curve?.unitText || undefined;
  // Filtro efectivo: si faltan las banderas, toda la zona (el control queda deshabilitado).
  const filter = (config.filter === 'netRes' && !avail.netRes) || (config.filter === 'netPay' && !avail.netPay) ? 'all' : config.filter;
  const excludeWashout = config.excludeWashout && avail.washout;

  // Series elegidas, en el orden de las candidatas («Actual» primero).
  const chosen = config.series.length ? config.series : [CURRENT_SERIES];
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
  const axis = useMemo<XYAxis | null>(() => (curve ? distributionAxis(cells, stat.scale, curve.short, unit) : null), [cells, stat.scale, curve, unit]);

  // Una sola serie: cajas con el color de la zona (legible sobre el fondo); varias: el color de cada serie.
  const rowStyles = useMemo(
    () => rows.map((r) => (lanes.length === 1 ? [zoneLaneStyle(r.color, theme)] : styles)),
    [rows, lanes.length, styles, theme],
  );

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
      plot: (c, w, h) => drawDistributionFigure(c, w, h, { axis, rows: rows.map((r, i) => ({ name: r.name, color: r.color, note: zoneNotes(cells[i]?.[0]).map((n) => n.text).join(' · ') })), cells, styles: figStyles }, th),
    });
  }, [axis, rows, cells, lanes, stat.mean, filter, curve?.short, wellName]);

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
              description={avail.washout ? 'Muestras con el indicador de derrumbe' : 'No hay indicador de derrumbe calculado'}
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
              {rows.length === 0 ? (
                <EmptyState size="sm" icon="boxplot" title="Ninguna zona a la vista" description={config.reservoirOnly ? 'No hay zonas de tipo reservorio visibles. Cambiá el tipo en el paso Zonas o desmarcá «Solo zonas de reservorio».' : 'Tocá una zona en la leyenda para mostrarla.'} />
              ) : !axis ? (
                <EmptyState size="sm" icon="boxplot" title="Sin datos para graficar" description={`${curve.short} no tiene valores en las zonas visibles con el filtro «${FILTER_LABEL[filter]}».`} />
              ) : (
                <div className="zdist-plot" data-testid="zdist-plot" onPointerLeave={() => setPlotLink({ hoverRuns: null })}>
                  <div className="zdist-axis-label">
                    <span className="zdist-axis-title">{unit ? `${curve.short} (${unit})` : curve.short}</span>
                    <span className="zdist-axis-filter">{FILTER_LABEL[filter]}</span>
                  </div>
                  <AxisCanvas axis={axis} ui={ui} />
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
                        setPlotLink({ hoverRuns: h ? [{ top: r.top, base: r.base }] : null });
                      }}
                      onGo={() => goTo(r)}
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
  return <canvas ref={ref} className="zdist-axis" style={{ height: rowAxisHeight(ui) }} aria-hidden="true" />;
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
}

function ZoneRowView({ row, cells, styles, axis, labels, mean, unit, ui, hover, onHover, onGo }: ZoneRowViewProps) {
  const lane = hover?.lane ?? -1;
  const ref = useCanvas((c, { width, height }, theme, u) => drawZoneRow(c, width, height, { axis, cells, styles, ...(lane >= 0 ? { hover: lane } : {}) }, theme, u), [axis, cells, styles, lane]);
  const notes = zoneNotes(cells[0]);
  const height = rowHeight(cells.length, ui);
  const move = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const k = laneAt(e.clientY - rect.top, cells.length, ui);
    onHover(k >= 0 ? { lane: k, x: e.clientX - rect.left, y: e.clientY - rect.top, width: rect.width } : null);
  };
  const tip = hover && hover.lane >= 0 && cells[hover.lane] ? cellTooltip(row.name, labels[hover.lane] ?? '', cells[hover.lane]!, mean, unit) : null;
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
      </div>
      <div className="zdist-cell" style={{ ['--zone' as string]: row.color }}>
        <canvas
          ref={ref}
          className="zdist-row"
          style={{ height }}
          role="img"
          aria-label={`Zona ${row.name}: ${summary}`}
          onPointerMove={move}
          onPointerLeave={() => onHover(null)}
          onClick={onGo}
        />
        {tip && hover && (
          <div className={`xy-plot__tip${hover.x > hover.width / 2 ? ' is-left' : ''}`} style={{ left: hover.x, top: hover.y }} role="tooltip">
            {tip.join('\n')}
          </div>
        )}
      </div>
    </>
  );
}
