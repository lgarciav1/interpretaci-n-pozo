/** Columna izquierda: pozo, curvas (medidas, con su semáforo de calidad, y calculadas), control de calidad y zonas. */
import { setActiveWell, updateCurveMeta } from '../../core/state/project';
import { unitLabel } from '../../core/units';
import { registry } from '../../modules';
import { selectActiveEntry, useProject } from '../store/project';
import { useWellQc } from '../store/qc';
import { useResults } from '../store/results';
import { useUi } from '../store/ui';
import { BoreholeSummary, QcCounts, QcDot } from './Qc';

const fmt = (v: number, d = 2) => v.toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });

export function WellPanel() {
  const entry = useProject(selectActiveEntry);
  const wells = useProject((s) => s.project.wells);
  const qc = useWellQc(entry?.well ?? null);
  const commit = useProject((s) => s.commit);
  const result = useResults((s) => s.result);
  const editingZoneId = useUi((s) => s.editingZoneId);
  const setUi = useUi((s) => s.set);
  if (!entry) return <div className="section muted">No hay pozo cargado.</div>;
  const { well, interpretation } = entry;
  const d = well.depth.values;
  const computed = result?.outputs.filter((o) => o.kind === 'curve') ?? [];
  const roles = registry.roles.all();

  return (
    <>
      <div className="section">
        <h2>Pozo</h2>
        {wells.length > 1 ? (
          <select
            aria-label="Pozo activo"
            className="well-select"
            value={well.id}
            onChange={(e) => commit('Cambiar de pozo', (p) => setActiveWell(p, e.currentTarget.value))}
          >
            {wells.map((w) => (
              <option key={w.well.id} value={w.well.id}>
                {w.well.name}
              </option>
            ))}
          </select>
        ) : (
          <div style={{ fontWeight: 600 }}>{well.name}</div>
        )}
        <div className="muted" data-testid="well-summary">
          {fmt(d[0]!)} – {fmt(d[d.length - 1]!)} m · {d.length.toLocaleString('es-AR')} muestras
          {well.depth.step ? ` · paso ${fmt(well.depth.step, 4)} m` : ''}
        </div>
      </div>
      <div className="section">
        <h2>Curvas medidas</h2>
        <table className="grid curves">
          <thead>
            <tr>
              <th aria-label="Calidad" />
              <th>Curva</th>
              <th>Rol</th>
              <th>Unidad</th>
            </tr>
          </thead>
          <tbody>
            {well.curves.map((c) => {
              const q = qc?.curves.find((x) => x.curveId === c.id);
              return (
                <tr key={c.id} data-curve={c.id} data-qc={q?.status}>
                  <td className="qc-cell">
                    {q ? <QcDot status={q.status} title={q.reasons.map((r) => r.message).join('\n') || 'Sin observaciones'} /> : null}
                  </td>
                  <td className="mono" title={c.description}>
                    {c.mnemonic}
                  </td>
                  <td>
                    <select
                      aria-label={`Rol de ${c.mnemonic}`}
                      value={c.role ?? ''}
                      onChange={(e) => commit('Asignar rol', (p) => updateCurveMeta(p, well.id, c.id, { role: e.currentTarget.value || null }))}
                    >
                      <option value="">—</option>
                      {roles.map((r) => (
                        <option key={r.id} value={r.id} title={r.label}>
                          {r.id}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="muted nowrap">{unitLabel(c.unit)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="section">
        <h2>Control de calidad</h2>
        {qc ? (
          <>
            <QcCounts report={qc} />
            <BoreholeSummary report={qc} compact />
          </>
        ) : (
          <div className="muted">Analizando…</div>
        )}
      </div>
      <div className="section">
        <h2>Curvas calculadas</h2>
        {computed.length === 0 && <div className="muted">Todavía no hay resultados.</div>}
        {computed.map((o) => (
          <div key={o.key}>
            <span className="mono">{o.port}</span>
            <span className="badge calc">{registry.get(o.moduleId)?.name ?? o.moduleId}</span>
            {!o.active && <span className="badge">alternativa</span>}
          </div>
        ))}
      </div>
      <div className="section">
        <h2>Zonas</h2>
        <table className="grid">
          <thead>
            <tr>
              <th>Zona</th>
              <th className="num">Tope</th>
              <th className="num">Base</th>
            </tr>
          </thead>
          <tbody>
            {interpretation.zones.map((z) => (
              <tr
                key={z.id}
                onClick={() => setUi({ editingZoneId: z.id === editingZoneId ? null : z.id })}
                style={{ cursor: 'pointer', fontWeight: z.id === editingZoneId ? 600 : undefined }}
              >
                <td>
                  <span className="chip" style={{ background: z.color }} />
                  {z.name}
                </td>
                <td className="num">{fmt(z.top)}</td>
                <td className="num">{fmt(z.base)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
