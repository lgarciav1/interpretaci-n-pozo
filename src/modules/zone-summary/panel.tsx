/**
 * Panel a medida del sumario por zona (0007, C21): totales destacados y tres tablas angostas (espesores, promedios del
 * pay y k y RT del pay con las medias geométrica y armónica, 0068) que entran en la columna del inspector; los valores
 * muestran P10/P50/P90 y nulos al pasar el mouse o con el foco. La tabla completa sigue en Resultados.
 */
import { useMemo, useRef, type ReactNode } from 'react';
import { SETTLE_MS, useSettled } from '../../app/useSettled';
import type { ClientResult } from '../../core/engine/client';
import type { TableCell, TableValue } from '../../core/module';
import type { Well } from '../../core/well';
import type { Interpretation } from '../../core/interpretation';
import type { IntervalSummary, SampleDistribution, SummaryInput } from '../../petro/summary';
import type { PositiveMeans } from '../../petro/stats';
import { computedCurves } from '../../app/computed';
import { plotContextOf } from '../../app/plots/context';
import { effectiveWell } from '../../app/preparation/data';
import { selectActiveEntry, useProject } from '../../app/store/project';
import { engineInputData } from '../../plots/data';
import { thicknessOf } from '../../plots/distribution/series';
import { Button, DataTable, EmptyState, Tooltip, formatNumber, type Column } from '../../ui';
import type { ModulePanel, ModulePanelProps } from '../../ui/modulePanel';
import { openZoneDistribution } from '../zone-distribution/dock';
import { zoneSummaryStats } from './stats';
import './panel.css';

type Row = Readonly<Record<string, TableCell>>;

const val = (c: TableCell | undefined): number | null => (typeof c === 'number' && Number.isFinite(c) ? c : null);
const fmt = (c: TableCell | undefined, digits: number) => formatNumber(val(c), { digits });
const isTotal = (r: Row) => r.zone === 'Total';

function numCol(key: string, header: ReactNode, digits: number, title?: string, tip?: (r: Row) => ReactNode, value?: (r: Row) => number): Column<Row> {
  return {
    key,
    header: title ? <span title={title}>{header}</span> : header,
    ...(title ? { title } : {}),
    align: 'num',
    render: (r) => {
      const text = value ? formatNumber(Number.isFinite(value(r)) ? value(r) : null, { digits }) : fmt(r[key], digits);
      const content = tip?.(r);
      // Valor con P10/P50/P90 y nulos al pasar el mouse o con el foco del teclado (Tab).
      return content ? (
        <Tooltip content={content} placement="left">
          <span className="zsum-stat" tabIndex={0}>
            {text}
          </span>
        </Tooltip>
      ) : (
        text
      );
    },
  };
}

// ── estadísticas que se muestran (percentiles, medias geométrica y armónica): fuera del motor ─────────────────────

const statsCache = new WeakMap<ClientResult, { zones: Interpretation['zones']; well: Well; stats: Map<string, IntervalSummary> }>();

/**
 * Sumario completo por fila (percentiles y medias) del resultado a la vista, calculado aparte del motor (ver
 * `stats.ts`, ~9 ms sobre el pozo del TP): una vez por resultado, solo mientras el panel está montado y cuando el
 * resultado se quedó quieto (mientras se arrastra un cutoff se muestran los de antes). Entradas: las mismas que usa el
 * motor para cada puerto (fuente elegida o calculada activa).
 */
