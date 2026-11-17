/**
 * Barra de pasos del flujo guiado. Genérica: recibe los pasos con su estado ya evaluado (la lógica vive en
 * src/app/flow/flow.ts). Cada paso es un botón; flechas ←/→ recorren los pasos, Enter elige.
 *
 * Si no entra en el ancho (ventana angosta, tamaño de interfaz grande), se compacta por etapas en vez de cortar el
 * último paso: `full` → `tight` (conectores cortos) → `short` (abreviaturas, si el paso tiene) → `done` (los pasos
 * resueltos quedan solo con su marca) → `markers` (solo los círculos). El paso activo conserva siempre su rótulo, y el
 * nombre de cada paso sigue en su `aria-label` y en el tooltip.
 */
import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { subscribeUiScale } from '../uiScale';
import './stepper.css';
import { Icon } from './Icon';
import { Tooltip } from './Tooltip';

export type StepperStatus = 'done' | 'partial' | 'todo' | 'skipped' | 'empty' | 'locked';

export interface StepperItem {
  id: string;
  label: string;
  /** Abreviatura que se usa si los rótulos no entran (p. ej. «Sat.» por «Saturación»). */
  shortLabel?: string;
  status: StepperStatus;
  /** Texto del tooltip (estado y qué hacer). */
  hint?: ReactNode;
  /**
   * Si hubo una decisión del usuario en el paso. Solo con `false` explícito y estado `done` el marcador se dibuja como
   * anillo (calculado con valores de fábrica); sin definir, el paso se ve como siempre.
   */
  reviewed?: boolean;
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

/** Etapas de compactación, de la más holgada a la más apretada. */
export const STEPPER_FITS = ['full', 'tight', 'short', 'done', 'markers'] as const;

/**
 * Elige la primera etapa en la que la lista entra en el ancho de la barra. Mide con el DOM (un reflujo por etapa, solo
 * al cambiar el ancho, los pasos o el tamaño de interfaz).
 */
function fitStepper(nav: HTMLElement, list: HTMLElement): void {
  for (const fit of STEPPER_FITS) {
    nav.dataset['fit'] = fit;
    if (list.scrollWidth <= nav.clientWidth + 0.5) return;
  }
}

export function Stepper({ items, activeId, suggestedId, onSelect, ...aria }: StepperProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const navRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  // Clave de lo que cambia el ancho natural: rótulos, estados y paso activo.
  const shape = items.map((s) => `${s.label}|${s.status}`).join('/') + `#${activeId ?? ''}`;
  useLayoutEffect(() => {
    const nav = navRef.current;
    const list = listRef.current;
    if (!nav || !list) return;
    const fit = () => fitStepper(nav, list);
    fit();
    let lastWidth = nav.clientWidth;
    const ro = new ResizeObserver(() => {
      if (nav.clientWidth === lastWidth) return;
      lastWidth = nav.clientWidth;
      fit();
    });
    ro.observe(nav);
    // El tamaño de interfaz cambia el ancho del texto sin cambiar el de la barra: medir de nuevo en el próximo cuadro.
    let frame = 0;
    const off = subscribeUiScale(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    });
    return () => {
      ro.disconnect();
      off();
      cancelAnimationFrame(frame);
    };
  }, [shape]);
  return (
    <nav ref={navRef} className="ui-stepper" aria-label={aria['aria-label'] ?? 'Pasos'} data-fit="full">
      <ol ref={listRef} className="ui-stepper__list">
        {items.map((s, i) => {
          const active = s.id === activeId;
          const prevDone = i > 0 && (items[i - 1]!.status === 'done' || items[i - 1]!.status === 'skipped');
          const unreviewed = s.reviewed === false && s.status === 'done';
          const review = s.reviewed ? ', revisado' : unreviewed ? ', calculado con valores de fábrica' : '';
          return (
            <li key={s.id} className={`ui-step ui-step--${s.status}${unreviewed ? ' is-unreviewed' : ''}${active ? ' is-active' : ''}${s.id === suggestedId ? ' is-suggested' : ''}`}>
              {i > 0 && <span className={`ui-step__line${prevDone ? ' is-filled' : ''}`} aria-hidden="true" />}
              <Tooltip content={s.hint} placement="bottom">
                <button
                  ref={(el) => {
                    refs.current[i] = el;
                  }}
                  type="button"
                  className="ui-step__button"
                  aria-current={active ? 'step' : undefined}
                  aria-label={`Paso ${i + 1}: ${s.label}, ${STATUS_TEXT[s.status]}${review}`}
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
                  {s.shortLabel ? (
                    <span className="ui-step__label ui-step__label--abbr">
                      <span className="ui-step__full">{s.label}</span>
                      <span className="ui-step__short">{s.shortLabel}</span>
                    </span>
                  ) : (
                    <span className="ui-step__label">{s.label}</span>
                  )}
                </button>
              </Tooltip>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
