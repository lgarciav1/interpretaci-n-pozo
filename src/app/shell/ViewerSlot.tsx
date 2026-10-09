/**
 * Lugar del visor multipista (fase 4). Hoy muestra los encabezados de pista con las curvas del pozo (paleta,
 * escala y unidad de cada una, del sistema de diseño) y un cuerpo vacío. La fase 4 reemplaza el cuerpo por el canvas.
 */
import { unitLabel } from '../../core/units';
import { registry } from '../../modules';
import { Button, CurveLegend, EmptyState, formatNumber } from '../../ui';
import { selectActiveEntry, useProject } from '../store/project';
import { useResults } from '../store/results';
import { useUi } from '../store/ui';
import { TRACK_TEMPLATES } from './trackTemplates';

export function ViewerSlot() {
  const entry = useProject(selectActiveEntry);
  const workspace = useUi((s) => s.workspace);
  const result = useResults((s) => s.result);
  const setUi = useUi((s) => s.set);

  if (!entry) {
    return (
      <div className="shell-viewer shell-viewer--empty">
        <EmptyState
          size="lg"
          icon="tracks"
          title="Cargá un pozo para ver sus perfiles"
          description="Excel, LAS o CSV. También podés empezar con los datos del TP, que vienen incluidos en la app."
          actions={
            <>
              <Button variant="primary" icon="upload" onClick={() => setUi({ loadDialog: {} })}>
                Cargar pozo
              </Button>
              <Button icon="table" onClick={() => setUi({ loadDialog: { source: 'tp' } })}>
                Usar datos del TP
              </Button>
            </>
          }
        />
      </div>
    );
  }

  const { well } = entry;
  const d = well.depth.values;
  const computed = new Set(result?.outputs.filter((o) => o.kind === 'curve' && o.active).map((o) => o.port) ?? []);
  const tracks = TRACK_TEMPLATES[workspace].map((t) => {
    if (t.depth) return { t, curves: [] as { key: string; role: string; name: string; unit?: string }[] };
    const curves: { key: string; role: string; name: string; unit?: string }[] = [];
    for (const role of t.roles ?? []) {
      for (const c of well.curves.filter((c) => c.role === role)) curves.push({ key: c.id, role, name: c.mnemonic, unit: unitLabel(registry.roles.get(role)?.unit ?? c.unit) });
      if (computed.has(role) && !well.curves.some((c) => c.role === role)) curves.push({ key: `calc-${role}`, role, name: role, unit: unitLabel(registry.roles.get(role)!.unit) });
    }
    return { t, curves };
  });

  return (
    <div className="shell-viewer" aria-label="Visor multipista">
      <div className="viewer-tracks" style={{ gridTemplateColumns: tracks.map(({ t }) => `minmax(0, ${t.flex ?? 1}fr)`).join(' ') }}>
        {tracks.map(({ t, curves }) => (
          <div key={t.id} className={`viewer-track${t.depth ? ' viewer-track--depth' : ''}`}>
            <div className="viewer-track__head">
              <div className="viewer-track__title">{t.title}</div>
              {t.depth ? (
                <div className="viewer-track__depth num">m</div>
              ) : curves.length === 0 ? (
                <div className="viewer-track__none">sin curvas</div>
              ) : (
                curves.map((c) => <CurveLegend key={c.key} role={c.role} name={c.name} {...(c.unit ? { unit: c.unit } : {})} catalog={registry.roles} />)
              )}
            </div>
            <div className="viewer-track__body">
              {t.depth && (
                <div className="viewer-depth-ticks num" aria-hidden="true">
                  {[0, 0.2, 0.4, 0.6, 0.8].map((f) => (
                    <span key={f} style={{ top: `${f * 100}%` }}>
                      {formatNumber(d[0]! + f * (d[d.length - 1]! - d[0]!), { digits: 0 })}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="viewer-note">
        <span className="viewer-note__badge">Fase 4</span>
        El visor multipista en canvas se dibuja acá. Los encabezados ya usan la paleta de curvas del sistema de diseño.
      </div>
    </div>
  );
}
