/**
 * Tooltip accesible: aparece al pasar el mouse (con demora) o al llegar con el teclado (`:focus-visible`), se
 * cierra con Escape, al salir o al hacer clic. Con `describe` (por defecto) el contenido queda enlazado al
 * disparador con `aria-describedby`, así lo leen los lectores de pantalla.
 */
import { cloneElement, isValidElement, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';
import './tooltip.css';
import { Portal, useAnchoredPosition, type Align, type Placement } from './layer';

export interface TooltipProps {
  content: ReactNode;
  children: ReactElement;
  placement?: Placement;
  align?: Align;
  /** Demora al pasar el mouse, en ms. */
  delay?: number;
  /** Enlaza el contenido con aria-describedby (desactivar si ya es el nombre accesible, como en IconButton). */
  describe?: boolean;
  /** El ancla ocupa todo el ancho (para disparadores de bloque). */
  block?: boolean;
  disabled?: boolean;
}

export function Tooltip({ content, children, placement = 'top', align = 'center', delay = 450, describe = true, block = false, disabled = false }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const pos = useAnchoredPosition(anchorRef, tipRef, open, placement, align, 6);
  const active = !disabled && content !== null && content !== undefined && content !== '';

  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  const show = (immediate = false) => {
    if (!active) return;
    window.clearTimeout(timer.current);
    if (immediate) setOpen(true);
    else timer.current = window.setTimeout(() => setOpen(true), delay);
  };
  const hide = () => {
    window.clearTimeout(timer.current);
    setOpen(false);
  };

  const child = isValidElement<{ 'aria-describedby'?: string }>(children) && describe && active
    ? cloneElement(children, { 'aria-describedby': [children.props['aria-describedby'], id].filter(Boolean).join(' ') })
    : children;

  return (
    <>
      <span
        ref={anchorRef}
        className={block ? 'ui-tooltip-anchor ui-tooltip-anchor--block' : 'ui-tooltip-anchor'}
        onPointerEnter={(e) => e.pointerType === 'mouse' && show()}
        onPointerLeave={hide}
        onPointerDown={hide}
        onFocus={(e) => {
          if ((e.target as HTMLElement).matches?.(':focus-visible')) show(true);
        }}
        onBlur={hide}
      >
        {child}
      </span>
      {/* Con aria-describedby el contenido queda montado (oculto) para que el lector lo encuentre; si no, solo al abrir. */}
      {active && (describe || open) && (
        <Portal>
          <div
            ref={tipRef}
            id={id}
            role="tooltip"
            className="ui-tooltip"
            data-open={open && pos.ready ? '' : undefined}
            data-placement={pos.placement}
            style={{ top: pos.top, left: pos.left }}
          >
            {content}
          </div>
        </Portal>
      )}
    </>
  );
}
