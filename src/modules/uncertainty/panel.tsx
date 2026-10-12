/**
 * Panel a medida de la incertidumbre del volumen (función I): botón «Calcular», destino (zona o total), P90/P50/P10
 * en unidades de campo frente al determinista, distribución (histograma + curva de excedencia con los percentiles) y
 * tornado de sensibilidad.
 *
 * Cálculo a pedido: el botón enciende `calculate`; cuando llega el resultado el panel guarda una copia (por pozo) y
 * vuelve a apagar `calculate` en el mismo paso del historial. Así ningún slider (de este módulo o de los cutoffs,
 * φ, Sw…) vuelve a disparar la simulación: si después cambia algo de lo que depende, el panel sigue mostrando la
 * copia marcada como desactualizada, con «Recalcular».
 */
import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import { selectActiveEntry, useProject } from '../../app/store/project';
import type { TableCell, TableValue } from '../../core/module';
import { clearParam, setParam as setProjectParam } from '../../core/state/project';
import { XYPlot, type XYBarLayer, type XYGuide, type XYLineLayer } from '../../plots/xy/XYPlot';
import type { XYAxis } from '../../plots/xy/axes';
import { Button, Callout, CurveSwatch, DataTable, EmptyState, SegmentedControl, fillColor, formatNumber, useThemeTokens, withAlpha, type Column } from '../../ui';
import type { ModulePanel, ModulePanelProps } from '../../ui/modulePanel';
import { CALCULATE_KEY, dependencySignature, exceedanceFor, histogramFor, niceRange, statsOf, targetsOf, tornadoFor, type Row, type TargetStats, type TornadoBar } from './model';
import './panel.css';

const fmt = (v: number | TableCell | undefined, digits: number) =>
  formatNumber(typeof v === 'number' && Number.isFinite(v) ? v : null, {
    digits,
  });
/** Cifras para volúmenes de campo: 3 significativas, sin pasar de 2 decimales en volúmenes grandes. */
const vol = (v: number) => (Number.isFinite(v) ? formatNumber(v, Math.abs(v) >= 100 ? { digits: 0 } : { significant: 3 }) : '—');
const pct = (v: number) => (Number.isFinite(v) ? `${v > 0 ? '+' : v < 0 ? '−' : '±'}${formatNumber(Math.abs(v), { digits: Math.abs(v) < 10 ? 1 : 0 })} %` : '—');

/** Copia del último cálculo de cada pozo (sobrevive al cambio de panel). */
interface Snapshot {
  wellId: string;
  gen: number;
  sig: string;
  iterations: number;
  summary: readonly Row[];
  hist: readonly Row[];
  cdf: readonly Row[];
  tornado: readonly Row[];
  warnings: string[];
}
const useSnapshots = create<{ byWell: Record<string, Snapshot> }>(() => ({
  byWell: {},
}));

let runCounter = 0;

