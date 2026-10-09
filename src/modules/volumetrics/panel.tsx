/**
 * Panel a medida del volumen in situ (0007, C22): totales en SI y en unidades de campo y una tabla por zona que
 * entra en la columna del inspector (las columnas de gas aparecen solo si alguna zona es de gas).
 */
import type { TableCell, TableValue } from '../../core/module';
import { DataTable, EmptyState, formatNumber, type Column } from '../../ui';
import type { ModulePanel, ModulePanelProps } from '../../ui/modulePanel';
import './panel.css';

type Row = Readonly<Record<string, TableCell>>;

const val = (c: TableCell | undefined): number | null => (typeof c === 'number' && Number.isFinite(c) ? c : null);
const fmt = (c: TableCell | undefined, digits: number) => formatNumber(val(c), { digits });
const isTotal = (r: Row) => r.zone === 'Total';
const numCol = (key: string, header: string, digits: number): Column<Row> => ({ key, header, align: 'num', render: (r) => fmt(r[key], digits) });

function VolumetricsPanel({ module, result, interpretation }: ModulePanelProps) {
  const out = result?.outputs.find((o) => o.moduleId === module.id && o.port === 'VOLUMETRICS');
  const rows = (out?.value as TableValue | undefined)?.rows ?? [];
  if (interpretation.zones.length === 0) {
    return <EmptyState size="sm" icon="layers" title="Hacen falta zonas" description="El área, el fluido y el factor de volumen se eligen por zona. Definí zonas en el paso Zonas." />;
  }
  if (rows.length === 0) {
    return <EmptyState size="sm" icon="table" title="Todavía no hay volumen" description="El volumen necesita el h·φ·Sh del sumario por zona." />;
  }
  // Reservorio sin Sw por zona (del sumario): el volumen usa solo el resto. El sello y las zonas sin faltante no muestran nada.
  const summary = (result?.outputs.find((o) => o.port === 'ZONE_SUMMARY')?.value as TableValue | undefined)?.rows ?? [];
  const gaps = summary
    .filter((r) => !isTotal(r) && r.kind !== 'Sello' && (val(r.noDataPay) ?? 0) > 0)
    .map((r) => {
      const gap = val(r.noDataPay)!;
      const res = val(r.netRes);
      const unknown = val(r.netPay) === null;
      return { zone: String(r.zone ?? ''), text: unknown ? 'sin Sw en todo el reservorio: sin dato' : `${fmt(gap, 1)} m de reservorio sin Sw${res ? ` (${Math.round((100 * gap) / res)} %)` : ''}` };
    });
  const total = rows.find(isTotal);
  const zones = rows.filter((r) => !isTotal(r));
  const hasGas = zones.some((r) => r.fluid === 'Gas');
  const hasOil = zones.some((r) => r.fluid === 'Petróleo') || !hasGas;

  return (
    <div className="vol">
      {total && (
        <div className="vol-kpis">
          {hasOil && (
            <div className="vol-kpi">
              <div className="vol-kpi__label">Petróleo in situ</div>
              <div className="vol-kpi__value num">
                {fmt(total.ooipField, 2)} <span className="vol-kpi__unit">MMbbl</span>
              </div>
              <div className="vol-kpi__sub num">{fmt(total.ooipSi, 1)} Mm³ estándar</div>
            </div>
          )}
          {hasGas && (
            <div className="vol-kpi">
              <div className="vol-kpi__label">Gas in situ</div>
              <div className="vol-kpi__value num">
                {fmt(total.ogipField, 2)} <span className="vol-kpi__unit">Bcf</span>
              </div>
              <div className="vol-kpi__sub num">{fmt(total.ogipSi, 2)} MMm³ estándar</div>
            </div>
          )}
        </div>
      )}
      <DataTable<Row>
        dense
        className="vol-table"
        data-testid="volumetrics-table"
        rows={rows}
        rowKey={(r, i) => `${String(r.zone)}-${i}`}
        rowProps={(r) => ({ 'data-total': isTotal(r) ? '' : undefined })}
        columns={[
          { key: 'zone', header: 'Zona', render: (r) => <span className="vol-zone">{String(r.zone ?? '')}</span> },
          { key: 'fluid', header: 'Fluido', render: (r) => <span className="vol-fluid">{String(r.fluid ?? '')}</span> },
          numCol('hphiSh', 'h·φ·Sh (m)', 2),
          ...(hasOil ? [numCol('ooipSi', 'Petróleo (Mm³)', 1), numCol('ooipField', '(MMbbl)', 2)] : []),
          ...(hasGas ? [numCol('ogipSi', 'Gas (MMm³)', 2), numCol('ogipField', '(Bcf)', 2)] : []),
        ]}
      />
      {gaps.length > 0 && (
        <ul className="vol-gaps" aria-label="Reservorio sin dato de Sw">
          {gaps.map((g) => (
            <li key={g.zone}>
              {g.zone}: {g.text}
            </li>
          ))}
        </ul>
      )}
      <p className="vol-note">Volúmenes a condiciones de superficie. Las zonas de tipo sello no aportan volumen.</p>
    </div>
  );
}

export const panel: ModulePanel = { moduleId: 'volumetrics', component: VolumetricsPanel };
