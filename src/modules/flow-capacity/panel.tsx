/**
 * Panel a medida de la capacidad de flujo (función S, Lorenz estratigráfico): zona elegida (o total), coeficiente
 * de Lorenz y capacidades como datos destacados, gráfico de Lorenz (estratigráfico y ordenado sobre la diagonal
 * homogénea), resumen por zona y tramos de la zona en páginas («Ver más»). Hover sobre la curva estratigráfica =
 * profundidad del tramo; clic = el visor va a ese tramo.
 */
import { useMemo, useState } from 'react';
import { useTrendsUi } from '../../app/trends/store';
import type { TableCell, TableValue } from '../../core/module';
import { XYPlot, type XYLineLayer, type XYPointLayer } from '../../plots/xy/XYPlot';
import type { XYAxis } from '../../plots/xy/axes';
import { Button, CurveSwatch, DataTable, EmptyState, SegmentedControl, curveStyle, formatNumber, useThemeTokens, type Column } from '../../ui';
import type { ModulePanel, ModulePanelProps } from '../../ui/modulePanel';
import { TOTAL_KEY, lorenzSeries, unitsFor, viewRangeFor, zoneKey, type Row, type UnitRow } from './model';
import './panel.css';

const PAGE = 100;
const MAX_POINTS = 1000;
const DIAGONAL = { x: [0, 100], y: [0, 100] };

const fmt = (c: TableCell | number | undefined, digits: number) => formatNumber(typeof c === 'number' && Number.isFinite(c) ? c : null, { digits });
const isTotal = (r: Row) => zoneKey(r.zoneId) === TOTAL_KEY;

const X_AXIS: XYAxis = { kind: 'linear', min: 0, max: 100, label: 'Capacidad de almacenaje acumulada Fφh', unit: '%' };
const Y_AXIS: XYAxis = { kind: 'linear', min: 0, max: 100, label: 'Capacidad de flujo acumulada Fkh', unit: '%' };

const numCol = (key: string, header: string, digits: number): Column<Row> => ({ key, header, align: 'num', render: (r) => fmt(r[key], digits) });
const unitCol = (key: keyof UnitRow, header: string, digits: number): Column<UnitRow> => ({ key, header, align: 'num', render: (u) => fmt(u[key] as number, digits) });

const zoneCol: Column<Row> = { key: 'zone', header: 'Zona', render: (r) => <span className="fcap-zone">{String(r.zone ?? '')}</span> };
const CAPACITY_COLUMNS: readonly Column<Row>[] = [zoneCol, numCol('units', 'Tramos', 0), numCol('h', 'h (m)', 1), numCol('phiH', 'φ·h (m)', 2), numCol('kH', 'k·h (mD·m)', 0)];
const MEAN_COLUMNS: readonly Column<Row>[] = [
  zoneCol,
  numCol('phiMean', 'φ (v/v)', 3),
  numCol('kMean', 'k (mD)', 1),
  { key: 'lc', header: 'Lc', align: 'num', title: 'Coeficiente de Lorenz', render: (r) => <span className="fcap-lc">{fmt(r.lc, 2)}</span> },
];

/** Profundidad del tramo: una sola cifra si es una muestra (tope = base), si no tope–base. */
const depthText = (u: UnitRow) => (u.base - u.top > 1e-6 ? `${fmt(u.top, 2)}–${fmt(u.base, 2)}` : fmt(u.top, 2));

function unitColumns(withZone: boolean): Column<UnitRow>[] {
  return [
    ...(withZone ? [{ key: 'zone', header: 'Zona', render: (u: UnitRow) => <span className="fcap-zone">{u.zone}</span> }] : []),
    { key: 'depth', header: 'Prof. (m)', align: 'num', render: (u) => <span className="fcap-depth">{depthText(u)}</span> },
    unitCol('h', 'h (m)', 2),
    unitCol('phi', 'φ', 3),
    unitCol('k', 'k (mD)', 1),
    unitCol('phiHPct', 'φ·h %', 2),
    unitCol('kHPct', 'k·h %', 2),
    unitCol('cumPhiHPct', 'Σφ·h %', 1),
    unitCol('cumKHPct', 'Σk·h %', 1),
  ];
}

const goTo = (u: UnitRow) => {
  const r = viewRangeFor(u.top, u.base);
  useTrendsUi.getState().requestRange(r.top, r.base);
};

