/**
 * Panel a medida del sumario por zona (0007, C21): totales destacados y dos tablas angostas (espesores y
 * promedios del pay) que entran en la columna del inspector. La tabla completa sigue en Resultados (dock).
 */
import type { TableCell, TableValue } from '../../core/module';
import { DataTable, EmptyState, formatNumber, type Column } from '../../ui';
import type { ModulePanel, ModulePanelProps } from '../../ui/modulePanel';
import './panel.css';

type Row = Readonly<Record<string, TableCell>>;

const val = (c: TableCell | undefined): number | null => (typeof c === 'number' && Number.isFinite(c) ? c : null);
const fmt = (c: TableCell | undefined, digits: number) => formatNumber(val(c), { digits });
const isTotal = (r: Row) => r.zone === 'Total';

function numCol(key: string, header: string, digits: number): Column<Row> {
  return { key, header, align: 'num', render: (r) => fmt(r[key], digits) };
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

function ZoneSummaryPanel({ module, result }: ModulePanelProps) {
  const out = result?.outputs.find((o) => o.moduleId === module.id && o.port === 'ZONE_SUMMARY');
  const rows = (out?.value as TableValue | undefined)?.rows;
  if (!rows || rows.length === 0) {
    return <EmptyState size="sm" icon="table" title="Todavía no hay sumario" description="El sumario necesita las banderas de los cutoffs, la porosidad efectiva y Sw." />;
  }
  const total = rows.find(isTotal);
  const hasGap = rows.some((r) => payGap(r) !== null);
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
          columns={[zoneCol, numCol('gross', 'Bruto', 1), numCol('netRes', 'Neto res.', 1), numCol('netPay', 'Neto pay', 1), numCol('ntgPay', 'N/G pay', 2), numCol('noData', 'Sin dato', 1), ...(hasGap ? [gapCol] : [])]}
        />
      </section>

      <section className="zsum-block" aria-label="Promedios del pay por zona">
        <h4 className="zsum-block__title">Promedios del pay</h4>
        <DataTable<Row>
          dense
          className="zsum-table"
          data-testid="zone-summary-pay"
          rows={rows}
          rowKey={(r, i) => `${String(r.zone)}-${i}`}
          rowProps={rowProps}
          columns={[
            zoneCol,
            numCol('phiPay', 'φ (v/v)', 3),
            numCol('swPay', 'Sw (v/v)', 3),
            numCol('vshPay', 'Vsh (v/v)', 3),
            numCol('kPay', 'k (mD)', 1),
            numCol('hphiShPay', 'h·φ·Sh (m)', 2),
          ]}
        />
      </section>
      {hasGap && <p className="zsum-note">Sin dato pay: reservorio al que le falta Sw. No se cuenta como no pay; los promedios y el h·φ·Sh usan el resto.</p>}
      <p className="zsum-note">Sw ponderada por volumen poral. La tabla completa (reservorio, kh, h·φ) está en Resultados.</p>
    </div>
  );
}

export const panel: ModulePanel = { moduleId: 'zone-summary', component: ZoneSummaryPanel };