function UncertaintyPanel({ module, interpretation, result }: ModulePanelProps) {
  const theme = useThemeTokens();
  const wellId = useProject((s) => selectActiveEntry(s)?.well.id ?? null);
  const commit = useProject((s) => s.commit);
  const snap = useSnapshots((s) => (wellId ? s.byWell[wellId] : undefined));
  const [group, setGroup] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);

  const calcOn = interpretation.params.global[CALCULATE_KEY] === true;
  const sig = useMemo(() => dependencySignature(interpretation), [interpretation]);
  const table = (port: string) => (result?.outputs.find((o) => o.moduleId === module.id && o.port === port)?.value as TableValue | undefined)?.rows ?? [];
  const liveSummary = table('UNCERTAINTY');
  const warnings = result?.diagnostics.filter((d) => d.moduleId === module.id && d.code === 'module-warning').map((d) => d.message) ?? [];
  const iterations = Number(interpretation.params.global['uncertainty.iterations'] ?? module.params.iterations?.default ?? 0);

  // Llegó el resultado de la simulación: guardar la copia y apagar el cálculo (mismo paso del historial que el botón).
  const arrived = calcOn && !!result && !!wellId && result.wellId === wellId && (liveSummary.length > 0 || warnings.length > 0);
  useEffect(() => {
    if (!arrived || !result || !wellId) return;
    useSnapshots.setState((s) => ({
      byWell: {
        ...s.byWell,
        [wellId]: {
          wellId,
          gen: result.gen,
          sig,
          iterations,
          summary: liveSummary,
          hist: table('UNCERTAINTY_HIST'),
          cdf: table('UNCERTAINTY_CDF'),
          tornado: table('UNCERTAINTY_TORNADO'),
          warnings,
        },
      },
    }));
    commit('Calcular incertidumbre', (p) => clearParam(p, wellId, CALCULATE_KEY), group ? { group } : undefined);
    setGroup(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- solo cuando llega un resultado nuevo con el cálculo encendido
  }, [arrived, result]);

  const calculate = () => {
    if (!wellId) return;
    const g = `uncertainty-calc-${++runCounter}`;
    setGroup(g);
    commit('Calcular incertidumbre', (p) => setProjectParam(p, wellId, CALCULATE_KEY, true), { group: g });
  };

  const stale = !!snap && (snap.sig !== sig || (!!result && result.wellId === snap.wellId && result.gen !== snap.gen));
  const targets = useMemo(() => targetsOf(snap?.summary ?? []), [snap]);
  const key = picked && targets.some((t) => t.key === picked) ? picked : (targets.find((t) => t.total)?.key ?? targets[0]?.key ?? '');
  const target = targets.find((t) => t.key === key);
  const row = snap?.summary.find((r) => r.key === key);
  const stats = row ? statsOf(row) : null;

  if (interpretation.zones.length === 0) {
    return <EmptyState size="sm" icon="layers" title="Faltan zonas" description="El área, el fluido y los factores de volumen se eligen por zona: definí las zonas para simular el volumen." />;
  }
  if (!snap) {
    return (
      <EmptyState
        size="sm"
        icon="activity"
        title="Incertidumbre sin calcular"
        description="La simulación Monte Carlo tarda unas décimas de segundo: se corre a pedido para que los sliders sigan respondiendo al instante. Ajustá los rangos y calculá."
        actions={
          <Button variant="primary" size="sm" icon="play" loading={calcOn} onClick={calculate} data-testid="uncertainty-calculate">
            {calcOn ? 'Calculando…' : 'Calcular'}
          </Button>
        }
      />
    );
  }

  return (
    <div className="unc">
      {stale ? (
        <Callout
          tone="warn"
          title="Resultados desactualizados"
          actions={
            <Button size="sm" variant="primary" icon="refresh" loading={calcOn} onClick={calculate} data-testid="uncertainty-recalculate">
              {calcOn ? 'Calculando…' : 'Recalcular'}
            </Button>
          }
        >
          Cambiaron parámetros, zonas o curvas después del último cálculo.
        </Callout>
      ) : (
        <div className="unc-status">
          <span className="unc-status__text num">{formatNumber(snap.iterations, { digits: 0 })} iteraciones · P90 = estimación baja, P10 = alta</span>
          <Button size="sm" variant="ghost" icon="refresh" loading={calcOn} onClick={calculate}>
            Recalcular
          </Button>
        </div>
      )}

      {snap.warnings.length > 0 && (
        <Callout tone="warn" title={targets.length === 0 ? 'Sin volumen para simular' : undefined}>
          {snap.warnings.map((w) => (
            <div key={w}>{w}</div>
          ))}
        </Callout>
      )}

      {targets.length > 1 && <SegmentedControl aria-label="Destino" size="sm" wrap value={key} onChange={setPicked} options={targets.map((t) => ({ value: t.key, label: t.label }))} />}

      {stats && target && (
        <div className={['unc-body', stale ? 'is-stale' : ''].filter(Boolean).join(' ')}>
          <Kpis stats={stats} />
          <Distribution snap={snap} targetKey={key} stats={stats} fluid={target.fluid} label={target.label} theme={theme} />
          <Tornado bars={tornadoFor(snap.tornado, key, stats.unit, fmt)} unit={stats.unit} theme={theme} label={target.label} />
          <SummaryTable rows={snap.summary} selected={key} onPick={setPicked} />
        </div>
      )}
    </div>
  );
}

