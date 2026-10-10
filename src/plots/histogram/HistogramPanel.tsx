/**
 * Panel «Histograma» (docs/decisiones/0014, D5): cualquier curva, clases automáticas o a mano, escala log para
 * resistividades (convención del visor por rol), superposición por zona con los colores de zona, normalización a %,
 * acumulada, cutoff arrastrable (real para VSH/PHIE/SW, libre para el resto) y estadísticos en un panel aparte.
 * Pasar sobre una clase marca en el visor los tramos de esas muestras.
 *
 * Presentación: no conoce los stores. Lo conecta `src/modules/histogram/dock.tsx`.
 */
import { useEffect, useMemo, useState } from 'react';
import { HISTOGRAM_BINS, type HistogramConfig } from '../../core/plots';
import { Button, Checkbox, DataTable, EmptyState, IconButton, NumberField, curveStyle, formatNumber, useThemeTokens } from '../../ui';
import { ControlGroup, CurveSelect, ScaleControl, ZoneFilterChips } from '../controls';
import { CUTOFF_PASSES, cutoffParamFor, cutoffScope, normalizeCutoff, paramStep, resolveCutoffLine, type CutoffParamKey } from '../cutoffs';
import { depthRuns, effectiveScale, keyForRole, plotCurveOptions, resolvePlotCurve, zoneFilter } from '../data';
import { setPlotLink } from '../link';
import type { SeriesContext } from '../trend/series';
import { niceRange, type XYAxis } from '../xy/axes';
import { XYPlot, type GuidePhase, type XYBarLayer, type XYGuide, type XYLineLayer } from '../xy/XYPlot';
import { autoRange, binEdges, countBins, cumulativePercent, cutoffSplit, sampleStats, toPercent, type SampleStats } from './histogram';
import '../plots.css';

export interface HistogramPanelProps {
  ctx: SeriesContext;
  config: HistogramConfig;
  onChange(patch: Partial<HistogramConfig>, label: string): void;
  /** Cutoff real arrastrado (parámetro del módulo de cutoffs en la zona del alcance o global). */
  onParamCutoff(key: CutoffParamKey, zoneId: string | null, value: number, phase: GuidePhase): void;
}

const fmt = (v: number) => formatNumber(v, { significant: 3 });

interface Series {
  id: string;
  name: string;
  color: string;
  include: (i: number) => boolean;
  stats: SampleStats;
}