function useZoneStats(result: ClientResult | null, interpretation: Interpretation): Map<string, IntervalSummary> | null {
  const entry = useProject(selectActiveEntry);
  const deferred = useSettled(result, SETTLE_MS);
  const last = useRef<{ wellId: string; stats: Map<string, IntervalSummary> } | null>(null);
  const fresh = useMemo(() => {
    const well = entry?.well;
    if (!deferred || !well || deferred.wellId !== well.id) return null;
    const hit = statsCache.get(deferred);
    if (hit && hit.zones === interpretation.zones && hit.well === well) return hit.stats;
    const ew = effectiveWell(well, deferred);
    const ctx = plotContextOf(ew, interpretation, computedCurves(deferred, well));
    const get = (port: string) => engineInputData(ctx, deferred.sources, port) ?? undefined;
    const [netRes, netPay, phi, sw] = [get('NET_RES'), get('NET_PAY'), get('PHIE'), get('SW')];
    if (!netRes || !netPay || !phi || !sw) return null;
    const netSand = get('NET_SAND');
    const input: SummaryInput = { thickness: thicknessOf(ew), netRes, netPay, phi, sw, vsh: get('VSH'), perm: get('PERM'), rt: get('RT'), ...(netSand ? { netSand } : {}) };
    const stats = zoneSummaryStats(input, ew.depth.values, interpretation.zones);
    statsCache.set(deferred, { zones: interpretation.zones, well, stats });
    return stats;
  }, [deferred, entry?.well, interpretation.zones]);
  // Sin resultado (el motor recalcula) se sostienen las del mismo pozo: sin parpadeo.
  if (fresh && entry) last.current = { wellId: entry.well.id, stats: fresh };
  return fresh ?? (last.current && last.current.wellId === entry?.well.id ? last.current.stats : null);
}

const f3 = (v: number) => formatNumber(Number.isFinite(v) ? v : null, { significant: 3 });
const mThk = (v: number) => formatNumber(Number.isFinite(v) ? v : null, { digits: 1 });

function nullLine(count: number, thickness: number, what = 'sin dato'): string {
  if (!Number.isFinite(count)) return 'Curva no disponible';
  return count === 0 ? `Nulos: ninguno` : `Nulos (${what}): ${count} ${count === 1 ? 'muestra' : 'muestras'} · ${mThk(thickness)} m`;
}

function DistTip({ title, d, weight, extra }: { title: string; d: SampleDistribution; weight: string; extra?: ReactNode }) {
  return (
    <div className="zsum-tip">
      <div className="zsum-tip__title">{title}</div>
      {d.n > 0 ? (
        <div className="zsum-tip__row num">
          P10 {f3(d.p10)} · P50 {f3(d.p50)} · P90 {f3(d.p90)}
        </div>
      ) : (
        <div className="zsum-tip__row">Sin muestras con dato</div>
      )}
      <div className="zsum-tip__muted">
        {d.n} {d.n === 1 ? 'muestra' : 'muestras'} · {mThk(d.thickness)} m · {weight}
      </div>
      <div className="zsum-tip__muted">{nullLine(d.nullCount, d.nullThickness)}</div>
      {extra}
    </div>
  );
}

function MeansTip({ title, means, d, unit, note }: { title: string; means: PositiveMeans; d: SampleDistribution; unit: string; note: string }) {
  return (
    <div className="zsum-tip">
      <div className="zsum-tip__title">{title}</div>
      <div className="zsum-tip__row num">
        geométrica {f3(means.geo)} · armónica {f3(means.harm)} {unit}
      </div>
      {d.n > 0 && (
        <div className="zsum-tip__row num">
          P10 {f3(d.p10)} · P50 {f3(d.p50)} · P90 {f3(d.p90)}
        </div>
      )}
      <div className="zsum-tip__muted">{note}</div>
      <div className="zsum-tip__muted">{nullLine(means.nullCount, means.nullWeight, 'sin dato o ≤ 0')}</div>
    </div>
  );
}
const zoneCol: Column<Row> = {
  key: 'zone',
  header: 'Zona',
  render: (r) => (
    <span className="zsum-zone">
      {String(r.zone ?? '')}
      {r.kind === 'Sello' && <span className="zsum-zone__kind">sello</span>}
    </span>
  ),
};

/** Reservorio sin Sw (m) de una fila; el sello y las filas sin faltante no muestran nada. */
const payGap = (r: Row): number | null => {
  const g = val(r.noDataPay);
  return r.kind !== 'Sello' && g !== null && g > 0 ? g : null;
};
const gapCol: Column<Row> = {
  key: 'noDataPay',
  header: 'Sin dato pay',
  align: 'num',
  render: (r) => {
    const g = payGap(r);
    return g === null ? null : (
      <span className="zsum-gap" title="Reservorio al que le falta Sw: no se cuenta como no pay.">
        {formatNumber(g, { digits: 1 })}
      </span>
    );
  },
};

