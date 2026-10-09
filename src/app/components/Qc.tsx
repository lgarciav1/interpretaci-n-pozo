/** Piezas de interfaz del control de calidad: semáforo, conteos, tabla por curva y estado del pozo (caliper). */
import { unitLabel } from '../../core/units';
import type { BoreholeInterval, QcReport, QcStatus } from '../../io';
import { DataTable, StatusDot, Tooltip, formatNumber, type Column, type Tone } from '../../ui';
import './qc.css';

export const QC_STATUS_LABEL: Record<QcStatus, string> = { ok: 'Bien', warning: 'Revisar', bad: 'Mala' };
export const QC_STATUS_TONE: Record<QcStatus, Tone> = { ok: 'ok', warning: 'warn', bad: 'error' };
const ORDER: Record<QcStatus, number> = { bad: 0, warning: 1, ok: 2 };

const fmt = (v: number, d = 2) => formatNumber(v, { digits: d });
const sig = (v: number) => formatNumber(v, { significant: 4 });
const count = (n: number) => n.toLocaleString('es-AR');

/** Semáforo de una curva. Con `reasons`, un tooltip las lista al pasar el mouse. */
export function QcDot({ status, reasons }: { status: QcStatus; reasons?: readonly string[] }) {
  if (!reasons) return <StatusDot tone={QC_STATUS_TONE[status]} label={QC_STATUS_LABEL[status]} />;
  const dot = <StatusDot tone={QC_STATUS_TONE[status]} label={QC_STATUS_LABEL[status]} nativeTitle={false} />;
  return (
    <Tooltip
      placement="right"
      content={
        reasons.length === 0 ? (
          'Sin observaciones'
        ) : (
          <ul className="qc-tip">
            {reasons.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        )
      }
    >
      {dot}
    </Tooltip>
  );
}

/** Cuántas curvas hay en cada estado (semáforo con conteos). */
export function QcCounts({ report }: { report: QcReport }) {
  return (
    <span className="qc-counts" data-testid="qc-counts">
      {(['ok', 'warning', 'bad'] as const).map((s) => {
        const n = report.curves.filter((c) => c.status === s).length;
        return (
          <span key={s} className={n === 0 ? 'qc-counts__item is-zero' : 'qc-counts__item'}>
            <StatusDot tone={n === 0 ? 'neutral' : QC_STATUS_TONE[s]} label={QC_STATUS_LABEL[s]} />
            <span className="num qc-counts__n">{n}</span> {QC_STATUS_LABEL[s].toLowerCase()}
          </span>
        );
      })}
    </span>
  );
}

type CurveQc = QcReport['curves'][number];

const COLUMNS: Column<CurveQc>[] = [
  { key: 'curve', header: 'Curva', render: (c) => <span className="mono qc-table__name">{c.mnemonic}</span> },
  { key: 'role', header: 'Rol', render: (c) => <span className="ui-text-muted">{c.role ?? '—'}</span> },
  {
    key: 'status',
    header: 'Estado',
    render: (c) => (
      <span className="qc-status">
        <StatusDot tone={QC_STATUS_TONE[c.status]} label={QC_STATUS_LABEL[c.status]} />
        <span aria-hidden="true">{QC_STATUS_LABEL[c.status]}</span>
      </span>
    ),
  },
  { key: 'nulls', header: 'Sin dato', align: 'num', title: 'Fracción de muestras sin dato', render: (c) => (c.nullCount === 0 ? '—' : `${fmt(c.nullFraction * 100, 1)} %`) },
  {
    key: 'range',
    header: 'P1 – P99',
    align: 'num',
    title: 'Rango entre los percentiles 1 y 99',
    render: (c) =>
      c.stats ? (
        <>
          {sig(c.stats.p1)} – {sig(c.stats.p99)} <span className="ui-text-muted">{unitLabel(c.unit)}</span>
        </>
      ) : (
        '—'
      ),
  },
  {
    key: 'reasons',
    header: 'Observaciones',
    render: (c) =>
      c.reasons.length === 0 ? (
        <span className="ui-text-muted">Sin observaciones</span>
      ) : (
        <ul className="qc-reasons">
          {c.reasons.map((r, i) => (
            <li key={i} data-severity={r.severity}>
              {r.message}
            </li>
          ))}
        </ul>
      ),
  },
];

/** Tabla completa: semáforo, nulos, rango p1–p99 y observaciones por curva (las peores primero). */
export function QcCurveTable({ report, maxHeight }: { report: QcReport; maxHeight?: number | string }) {
  const curves = [...report.curves].sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  return (
    <DataTable
      className="qc-table"
      data-testid="qc-table"
      caption="Control de calidad por curva"
      rows={curves}
      rowKey={(c) => c.curveId}
      rowProps={(c) => ({ 'data-curve': c.curveId, 'data-status': c.status })}
      columns={COLUMNS}
      {...(maxHeight !== undefined ? { maxHeight } : {})}
    />
  );
}

function intervalText(r: BoreholeInterval): string {
  const range = r.topM === r.baseM ? `${fmt(r.topM)} m` : `${fmt(r.topM)} – ${fmt(r.baseM)} m`;
  const extreme = r.kind === 'washout' ? `+${sig(r.extreme)} in` : `${sig(r.extreme)} in`;
  return `${range} (${extreme})`;
}

/** Derrumbes y tramos con caliper inválido. `compact` muestra solo el resumen, sin la lista de tramos. */
export function BoreholeSummary({ report, compact = false }: { report: QcReport; compact?: boolean }) {
  const b = report.borehole;
  if (!b) return <p className="qc-borehole__meta">Sin caliper: no se pudo evaluar el estado del pozo.</p>;
  const bit = `${sig(b.bitSize)} in${b.bitSizeCurveId ? ` (curva ${b.bitSizeCurveId})` : ' (por defecto)'}`;
  const rows: Array<{ label: string; list: BoreholeInterval[]; samples: number; thickness: number; tone: Tone }> = [
    { label: 'Derrumbe', list: b.washouts, samples: b.washoutSamples, thickness: b.washoutThicknessM, tone: 'warn' },
    { label: 'Caliper inválido', list: b.invalidCaliper, samples: b.invalidCaliperSamples, thickness: b.invalidCaliperThicknessM, tone: 'error' },
  ];
  return (
    <div className={`qc-borehole${compact ? ' is-compact' : ''}`} data-testid="borehole-summary">
      <p className="qc-borehole__meta">
        Caliper <span className="mono">{b.caliperId}</span> · trépano {bit}
      </p>
      {rows.map((r) => (
        <div key={r.label} className="qc-borehole__row">
          <StatusDot tone={r.list.length === 0 ? 'ok' : r.tone} label={r.list.length === 0 ? 'Bien' : 'Revisar'} />
          <span className="qc-borehole__text">
            <span className="qc-borehole__label">{r.label}</span>{' '}
            {r.list.length === 0 ? (
              <span className="ui-text-muted">no se detectó</span>
            ) : (
              <span className="num">
                {r.list.length} {r.list.length === 1 ? 'tramo' : 'tramos'} · ≈ {fmt(r.thickness, 1)} m
                <span className="ui-text-muted"> ({count(r.samples)} muestras)</span>
              </span>
            )}
          </span>
          {!compact && r.list.length > 0 && <div className="qc-borehole__list mono">{r.list.map(intervalText).join(' · ')}</div>}
        </div>
      ))}
      {b.affectedCurveIds.length > 0 && (
        <p className="qc-borehole__note">
          {b.affectedCurveIds.join(' y ')} {b.affectedCurveIds.length === 1 ? 'no es confiable' : 'no son confiables'} en esos tramos.
        </p>
      )}
    </div>
  );
}
