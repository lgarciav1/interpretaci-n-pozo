/** Barra del flujo guiado: pasos con su estado y progreso. Elegir un paso lo abre en el inspector. */
import { Stepper, Tooltip } from '../../ui';
import { flowProgress, STEP_STATUS_LABEL } from '../flow/flow';
import { openStep, useFlow } from '../flow/useFlow';
import { useUi } from '../store/ui';
import { FREE_MODULE_VIEW } from './freeModuleView';
import { WalkthroughClock } from './WalkthroughClock';

export function FlowBar() {
  const { states, active, suggested } = useFlow();
  const freeModule = useUi((s) => s.activeStepId === FREE_MODULE_VIEW);
  // Con los paneles al costado y un panel a la vista (Crossplot, Resumen…), ningún paso está abierto: la barra no
  // marca uno como activo (docs/decisiones/0069). Elegir un paso vuelve a su vista.
  const panelShown = useUi((s) => s.layout.panels === 'side' && s.sideView === 'panels' && !s.layout.rightCollapsed);
  const { computed, reviewed, total } = flowProgress(states);
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const counter = `${plural(computed, 'calculado', 'calculados')} · ${plural(reviewed, 'revisado', 'revisados')}`;
  const counterLong = `${plural(computed, 'paso calculado', 'pasos calculados')} y ${plural(reviewed, 'revisado', 'revisados')}, de ${total}`;
  return (
    <div className="shell-flowbar">
      <Stepper
        aria-label="Flujo guiado"
        items={states.map((s) => ({
          id: s.def.id,
          label: s.def.label,
          ...(s.def.short ? { shortLabel: s.def.short } : {}),
          status: s.status,
          // «Revisado» solo importa donde hay resultado o marca: pendiente, sin módulos o bloqueado se ven como siempre.
          ...(s.status === 'done' || s.status === 'partial' || s.status === 'skipped' ? { reviewed: s.reviewed } : {}),
          hint: (
            <>
              <strong>{s.def.title}</strong> · {STEP_STATUS_LABEL[s.status].toLowerCase()}
              <br />
              {s.reason}
              {s.reviewReason ? (
                <>
                  <br />
                  {s.reviewReason}
                </>
              ) : (
                s.status === 'done' && (
                  <>
                    <br />
                    Calculado con valores de fábrica: todavía no lo tocaste.
                  </>
                )
              )}
            </>
          ),
        }))}
        activeId={freeModule || panelShown ? null : active.def.id}
        suggestedId={suggested?.def.id ?? null}
        onSelect={(id) => openStep(states.find((s) => s.def.id === id)!)}
      />
      <Tooltip content={`${counterLong}. Calculado: tiene resultado. Revisado: cambiaste algo o lo marcaste a mano.`} placement="bottom" align="end" describe={false}>
        <div className="shell-flowbar__progress" role="group" tabIndex={0} aria-label={`${counterLong}. Calculado: tiene resultado. Revisado: cambiaste algo o lo marcaste a mano.`}>
          <span className="shell-flowbar__count shell-flowbar__count--long num" aria-hidden="true">
            {counter}
          </span>
          <span className="shell-flowbar__count shell-flowbar__count--short num" aria-hidden="true">
            {computed} · {reviewed} rev.
          </span>
          <span className="shell-progress" aria-hidden="true">
            <span className="shell-progress__computed" style={{ width: `${(Math.max(computed, reviewed) / total) * 100}%` }} />
            <span className="shell-progress__reviewed" style={{ width: `${(reviewed / total) * 100}%` }} />
          </span>
        </div>
      </Tooltip>
      <WalkthroughClock />
    </div>
  );
}
