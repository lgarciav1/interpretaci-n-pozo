/**
 * Pestaña «Resumen» (docs/decisiones/0068): un vistazo a la zona elegida al tope de los paneles. Chips de zona con los
 * colores del visor; tarjetas (bruto, neto, N/G, pay, φ del neto, Sw del pay) de la tabla del sumario por zona;
 * histogramas chicos de GR, Vsh, φ y Sw apilados por zona con el cutoff (arrastrable) y la acumulada con su P50; un
 * Pickett chico y cajas por zona de la propiedad elegida. Cada gráfico tiene ⤢: abre el módulo completo agrandado.
 *
 * Reúsa: `XYPlot` (barras apiladas, acumulada, guías), `cumulativeCurve`, las cajas y el eje de Distribución por zona
 * (`buildCells`, `drawZoneRow`, `drawDistAxis`) y la configuración guardada de cada módulo (al abrirlo se ve lo mismo).
 * Solo se monta a la vista; mientras el motor recalcula sostiene el último resultado (sin parpadeo).
 */
import { useMemo, useRef } from 'react';
import type { TableValue } from '../../core/module';
import { computedCurves } from '../computed';
import { commitParamCutoff, commitPlotConfig, usePlotConfig, usePlotContext } from '../plots/connect';
import { selectActiveEntry, useProject } from '../store/project';
import { useResults } from '../store/results';
import { GLANCE_PANEL_ID, panelVisible, useUi } from '../store/ui';
import { crossplotTemplatePatch } from '../../plots/crossplot/applyTemplate';
import { PICKETT_SW, pickettLine } from '../../plots/crossplot/templates';
import { CurveSelect } from '../../plots/controls';
import { CUTOFF_PASSES, cutoffScope, guideStep, normalizeCutoff, sharedParamValue, type CutoffParamKey } from '../../plots/cutoffs';
import { keyForRole, resolvePlotCurve } from '../../plots/data';
import { buildCells, distributionAxis, propertyStat, zoneRows, type ZoneRow } from '../../plots/distribution/distribution';
import { DIST_METRICS, drawDistAxis, drawZoneRow, rowHeight, zoneLaneStyle } from '../../plots/distribution/draw';
import { defaultProperty, propertyOptions, seriesFromContext, thicknessOf } from '../../plots/distribution/series';
import { plotParamValue, PLOT_PARAMS } from '../../plots/params';
import type { SeriesContext } from '../../plots/trend/series';
import { niceRange, type XYAxis } from '../../plots/xy/axes';
import { XYPlot, type GuidePhase, type XYBarLayer, type XYGuide, type XYLineLayer, type XYPointLayer } from '../../plots/xy/XYPlot';
import { Chip, EmptyState, IconButton, formatNumber, toast, useThemeTokens, useUiScaleFactor } from '../../ui';
import { useCanvas } from '../../ui/canvas';
import { glanceCards, pickettCloud, positiveMedianAt, stackedHistogram, zoneIndexOf } from './glance';
import { useGlance } from './store';
import { SETTLE_MS, useSettled } from '../useSettled';
import './glance.css';

type Rows = TableValue['rows'];

/** Abre la pestaña de un módulo agrandada (⤢). */
function openFull(id: string): void {
  useUi.getState().openPanel(id);
  useUi.setState({ panelExpanded: true });
}

function Expand({ label, onClick }: { label: string; onClick(): void }) {
  return <IconButton icon="expand-view" label={label} size="sm" onClick={onClick} className="glance-expand" />;
}

export function GlancePanel() {
  const visible = useUi((s) => panelVisible(s, GLANCE_PANEL_ID));
  const live = usePlotContext();
  if (!visible) return null;
  if (!live) return <EmptyState size="sm" icon="sigma" title="Sin pozo" description="Cargá un pozo para ver su resumen por zona." />;
  return <GlanceBody live={live} />;
}

/**
 * Mientras el motor recalcula, el resultado queda en null y las calculadas desaparecen un instante: se sostiene el
 * último contexto con resultado del MISMO pozo (con la interpretación vigente: los cutoffs nuevos) y su tabla.
 */