function Kpis({ stats }: { stats: TargetStats }) {
  const rel = (v: number) => (stats.det > 0 ? (100 * (v - stats.det)) / stats.det : NaN);
  const card = (id: string, label: string, hint: string, v: number) => (
    <div className={`unc-kpi unc-kpi--${id}`} key={id}>
      <div className="unc-kpi__label" title={hint}>
        {label}
      </div>
      <div className="unc-kpi__value num">
        {vol(v)} <span className="unc-kpi__unit">{stats.unit}</span>
      </div>
      <div className="unc-kpi__sub num">{pct(rel(v))} vs. det.</div>
    </div>
  );
  return (
    <section className="unc-block" aria-label="Percentiles del volumen">
      <div className="unc-kpis">
        {card('p90', 'P90 · baja', 'Volumen superado con 90 % de probabilidad (estimación baja).', stats.p90)}
        {card('p50', 'P50 · central', 'Volumen superado con 50 % de probabilidad (mediana).', stats.p50)}
        {card('p10', 'P10 · alta', 'Volumen superado con 10 % de probabilidad (estimación alta).', stats.p10)}
      </div>
      <p className="unc-note num">
        Determinista{' '}
        <strong>
          {vol(stats.det)} {stats.unit}
        </strong>{' '}
        · media {vol(stats.mean)} · rango {vol(stats.min)}–{vol(stats.max)} {stats.unit}
        {Number.isFinite(stats.spread) && <> · (P10 − P90)/P50 = {formatNumber(stats.spread, { digits: 2 })}</>}
      </p>
    </section>
  );
}

type Theme = ReturnType<typeof useThemeTokens>;

