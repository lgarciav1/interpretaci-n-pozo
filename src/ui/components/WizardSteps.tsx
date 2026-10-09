/**
 * Pasos de un asistente (encabezado de un diálogo de varios pasos): número, check en los completos y el actual
 * resaltado. Solo informa: no navega (para la barra navegable del flujo guiado está `Stepper`).
 */
import './wizard.css';
import { Icon } from './Icon';

export interface WizardStep {
  id: string;
  label: string;
}

export interface WizardStepsProps {
  steps: readonly WizardStep[];
  /** id del paso actual; los anteriores se muestran completos. */
  current: string;
  'aria-label'?: string;
}

export function WizardSteps({ steps, current, ...aria }: WizardStepsProps) {
  const at = steps.findIndex((s) => s.id === current);
  return (
    <ol className="ui-wizard" aria-label={aria['aria-label'] ?? 'Pasos'}>
      {steps.map((s, i) => {
        const state = i === at ? 'current' : i < at ? 'done' : 'todo';
        return (
          <li key={s.id} className={`ui-wizard__step is-${state}`} aria-current={state === 'current' ? 'step' : undefined}>
            {i > 0 && <span className="ui-wizard__line" aria-hidden="true" />}
            <span className="ui-wizard__marker" aria-hidden="true">
              {state === 'done' ? <Icon name="check" size={12} strokeWidth={2.75} /> : <span className="num">{i + 1}</span>}
            </span>
            <span className="ui-wizard__label">
              {s.label}
              {state === 'done' && <span className="ui-visually-hidden"> (completo)</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