function ZoneSummaryPanel({ module, result, interpretation }: ModulePanelProps) {
  const out = result?.outputs.find((o) => o.moduleId === module.id && o.port === 'ZONE_SUMMARY');
  const rows = (out?.value as TableValue | undefined)?.rows;
  const stats = useZoneStats(result, interpretation);
  const statOf = (r: Row) => stats?.get(String(r.zone ?? '')) ?? null;
  const tipOf = (f: (s: IntervalSummary) => ReactNode) => (r: Row) => {
    const s = statOf(r);
    return s ? f(s) : null;
  };
  const valueOf = (f: (s: IntervalSummary) => number) => (r: Row) => {
    const s = statOf(r);
    return s ? f(s) : NaN;
  };
  if (!rows || rows.length === 0) {
    return <EmptyState size="sm" icon="table" title="Todavía no hay sumario" description="El sumario necesita las banderas de los cutoffs, la porosidad efectiva y Sw." />;
  }
  const total = rows.find(isTotal);
  const hasGap = rows.some((r) => payGap(r) !== null);
  // Arena neta (0054): solo si la bandera llegó (un NET_RES ajeno al módulo de cutoffs no la trae).
  const hasSand = rows.some((r) => val(r.netSand) !== null);
  const rowProps = (r: Row) => ({ 'data-total': isTotal(r) ? '' : undefined });

  return (
    <div className="zsum">
      {total && (
        <div className="zsum-kpis">
          <div className="zsum-kpi">
            <div className="zsum-kpi__label">Neto pay</div>
            <div className="zsum-kpi__value num">
              {fmt(total.netPay, 1)} <span className="zsum-kpi__unit">m</span>
            </div>
            <div className="zsum-kpi__sub num">de {fmt(total.gross, 1)} m brutos</div>
          </div>
          <div className="zsum-kpi">
            <div className="zsum-kpi__label">N/G pay</div>
            <div className="zsum-kpi__value num">{fmt(total.ntgPay, 2)}</div>
            <div className="zsum-kpi__sub num">reservorio {fmt(total.ntgRes, 2)}</div>
          </div>
          <div className="zsum-kpi">
            <div className="zsum-kpi__label">h·φ·Sh pay</div>
            <div className="zsum-kpi__value num">
              {fmt(total.hphiShPay, 2)} <span className="zsum-kpi__unit">m</span>
            </div>
            <div className="zsum-kpi__sub num">
              φ {fmt(total.phiPay, 3)} · Sw {fmt(total.swPay, 3)}
            </div>
          </div>
        </div>
      )}

      <section className="zsum-block" aria-label="Espesores por zona">
        <h4 className="zsum-block__title">
          Espesores <span className="zsum-block__unit">en m</span>
        </h4>
        <DataTable<Row>
          dense
          className="zsum-table"
          data-testid="zone-summary-thickness"
          rows={rows}
          rowKey={(r, i) => `${String(r.zone)}-${i}`}
          rowProps={rowProps}
          columns={[
            zoneCol,
            numCol('gross', 'Bruto', 1),
            ...(hasSand ? [numCol('netSand', 'Arena', 1, 'Arena neta: Vsh no mayor que el corte.')] : []),
            numCol('netRes', 'Res.', 1, 'Reservorio neto (permeable): arena con porosidad y, si se usa, permeabilidad sobre el corte.'),
            numCol('netPay', 'Pay', 1, 'Pay neto (útil): reservorio con Sw no mayor que el corte.'),
            numCol('ntgPay', 'N/G pay', 2),
            numCol('noData', 'Sin dato', 1),
            ...(hasGap ? [gapCol] : []),
          ]}
        />
      </section>

      <section className="zsum-block" aria-label="Promedios del pay por zona">
        <h4 className="zsum-block__title">
          Promedios del pay <span className="zsum-block__unit">φ, Sw y Vsh en v/v</span>
        </h4>
        <DataTable<Row>
          dense
          className="zsum-table"
          data-testid="zone-summary-pay"
          rows={rows}
          rowKey={(r, i) => `${String(r.zone)}-${i}`}
          rowProps={rowProps}
          columns={[
            zoneCol,
            numCol('phiPay', 'φ', 3, undefined, tipOf((s) => <DistTip title="φ del pay" d={s.statsPay.phi} weight="pesos por espesor" />)),
            numCol('swPay', 'Sw', 3, undefined, tipOf((s) => <DistTip title="Sw del pay" d={s.statsPay.sw} weight="pesos por volumen poral h·φ" />)),
            numCol('vshPay', 'Vsh', 3, undefined, tipOf((s) => <DistTip title="Vsh del pay" d={s.statsPay.vsh} weight="pesos por espesor" />)),
            numCol('hphiShPay', 'h·φ·Sh m', 2, 'Espesor equivalente de hidrocarburo del pay, en m.'),
          ]}
        />
      </section>

      <section className="zsum-block" aria-label="Permeabilidad y resistividad del pay por zona">
        <h4 className="zsum-block__title">
          k y RT del pay <span className="zsum-block__unit">g: media geométrica</span>
        </h4>
        <DataTable<Row>
          dense
          className="zsum-table"
          data-testid="zone-summary-k-rt"
          rows={rows}
          rowKey={(r, i) => `${String(r.zone)}-${i}`}
          rowProps={rowProps}
          columns={[
            zoneCol,
            numCol('kPay', 'k (mD)', 1, 'Media aritmética ponderada por espesor: flujo paralelo a las capas (kh).', tipOf((s) => <DistTip title="k del pay" d={s.statsPay.k} weight="pesos por espesor" />)),
            numCol(
              'kgPay',
              <>
                k<span className="zsum-g">g</span> (mD)
              </>,
              2,
              'Media geométrica de k ponderada por espesor (solo k > 0).',
              tipOf((s) => <MeansTip title="k del pay" means={s.kMeansPay} d={s.statsPay.k} unit="mD" note="La armónica es la k con flujo perpendicular a las capas (en serie)." />),
              valueOf((s) => s.kMeansPay.geo),
            ),
            numCol(
              'rtgPay',
              <>
                RT<span className="zsum-g">g</span> (Ω·m)
              </>,
              2,
              'Media geométrica de RT ponderada por espesor (solo RT > 0).',
              tipOf((s) => (
                <MeansTip title="RT del pay" means={s.rtMeansPay} d={s.statsPay.rt} unit="Ω·m" note={`La armónica es la RT con corriente paralela a la estratificación, la que leen las herramientas de inducción.${s.statsRes.rt.n > 0 ? ` En todo el reservorio: P10 ${f3(s.statsRes.rt.p10)} · P50 ${f3(s.statsRes.rt.p50)} · P90 ${f3(s.statsRes.rt.p90)}.` : ''}`} />
              )),
              valueOf((s) => s.rtMeansPay.geo),
            ),
            numCol(
              'rthPay',
              <>
                RT<span className="zsum-g">h</span>
              </>,
              2,
              'Media armónica de RT ponderada por espesor: corriente paralela a las capas (inducción).',
              tipOf((s) => <MeansTip title="RT del pay" means={s.rtMeansPay} d={s.statsPay.rt} unit="Ω·m" note="Armónica: resistividad con corriente paralela a la estratificación (inducción)." />),
              valueOf((s) => s.rtMeansPay.harm),
            ),
          ]}
        />
        {!stats && <p className="zsum-note">Calculando las medias geométricas y los percentiles…</p>}
      </section>
      {hasGap && <p className="zsum-note">Sin dato pay: reservorio al que le falta Sw. No se cuenta como no pay; los promedios y el h·φ·Sh usan el resto.</p>}
      <p className="zsum-note">
        {hasSand ? 'Arena neta ⊇ reservorio neto (permeable) ⊇ pay neto (útil). ' : ''}Sw ponderada por volumen poral. Pasá el mouse (o Tab) sobre un valor subrayado para ver P10, P50, P90 y los nulos. La tabla completa (reservorio, kh, h·φ) está en Resultados.
      </p>
      <div className="zsum-more">
        <Button size="sm" variant="secondary" icon="boxplot" onClick={openZoneDistribution} data-testid="zone-summary-distributions">
          Ver distribuciones
        </Button>
        <span className="zsum-note">P10, P50 y P90 de φ, Sw, Vsh o k en cada zona, y comparación con snapshots.</span>
      </div>
    </div>
  );
}

export const panel: ModulePanel = { moduleId: 'zone-summary', component: ZoneSummaryPanel };