function useHeld(live: SeriesContext): { ctx: SeriesContext; rows: Rows | null } {
  const result = useResults((s) => s.result);
  const entry = useProject(selectActiveEntry);
  const held = useRef<{ ctx: SeriesContext; rows: Rows | null } | null>(null);
  const fresh = !!result && !!entry && result.wellId === entry.well.id && computedCurves(result, entry.well).length > 0;
  const rows = useMemo(() => {
    const out = result?.outputs.find((o) => o.moduleId === 'zone-summary' && o.port === 'ZONE_SUMMARY');
    return (out?.value as TableValue | undefined)?.rows ?? null;
  }, [result]);
  if (fresh) held.current = { ctx: live, rows };
  else if (held.current && held.current.ctx.well.id !== live.well.id) held.current = null;
  const h = fresh ? null : held.current;
  const ctx = useMemo(() => (!h ? live : h.ctx.interpretation === live.interpretation ? h.ctx : { ...h.ctx, interpretation: live.interpretation }), [h?.ctx, live]); // eslint-disable-line react-hooks/exhaustive-deps
  return { ctx, rows: h ? h.rows : rows };
}

const pct = (v: number, d = 0) => (Number.isFinite(v) ? `${formatNumber(v * 100, { digits: d })} %` : '—');
const m = (v: number) => (Number.isFinite(v) ? formatNumber(v, { digits: 1 }) : '—');

function GlanceBody({ live }: { live: SeriesContext }) {
  const held = useHeld(live);
  const rows = held.rows;
  // Los gráficos se rehacen cuando el resultado se queda quieto (un arrastre de cutoff no los recalcula en cada paso);
  // las tarjetas y la línea del cutoff siguen al instante.
  const ctx = useSettled(held.ctx, SETTLE_MS);
  const params = held.ctx.interpretation.params;
  const zoneId = useGlance((s) => s.zoneId);
  const setZone = useGlance((s) => s.set);
  const depth = ctx.well.depth.values;
  const zrows = useMemo(() => zoneRows(depth, ctx.interpretation.zones), [depth, ctx.interpretation.zones]);
  const zoneIdx = useMemo(() => zoneIndexOf(depth.length, zrows), [depth.length, zrows]);
  const chosen = zrows.findIndex((z) => z.id === zoneId);
  const zone = chosen >= 0 ? zrows[chosen]! : null;
  const shown = useMemo(() => (chosen >= 0 ? new Set([chosen]) : null), [chosen]);
  const cards = glanceCards(rows, zone?.name ?? null);

  return (
    <div className="glance" data-testid="glance">
      {zrows.length > 0 && (
        <div className="glance-zones plot-chips" role="group" aria-label="Zona del resumen">
          <Chip selected={!zone} onClick={() => setZone(null)} title="Todo el intervalo con zonas">
            Todas
          </Chip>
          {zrows.map((z) => (
            <Chip key={z.id} color={z.color} selected={zone?.id === z.id} title={`Solo la zona ${z.name}`} onClick={() => setZone(zone?.id === z.id ? null : z.id)}>
              {z.name}
            </Chip>
          ))}
        </div>
      )}

      <div className="glance-cards" aria-label={`Resumen de ${zone ? `la zona ${zone.name}` : 'todas las zonas'}`}>
        <Card label="Bruto" value={m(cards?.gross ?? NaN)} unit="m" />
        <Card label="Neto" value={m(cards?.net ?? NaN)} unit="m" sub="reservorio" />
        <Card label="N/G" value={pct(cards?.ntg ?? NaN)} sub="reservorio" />
        <Card label="Pay" value={m(cards?.pay ?? NaN)} unit="m" />
        <Card label="φ" value={pct(cards?.phiNet ?? NaN, 1)} sub="neto" />
        <Card label="Sw" value={pct(cards?.swPay ?? NaN)} sub="pay" />
      </div>
      {!rows && <p className="glance-note">Las tarjetas aparecen cuando el sumario por zona tiene banderas de cutoffs, φe y Sw.</p>}

      <section className="glance-block" aria-label="Histogramas">
        <header className="glance-block__head">
          <h3 className="glance-block__title">Histogramas</h3>
          <span className="glance-block__meta">espesor por clase · acumulada</span>
        </header>
        <div className="glance-hists">
          <MiniHistogram ctx={ctx} params={params} role="GR" zoneIdx={zoneIdx} rows={zrows} shown={shown} zone={zone} />
          <MiniHistogram ctx={ctx} params={params} role="VSH" cutoff="vshCutoff" zoneIdx={zoneIdx} rows={zrows} shown={shown} zone={zone} />
          <MiniHistogram ctx={ctx} params={params} role="PHIE" cutoff="phiCutoff" zoneIdx={zoneIdx} rows={zrows} shown={shown} zone={zone} />
          <MiniHistogram ctx={ctx} params={params} role="SW" cutoff="swCutoff" zoneIdx={zoneIdx} rows={zrows} shown={shown} zone={zone} />
        </div>
      </section>

      <MiniPickett ctx={ctx} zoneIdx={zoneIdx} rows={zrows} shown={shown} zone={zone} />
      <ZoneBoxes ctx={ctx} rows={zrows} zone={zone} />
    </div>
  );
}

