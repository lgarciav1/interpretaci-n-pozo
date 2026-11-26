/** Panel de CGR: resumen de calibración espectral, pista GR · CGR y paso a IGR desde CGR (ADR 0090). */
import { openModuleInspector } from '../../app/shell/moduleNavigation';
import { selectActiveEntry, useProject } from '../../app/store/project';
import { showCgrComparison } from '../../app/tracks/cgrComparison';
import type { TableValue } from '../../core/module';
import { setSource } from '../../core/state/project';
import { registry } from '../../modules';
import { MIN_FIT_R2 } from '../../petro/spectralGr';
import { Badge, Button, Callout, EmptyState, formatNumber, type Tone } from '../../ui';
import type { ModulePanel, ModulePanelProps } from '../../ui/modulePanel';
import { CGR_CALIBRATION } from './index';
import './panel.css';

const fmt = (v: unknown, digits = 2) => (typeof v === 'number' && Number.isFinite(v) ? formatNumber(v, { digits }) : '—');
const fmtInt = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? formatNumber(v, { digits: 0 }) : '—');

function statusTone(status: unknown): Tone {
  if (status === 'Coherente') return 'ok';
  if (typeof status === 'string' && (status.includes('bajo') || status.includes('no positivo') || status.includes('Estándar'))) return 'warn';
  return 'neutral';
}

function CgrPanel({ module, result }: ModulePanelProps) {
  const entry = useProject(selectActiveEntry);
  const commit = useProject((s) => s.commit);
  const rows = (result?.outputs.find((o) => o.moduleId === module.id && o.port === CGR_CALIBRATION)?.value as TableValue | undefined)?.rows ?? [];
  const wellRow = rows[0];
  const zoneRows = rows.slice(1);
  const igrSource = result?.sources['IGR'];
  const usingCgrForIgr = igrSource?.kind === 'module' && igrSource.moduleId === 'igr-cgr';
  const hasCgr =
    (result?.candidates['CGR']?.some((c) => c.kind === 'curve') ?? false) ||
    (result?.nodes.some((n) => n.moduleId === 'cgr' && n.status === 'ok') ?? false);
  const hasGr = (result?.candidates['GR']?.length ?? 0) > 0;
  const canToggleIgr = usingCgrForIgr ? hasGr : hasCgr;
  const igrCgrMod = registry.get('igr-cgr');

  const toggleIgrSource = () => {
    if (!entry) return;
    const wellId = entry.well.id;
    if (usingCgrForIgr) {
      commit('Usar GR total para IGR', (p) => setSource(p, wellId, 'IGR', { kind: 'module', moduleId: 'igr' }));
    } else {
      commit('Usar CGR para IGR', (p) => setSource(p, wellId, 'IGR', { kind: 'module', moduleId: 'igr-cgr' }));
    }
  };

  const lowUraniumWeight =
    wellRow &&
    wellRow.source === 'Ajustados en el pozo' &&
    typeof wellRow.c === 'number' &&
    wellRow.c < 0.5 &&
    typeof wellRow.r2 === 'number' &&
    wellRow.r2 >= MIN_FIT_R2;

  return (
    <div className="cgr-panel" data-testid="cgr-panel">
      <div className="cgr-panel__actions">
        <Button size="sm" variant="secondary" icon="compare" block onClick={() => showCgrComparison()} data-testid="cgr-show-track">
          Ver CGR frente a GR en el visor
        </Button>
        {entry && (
          <Button
            size="sm"
            variant={usingCgrForIgr ? 'ghost' : 'primary'}
            icon={usingCgrForIgr ? 'refresh' : 'check'}
            block
            disabled={!canToggleIgr}
            onClick={toggleIgrSource}
            data-testid="cgr-toggle-igr-source"
          >
            {usingCgrForIgr ? 'Volver a GR total en IGR' : 'Usar CGR como fuente de IGR'}
          </Button>
        )}
        {igrCgrMod && (
          <Button size="sm" variant="ghost" icon="sliders" block onClick={() => openModuleInspector(igrCgrMod)} data-testid="cgr-open-igr-cgr">
            Ajustar extremos en IGR desde CGR
          </Button>
        )}
      </div>

      {!wellRow ? (
        <EmptyState size="sm" title="Sin calibración espectral" description="Cargá un pozo con torio (THOR) y potasio (POTA) para calcular CGR." />
      ) : (
        <>
          <div className="cgr-panel__head">
            <Badge tone="neutral" variant="outline">
              {String(wellRow.source ?? '')}
            </Badge>
            <Badge tone={statusTone(wellRow.status)} variant="soft">
              {String(wellRow.status ?? '')}
            </Badge>
            {usingCgrForIgr && (
              <Badge tone="accent" variant="soft">
                IGR usa CGR
              </Badge>
            )}
          </div>

          <dl className="cgr-panel__kv">
            <div className="cgr-panel__metric">
              <dt>Th (gAPI/ppm)</dt>
              <dd>{fmt(wellRow.a, 2)}</dd>
            </div>
            <div className="cgr-panel__metric">
              <dt>K (gAPI/%)</dt>
              <dd>{fmt(wellRow.b, 2)}</dd>
            </div>
            <div className="cgr-panel__metric">
              <dt>U (gAPI/ppm)</dt>
              <dd>{fmt(wellRow.c, 2)}</dd>
            </div>
            <div className="cgr-panel__metric">
              <dt>Muestras</dt>
              <dd>{fmtInt(wellRow.samples)}</dd>
            </div>
            <div className="cgr-panel__metric">
              <dt>R²</dt>
              <dd>{fmt(wellRow.r2, 4)}</dd>
            </div>
            <div className="cgr-panel__metric">
              <dt>RMSE (gAPI)</dt>
              <dd>{fmt(wellRow.rmse, 2)}</dd>
            </div>
          </dl>

          {lowUraniumWeight && (
            <Callout tone="info" icon="info" title="Aporte de uranio casi nulo en el GR medido">
              El ajuste explica el GR casi solo con torio y potasio (coeficiente de uranio cercano a cero): el perfil GR cargado ya se comporta casi como un GR sin uranio.
            </Callout>
          )}

          {zoneRows.length > 0 && (
            <div className="cgr-panel__table">
              <table>
                <thead>
                  <tr>
                    <th>Zona</th>
                    <th className="num">Muestras</th>
                    <th className="num">R²</th>
                    <th className="num">RMSE</th>
                    <th>Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {zoneRows.map((r, i) => (
                    <tr key={String(r.zoneId ?? i)}>
                      <td>{String(r.scope ?? '')}</td>
                      <td className="num">{fmtInt(r.samples)}</td>
                      <td className="num">{fmt(r.r2, 3)}</td>
                      <td className="num">{fmt(r.rmse, 2)}</td>
                      <td>{String(r.status ?? '')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      <p className="cgr-panel__note">
        CGR elimina la radiactividad del uranio pero conserva torio y potasio (arcillas, feldespatos y micas). Activá «Comparar» en IGR desde CGR o guardá un snapshot con Cortina para ver el cambio en Vsh, porosidad efectiva y pay neto.
      </p>
    </div>
  );
}

export const panel: ModulePanel = { moduleId: 'cgr', component: CgrPanel };
