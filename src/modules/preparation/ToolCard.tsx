/**
 * Piezas comunes de las herramientas de «Preparar datos» (0058): la tarjeta, el slider de parámetro y el rótulo del
 * tramo. Los sliders cambian el BORRADOR (no el proyecto): la vista previa se recalcula sola y el proyecto cambia una
 * sola vez, al «Aplicar» (un paso de deshacer). Escape durante un arrastre vuelve al valor de antes del gesto.
 */
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Badge, Field, Icon, SliderField, formatNumber, valueToPosition, type IconName, type Tone } from '../../ui';
import type { DepthRange } from './types';

export function ToolShell({ title, icon, description, status, children, footer, onClose }: {
  title: string;
  icon: IconName;
  description: string;
  status?: { tone: Tone; label: string } | undefined;
  children?: ReactNode;
  footer?: ReactNode;
  onClose?: () => void;
}) {
  const id = useId();
  return (
    <section className="prep-tool is-open" aria-labelledby={id}>
      <header className="prep-tool__head">
        <span className="prep-tool__icon" aria-hidden="true">
          <Icon name={icon} size={16} />
        </span>
        <div className="prep-tool__titles">
          <h3 className="prep-tool__title" id={id}>
            {title}
          </h3>
          <p className="prep-tool__desc">{description}</p>
        </div>
        {status && <Badge tone={status.tone}>{status.label}</Badge>}
        {onClose && (
          <button type="button" className="prep-tool__close" onClick={onClose} aria-label={`Cerrar ${title}`} title="Volver a las herramientas">
            <Icon name="x" size={14} />
          </button>
        )}
      </header>
      {children && <div className="prep-tool__body">{children}</div>}
      {footer && <footer className="prep-tool__foot">{footer}</footer>}
    </section>
  );
}

/** Tarjeta compacta de la lista de herramientas (abre la herramienta). */
export function ToolTile({ title, icon, description, status, onOpen, disabledReason }: {
  title: string;
  icon: IconName;
  description: string;
  status?: { tone: Tone; label: string } | undefined;
  onOpen(): void;
  disabledReason?: string | null;
}) {
  return (
    <button type="button" className="prep-tile" onClick={onOpen} aria-describedby={undefined} title={disabledReason ?? undefined}>
      <span className="prep-tool__icon" aria-hidden="true">
        <Icon name={icon} size={16} />
      </span>
      <span className="prep-tile__text">
        <span className="prep-tile__title">{title}</span>
        <span className="prep-tile__desc">{disabledReason ?? description}</span>
      </span>
      {status && <Badge tone={status.tone}>{status.label}</Badge>}
      <Icon name="chevron-right" size={14} />
    </button>
  );
}

/**
 * Slider de un parámetro del borrador. Escape durante el arrastre restaura el valor del comienzo del gesto e ignora el
 * resto del arrastre; las flechas del teclado cambian de a un paso.
 */
export function DraftSlider({ label, hint, value, onChange, min, max, step, scale, unit, format, tooltip }: {
  label: string;
  hint?: ReactNode;
  value: number;
  onChange(v: number): void;
  min: number;
  max: number;
  step?: number;
  scale?: 'linear' | 'log';
  unit?: string;
  format?: (v: number) => string;
  tooltip?: string;
}) {
  const id = useId();
  const gesture = useRef<{ start: number; cancelled: boolean } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const latest = useRef(value);
  latest.current = value;
  // El riel nativo sigue al puntero aunque se ignoren sus cambios: al cancelar se lo vuelve a poner en el valor.
  const resync = () => {
    const input = box.current?.querySelector<HTMLInputElement>('input[type=range]');
    if (input) input.value = String(valueToPosition(latest.current, { min, max, ...(step !== undefined ? { step } : {}), ...(scale ? { scale } : {}) }));
  };
  const resyncRef = useRef(resync);
  resyncRef.current = resync;
  useEffect(() => {
    const end = () => {
      if (gesture.current?.cancelled) requestAnimationFrame(() => resyncRef.current());
      gesture.current = null;
    };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, []);
  const fmt = format ?? ((v: number) => formatNumber(v, { digits: 2 }));
  return (
    <Field label={label} htmlFor={id} hint={hint} tooltip={tooltip}>
      <div
        ref={box}
        className="prep-slider"
        onPointerDownCapture={() => {
          gesture.current = { start: value, cancelled: false };
        }}
        onKeyDownCapture={(e) => {
          const g = gesture.current;
          if (e.key === 'Escape' && g && !g.cancelled) {
            e.preventDefault();
            e.stopPropagation();
            g.cancelled = true;
            latest.current = g.start;
            onChange(g.start);
            resync();
          }
        }}
      >
        <SliderField
          id={id}
          aria-label={label}
          value={value}
          min={min}
          max={max}
          {...(step !== undefined ? { step } : {})}
          scale={scale ?? 'linear'}
          unit={unit}
          formatValue={(v) => `${fmt(v)}${unit ? ` ${unit}` : ''}`}
          onChange={(v) => {
            if (gesture.current?.cancelled) {
              resync();
              return;
            }
            onChange(v);
          }}
        />
      </div>
    </Field>
  );
}

const m = (v: number) => formatNumber(v, { digits: 2 });

/** Rótulo del tramo que usa una herramienta, con de dónde sale. */
export function RangeNote({ range, fromSelection, onClear }: { range: DepthRange | null; fromSelection: boolean; onClear?: () => void }) {
  if (!range) return <p className="prep-note">Elegí un tramo: arrastrá sobre el gráfico o escribí tope y base arriba.</p>;
  return (
    <p className="prep-note">
      <Icon name="fit-height" size={13} />
      <span className="prep-note__text">
        Tramo <strong className="num">{m(range.top)} – {m(range.base)} m</strong> {fromSelection ? '(marcado en el gráfico).' : '(toda la vista). Arrastrá sobre el gráfico para acotarlo.'}
        {fromSelection && onClear && (
          <button type="button" className="prep-link" onClick={onClear}>
            Usar toda la vista
          </button>
        )}
      </span>
    </p>
  );
}
