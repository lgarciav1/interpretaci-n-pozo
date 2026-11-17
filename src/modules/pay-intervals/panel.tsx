/**
 * Panel a medida de capas de pay y punzados sugeridos (F04): totales arriba (tramos, Σ pay neto, Σ k·h), tabla ordenada
 * por k·h con casilla para elegir los tramos a punzar, «Elegir los N primeros» / «Limpiar» y «Exportar a Excel».
 * Clic en una fila = el visor va al tramo. Los elegidos se guardan con la interpretación (`moduleState`, entra en
 * deshacer y en el proyecto) y la superposición del módulo los marca en la pista de profundidad.
 * Los parámetros (espesor mínimo, tolerancia) siguen en los controles generados, arriba de este panel.
 */
import { useMemo, useState, type CSSProperties } from 'react';
import { downloadFile } from '../../app/export/exportActions';
import { selectActiveEntry, useProject } from '../../app/store/project';
import { useTrendsUi } from '../../app/trends/store';
import type { TableValue } from '../../core/module';
import { safeFileName } from '../../io/export/files';
import { writeWorkbook } from '../../io/export/xlsx';
import { Button, Checkbox, DataTable, EmptyState, Select, formatNumber, toast, type Column } from '../../ui';
import type { ModulePanel, ModulePanelProps } from '../../ui/modulePanel';
import { TABLE_PORT, exportSheets, firstN, payRowsFrom, picksRecipe, readPicks, resolvePicks, summarize, togglePick, viewRangeFor, type PayRow } from './model';
import './panel.css';

const fmt = (v: number, digits: number) => formatNumber(Number.isFinite(v) ? v : null, { digits });
const depth = (v: number) => formatNumber(v, { digits: 2, grouping: false });
const N_OPTIONS = [1, 2, 3, 4, 5, 8, 10].map((n) => ({ value: String(n), label: String(n) }));

const goTo = (r: PayRow) => {
  const v = viewRangeFor(r.top, r.base);
  useTrendsUi.getState().requestRange(v.top, v.base);
};