function Distribution({ snap, targetKey, stats, fluid, label, theme }: { snap: Snapshot; targetKey: string; stats: TargetStats; fluid: 'oil' | 'gas'; label: string; theme: Theme }) {
  const hist = useMemo(() => histogramFor(snap.hist, targetKey, stats.unit), [snap, targetKey, stats.unit]);
  const exc = useMemo(() => exceedanceFor(snap.cdf, targetKey, stats.unit), [snap, targetKey, stats.unit]);
  const barColor = fillColor(fluid, theme.name).color;
  const curveColor = theme.color.text;
  const pColor = theme.color.textMuted;
  const detColor = theme.color.accent;

  const range = niceRange([...Array.from(hist.edges), ...Array.from(exc.x), stats.det]);
  const maxFreq = Math.max(0, ...Array.from(hist.values));
  const x: XYAxis = {
    kind: 'linear',
    min: range?.min ?? 0,
    max: range?.max ?? 1,
    label: 'Volumen in situ',
    unit: stats.unit,
  };
  const y: XYAxis = {
    kind: 'linear',
    min: 0,
    max: Math.max(1, Math.ceil((maxFreq * 1.15) / 2) * 2),
    label: 'Frecuencia',
    unit: '%',
  };
  const y2: XYAxis = {
    kind: 'linear',
    min: 0,
    max: 100,
    label: 'Probabilidad de superar',
    unit: '%',
  };

  const bars = useMemo<XYBarLayer[]>(
    () => [
      {
        id: 'hist',
        name: 'Histograma',
        edges: hist.edges,
        values: hist.values,
        color: barColor,
        fillAlpha: 0.35,
      },
    ],
    [hist, barColor],
  );
  const lines = useMemo<XYLineLayer[]>(
    () => [
      {
        id: 'exc',
        name: 'Probabilidad de superar',
        x: exc.x,
        y: exc.y,
        y2: true,
        color: curveColor,
        width: 2,
      },
    ],
    [exc, curveColor],
  );
  const guides = useMemo<XYGuide[]>(
    () => [
      {
        axis: 'x',
        value: stats.p90,
        color: pColor,
        dash: [4, 3],
        label: 'P90',
      },
      { axis: 'x', value: stats.p50, color: pColor, width: 1.5, label: 'P50' },
      {
        axis: 'x',
        value: stats.p10,
        color: pColor,
        dash: [4, 3],
        label: 'P10',
      },
      {
        axis: 'x',
        value: stats.det,
        color: detColor,
        width: 1.5,
        label: 'Det.',
      },
    ],
    [stats, pColor, detColor],
  );

  return (
    <section className="unc-block" aria-label="Distribución del volumen">
      <h4 className="unc-block__title">
        Distribución{' '}
        <span className="unc-block__unit">
          {label} · {stats.unit}
        </span>
      </h4>
      <div className="unc-legend">
        <span className="unc-legend__item">
          <span
            className="unc-legend__bar"
            style={{
              background: withAlpha(barColor, 0.35),
              borderColor: barColor,
            }}
          />
          Frecuencia
        </span>
        <span className="unc-legend__item">
          <CurveSwatch style={{ color: curveColor, dash: [], width: 2, kind: 'line' }} width={18} />
          Probabilidad de superar (eje derecho)
        </span>
        <span className="unc-legend__item">
          <CurveSwatch style={{ color: pColor, dash: [4, 3], width: 1.25, kind: 'line' }} width={18} />
          P90 · P50 · P10
        </span>
        <span className="unc-legend__item">
          <CurveSwatch style={{ color: detColor, dash: [], width: 1.5, kind: 'line' }} width={18} />
          Determinista
        </span>
      </div>
      <XYPlot
        x={x}
        y={y}
        y2={y2}
        bars={bars}
        lines={lines}
        guides={guides}
        height={260}
        ariaLabel={`Distribución del volumen in situ de ${label}: P90 ${vol(stats.p90)}, P50 ${vol(stats.p50)}, P10 ${vol(stats.p10)} ${stats.unit}; determinista ${vol(stats.det)} ${stats.unit}`}
        emptyText="Sin iteraciones para mostrar."
        figureId={`uncertainty-distribution-${targetKey}`}
        figureTitle={`Incertidumbre · ${label}`}
        data-testid="uncertainty-distribution"
      />
    </section>
  );
}

