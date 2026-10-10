/**
 * Popover: capa flotante NO modal anclada a un elemento (editor de escala de una curva, detalles). role="dialog"
 * con nombre accesible; al abrir enfoca `[data-autofocus]` o el primer control; Tab circula adentro; Escape cierra
 * y devuelve el foco al ancla; un clic afuera cierra sin robar el foco. Se reubica al hacer scroll o cambiar el
 * tamaño de la ventana (gira si no entra).
 */
import { useEffect, useRef, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import './overlay.css';
import { scaledCss } from '../uiScale';
import { focusableIn, Portal, useAnchoredPosition, useOutsidePointerDown, type Align, type Placement } from './layer';

export interface PopoverProps {
  open: boolean;
  /** Elemento al que se ancla (y al que vuelve el foco al cerrar con Escape). */
  anchorRef: RefObject<HTMLElement | null>;
  onClose(): void;
  /** Nombre accesible del diálogo. */
  label: string;
  placement?: Placement;
  align?: Align;
  /** Ancho en px. */
  width?: number;
  className?: string;
  children: ReactNode;
}

export function Popover({ open, anchorRef, onClose, label, placement = 'bottom', align = 'start', width = 300, className, children }: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const pos = useAnchoredPosition(anchorRef, ref, open, placement, align, 6);
  const refs = useRef([anchorRef, ref] as const);
  refs.current = [anchorRef, ref] as const;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useOutsidePointerDown(refs.current, () => closeRef.current(), open);

  // Foco inicial cuando la capa ya está ubicada.
  const focused = useRef(false);
  useEffect(() => {
    if (!open) {
      focused.current = false;
      return;
    }
    if (!pos.ready || focused.current || !ref.current) return;
    focused.current = true;
    const el = ref.current.querySelector<HTMLElement>('[data-autofocus]') ?? focusableIn(ref.current)[0] ?? ref.current;
    el.focus({ preventScroll: true });
  }, [open, pos.ready]);

  if (!open) return null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      anchorRef.current?.focus();
    } else if (e.key === 'Tab' && ref.current) {
      const items = focusableIn(ref.current);
      if (!items.length) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const style: CSSProperties = { top: pos.top, left: pos.left, width: scaledCss(width) };
  return (
    <Portal>
      <div
        ref={ref}
        role="dialog"
        aria-modal="false"
        aria-label={label}
        tabIndex={-1}
        className={['ui-popover', className].filter(Boolean).join(' ')}
        data-open={pos.ready ? '' : undefined}
        data-placement={pos.placement}
        style={style}
        onKeyDown={onKeyDown}
      >
        {children}
      </div>
    </Portal>
  );
}