function FlowCapacityPanel({ module, result, zoneId }: ModulePanelProps) {
  const theme = useThemeTokens();
  const table = (port: string) => (result?.outputs.find((o) => o.moduleId === module.id && o.port === port)?.value as TableValue | undefined)?.rows ?? [];
  const summary = table('FLOW_SUMMARY');
  const unitRows = table('FLOW_UNITS');
  const lorenzRows = table('FLOW_LORENZ');

  const keys = summary.map((r) => zoneKey(r.zoneId));
  const [picked, setPicked] = useState<string | null>(null);
  const preferred = zoneId && keys.includes(zoneId) ? zoneId : TOTAL_KEY;
  const key = picked && keys.includes(picked) ? picked : keys.includes(preferred) ? preferred : (keys[0] ?? TOTAL_KEY);
  const [limit, setLimit] = useState({ key, n: PAGE });
  const shown = limit.key === key ? limit.n : PAGE;
  const [hover, setHover] = useState<number | null>(null);

  const units = useMemo(() => unitsFor(unitRows, key), [unitRows, key]);
  const strat = useMemo(() => lorenzSeries(lorenzRows, key, 'strat', MAX_POINTS), [lorenzRows, key]);
  const ordered = useMemo(() => lorenzSeries(lorenzRows, key, 'ordered', MAX_POINTS), [lorenzRows, key]);

  const stratColor = theme.color.accent;
  const orderedColor = curveStyle('PERM', theme.name).color;
  const diagColor = theme.color.textMuted;

  const lines = useMemo<XYLineLayer[]>(
    () => [
      { id: 'diag', name: 'Homogéneo', ...DIAGONAL, color: diagColor, width: 1, dash: [4, 4] },
      { id: 'ordered', name: 'Lorenz ordenado', x: ordered.x, y: ordered.y, color: orderedColor, width: 1.75 },
      { id: 'strat', name: 'Lorenz estratigráfico', x: strat.x, y: strat.y, color: stratColor, width: 2 },
    ],
    [strat, ordered, stratColor, orderedColor, diagColor],
  );
  // Vértices de la curva estratigráfica: invisibles, solo para el puntero (tooltip con la profundidad y clic).
  const unitAt = (j: number): UnitRow | undefined => units[(strat.src[j] ?? 0) - 1];
  const points = useMemo<XYPointLayer[]>(
    () => [
      {
        id: 'strat-pts',
        x: strat.x,
        y: strat.y,
        color: stratColor,
        dense: true,
        alpha: 0,
        radius: 2,
        interactive: true,
        label: (j) => {
          const u = units[(strat.src[j] ?? 0) - 1];
          return u ? `${u.zone ? `${u.zone} · ` : ''}${depthText(u)} m` : 'Tope de la secuencia';
        },
      },
    ],
    [strat, units, stratColor],
  );

  if (summary.length === 0) {
    return <EmptyState size="sm" icon="table" title="Todavía no hay capacidad de flujo" description="El cálculo necesita porosidad efectiva y permeabilidad." />;
  }
  const row = summary.find((r) => zoneKey(r.zoneId) === key);
  const hoverUnit = hover !== null ? unitAt(hover) : undefined;
  const hasZones = !summary.every(isTotal);
  const pick = (k: string) => {
    setPicked(k);
    setHover(null);
  };
  const summaryProps = {
    dense: true,
    className: 'fcap-table',
    rows: summary,
    rowKey: (r: Row) => zoneKey(r.zoneId),
    selectedKey: key,
    onRowClick: (r: Row) => pick(zoneKey(r.zoneId)),
    rowProps: (r: Row) => ({ 'data-total': isTotal(r) && hasZones ? '' : undefined }),
  };
  const options = summary.map((r) => ({ value: zoneKey(r.zoneId), label: String(r.zone ?? '') }));

  return (
    <div className="fcap">
      {options.length > 1 && (
        <SegmentedControl
          aria-label="Zona"
          size="sm"
          wrap
          value={key}
          onChange={pick}
          options={options}
        />
      )}

      {row && (
        <div className="fcap-kpis">
          <div className="fcap-kpi">
            <div className="fcap-kpi__label" title="Coeficiente de Lorenz">Lorenz Lc</div>
            <div className="fcap-kpi__value num">{fmt(row.lc, 2)}</div>
            <div className="fcap-kpi__sub num">{fmt(row.units, 0)} tramos</div>
          </div>
          <div className="fcap-kpi">
            <div className="fcap-kpi__label" title="Capacidad de flujo">Flujo k·h</div>
            <div className="fcap-kpi__value num">
              {fmt(row.kH, 0)} <span className="fcap-kpi__unit">mD·m</span>
            </div>
            <div className="fcap-kpi__sub num">k {fmt(row.kMean, 1)} mD</div>
          </div>
          <div className="fcap-kpi">
            <div className="fcap-kpi__label" title="Capacidad de almacenaje">Almacenaje φ·h</div>
            <div className="fcap-kpi__value num">
              {fmt(row.phiH, 2)} <span className="fcap-kpi__unit">m</span>
            </div>
            <div className="fcap-kpi__sub num">
              en {fmt(row.h, 1)} m
            </div>
          </div>
        </div>
      )}

      <section className="fcap-block" aria-label="Curvas de Lorenz">
        <div className="fcap-legend">
          <span className="fcap-legend__item">
            <CurveSwatch style={{ color: stratColor, dash: [], width: 2, kind: 'line' }} width={18} />
            Estratigráfico (por profundidad)
          </span>
          <span className="fcap-legend__item">
            <CurveSwatch style={{ color: orderedColor, dash: [], width: 1.75, kind: 'line' }} width={18} />
            Ordenado (k/φ decreciente)
          </span>
          <span className="fcap-legend__item">
            <CurveSwatch style={{ color: diagColor, dash: [4, 4], width: 1, kind: 'line' }} width={18} />
            Homogéneo
          </span>
        </div>
        <XYPlot
          x={X_AXIS}
          y={Y_AXIS}
          lines={lines}
          points={points}
          height={280}
          ariaLabel={`Curvas de Lorenz de ${String(row?.zone ?? 'la zona')}: capacidad de flujo acumulada contra capacidad de almacenaje acumulada`}
          emptyText="Sin tramos con φ y k para el filtro elegido."
          onPointHover={(_l, j) => setHover(j)}
          onPointLeave={() => setHover(null)}
          onPointClick={(_l, j) => {
            const u = unitAt(j);
            if (u) goTo(u);
          }}
          figureId={`flow-capacity-lorenz-${key}`}
          figureTitle={`Lorenz · ${String(row?.zone ?? '')}`}
          data-testid="flow-capacity-lorenz"
        />
        <p className="fcap-readout num" aria-live="polite">
          {hoverUnit ? (
            <>
              Tramo {fmt(hoverUnit.index, 0)}
              {hoverUnit.zone && hasZones && key === TOTAL_KEY ? ` de ${hoverUnit.zone}` : ''} · {depthText(hoverUnit)} m · φ {fmt(hoverUnit.phi, 3)} · k {fmt(hoverUnit.k, 1)} mD
              <span className="fcap-readout__hint"> · clic para verlo en el visor</span>
            </>
          ) : (
            <span className="fcap-readout__hint">
              Pasá el puntero por la curva estratigráfica para ver la profundidad de cada tramo.
            </span>
          )}
        </p>
      </section>

      <section className="fcap-block" aria-label="Capacidades por zona">
        <h4 className="fcap-block__title">Capacidades por zona</h4>
        <DataTable<Row> {...summaryProps} data-testid="flow-capacity-summary" columns={CAPACITY_COLUMNS} />
      </section>

      <section className="fcap-block" aria-label="Promedios y heterogeneidad por zona">
        <h4 className="fcap-block__title">Promedios y heterogeneidad</h4>
        <DataTable<Row> {...summaryProps} data-testid="flow-capacity-means" columns={MEAN_COLUMNS} />
      </section>

      <section className="fcap-block" aria-label="Tramos">
        <h4 className="fcap-block__title">
          Tramos <span className="fcap-block__unit">{String(row?.zone ?? '')} · de arriba hacia abajo</span>
        </h4>
        <DataTable<UnitRow>
          dense
          className="fcap-table"
          data-testid="flow-capacity-units"
          maxHeight={320}
          rows={units.length > shown ? units.slice(0, shown) : units}
          rowKey={(u) => String(u.seq)}
          onRowClick={goTo}
          selectedKey={hoverUnit ? String(hoverUnit.seq) : null}
          columns={unitColumns(key === TOTAL_KEY && hasZones)}
          empty="Sin tramos con φ y k para el filtro elegido."
        />
        {units.length > shown && (
          <div className="fcap-more">
            <span className="fcap-note num">
              {formatNumber(shown, { digits: 0 })} de {formatNumber(units.length, { digits: 0 })} tramos
            </span>
            <Button size="sm" variant="ghost" onClick={() => setLimit({ key, n: shown + PAGE * 5 })}>
              Ver {formatNumber(Math.min(PAGE * 5, units.length - shown), { digits: 0 })} más
            </Button>
          </div>
        )}
      </section>
      <p className="fcap-note">Clic en un tramo para verlo en el visor. Con «Muestras por tramo» se agrupan muestras consecutivas; el coeficiente de Lorenz depende de esa resolución.</p>
    </div>
  );
}

export const panel: ModulePanel = { moduleId: 'flow-capacity', component: FlowCapacityPanel };
