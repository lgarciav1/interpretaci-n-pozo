/** Panel auxiliar de IGR desde CGR: acceso directo a la pista GR · CGR y a la calibración espectral (ADR 0090). */
import { openModuleInspector } from '../../app/shell/moduleNavigation';
import { selectActiveEntry, useProject } from '../../app/store/project';
import { showCgrComparison } from '../../app/tracks/cgrComparison';
import { setSource } from '../../core/state/project';
import { registry } from '../../modules';
import { Badge, Button } from '../../ui';
import type { ModulePanel, ModulePanelProps } from '../../ui/modulePanel';
import '../cgr/panel.css';

function IgrCgrPanel({ result }: ModulePanelProps) {
  const entry = useProject(selectActiveEntry);
  const commit = useProject((s) => s.commit);
  const igrSource = result?.sources['IGR'];
  const active = igrSource?.kind === 'module' && igrSource.moduleId === 'igr-cgr';
  const hasCgr =
    (result?.candidates['CGR']?.some((c) => c.kind === 'curve') ?? false) ||
    (result?.nodes.some((n) => n.moduleId === 'cgr' && n.status === 'ok') ?? false);
  const hasGr = (result?.candidates['GR']?.length ?? 0) > 0;
  const canToggle = active ? hasGr : hasCgr;
  const cgrMod = registry.get('cgr');

  const toggleSource = () => {
    if (!entry) return;
    const wellId = entry.well.id;
    commit(active ? 'Usar GR total para IGR' : 'Usar CGR para IGR', (p) =>
      setSource(p, wellId, 'IGR', { kind: 'module', moduleId: active ? 'igr' : 'igr-cgr' }),
    );
  };

  return (
    <div className="cgr-panel" data-testid="igr-cgr-panel">
      <div className="cgr-panel__head">
        <Badge tone={active ? 'ok' : 'neutral'} variant={active ? 'soft' : 'outline'}>
          {active ? 'Alimentando IGR → Vsh' : 'Alternativa (IGR usa GR total)'}
        </Badge>
      </div>
      <div className="cgr-panel__actions">
        <Button size="sm" variant="secondary" icon="compare" block onClick={() => showCgrComparison()} data-testid="igr-cgr-show-track">
          Ver CGR frente a GR en el visor
        </Button>
        {entry && (
          <Button size="sm" variant={active ? 'ghost' : 'primary'} icon={active ? 'refresh' : 'check'} block disabled={!canToggle} onClick={toggleSource} data-testid="igr-cgr-toggle-source">
            {active ? 'Volver a GR total en IGR' : 'Activar CGR como fuente de IGR'}
          </Button>
        )}
        {cgrMod && (
          <Button size="sm" variant="ghost" icon="sliders" block onClick={() => openModuleInspector(cgrMod)} data-testid="igr-cgr-open-cgr">
            Ver calibración de CGR
          </Button>
        )}
      </div>
      <p className="cgr-panel__note">
        Los extremos de arena limpia y arcilla de este módulo son independientes de los del GR total. Activá «Comparar» arriba o usá Snapshots y Cortina para contrastar el impacto en Vsh, porosidad efectiva y pay neto.
      </p>
    </div>
  );
}

export const panel: ModulePanel = { moduleId: 'igr-cgr', component: IgrCgrPanel };