function Card({ label, value, unit, sub }: { label: string; value: string; unit?: string; sub?: string }) {
  return (
    <div className="glance-card">
      <div className="glance-card__label">
        {label}
        {sub && <span className="glance-card__sub"> {sub}</span>}
      </div>
      <div className="glance-card__value num">
        {value}
        {unit && value !== '—' && <span className="glance-card__unit"> {unit}</span>}
      </div>
    </div>
  );
}

const NO_POINTS: readonly XYPointLayer[] = [];

interface MiniProps {
  ctx: SeriesContext;
  zoneIdx: Int16Array;
  rows: readonly ZoneRow[];
  shown: ReadonlySet<number> | null;
  zone: ZoneRow | null;
}

/** Histograma chico de una curva por rol: espesor apilado por zona, acumulada (eje derecho) y la caída del P50. */
function MiniHistogram({ ctx, params, role, cutoff, zoneIdx, rows, shown, zone }: MiniProps & { params: SeriesContext['interpretation']['params']; role: string; cutoff?: CutoffParamKey }) {
  const theme = useThemeTokens();
  const key = keyForRole(ctx, role);
  const curve = useMemo(() => resolvePlotCurve(ctx, key), [ctx, key]);
  const model = useMemo(() => (curve ? stackedHistogram(curve.data, curve.scale, zoneIdx, rows, thicknessOf(ctx.well), shown) : null), [curve, zoneIdx, rows, ctx.well, shown]);
  const scope = cutoffScope(zone ? [zone.id] : [], ctx.interpretation.zones);
  const cutValue = cutoff ? sharedParamValue(params, cutoff, scope.zoneId) : NaN;

  const layers = useMemo(() => {
    if (!model) return null;
    const bars: XYBarLayer[] = [
      ...model.layers.map((l) => ({ id: `z-${l.zoneId}`, edges: model.edges, values: l.values, base: l.base, color: l.color, fillAlpha: theme.name === 'dark' ? 0.75 : 0.85 })),
      { id: 'total', edges: model.edges, values: model.total, color: theme.color.borderStrong, outlineOnly: true },
    ];
    const x = Float64Array.from(model.edges);
    const lines: XYLineLayer[] = [{ id: 'cum', x, y: Float64Array.from(model.cdf.cdf, (v) => v * 100), color: theme.color.text, width: 1.25, y2: true }];
    const p50 = model.cdf.p50;
    if (Number.isFinite(p50)) lines.push({ id: 'p50', x: [p50, p50, model.edges[model.edges.length - 1]!], y: [0, 50, 50], color: theme.color.textMuted, width: 1, dash: [3, 3], y2: true });
    return { bars, lines };
  }, [model, theme]);

  const title = curve?.short ?? role;
  if (!curve || !model || !layers) {
    return (
      <div className="glance-hist glance-hist--empty">
        <div className="glance-hist__head">
          <span className="glance-hist__name">{title}</span>
        </div>
        <p className="glance-note">Sin {role === 'GR' ? 'GR' : title}</p>
      </div>
    );
  }
  const lo = model.edges[0]!;
  const hi = model.edges[model.edges.length - 1]!;
  const xAxis: XYAxis = { kind: model.scale, min: lo, max: hi, label: title, ...(curve.unitText ? { unit: curve.unitText } : {}) };
  const yAxis: XYAxis = { kind: 'linear', min: 0, max: (model.max || 1) * 1.08, label: 'Espesor', unit: 'm' };
  const guides: XYGuide[] =
    cutoff && Number.isFinite(cutValue)
      ? [{ id: `cut-${cutoff}`, axis: 'x', value: cutValue, color: theme.color.error, width: 1.5, draggable: true, removable: false, ...guideStep(cutoff) }]
      : [];
  const onGuide = (_id: string, v: number, phase: GuidePhase) => {
    if (!cutoff) return;
    commitParamCutoff(cutoff, scope.zoneId, phase === 'cancel' ? v : normalizeCutoff(cutoff, v), phase);
  };
  const open = () => {
    commitPlotConfig('histogram', { curve: key, zones: zone ? [zone.id] : [], byZone: true, cumulative: true }, `Histograma de ${title}`);
    openFull('histogram');
  };
  const side = cutoff ? CUTOFF_PASSES[cutoff] : null;
  return (
    <figure className="glance-hist" aria-label={`Histograma de ${title}`}>
      <figcaption className="glance-hist__head">
        <span className="glance-hist__name">
          {title}
          {curve.unitText && <span className="glance-hist__unit"> {curve.unitText}</span>}
        </span>
        <span className="glance-hist__p50 num" title="Mediana ponderada por espesor, leída sobre la acumulada">
          P50 {formatNumber(model.cdf.p50, { significant: 3 })}
        </span>
        <Expand label={`Abrir el histograma de ${title}`} onClick={open} />
      </figcaption>
      <XYPlot
        compact
        height={92}
        x={xAxis}
        y={yAxis}
        y2={{ kind: 'linear', min: 0, max: 100, label: 'Acumulada', unit: '%' }}
        bars={layers.bars}
        lines={layers.lines}
        guides={guides}
        points={NO_POINTS}
        onGuideChange={onGuide}
        ariaLabel={`Histograma de ${title}${zone ? ` en la zona ${zone.name}` : ' por zona'}${cutoff ? `; cutoff ${formatNumber(cutValue, { significant: 3 })} (pasa ${side === 'below' ? 'por debajo' : 'por encima'})` : ''}`}
      />
    </figure>
  );
}

