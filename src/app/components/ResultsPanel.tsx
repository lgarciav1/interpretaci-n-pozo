/** Columna central: lugar reservado al visor (fase 4) y un resumen numérico de los resultados del motor. */
import type { TableValue } from '../../core/module';
import { registry } from '../../modules';
import { useResults } from '../store/results';

const num = (v: unknown, d = 3) => (typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('es-AR', { maximumFractionDigits: d, minimumFractionDigits: d }) : '—');

export function ResultsPanel() {
  const { result, busy, error, mode } = useResults();
  const tables = result?.outputs.filter((o) => o.kind === 'table') ?? [];
  const scalars = result?.outputs.filter((o) => o.kind === 'scalar') ?? [];

  return (
    <>
      <div className="viewer-placeholder">Visor multipista (fase 4)</div>
      <div className="section">
        <h2>Motor de cálculo</h2>
        <div className="stats" data-testid="engine-stats">
          <span className="muted">Ejecución</span>
          <span data-testid="engine-mode">{mode === 'worker' ? 'Web Worker' : mode === 'in-process' ? 'hilo principal (sin worker)' : '—'}</span>
          <span className="muted">Estado</span>
          <span>{busy ? 'calculando…' : 'listo'}</span>
          <span className="muted">Cálculo #</span>
          <span data-testid="engine-seq">{result?.seq ?? '—'}</span>
          <span className="muted">Tiempo en el motor</span>
          <span data-testid="engine-ms">{result ? `${result.stats.ms.toFixed(2)} ms` : '—'}</span>
          <span className="muted">Ida y vuelta</span>
          <span>{result ? `${result.roundTripMs.toFixed(1)} ms` : '—'}</span>
          <span className="muted">Recalculados</span>
          <span data-testid="engine-recomputed">{result ? result.stats.recomputed.join(', ') || 'ninguno (caché)' : '—'}</span>
          <span className="muted">Pedidos coalescidos</span>
          <span>{result?.coalesced ?? 0}</span>
        </div>
        {error && <div className="diag error">{error}</div>}
      </div>
      {tables.map((t) => {
        const spec = Object.values(registry.get(t.moduleId)!.outputs).find((s) => s.kind === 'table' && s.port === t.port);
        const columns = spec?.kind === 'table' ? spec.columns : [];
        const rows = (t.value as TableValue).rows;
        return (
          <div className="section" key={t.key}>
            <h2>{t.label}</h2>
            <table className="grid" data-testid={`table-${t.port}`}>
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th key={c.key} className={c.kind === 'text' ? '' : 'num'}>
                      {c.label}
                      {c.unit && c.unit !== 'unitless' ? ` (${c.unit})` : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    {columns.map((c) => (
                      <td key={c.key} className={c.kind === 'text' ? '' : 'num'}>
                        {c.kind === 'text' ? String(r[c.key] ?? '') : num(r[c.key], c.unit === 'm' ? 1 : 3)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
      {scalars.length > 0 && (
        <div className="section">
          <h2>Valores</h2>
          {scalars.map((s) => (
            <div key={s.key}>
              {s.label}: <strong>{num(s.value)}</strong> {s.unit && s.unit !== 'unitless' ? s.unit : ''}
            </div>
          ))}
        </div>
      )}
      {result && result.diagnostics.length > 0 && (
        <div className="section">
          <h2>Avisos</h2>
          {result.diagnostics.map((d, i) => (
            <div key={i} className={`diag ${d.level}`}>
              {d.message}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
