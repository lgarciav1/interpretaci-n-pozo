/**
 * Barra de pasos del flujo guiado. Genérica: recibe los pasos con su estado ya evaluado (la lógica vive en
 * src/app/flow/flow.ts). Cada paso es un botón; flechas ←/→ recorren los pasos, Enter elige.
 */
import { useRef, type ReactNode } from 'react';
import './stepper.css';
import { Icon } from './Icon';
import { Tooltip } from './Tooltip';

export type StepperStatus = 'done' | 'partial' | 'todo' | 'skipped' | 'empty' | 'locked';

export interface StepperItem {
  id: string;
  label: string;
  status: StepperStatus;
  /** Texto del tooltip (estado y qué hacer). */
  hint?: ReactNode;
}

export interface StepperProps {
  items: readonly StepperItem[];
  /** Paso abierto en el inspector. */
  activeId: string | null;
  /** Paso sugerido (el próximo a resolver): se marca con un punto. */
  suggestedId?: string | null;
  onSelect(id: string): void;
  'aria-label'?: string;
}

const STATUS_TEXT: Record<StepperStatus, string> = {
  done: 'completo',
  partial: 'en curso',
  todo: 'pendiente',
  skipped: 'saltado',
  empty: 'sin módulos todavía',
  locked: 'necesita un pozo',
};

function Marker({ status, index }: { status: StepperStatus; index: number }) {
  switch (status) {
    case 'done':
      return <Icon name="check" size={12} strokeWidth={2.75} />;
    case 'skipped':
      return <Icon name="skip" size={10} strokeWidth={2.25} />;
    case 'locked':
      return <Icon name="lock" size={10} strokeWidth={2.25} />;
    default:
      return <span className="num">{index + 1}</span>;
  }
}

export function Stepper({ items, activeId, suggestedId, onSelect, ...aria }: StepperProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <nav className="ui-stepper" aria-label={aria['aria-label'] ?? 'Pasos'}>
      <ol className="ui-stepper__list">
        {items.map((s, i) => {
          const active = s.id === activeId;
          const prevDone = i > 0 && (items[i - 1]!.status === 'done' || items[i - 1]!.status === 'skipped');
          return (
            <li key={s.id} className={`ui-step ui-step--${s.status}${active ? ' is-active' : ''}${s.id === suggestedId ? ' is-suggested' : ''}`}>
              {i > 0 && <span className={`ui-step__line${prevDone ? ' is-filled' : ''}`} aria-hidden="true" />}
              <Tooltip content={s.hint} placement="bottom">
                <button
                  ref={(el) => {
                    refs.current[i] = el;
                  }}
                  type="button"
                  className="ui-step__button"
                  aria-current={active ? 'step' : undefined}
                  aria-label={`Paso ${i + 1}: ${s.label}, ${STATUS_TEXT[s.status]}`}
                  onClick={() => onSelect(s.id)}
                  onKeyDown={(e) => {
                    const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
                    if (!d) return;
                    e.preventDefault();
                    refs.current[(i + d + items.length) % items.length]?.focus();
                  }}
                >
                  <span className="ui-step__marker" aria-hidden="true">
                    <Marker status={s.status} index={i} />
                  </span>
                  <span className="ui-step__label">{s.label}</span>
                </button>
              </Tooltip>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