function PayIntervalsPanel({ module, interpretation, result }: ModulePanelProps) {
  const wellId = useProject((s) => selectActiveEntry(s)?.well.id ?? null);
  const wellName = useProject((s) => selectActiveEntry(s)?.well.name ?? 'pozo');
  const [focus, setFocus] = useState<string | null>(null);
  const [nFirst, setNFirst] = useState('3');

  const tableRows = (result?.outputs.find((o) => o.moduleId === module.id && o.port === TABLE_PORT)?.value as TableValue | undefined)?.rows;
  const rows = useMemo(() => payRowsFrom(tableRows ?? []), [tableRows]);
  const picks = useMemo(() => readPicks(interpretation), [interpretation]);
  const { picked, orphans } = useMemo(() => resolvePicks(rows, picks), [rows, picks]);
  const pickedSet = useMemo(() => new Set(picked.map((r) => r.key)), [picked]);
  const sum = useMemo(() => summarize(rows), [rows]);
  const pickedSum = useMemo(() => summarize(picked), [picked]);

  if (!result || !wellId) return null;
  const node = result.nodes.find((n) => n.moduleId === module.id);
  const warnings = result.diagnostics.filter((d) => d.moduleId === module.id && d.code === 'module-warning').map((d) => d.message);

  if (!node || node.status === 'missing-input') {
    return (
      <EmptyState
        size="sm"
        icon="layers"
        title="Faltan los cutoffs"
        description="Los tramos de pay salen de la bandera de pay neto (NET_PAY), con φ y Sw. Definí los cutoffs en el paso Cutoffs y volvé al Sumario."
      />
    );
  }
  if (rows.length === 0) {
    const reason = warnings.find((w) => !/PERM/.test(w));
    return (
      <EmptyState
        size="sm"
        icon="layers"
        title="Ningún tramo de pay"
        description={reason ?? 'No hay tramos de pay con los cutoffs y parámetros actuales.'}
      />
    );
  }

  const commitPicks = (label: string, keys: readonly string[]) => useProject.getState().commit(label, picksRecipe(wellId, keys));
  const toggle = (r: PayRow) => {
    const on = !pickedSet.has(r.key);
    // Las elecciones huérfanas (tramos que ya no existen) se descartan al tocar la selección.
    commitPicks(on ? `Elegir tramo ${r.rank} para punzar` : `Quitar tramo ${r.rank} de los punzados`, togglePick(picked.map((p) => p.key), r.key));
  };
  const n = Math.min(Number(nFirst), rows.length);
  const pickFirst = () => commitPicks(`Elegir los ${n} primeros tramos para punzar`, firstN(rows, n));
  const clear = () => commitPicks('Limpiar punzados sugeridos', []);

  const exportXlsx = () => {
    try {
      const bytes = writeWorkbook(exportSheets(rows, picked.map((r) => r.key), { wellName }));
      const name = `${safeFileName(wellName)}_capas_de_pay.xlsx`;
      downloadFile({ name, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', bytes });
      toast({ tone: 'ok', title: 'Capas de pay exportadas', description: `${name} · ${rows.length} tramos${picked.length ? `, ${picked.length} elegidos` : ''}` });
    } catch (err) {
      toast({ tone: 'error', title: 'No se pudo exportar', description: err instanceof Error ? err.message : String(err) });
    }
  };

  const hasZones = rows.some((r) => r.zoneId !== '');
  const anyGaps = rows.some((r) => r.gaps > 0);
  const maxPct = Math.max(0, ...rows.map((r) => (Number.isFinite(r.khPct) ? r.khPct : 0)));

  const columns: Column<PayRow>[] = [
    {
      key: 'pick',
      header: <span className="ui-visually-hidden">Elegido</span>,
      title: 'Elegir para punzar',
      width: 28,
      render: (r) => (
        // La casilla no dispara el salto del visor de la fila.
        <span className="pay-check" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
          <Checkbox checked={pickedSet.has(r.key)} onChange={() => toggle(r)} aria-label={`Elegir el tramo ${r.rank} (${depth(r.top)}–${depth(r.base)} m) para punzar`} />
        </span>
      ),
    },
    {
      key: 'rank',
      header: '#',
      title: hasZones ? 'Orden por capacidad de flujo y zona' : 'Orden por capacidad de flujo',
      render: (r) => (
        <span className="pay-rankcell">
          <span className="pay-rank num">{r.rank}</span>
          {hasZones && <span className="pay-zone">{r.zone}</span>}
        </span>
      ),
    },
    {
      key: 'depth',
      header: 'Tope–base',
      title: 'Tope y base del tramo (m)',
      align: 'num',
      render: (r) => (
        <span className="pay-depth">
          <span>{depth(r.top)}</span>
          <span className="pay-sub">{depth(r.base)}</span>
        </span>
      ),
    },
    {
      key: 'net',
      header: 'Neto',
      align: 'num',
      title: anyGaps ? 'Espesor de pay neto (m); debajo, el bruto con las intercalaciones unidas' : 'Espesor de pay neto (m)',
      render: (r) => (
        <span className="pay-stack">
          <span>{fmt(r.net, 2)}</span>
          {r.gaps > 0 && (
            <span className="pay-sub" title={`${r.gaps} intercalación${r.gaps === 1 ? '' : 'es'} unida${r.gaps === 1 ? '' : 's'}`}>
              de {fmt(r.gross, 2)}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'phisw',
      header: 'φ · Sw',
      align: 'num',
      title: 'Porosidad efectiva y saturación de agua promedio (v/v)',
      render: (r) => (
        <span className="pay-stack">
          <span>{fmt(r.phi, 2)}</span>
          <span className="pay-sub">{fmt(r.sw, 2)}</span>
        </span>
      ),
    },
    sum.hasPerm
      ? {
          key: 'kh',
          header: 'k·h',
          align: 'num',
          title: 'Capacidad de flujo y su parte del total de los tramos listados',
          render: (r) => (
            <span className="pay-kh" title={`${fmt(r.khPct, 1)} % del k·h de los tramos listados`}>
              <span>{fmt(r.kh, r.kh >= 100 ? 0 : 1)}</span>
              <span className="pay-kh__pct">
                <span className="pay-bar" aria-hidden="true">
                  <span className="pay-bar__fill" style={{ '--pct': `${maxPct > 0 ? (100 * (Number.isFinite(r.khPct) ? r.khPct : 0)) / maxPct : 0}%` } as CSSProperties} />
                </span>
                {fmt(r.khPct, r.khPct >= 10 ? 0 : 1)} %
              </span>
            </span>
          ),
        }
      : { key: 'hphi', header: 'h·φ (m)', align: 'num', title: 'Capacidad de almacenaje (sin permeabilidad, el orden es por h·φ)', render: (r) => fmt(r.hphi, 3) },
  ];

  return (
    <div className="pay" data-testid="pay-intervals-panel">
      <div className="pay-kpis">
        <div className="pay-kpi">
          <div className="pay-kpi__label">Tramos</div>
          <div className="pay-kpi__value num" data-testid="pay-count">{rows.length}</div>
          <div className="pay-kpi__sub">{sum.hasPerm ? 'orden por k·h' : 'orden por h·φ'}</div>
        </div>
        <div className="pay-kpi">
          <div className="pay-kpi__label" title="Suma del espesor de pay neto de los tramos listados">Σ pay neto</div>
          <div className="pay-kpi__value num" data-testid="pay-net">
            {fmt(sum.net, 2)} <span className="pay-kpi__unit">m</span>
          </div>
          <div className="pay-kpi__sub num">{sum.gross > sum.net + 1e-6 ? `bruto ${fmt(sum.gross, 2)}` : 'sin intercalaciones'}</div>
        </div>
        <div className="pay-kpi">
          <div className="pay-kpi__label" title="Capacidad de flujo de los tramos listados">Σ k·h</div>
          {sum.hasPerm ? (
            <>
              <div className="pay-kpi__value num" data-testid="pay-kh">{fmt(sum.kh, 0)}</div>
              <div className="pay-kpi__sub">mD·m</div>
            </>
          ) : (
            <>
              <div className="pay-kpi__value pay-kpi__value--muted">—</div>
              <div className="pay-kpi__sub">sin permeabilidad</div>
            </>
          )}
        </div>
      </div>

      <section className="pay-picks" aria-label="Punzados sugeridos">
        <div className="pay-picks__head">
          <h4 className="pay-picks__title">Punzados sugeridos</h4>
          <span className="pay-picks__sum num" data-testid="pay-picked-summary">
            {picked.length
              ? `${picked.length} elegido${picked.length === 1 ? '' : 's'} · ${fmt(pickedSum.net, 2)} m${sum.hasPerm && sum.kh > 0 ? ` · ${fmt((100 * pickedSum.kh) / sum.kh, 0)} % k·h` : ''}`
              : 'ninguno elegido'}
          </span>
        </div>
        <div className="pay-picks__actions">
          <Select size="sm" aria-label="Cantidad de tramos a elegir" value={nFirst} onChange={setNFirst} options={N_OPTIONS} />
          <Button size="sm" variant="secondary" icon="check" onClick={pickFirst} title={`Elige los ${n} tramos de mayor ${sum.hasPerm ? 'k·h' : 'h·φ'}`}>
            Elegir primeros
          </Button>
          <Button size="sm" variant="ghost" icon="x" onClick={clear} disabled={picks.length === 0} className="pay-picks__clear">
            Limpiar
          </Button>
        </div>
      </section>

      <DataTable<PayRow>
        dense
        className="pay-table"
        data-testid="pay-intervals-table"
        maxHeight={360}
        rows={rows}
        rowKey={(r) => r.key}
        columns={columns}
        selectedKey={focus}
        onRowClick={(r) => {
          setFocus(r.key);
          goTo(r);
        }}
        rowProps={(r) => ({ 'data-picked': pickedSet.has(r.key) ? '' : undefined, 'data-rank': String(r.rank) })}
      />

      {orphans > 0 && (
        <p className="pay-note pay-note--warn">
          {orphans === 1 ? 'Un tramo elegido ya no existe' : `${orphans} tramos elegidos ya no existen`} con los parámetros actuales.{' '}
          <button type="button" className="pay-link" onClick={() => commitPicks('Descartar punzados que ya no existen', picked.map((p) => p.key))}>
            Descartarlos
          </button>
        </p>
      )}

      <div className="pay-foot">
        <p className="pay-note">Profundidades en m, k·h en mD·m. Clic en un tramo para verlo en el visor; la casilla lo marca como punzado sugerido en la pista de profundidad.</p>
        <Button size="sm" variant="secondary" icon="download" onClick={exportXlsx} data-testid="pay-export">
          Exportar a Excel
        </Button>
      </div>
    </div>
  );
}

export const panel: ModulePanel = { moduleId: 'pay-intervals', component: PayIntervalsPanel };