/** Tornado en SVG (estático y chico): barras centradas en el caso base, la parte clara = parámetro en su bajo. */
function Tornado({ bars, unit, theme, label }: { bars: TornadoBar[]; unit: string; theme: Theme; label: string }) {
  if (bars.length === 0) return null;
  const base = bars[0]!.base;
  const values = bars.flatMap((b) => [b.vLow, b.vHigh, b.base]);
  // Margen amplio a los lados: ahí van los valores del parámetro junto a cada barra.
  const r = niceRange(values, 0.3) ?? { min: 0, max: 1 };
  const lowColor = withAlpha(theme.color.accent, 0.4);
  const highColor = theme.color.accent;
  const W = 100; // en %: el SVG escala al ancho del panel
  const pos = (v: number) => (W * (v - r.min)) / (r.max - r.min);
  const ROW = 12;
  return (
    <section className="unc-block" aria-label="Tornado de sensibilidad">
      <h4 className="unc-block__title">
        Tornado{' '}
        <span className="unc-block__unit">
          {label} · {unit} · ordenado por amplitud
        </span>
      </h4>
      <div className="unc-legend">
        <span className="unc-legend__item">
          <span className="unc-legend__bar" style={{ background: lowColor, borderColor: lowColor }} />
          Parámetro en su valor bajo
        </span>
        <span className="unc-legend__item">
          <span className="unc-legend__bar" style={{ background: highColor, borderColor: highColor }} />
          En su valor alto
        </span>
        <span className="unc-legend__item num">
          <span className="unc-legend__rule" />
          Caso base {vol(base)}
        </span>
      </div>
      <div className="unc-tornado" data-testid="uncertainty-tornado" role="list">
        {bars.map((b) => {
          const lo = Math.min(b.vLow, b.vHigh);
          const hi = Math.max(b.vLow, b.vHigh);
          const ok = Number.isFinite(lo) && Number.isFinite(hi);
          const segs = [
            { v: b.vLow, color: lowColor, key: 'low' },
            { v: b.vHigh, color: highColor, key: 'high' },
          ].filter((s) => Number.isFinite(s.v));
          return (
            <div className="unc-tornado__row" role="listitem" key={b.param} aria-label={`${b.label}: ${b.lowText} da ${vol(b.vLow)}, ${b.highText} da ${vol(b.vHigh)} ${unit}`}>
              <div className="unc-tornado__head">
                <span className="unc-tornado__label" title={b.label}>
                  {b.label}
                </span>
                <span className="unc-tornado__swing num" title="Semiamplitud respecto del caso base">
                  ±{formatNumber(b.swingPct / 2, { digits: b.swingPct < 20 ? 1 : 0 })} %
                </span>
              </div>
              <div className="unc-tornado__track">
                <svg viewBox={`0 0 ${W} ${ROW}`} preserveAspectRatio="none" width="100%" height={ROW} aria-hidden="true">
                  {segs.map((s) => {
                    const x0 = pos(Math.min(s.v, base));
                    const x1 = pos(Math.max(s.v, base));
                    return <rect key={s.key} x={x0} y={0} width={Math.max(0.3, x1 - x0)} height={ROW} fill={s.color} />;
                  })}
                </svg>
                {ok && (
                  <>
                    <span className="unc-tornado__val num" style={{ right: `${100 - pos(lo)}%` }}>
                      {b.vLow <= b.vHigh ? b.lowText : b.highText}
                    </span>
                    <span className="unc-tornado__val num" style={{ left: `${pos(hi)}%` }}>
                      {b.vLow <= b.vHigh ? b.highText : b.lowText}
                    </span>
                  </>
                )}
              </div>
            </div>
          );
        })}
        <div className="unc-tornado__base" style={{ left: `${pos(base)}%` }} aria-hidden="true" />
        <div className="unc-tornado__ticks num" aria-hidden="true">
          <span>{vol(r.min)}</span>
          <span className="unc-tornado__tick-base" style={{ left: `${pos(base)}%` }}>
            {vol(base)}
          </span>
          <span>{vol(r.max)}</span>
        </div>
      </div>
    </section>
  );
}

const COLUMNS: readonly Column<Row>[] = [
  {
    key: 'target',
    header: 'Destino',
    render: (r) => (
      <span className="unc-nowrap">
        {targetsOf([r])[0]!.label} <span className="unc-muted">{String(r.fieldUnit ?? '')}</span>
      </span>
    ),
  },
  ...(['detField', 'p90Field', 'p50Field', 'p10Field'] as const).map(
    (k): Column<Row> => ({
      key: k,
      header: {
        detField: 'Det.',
        p90Field: 'P90',
        p50Field: 'P50',
        p10Field: 'P10',
      }[k],
      align: 'num',
      render: (r) => vol(typeof r[k] === 'number' ? (r[k] as number) : NaN),
    }),
  ),
];

function SummaryTable({ rows, selected, onPick }: { rows: readonly Row[]; selected: string; onPick(k: string): void }) {
  return (
    <section className="unc-block" aria-label="Resumen por destino">
      <h4 className="unc-block__title">Resumen por destino</h4>
      <DataTable<Row>
        dense
        className="unc-table"
        data-testid="uncertainty-summary"
        rows={rows}
        rowKey={(r) => String(r.key)}
        selectedKey={selected}
        onRowClick={(r) => onPick(String(r.key))}
        rowProps={(r) => ({
          'data-total': String(r.key).startsWith('TOTAL_') ? '' : undefined,
        })}
        columns={COLUMNS}
      />
    </section>
  );
}

export const panel: ModulePanel = {
  moduleId: 'uncertainty',
  component: UncertaintyPanel,
};
