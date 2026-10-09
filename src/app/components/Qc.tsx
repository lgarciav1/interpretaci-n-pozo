/** Piezas de interfaz del control de calidad: semáforo, tabla por curva y resumen del estado del pozo. */
import { unitLabel } from '../../core/units';
import type { BoreholeInterval, QcReport, QcStatus } from '../../io';

export const QC_STATUS_LABEL: Record<QcStatus, string> = { ok: 'Bien', warning: 'Revisar', bad: 'Mala' };

const fmt = (v: number, d = 2) => v.toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });
const sig = (v: number) => v.toLocaleString('es-AR', { maximumSignificantDigits: 4 });

export function QcDot({ status, title }: { status: QcStatus; title?: string }) {
  return <span className={`qc-dot ${status}`} role="img" aria-label={QC_STATUS_LABEL[status]} title={title ?? QC_STATUS_LABEL[status]} />;
}

/** Resumen de una línea: cuántas curvas en cada estado. */
export function QcCounts({ report }: { report: QcReport }) {
  const count = (s: QcStatus) => report.curves.filter((c) => c.status === s).length;
  return (
    <span className="qc-counts">
      {(['ok', 'warning', 'bad'] as const).map((s) => (
        <span key={s}>
          <QcDot status={s} /> {count(s)} {QC_STATUS_LABEL[s].toLowerCase()}
        </span>
      ))}
    </span>
  );
}

/** Tabla completa: semáforo, nulos, rango p1–p99 y razones por curva. */
export function QcCurveTable({ report }: { report: QcReport }) {
  const order: Record<QcStatus, number> = { bad: 0, warning: 1, ok: 2 };
  const curves = [...report.curves].sort((a, b) => order[a.status] - order[b.status]);
  return (
    <table className="grid qc-table" data-testid="qc-table">
      <thead>
        <tr>
          <th>Curva</th>
          <th>Rol</th>
          <th>Estado</th>
          <th className="num">Sin dato</th>
          <th className="num">P1 – P99</th>
          <th>Observaciones</th>
        </tr>
      </thead>
      <tbody>
        {curves.map((c) => (
          <tr key={c.curveId} data-curve={c.curveId} data-status={c.status}>
            <td className="mono">{c.mnemonic}</td>
            <td className="muted">{c.role ?? '—'}</td>
            <td className="nowrap">
              <QcDot status={c.status} /> {QC_STATUS_LABEL[c.status]}
            </td>
            <td className="num nowrap">{c.nullCount === 0 ? '—' : `${fmt(c.nullFraction * 100, 1)} %`}</td>
            <td className="num nowrap">
              {c.stats ? `${sig(c.stats.p1)} – ${sig(c.stats.p99)}` : '—'} <span className="muted">{c.stats ? unitLabel(c.unit) : ''}</span>
            </td>
            <td>
              {c.reasons.length === 0 ? (
                <span className="muted">Sin observaciones</span>
              ) : (
                <ul className="qc-reasons">
                  {c.reasons.map((r, i) => (
                    <li key={i} className={r.severity}>
                      {r.message}
                    </li>
                  ))}
                </ul>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function intervalText(r: BoreholeInterval): string {
  const range = r.topM === r.baseM ? `${fmt(r.topM)} m` : `${fmt(r.topM)} – ${fmt(r.baseM)} m`;
  const extreme = r.kind === 'washout' ? `+${sig(r.extreme)} in` : `${sig(r.extreme)} in`;
  return `${range} (${extreme})`;
}

/** Derrumbes y tramos con caliper inválido. `compact` muestra solo el resumen. */
export function BoreholeSummary({ report, compact = false }: { report: QcReport; compact?: boolean }) {
  const b = report.borehole;
  if (!b) return <div className="muted">Sin caliper: no se pudo evaluar el estado del pozo.</div>;
  const bit = `${sig(b.bitSize)} in${b.bitSizeCurveId ? ` (curva ${b.bitSizeCurveId})` : ' (por defecto)'}`;
  const rows: Array<[string, BoreholeInterval[], number, number]> = [
    ['Derrumbe', b.washouts, b.washoutSamples, b.washoutThicknessM],
    ['Caliper inválido', b.invalidCaliper, b.invalidCaliperSamples, b.invalidCaliperThicknessM],
  ];
  return (
    <div className="borehole" data-testid="borehole-summary">
      <div className="muted">
        Caliper {b.caliperId} · trépano {bit}
      </div>
      {rows.map(([label, list, samples, thickness]) => (
        <div key={label} className="borehole-row">
          <strong>{label}:</strong>{' '}
          {list.length === 0 ? (
            <span className="muted">no se detectó</span>
          ) : (
            <>
              {list.length} {list.length === 1 ? 'tramo' : 'tramos'}, {samples.toLocaleString('es-AR')} muestras (≈ {fmt(thickness, 1)} m)
              {!compact && <div className="borehole-list mono">{list.map(intervalText).join(' · ')}</div>}
            </>
          )}
        </div>
      ))}
      {b.affectedCurveIds.length > 0 && (
        <div className="muted">
          {b.affectedCurveIds.join(' y ')} {b.affectedCurveIds.length === 1 ? 'no es confiable' : 'no son confiables'} en esos tramos.
        </div>
      )}
    </div>
  );
}