export function HistogramPanel({ ctx, config, onChange, onParamCutoff }: HistogramPanelProps) {
  const theme = useThemeTokens();
  const [preview, setPreview] = useState<{ id: string; value: number } | null>(null);
  const options = useMemo(() => plotCurveOptions(ctx), [ctx]);
  const key = config.curve ?? keyForRole(ctx, 'GR') ?? options[0]?.value ?? null;
  const curve = useMemo(() => resolvePlotCurve(ctx, key), [ctx, key]);
  const scale = effectiveScale(config.scale, curve);
  const depth = ctx.well.depth.values;
  const zones = ctx.interpretation.zones;
  const filter = useMemo(() => zoneFilter(depth, zones, config.zones), [depth, zones, config.zones]);

  // Al desmontarse o cambiar de curva, el visor deja de marcar la clase.
  useEffect(() => () => setPlotLink({ hoverRuns: null }), []);

  const model = useMemo(() => {
    if (!curve) return null;
    const data = curve.data;
    const range = autoRange(data, scale, filter.include, config.bins);
    if (!range) return { curve, empty: true as const };
    const edges = binEdges(range.lo, range.hi, range.bins, scale);
    const curveColor = curveStyle(curve.role, theme.name, ctx.catalog).color;
    const series: Series[] = [];
    const zoneIdx = filter.zoneIndex;
    if (config.byZone && filter.shown.length > 0) {
      filter.zones.forEach((z, j) => {
        if (!filter.shown.includes(z)) return;
        const include = (i: number) => zoneIdx[i] === j;
        const stats = sampleStats(data, scale, include);
        if (stats.n > 0) series.push({ id: z.id, name: `Zona ${z.name}`, color: z.color, include, stats });
      });
    } else {
      series.push({ id: 'all', name: filter.selected.length ? 'Zonas filtradas' : 'Todo el pozo', color: curveColor, include: filter.include, stats: sampleStats(data, scale, filter.include) });
    }
    const counts = series.map((s) => countBins(data, edges, scale, s.include));
    const values = counts.map((c) => (config.normalize ? toPercent(c.counts, c.n + c.below + c.above) : c.counts));
    let max = 0;
    for (const v of values) for (const x of v) if (x > max) max = x;
    const yr = niceRange([[0, max * 1.06]], 'linear', { zero: true, pad: 0 }) ?? { min: 0, max: 1 };
    const overlay = series.length > 1;
    const bars: XYBarLayer[] = series.map((s, k) => ({ id: s.id, name: s.name, edges, values: values[k]!, color: s.color, fillAlpha: overlay ? 0.16 : 0.42 }));
    const lines: XYLineLayer[] = config.cumulative
      ? series.map((s, k) => ({ id: `cum-${s.id}`, name: overlay ? undefined : 'Acumulada', x: Float64Array.from(edges.slice(1)), y: cumulativePercent(counts[k]!), color: s.color, width: 1.75, dash: [5, 3], y2: true }))
      : [];
    const total = series.length > 1 ? sampleStats(data, scale, filter.include) : null;
    const outside = counts.reduce((a, c) => a + c.below + c.above, 0);
    return { curve, empty: false as const, edges, bins: range.bins, series, counts, values, bars, lines, yMax: yr.max, total, outside };
  }, [curve, scale, filter, config.bins, config.byZone, config.normalize, config.cumulative, theme.name, ctx.catalog]);

  if (options.length === 0) return <EmptyState size="sm" icon="histogram" title="Sin curvas" description="El pozo no tiene curvas para graficar." />;

  const scope = cutoffScope(config.zones, zones);
  const line = curve ? resolveCutoffLine('x', curve, config.cutoffs, ctx.interpretation.params, scope, preview) : null;
  const param = cutoffParamFor(curve?.role ?? null);

  const xAxis: XYAxis | null = model && !model.empty ? { kind: scale, min: model.edges[0]!, max: model.edges[model.edges.length - 1]!, label: curve!.short, unit: curve!.unitText || undefined } : null;
  const yAxis: XYAxis = { kind: 'linear', min: 0, max: model && !model.empty ? model.yMax : 1, label: config.normalize ? 'Frecuencia' : 'Muestras', ...(config.normalize ? { unit: '%' } : {}) };

  const passSide = line?.param ? CUTOFF_PASSES[line.param] : null;
  const split = line && curve ? cutoffSplit(curve.data, line.value, filter.include, passSide === 'above' ? 'above' : 'below') : null;
  const guides: XYGuide[] = line
    ? [
        {
          id: line.id,
          axis: 'x',
          value: line.value,
          color: line.param ? theme.color.error : theme.color.accent,
          dash: line.param ? [] : [6, 4],
          width: 1.75,
          draggable: true,
          ...(line.param ? { step: paramStep(line.param) } : {}),
          label: `${line.title} · ${fmt(line.value)}`,
          ...(split && split.n > 0
            ? { detail: passSide ? `Pasa ${formatNumber(passSide === 'below' ? split.below : split.above, { digits: 0 })} % de las muestras` : `${formatNumber(split.below, { digits: 0 })} % ≤ · ${formatNumber(split.above, { digits: 0 })} % >` }
            : {}),
        },
      ]
    : [];

  const onGuide = (id: string, value: number, phase: GuidePhase) => {
    if (!line || id !== line.id) return;
    if (line.param) {
      const v = normalizeCutoff(line.param, value);
      setPreview(phase === 'preview' ? { id, value: v } : null);
      onParamCutoff(line.param, line.zoneId, phase === 'cancel' ? value : v, phase);
      return;
    }
    if (phase === 'preview') setPreview({ id, value });
    else {
      setPreview(null);
      if (phase === 'commit') onChange({ cutoffs: { ...config.cutoffs, [line.curveKey]: value } }, 'Mover cutoff libre');
    }
  };
  const addCutoff = () => {
    if (!curve || !model || model.empty) return;
    const median = model.total?.p50 ?? model.series[0]?.stats.p50 ?? NaN;
    onChange({ cutoffs: { ...config.cutoffs, [curve.key]: param ? true : +median.toPrecision(3) } }, param ? 'Mostrar cutoff en el histograma' : 'Agregar cutoff libre');
  };
  const removeCutoff = () => {
    if (!curve) return;
    const { [curve.key]: _gone, ...rest } = config.cutoffs;
    onChange({ cutoffs: rest }, 'Quitar cutoff del histograma');
  };

  const barLabel = (j: number) => {
    if (!model || model.empty) return '';
    const head = `${fmt(model.edges[j]!)}–${fmt(model.edges[j + 1]!)}${curve?.unitText ? ` ${curve.unitText}` : ''}`;
    const rows = model.series.map((s, k) => `${model.series.length > 1 ? `${s.name}: ` : ''}${config.normalize ? `${formatNumber(model.values[k]![j]!, { digits: 1 })} %` : `${model.counts[k]!.counts[j]} muestras`}`);
    return [head, ...rows, 'Marcadas en el visor'].join('\n');
  };
  const onBarHover = (j: number | null) => {
    if (j === null || !model || model.empty || !curve) {
      setPlotLink({ hoverRuns: null });
      return;
    }
    const lo = model.edges[j]!;
    const hi = model.edges[j + 1]!;
    const last = j === model.edges.length - 2;
    const d = curve.data;
    setPlotLink({ hoverRuns: depthRuns(depth, (i) => filter.include(i) && d[i]! >= lo && (last ? d[i]! <= hi : d[i]! < hi)) });
  };

  const statsRows = model && !model.empty ? [...model.series.map((s) => ({ id: s.id, name: s.name, color: s.color, st: s.stats })), ...(model.total ? [{ id: 'total', name: 'Total', color: '', st: model.total }] : [])] : [];
  const geometric = scale === 'log';

  return (
    <div className="plot-host">
      <div className="plot-panel" data-testid="histogram-panel">
        <div className="plot-panel__side">
          <div className="plot-panel__controls">
            <ControlGroup title="Curva">
              <CurveSelect label="Curva del histograma" value={key} options={options} onChange={(v) => onChange({ curve: v }, 'Cambiar la curva del histograma')} />
              <div className="plot-row">
                <span className="plot-row__label">Escala</span>
                <ScaleControl label="Escala del eje x" value={config.scale} onChange={(v) => onChange({ scale: v }, 'Cambiar la escala del histograma')} />
              </div>
              <div className="plot-row">
                <span className="plot-row__label">Clases</span>
                <NumberField
                  size="sm"
                  width={64}
                  aria-label="Cantidad de clases"
                  value={config.bins ?? (model && !model.empty ? model.bins : 20)}
                  min={HISTOGRAM_BINS.min}
                  max={HISTOGRAM_BINS.max}
                  step={1}
                  onChange={(v) => onChange({ bins: Math.round(v) }, 'Cambiar las clases del histograma')}
                />
                {config.bins === null ? (
                  <span className="plot-muted" title="Freedman–Diaconis: el ancho de clase sigue a la dispersión y a la cantidad de muestras">
                    auto
                  </span>
                ) : (
                  <Button size="sm" variant="ghost" onClick={() => onChange({ bins: null }, 'Clases automáticas')}>
                    Auto
                  </Button>
                )}
              </div>
            </ControlGroup>
            <ControlGroup title="Zonas">
              <ZoneFilterChips zones={filter.zones} selected={filter.selected} onChange={(ids) => onChange({ zones: ids }, 'Filtrar el histograma por zona')} />
              <Checkbox checked={config.byZone} onChange={(on) => onChange({ byZone: on }, on ? 'Superponer zonas' : 'Juntar zonas')} label="Un histograma por zona" />
              <Checkbox checked={config.normalize} onChange={(on) => onChange({ normalize: on }, on ? 'Normalizar a %' : 'Mostrar muestras')} label="Normalizar a %" description="Compara zonas de distinto espesor" />
              <Checkbox checked={config.cumulative} onChange={(on) => onChange({ cumulative: on }, on ? 'Mostrar acumulada' : 'Ocultar acumulada')} label="Curva acumulada" />
            </ControlGroup>
            <ControlGroup title="Cutoff">
              {line ? (
                <div className="plot-row">
                  <span className={`plot-cut-swatch${line.param ? ' is-real' : ''}`} aria-hidden="true" />
                  <span className="plot-row__label num">
                    {line.title} · {fmt(line.value)}
                  </span>
                  <IconButton size="sm" icon="trash" label="Quitar el cutoff del histograma" onClick={removeCutoff} />
                </div>
              ) : (
                <Button size="sm" icon="plus" disabled={!model || model.empty} onClick={addCutoff}>
                  {param ? 'Mostrar el cutoff' : 'Agregar cutoff libre'}
                </Button>
              )}
              <p className="plot-hint">
                {param
                  ? `Es el cutoff del módulo de cutoffs: arrastrarlo recalcula el pay. Con una sola zona filtrada cambia el de esa zona.`
                  : 'Línea libre: no cambia la petrofísica. Arrastrala o movela con las flechas desde su manija.'}
              </p>
            </ControlGroup>
          </div>
          <aside className="plot-panel__aside" aria-label="Estadísticos">
            <div className="plot-group__title">Estadísticos{curve?.unitText ? ` (${curve.unitText})` : ''}</div>
            <DataTable
              dense
              data-testid="histogram-stats"
              rows={statsRows}
              rowKey={(r) => r.id}
              empty="Sin muestras en el filtro."
              columns={[
                {
                  key: 'name',
                  header: 'Serie',
                  render: (r) => (
                    <span className="plot-series">
                      {r.color && <span className="plot-dot" style={{ background: r.color }} aria-hidden="true" />}
                      {r.name}
                    </span>
                  ),
                },
                { key: 'n', header: 'n', align: 'num', render: (r) => formatNumber(r.st.n, { digits: 0 }) },
                { key: 'mean', header: geometric ? 'Media g.' : 'Media', title: geometric ? 'Media geométrica (escala log)' : 'Media aritmética', align: 'num', render: (r) => fmt(r.st.mean) },
                { key: 'p10', header: 'P10', title: 'Percentil 10: el 10 % de las muestras queda por debajo', align: 'num', render: (r) => fmt(r.st.p10) },
                { key: 'p50', header: 'P50', title: 'Mediana', align: 'num', render: (r) => fmt(r.st.p50) },
                { key: 'p90', header: 'P90', title: 'Percentil 90', align: 'num', render: (r) => fmt(r.st.p90) },
              ]}
            />
            {model && !model.empty && model.outside > 0 && <p className="plot-hint">{formatNumber(model.outside, { digits: 0 })} muestras fuera del rango graficado (percentiles 0,5–99,5).</p>}
          </aside>
        </div>
        <div className="plot-panel__main">
          {!curve ? (
            <EmptyState size="sm" icon="histogram" title="Elegí una curva" description="La curva elegida ya no está en el pozo o todavía se está calculando." />
          ) : !xAxis || !model || model.empty ? (
            <EmptyState size="sm" icon="histogram" title="Sin datos para graficar" description="La curva no tiene valores en las zonas elegidas." />
          ) : (
            <XYPlot
              height="fill"
              className="plot-panel__plot"
              data-testid="histogram-plot"
              figureId="histograma"
              figureTitle={`Histograma de ${curve.short}`}
              ariaLabel={`Histograma de ${curve.label}${model.series.length > 1 ? ', una serie por zona' : ''}`}
              x={xAxis}
              y={yAxis}
              {...(config.cumulative ? { y2: { kind: 'linear' as const, min: 0, max: 100, label: 'Acumulada', unit: '%' } } : {})}
              bars={model.bars}
              lines={model.lines}
              guides={guides}
              onGuideChange={onGuide}
              onGuideRemove={removeCutoff}
              onBarHover={onBarHover}
              barLabel={barLabel}
            />
          )}
          {model && !model.empty && model.series.length > 1 && (
            <ul className="plot-keybar" aria-label="Series">
              {model.series.map((s) => (
                <li key={s.id}>
                  <span className="plot-dot" style={{ background: s.color }} aria-hidden="true" />
                  {s.name}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