/** Pickett chico: RT contra φe (log–log) con las rectas de Sw de Archie de la zona elegida (o los globales). */
function MiniPickett({ ctx, zoneIdx, rows, shown, zone }: MiniProps) {
  const theme = useThemeTokens();
  const rt = useMemo(() => resolvePlotCurve(ctx, keyForRole(ctx, 'RT')), [ctx]);
  const phi = useMemo(() => resolvePlotCurve(ctx, keyForRole(ctx, 'PHIE')), [ctx]);
  const cloud = useMemo(() => (rt && phi ? pickettCloud(rt.data, phi.data, zoneIdx, shown) : null), [rt, phi, zoneIdx, shown]);
  const params = ctx.interpretation.params;
  const zid = zone?.id ?? null;
  const a = plotParamValue(params, PLOT_PARAMS.a, zid);
  const mm = plotParamValue(params, PLOT_PARAMS.m, zid);
  const n = plotParamValue(params, PLOT_PARAMS.n, zid);
  // Rw de la recta: la mediana de la curva RW activa en los puntos (con «Rw conocida», ya llevada a su temperatura).
  const rwCurve = ctx.computed.find((c) => c.active && c.port === 'RW');
  const rwMed = cloud && rwCurve ? positiveMedianAt(rwCurve.data, cloud.samples) : NaN;
  const rw = rwMed > 0 ? rwMed : plotParamValue(params, PLOT_PARAMS.rwRef, zid);

  const layers = useMemo(() => {
    if (!cloud || cloud.rt.length === 0) return null;
    const colors = rows.map((r) => r.color);
    const points: XYPointLayer[] = [{ id: 'pk', x: cloud.rt, y: cloud.phi, color: (i) => colors[cloud.zone[i]!] ?? theme.color.accent, dense: true, alpha: 0.8, radius: 1.6 }];
    const lines: XYLineLayer[] = PICKETT_SW.map((sw, k) => {
      const l = pickettLine(sw, { a, m: mm, n, rw }, [0.005, 1]);
      return { id: `sw-${sw}`, x: l.rt, y: l.phi, color: k === 0 ? theme.color.info : theme.color.textMuted, width: k === 0 ? 1.5 : 1, dash: k === 0 ? [] : [5, 4], label: `${Math.round(sw * 100)} %`, labelAt: 'start' as const };
    });
    const xr = niceRange([cloud.rt], 'log') ?? { min: 0.1, max: 1000 };
    const yr = niceRange([cloud.phi], 'log') ?? { min: 0.01, max: 1 };
    return { points, lines, xr, yr };
  }, [cloud, rows, theme, a, mm, n, rw]);

  const open = () => {
    const r = crossplotTemplatePatch(ctx, 'pickett');
    if (!r.ok) {
      toast({ tone: 'warn', title: r.title, description: r.description });
      return;
    }
    commitPlotConfig('crossplot', { ...r.patch, zones: zone ? [zone.id] : [], color: { kind: 'zone' } }, r.label);
    openFull('crossplot');
  };
  return (
    <section className="glance-block" aria-label="Pickett">
      <header className="glance-block__head">
        <h3 className="glance-block__title">Pickett</h3>
        <span className="glance-block__meta num">
          m {formatNumber(mm, { digits: 2 })} · Rw {formatNumber(rw, { significant: 3 })} Ω·m
        </span>
        <Expand label="Abrir el crossplot con la plantilla de Pickett" onClick={open} />
      </header>
      {layers ? (
        <XYPlot
          compact
          height={190}
          x={{ kind: 'log', min: layers.xr.min, max: layers.xr.max, label: rt?.short ?? 'RT', unit: 'Ω·m' }}
          y={{ kind: 'log', min: Math.max(0.01, layers.yr.min), max: Math.min(1, Math.max(layers.yr.max, 0.1)), label: 'φe', unit: 'v/v' }}
          points={layers.points}
          lines={layers.lines}
          ariaLabel={`Pickett${zone ? ` de la zona ${zone.name}` : ''}: resistividad contra porosidad efectiva con rectas de Sw 100, 50, 30 y 20 %`}
        />
      ) : (
        <p className="glance-note">El Pickett necesita RT y φe.</p>
      )}
    </section>
  );
}

