/** Columna izquierda: pozo, curvas (medidas y calculadas) y zonas. */
import { updateCurveMeta } from '../../core/state/project';
import { unitLabel } from '../../core/units';
import { registry } from '../../modules';
import { selectActiveEntry, useProject } from '../store/project';
import { useResults } from '../store/results';
import { useUi } from '../store/ui';

const fmt = (v: number, d = 2) => v.toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });

export function WellPanel() {
  const entry = useProject(selectActiveEntry);
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
        <div style={{ fontWeight: 600 }}>{well.name}</div>
        <div className="muted">
          {fmt(d[0]!)} – {fmt(d[d.length - 1]!)} m · {d.length.toLocaleString('es-AR')} muestras
          {well.depth.step ? ` · paso ${fmt(well.depth.step, 4)} m` : ''}
        </div>
      </div>
      <div className="section">
        <h2>Curvas medidas</h2>
        <table className="grid">
          <thead>
            <tr>
              <th>Curva</th>
              <th>Rol</th>
              <th>Unidad</th>
            </tr>
          </thead>
          <tbody>
            {well.curves.map((c) => (
              <tr key={c.id}>
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
                <td className="muted">{unitLabel(c.unit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
