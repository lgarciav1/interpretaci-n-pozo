/**
 * Diálogo modal: foco atrapado (Tab/Mayús+Tab ciclan adentro), Escape y clic en el fondo cierran (salvo
 * `dismissible={false}`), el foco vuelve al disparador al cerrar y el fondo no hace scroll.
 * Foco inicial: el primer elemento con `data-autofocus`, si no el diálogo mismo.
 */
import { useEffect, useId, useRef, type ReactNode } from 'react';
import './overlay.css';
import { IconButton } from './Button';
import { focusableIn, Portal } from './layer';

export interface DialogProps {
  open: boolean;
  onClose(): void;
  title: ReactNode;
  description?: ReactNode;
  /** Contenido del encabezado a la derecha del título (p. ej. pasos de un asistente). */
  headerExtra?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
  /** `full`: ventana completa con un margen chico (mesas de trabajo). */
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
  /** Si es false, Escape y el fondo no cierran (p. ej. mientras se procesa algo). */
  dismissible?: boolean;
  className?: string;
  /** El cuerpo no tiene padding (tablas a sangre). */
  flush?: boolean;
}

let openCount = 0;

export function Dialog({ open, onClose, title, description, headerExtra, footer, children, size = 'md', dismissible = true, className, flush }: DialogProps) {
  const titleId = useId();
  const descId = useId();
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const el = ref.current;
    (el?.querySelector<HTMLElement>('[data-autofocus]') ?? el)?.focus();
    openCount++;
    document.documentElement.classList.add('ui-scroll-locked');
    return () => {
      openCount--;
      if (openCount === 0) document.documentElement.classList.remove('ui-scroll-locked');
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    <Portal>
      <div className="ui-dialog-backdrop" onMouseDown={(e) => dismissible && e.target === e.currentTarget && closeRef.current()}>
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={description ? descId : undefined}
          tabIndex={-1}
          className={['ui-dialog', `ui-dialog--${size}`, className].filter(Boolean).join(' ')}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && dismissible) {
              e.preventDefault();
              e.stopPropagation();
              closeRef.current();
              return;
            }
            if (e.key !== 'Tab' || !ref.current) return;
            const items = focusableIn(ref.current);
            if (items.length === 0) {
              e.preventDefault();
              return;
            }
            const first = items[0]!;
            const last = items[items.length - 1]!;
            const active = document.activeElement;
            if (e.shiftKey && (active === first || active === ref.current)) {
              e.preventDefault();
              last.focus();
            } else if (!e.shiftKey && active === last) {
              e.preventDefault();
              first.focus();
            }
          }}
        >
          <header className="ui-dialog__head">
            <div className="ui-dialog__titles">
              <h2 id={titleId} className="ui-dialog__title">
                {title}
              </h2>
              {description && (
                <p id={descId} className="ui-dialog__desc">
                  {description}
                </p>
              )}
            </div>
            {headerExtra && <div className="ui-dialog__extra">{headerExtra}</div>}
            <IconButton icon="x" label="Cerrar" onClick={onClose} disabled={!dismissible} tooltip={false} />
          </header>
          <div className={`ui-dialog__body${flush ? ' ui-dialog__body--flush' : ''}`}>{children}</div>
          {footer && <footer className="ui-dialog__foot">{footer}</footer>}
        </div>
      </div>
    </Portal>
  );
}