/** Cajas por zona (P10–P90, P25–P75, mediana y media) de la propiedad de Distribución por zona, con su configuración. */
function ZoneBoxes({ ctx, rows, zone }: { ctx: SeriesContext; rows: readonly ZoneRow[]; zone: ZoneRow | null }) {
  const config = usePlotConfig('distribution');
  const ui = useUiScaleFactor();
  const options = useMemo(() => propertyOptions(ctx), [ctx]);
  const key = config?.curve && options.some((o) => o.value === config.curve) ? config.curve : defaultProperty(options);
  const curve = useMemo(() => resolvePlotCurve(ctx, key), [ctx, key]);
  const model = useMemo(() => {
    if (!config || !curve || rows.length === 0) return null;
    const series = seriesFromContext(ctx, key, { id: '#current', label: 'Actual', kind: 'current' });
    const stat = propertyStat(curve.role ?? curve.short, !!series.phi, curve.scale);
    const filter = (config.filter === 'netRes' && !series.netRes) || (config.filter === 'netPay' && !series.netPay) ? 'all' : config.filter;
    const cells = buildCells(rows, [series], { filter, excludeWashout: config.excludeWashout && !!series.washout, mean: stat.mean });
    const axis = distributionAxis(cells, stat.scale, curve.short, curve.unitText || undefined);
    return axis ? { cells, axis, filter } : null;
  }, [ctx, key, curve, config, rows]);

  const rowH = rowHeight(1, ui);
  const axisH = Math.round(DIST_METRICS.axis * ui);
  const height = axisH + rows.length * rowH;
  const ref = useCanvas(
    (c, { width }, theme, u) => {
      if (!model) return;
      drawDistAxis(c, width, Math.round(DIST_METRICS.axis * u), model.axis, theme, u);
      const rh = rowHeight(1, u);
      rows.forEach((r, k) => {
        drawZoneRow(c, width, rh, { axis: model.axis, cells: model.cells[k]!, styles: [zoneLaneStyle(r.color, theme)] }, theme, u, 0, Math.round(DIST_METRICS.axis * u) + k * rh);
      });
    },
    [model, rows],
  );
  const filterText = model?.filter === 'netPay' ? 'pay neto' : model?.filter === 'netRes' ? 'reservorio neto' : 'toda la zona';
  return (
    <section className="glance-block" aria-label="Cajas por zona">
      <header className="glance-block__head">
        <h3 className="glance-block__title">Por zona</h3>
        <span className="glance-block__meta">{filterText}</span>
        <Expand label="Abrir Distribución por zona" onClick={() => openFull('zone-distribution')} />
      </header>
      <div className="glance-boxes__pick">
        <CurveSelect label="Propiedad de las cajas" value={key} options={options} onChange={(v) => commitPlotConfig('distribution', { curve: v }, 'Elegir la propiedad de las distribuciones')} />
      </div>
      {model ? (
        <div className="glance-boxes" style={{ ['--glance-axis' as string]: `${axisH}px`, ['--glance-row' as string]: `${rowH}px` }}>
          <ol className="glance-boxes__names" aria-hidden="true">
            {rows.map((r) => (
              <li key={r.id} className={zone && zone.id !== r.id ? 'is-dim' : zone ? 'is-on' : ''}>
                <span className="zone-swatch" style={{ background: r.color }} />
                {r.name}
              </li>
            ))}
          </ol>
          <canvas
            ref={ref}
            className="glance-boxes__canvas"
            style={{ height }}
            role="img"
            aria-label={`Cajas por zona de ${curve?.short ?? 'la propiedad'}: P10 a P90, P25 a P75, mediana y media (rombo)`}
          />
        </div>
      ) : (
        <p className="glance-note">{rows.length === 0 ? 'El pozo no tiene zonas.' : 'Sin datos de la propiedad en las zonas.'}</p>
      )}
      <p className="glance-legend">
        Caja P25–P75 · línea: mediana · rombo: media · bigotes P10–P90
      </p>
    </section>
  );
}
