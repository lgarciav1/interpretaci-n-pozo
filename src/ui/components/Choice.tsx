/** Selección: SegmentedControl (radio), Tabs (pestañas con paneles), Checkbox y Switch. */
import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import './choice.css';
import { Icon, type IconName } from './Icon';
import { Tooltip } from './Tooltip';

/** Tecla de navegación → índice destino y dirección (para saltar opciones desactivadas). */
function rovingKey(e: KeyboardEvent, index: number, count: number): { target: number; dir: 1 | -1 } | null {
  switch (e.key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return { target: (index + 1) % count, dir: 1 };
    case 'ArrowLeft':
    case 'ArrowUp':
      return { target: (index - 1 + count) % count, dir: -1 };
    case 'Home':
      return { target: 0, dir: 1 };
    case 'End':
      return { target: count - 1, dir: -1 };
    default:
      return null;
  }
}

function skipDisabled({ target, dir }: { target: number; dir: 1 | -1 }, from: number, disabled: readonly boolean[]): number {
  const n = disabled.length;
  for (let k = 0, i = target; k < n; k++, i = (i + dir + n) % n) if (!disabled[i]) return i;
  return from;
}

// ---------------------------------------------------------------------------------------------------------------

export interface SegmentOption<V extends string> {
  value: V;
  label?: ReactNode;
  icon?: IconName;
  /** Tooltip (obligatorio si solo hay ícono: es el nombre accesible). */
  title?: string;
  disabled?: boolean;
}

export interface SegmentedControlProps<V extends string> {
  value: V;
  onChange(value: V): void;
  options: readonly SegmentOption<V>[];
  'aria-label': string;
  size?: 'sm' | 'md';
  /** Las opciones se reparten el ancho. */
  block?: boolean;
  /** Permite varias filas si no entran. */
  wrap?: boolean;
}

/** Grupo de opciones excluyentes (role="radiogroup"); flechas para moverse. */
export function SegmentedControl<V extends string>({ value, onChange, options, size = 'md', block, wrap, ...aria }: SegmentedControlProps<V>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const disabled = options.map((o) => !!o.disabled);
  const current = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div
      role="radiogroup"
      aria-label={aria['aria-label']}
      className={['ui-seg', `ui-seg--${size}`, block && 'ui-seg--block', wrap && 'ui-seg--wrap'].filter(Boolean).join(' ')}
    >
      {options.map((o, i) => {
        const checked = o.value === value;
        const button = (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={o.label === undefined ? o.title : undefined}
            tabIndex={i === current ? 0 : -1}
            disabled={o.disabled}
            className="ui-seg__item"
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              const k = rovingKey(e, i, options.length);
              if (k === null) return;
              e.preventDefault();
              const j = skipDisabled(k, i, disabled);
              refs.current[j]?.focus();
              onChange(options[j]!.value);
            }}
          >
            {o.icon && <Icon name={o.icon} size={size === 'sm' ? 14 : 15} />}
            {o.label !== undefined && <span>{o.label}</span>}
          </button>
        );
        return o.title ? (
          <Tooltip key={o.value} content={o.title} describe={o.label !== undefined}>
            {button}
          </Tooltip>
        ) : (
          button
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------

export interface TabItem {
  id: string;
  label: ReactNode;
  icon?: IconName;
  /** Contador o insignia al lado de la etiqueta. */
  badge?: ReactNode;
  disabled?: boolean;
}

export interface TabsProps {
  value: string;
  onChange(id: string): void;
  items: readonly TabItem[];
  'aria-label': string;
  /** Prefijo de ids (para enlazar con TabPanel). */
  idBase?: string;
  size?: 'sm' | 'md';
}

/** Pestañas (role="tablist"), activación automática con flechas. Usar con <TabPanel>. */
export function Tabs({ value, onChange, items, idBase, size = 'md', ...aria }: TabsProps) {
  const auto = useId();
  const base = idBase ?? auto;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const disabled = items.map((t) => !!t.disabled);
  return (
    <div role="tablist" aria-label={aria['aria-label']} className={`ui-tabs ui-tabs--${size}`}>
      {items.map((t, i) => {
        const selected = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${base}-tab-${t.id}`}
            aria-selected={selected}
            aria-controls={`${base}-panel-${t.id}`}
            tabIndex={selected ? 0 : -1}
            disabled={t.disabled}
            className="ui-tabs__tab"
            title={typeof t.label === 'string' ? t.label : undefined}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => {
              const k = rovingKey(e, i, items.length);
              if (k === null) return;
              e.preventDefault();
              const j = skipDisabled(k, i, disabled);
              refs.current[j]?.focus();
              onChange(items[j]!.id);
            }}
          >
            {t.icon && <Icon name={t.icon} size={15} />}
            <span className="ui-tabs__label">{t.label}</span>
            {t.badge !== undefined && t.badge !== null && <span className="ui-tabs__badge">{t.badge}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({ id, idBase, active, children, className }: { id: string; idBase: string; active: boolean; children: ReactNode; className?: string }) {
  return (
    <div role="tabpanel" id={`${idBase}-panel-${id}`} aria-labelledby={`${idBase}-tab-${id}`} hidden={!active} className={className} tabIndex={0}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------

export interface CheckProps {
  checked: boolean;
  onChange(checked: boolean): void;
  label?: ReactNode;
  /** Texto secundario debajo de la etiqueta. */
  description?: ReactNode;
  disabled?: boolean;
  'aria-label'?: string;
  name?: string;
  id?: string;
}

export function Checkbox({ checked, onChange, label, description, disabled, ...rest }: CheckProps) {
  return (
    <label className={`ui-check${disabled ? ' is-disabled' : ''}`}>
      <input type="checkbox" className="ui-check__input" checked={checked} disabled={disabled} onChange={(e) => onChange(e.currentTarget.checked)} {...rest} />
      <span className="ui-check__box" aria-hidden="true">
        <Icon name="check" size={12} strokeWidth={2.5} />
      </span>
      {(label || description) && (
        <span className="ui-check__text">
          {label}
          {description && <span className="ui-check__desc">{description}</span>}
        </span>
      )}
    </label>
  );
}

export function Switch({ checked, onChange, label, description, disabled, ...rest }: CheckProps) {
  return (
    <label className={`ui-switch${disabled ? ' is-disabled' : ''}`}>
      <input type="checkbox" role="switch" className="ui-switch__input" checked={checked} disabled={disabled} onChange={(e) => onChange(e.currentTarget.checked)} {...rest} />
      <span className="ui-switch__track" aria-hidden="true">
        <span className="ui-switch__thumb" />
      </span>
      {(label || description) && (
        <span className="ui-check__text">
          {label}
          {description && <span className="ui-check__desc">{description}</span>}
        </span>
      )}
    </label>
  );
}
