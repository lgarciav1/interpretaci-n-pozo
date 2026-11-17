/** Contenedores: Panel (tarjeta) y Section (bloque con encabezado, opcionalmente colapsable); ResizeHandle. */
import { useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import './layout.css';
import { Icon } from './Icon';

export interface PanelProps {
  title?: ReactNode;
  /** Texto chico sobre el título. */
  overline?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  children?: ReactNode;
  className?: string;
  /** Sin padding en el cuerpo. */
  flush?: boolean;
  style?: CSSProperties;
}

/** Tarjeta con encabezado opcional. */
export function Panel({ title, overline, actions, footer, children, className, flush, style }: PanelProps) {
  return (
    <section className={['ui-panel', className].filter(Boolean).join(' ')} style={style}>
      {(title || actions || overline) && (
        <header className="ui-panel__head">
          <div className="ui-panel__titles">
            {overline && <div className="ui-overline">{overline}</div>}
            {title && <h3 className="ui-panel__title">{title}</h3>}
          </div>
          {actions && <div className="ui-panel__actions">{actions}</div>}
        </header>
      )}
      <div className={flush ? 'ui-panel__body ui-panel__body--flush' : 'ui-panel__body'}>{children}</div>
      {footer && <footer className="ui-panel__foot">{footer}</footer>}
    </section>
  );
}

export interface SectionProps {
  title: ReactNode;
  /** Cantidad o resumen a la derecha del título. */
  meta?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
  /** Abierto/plegado controlado desde afuera (con `onOpenChange`); sin él, la sección lleva su propio estado. */
  open?: boolean;
  onOpenChange?(open: boolean): void;
  className?: string;
  id?: string;
  'data-testid'?: string;
}

/** Bloque dentro de una columna o panel: encabezado en versalitas + contenido. */
export function Section({ title, meta, actions, children, collapsible = false, defaultOpen = true, open: openProp, onOpenChange, className, id, 'data-testid': testId }: SectionProps) {
  const [openState, setOpenState] = useState(defaultOpen);
  const open = openProp ?? openState;
  const toggle = () => {
    if (openProp === undefined) setOpenState(!open);
    onOpenChange?.(!open);
  };
  const bodyId = useId();
  const titleNode = (
    <>
      {collapsible && <Icon name="chevron-right" size={14} className="ui-section__chevron" />}
      <span className="ui-section__title">{title}</span>
      {meta !== undefined && meta !== null && <span className="ui-section__meta">{meta}</span>}
    </>
  );
  return (
    <section className={['ui-section', collapsible && 'is-collapsible', open && 'is-open', className].filter(Boolean).join(' ')} id={id} data-testid={testId}>
      <header className="ui-section__head">
        {collapsible ? (
          <button type="button" className="ui-section__toggle" aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
            {titleNode}
          </button>
        ) : (
          <h3 className="ui-section__heading">{titleNode}</h3>
        )}
        {actions && <div className="ui-section__actions">{actions}</div>}
      </header>
      <div id={bodyId} className="ui-section__body" hidden={collapsible && !open}>
        {children}
      </div>
    </section>
  );
}

export interface ResizeHandleProps {
  /** 'vertical' = separador entre columnas (se arrastra en X); 'horizontal' = entre filas (en Y). */
  orientation: 'vertical' | 'horizontal';
  value: number;
  min: number;
  max: number;
  onChange(value: number): void;
  /** Invierte el sentido (panel a la derecha o abajo del separador). */
  invert?: boolean;
  /** Doble clic o Enter: colapsar/expandir. */
  onToggle?(): void;
  label: string;
}

/** Separador redimensionable accesible (role="separator"): arrastre, flechas (Mayús ×4), Inicio/Fin, Enter. */
export function ResizeHandle({ orientation, value, min, max, onChange, invert = false, onToggle, label }: ResizeHandleProps) {
  const start = useRef<{ pos: number; value: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const clampV = (v: number) => Math.round(Math.min(max, Math.max(min, v)));
  const sign = invert ? -1 : 1;
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      className={`ui-resize ui-resize--${orientation}${dragging ? ' is-dragging' : ''}`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { pos: orientation === 'vertical' ? e.clientX : e.clientY, value };
        setDragging(true);
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        const pos = orientation === 'vertical' ? e.clientX : e.clientY;
        onChange(clampV(start.current.value + sign * (pos - start.current.pos)));
      }}
      onPointerUp={() => {
        start.current = null;
        setDragging(false);
      }}
      onPointerCancel={() => {
        start.current = null;
        setDragging(false);
      }}
      onDoubleClick={onToggle}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 64 : 16;
        const inc = orientation === 'vertical' ? ['ArrowRight', 'ArrowLeft'] : ['ArrowDown', 'ArrowUp'];
        if (e.key === inc[0]) onChange(clampV(value + sign * step));
        else if (e.key === inc[1]) onChange(clampV(value - sign * step));
        else if (e.key === 'Home') onChange(min);
        else if (e.key === 'End') onChange(max);
        else if (e.key === 'Enter' && onToggle) onToggle();
        else return;
        e.preventDefault();
      }}
    />
  );
}
