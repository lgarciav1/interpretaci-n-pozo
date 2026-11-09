/** Barra del flujo guiado: pasos con su estado y progreso. Elegir un paso lo abre en el inspector. */
import { Stepper } from '../../ui';
import { flowProgress, STEP_STATUS_LABEL } from '../flow/flow';
import { openStep, useFlow } from '../flow/useFlow';
import { useUi } from '../store/ui';
import { FREE_MODULE_VIEW } from './freeModuleView';

export function FlowBar() {
  const { states, active, suggested } = useFlow();
  const freeModule = useUi((s) => s.activeStepId === FREE_MODULE_VIEW);
  // Con los paneles al costado y un panel a la vista (Crossplot, Resumen…), ningún paso está abierto: la barra no
  // marca uno como activo (docs/decisiones/0069). Elegir un paso vuelve a su vista.
  const panelShown = useUi((s) => s.layout.panels === 'side' && s.sideView === 'panels' && !s.layout.rightCollapsed);
  const { resolved, total } = flowProgress(states);
  return (
    <div className="shell-flowbar">
      <Stepper
        aria-label="Flujo guiado"
        items={states.map((s) => ({
          id: s.def.id,
          label: s.def.label,
          ...(s.def.short ? { shortLabel: s.def.short } : {}),
          status: s.status,
          hint: (
            <>
              <strong>{s.def.title}</strong> · {STEP_STATUS_LABEL[s.status].toLowerCase()}
              <br />
              {s.reason}
            </>
          ),
        }))}
        activeId={freeModule || panelShown ? null : active.def.id}
        suggestedId={suggested?.def.id ?? null}
        onSelect={(id) => openStep(states.find((s) => s.def.id === id)!)}
      />
      <div className="shell-flowbar__progress" aria-label={`${resolved} de ${total} pasos resueltos`}>
        <span className="num">
          {resolved}/{total}
        </span>
        <span className="shell-progress" aria-hidden="true">
          <span style={{ width: `${(resolved / total) * 100}%` }} />
        </span>
      </div>
    </div>
  );
}
